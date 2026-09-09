begin;

-- A fresh world may not yet have a price basket; products remain available.
CREATE OR REPLACE FUNCTION economy_private.on_product_price_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  basket_id uuid;
  observed_price numeric;
  rp_at timestamptz := public.rp_now();
begin
  if tg_op = 'UPDATE'
     and new.price is not distinct from old.price
     and new.promotion_price is not distinct from old.promotion_price then
    return new;
  end if;

  basket_id := economy_private.resolve_product_basket_item(new);
  if basket_id is null then return new; end if;
  observed_price := case
    when new.promotion_price is not null
      and (new.promotion_expires_at is null or new.promotion_expires_at > now())
      then new.promotion_price
    else new.price
  end;

  insert into public.price_observations (
    basket_item_id,
    product_id,
    sector_id,
    source_table,
    source_id,
    price,
    observed_at_real,
    observed_at_rp,
    period_id,
    metadata
  )
  values (
    basket_id,
    new.id,
    coalesce(
      new.economic_sector_id,
      (select pbi.sector_id from public.price_basket_items pbi where pbi.id = basket_id)
    ),
    'products',
    new.id::text || ':' || extract(epoch from now())::bigint::text,
    observed_price,
    now(),
    rp_at,
    economy_private.period_for('month', rp_at),
    jsonb_build_object('category', new.category, 'product_type', new.product_type)
  )
  on conflict do nothing;

  return new;
end;
$function$

;
alter function economy_private.on_product_price_change() owner to postgres;

insert into public.system_settings(key,value,description) values('citizen_needs',
 '{"decay_per_rp_day":{"hunger":4,"thirst":5,"hygiene":2,"social":2,"sleep":3},"offline_decay_cap":20,"offline_floor":30,"grace_rp_days":2,"bath_cooldown_rp_hours":8,"sleep_cooldown_rp_hours":12,"social_daily_cap":12}',
 'Necessidades moderadas no tempo RP, sem morte ou penalidades políticas.') on conflict do nothing;
create table public.citizen_needs (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 health numeric not null default 100 check(health between 25 and 100),
 hunger numeric not null default 100 check(hunger between 0 and 100),
 thirst numeric not null default 100 check(thirst between 0 and 100),
 hygiene numeric not null default 100 check(hygiene between 0 and 100),
 social numeric not null default 100 check(social between 0 and 100),
 sleep numeric not null default 100 check(sleep between 0 and 100),
 updated_at timestamptz not null default clock_timestamp(),
 updated_at_rp timestamptz not null default public.rp_now(),
 grace_until_rp timestamptz not null,
 last_bath_rp timestamptz,last_sleep_rp timestamptz,last_social_at timestamptz,
 social_day date,social_earned numeric not null default 0,
 alert_bands jsonb not null default '{}'
);
create table private.citizen_need_actions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 action text not null,reference_id uuid,idempotency_key uuid unique,result jsonb,
 created_at timestamptz not null default clock_timestamp(),occurred_at_rp timestamptz not null default public.rp_now()
);
create index citizen_need_actions_user_time on private.citizen_need_actions(user_id,created_at desc);
alter table public.citizen_needs enable row level security;
alter table private.citizen_need_actions enable row level security;
revoke all on public.citizen_needs from public,anon,authenticated;
grant select on public.citizen_needs to authenticated;
grant all on public.citizen_needs to service_role;
create policy needs_owner_read on public.citizen_needs for select to authenticated using(user_id=(select auth.uid()));

create or replace function private.assert_citizen_service(p_service text)
returns void language plpgsql security definer set search_path='' as $$
declare settings jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed) then raise exception 'Conclua sua cidadania para usar este serviço.' using errcode='42501'; end if;
 select value into settings from public.system_settings where key='service_availability';
 if coalesce(settings->'__site__'->>'mode','active')<>'active' or coalesce(settings->p_service->>'mode','active')<>'active' then raise exception 'Este serviço está temporariamente indisponível. Tente novamente mais tarde.'; end if;
end; $$;

create or replace function private.refresh_citizen_needs(p_user_id uuid)
returns public.citizen_needs language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype; cfg jsonb; elapsed numeric; offline boolean; day_rp timestamptz:=public.rp_now(); values_json jsonb; k text; v numeric; loss numeric; band integer; alerts jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_user_id and onboarding_completed) then return null; end if;
 select value into cfg from public.system_settings where key='citizen_needs';
 insert into public.citizen_needs(user_id,grace_until_rp) values(p_user_id,day_rp+make_interval(days=>coalesce((cfg->>'grace_rp_days')::integer,2))) on conflict do nothing;
 select * into n from public.citizen_needs where user_id=p_user_id for update;
 elapsed:=greatest(0,extract(epoch from (day_rp-greatest(n.updated_at_rp,n.grace_until_rp)))/86400);
 offline:=clock_timestamp()-n.updated_at>interval '2 minutes';
 values_json:=to_jsonb(n); alerts:=n.alert_bands;
 foreach k in array array['hunger','thirst','hygiene','social','sleep'] loop
   loss:=elapsed*coalesce((cfg->'decay_per_rp_day'->>k)::numeric,2);
   if offline then loss:=least(loss,coalesce((cfg->>'offline_decay_cap')::numeric,20)); end if;
   v:=greatest(0,(values_json->>k)::numeric-loss);
   if offline then v:=greatest(least((values_json->>k)::numeric,coalesce((cfg->>'offline_floor')::numeric,30)),v); end if;
   values_json:=jsonb_set(values_json,array[k],to_jsonb(round(v,2)));
   band:=case when v<=15 then 15 when v<=30 then 30 else 0 end;
   if band>0 and (coalesce((alerts->>k)::integer,100)>band) then
     insert into public.notifications(user_id,type,content,link,metadata) values(p_user_id,'citizen_need_alert',
       case k when 'hunger' then 'Sua fome está baixa. Consuma um alimento do inventário.' when 'thirst' then 'Sua sede está baixa. Consuma uma bebida.' when 'hygiene' then 'É hora de cuidar da higiene. Tome banho em sua residência.' when 'sleep' then 'Seu cidadão está cansado. Descanse em sua residência.' else 'Seu cidadão precisa socializar. Participe da Rede X.' end,
       case when k='social' then '/services/x' when k in('hygiene','sleep') then '/services/national-housing' else '/services/inventory' end,jsonb_build_object('need',k,'threshold',band));
     alerts:=jsonb_set(alerts,array[k],to_jsonb(band));
   elsif v>=40 then alerts:=alerts-k; end if;
 end loop;
 if least(n.hunger,n.thirst,n.hygiene,n.sleep)<20 then n.health:=greatest(25,n.health-least(5,elapsed*.5));
 elsif least(n.hunger,n.thirst,n.hygiene,n.sleep)>=50 then n.health:=least(100,n.health+least(5,elapsed)); end if;
 update public.citizen_needs set health=round(n.health,2),hunger=(values_json->>'hunger')::numeric,thirst=(values_json->>'thirst')::numeric,
 hygiene=(values_json->>'hygiene')::numeric,social=(values_json->>'social')::numeric,sleep=(values_json->>'sleep')::numeric,
 updated_at=clock_timestamp(),updated_at_rp=day_rp,alert_bands=alerts where user_id=p_user_id returning * into n;
 return n;
end; $$;
create or replace function public.get_citizen_needs()
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype; age_rp integer;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 n:=private.refresh_citizen_needs(auth.uid());
 if n.user_id is null then return null; end if;
 select extract(year from age(public.rp_now(),date_of_birth))::integer into age_rp from public.profiles where id=auth.uid();
 return to_jsonb(n)||jsonb_build_object('age_rp',greatest(0,age_rp),'rp_now',public.rp_now());
end; $$;

-- State offers share the existing product catalog, inventory, transactions and commerce orders.
alter table public.products add column state_enterprise_id uuid references public.state_enterprises(id),
 add column consumable_effects jsonb not null default '{}',add column residence_spec jsonb;
alter table public.products alter column seller_id drop not null;
alter table public.products add constraint products_owner_kind check((seller_id is not null and state_enterprise_id is null) or (seller_id is null and state_enterprise_id is not null));
alter table public.commerce_orders add column state_enterprise_id uuid references public.state_enterprises(id);
alter table public.commerce_orders alter column seller_account_id drop not null;
alter table public.commerce_orders add constraint commerce_order_destination check(seller_account_id is not null or state_enterprise_id is not null);
create table public.citizen_residences (
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id),
 inventory_id uuid not null unique references public.user_inventory(id),product_id uuid not null references public.products(id),
 transaction_id uuid references public.transactions(id),name text not null,city text not null,state text not null,area_sqm numeric not null,
 purchase_price numeric not null check(purchase_price>0),quality integer not null default 1 check(quality between 1 and 3),
 acquired_at timestamptz not null default clock_timestamp(),status text not null default 'owned' check(status in('owned','listed','transferred'))
);
create index residences_owner on public.citizen_residences(owner_id,status);
alter table public.citizen_residences enable row level security;
revoke all on public.citizen_residences from public,anon,authenticated;
grant select on public.citizen_residences to authenticated;
grant all on public.citizen_residences to service_role;
create policy residences_owner_read on public.citizen_residences for select to authenticated using(owner_id=(select auth.uid()));
create or replace function private.validate_citizen_product()
returns trigger language plpgsql set search_path='' as $$
declare k text; v jsonb;
begin
 if current_user not in('postgres','supabase_admin','service_role') and (new.state_enterprise_id is not null or new.residence_spec is not null) then raise exception 'Somente a gestão autorizada pode cadastrar ofertas estatais e imóveis.' using errcode='42501'; end if;
 if jsonb_typeof(new.consumable_effects)<>'object' then raise exception 'Defina os efeitos do consumível corretamente.'; end if;
 for k,v in select * from jsonb_each(new.consumable_effects) loop
   if k not in('hunger','thirst') or jsonb_typeof(v)<>'number' or v::numeric<=0 or v::numeric>60 then raise exception 'Consumíveis podem recuperar até 60 pontos de fome ou sede.'; end if;
 end loop;
 if new.consumable_effects<>'{}' and (new.product_type<>'one-time' or new.category not in('Alimentos','Bebidas')) then raise exception 'Consumíveis devem ser produtos de alimentos ou bebidas com quantidade em estoque.'; end if;
 return new;
end; $$;
create trigger validate_citizen_product before insert or update on public.products for each row execute function private.validate_citizen_product();

create or replace function private.buy_state_product(p_product_id uuid,p_payment_method text,p_card_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; a public.accounts%rowtype; t uuid; inv uuid; q jsonb; total numeric; tax numeric; net numeric; o uuid; spec jsonb; service_path text;
begin
 select * into p from public.products where id=p_product_id for update;
 service_path:=case when p.residence_spec is null then '/services/national-market' else '/services/national-housing' end;
 perform private.assert_citizen_service(service_path);
 if not exists(select 1 from public.state_enterprises where id=p.state_enterprise_id and is_active and not is_privatized) then raise exception 'Esta oferta estatal está indisponível.'; end if;
 if p_payment_method<>'balance' or p_card_id is not null then raise exception 'O serviço estatal aceita pagamento com saldo do Banco Nacional.'; end if;
 if p.price<=0 then raise exception 'A oferta precisa de um preço válido.'; end if;
 q:=public.quote_legal_levies('purchase',p.price,false,p.economic_sector_id,p.category);
 if (q->>'restricted')::boolean then raise exception 'Esta operação está temporariamente restrita por norma vigente.'; end if;
 total:=(q->>'total_debited')::numeric;tax:=(q->>'buyer_tax')::numeric+(q->>'seller_tax')::numeric;net:=(q->>'net_amount')::numeric;
 select * into a from public.accounts where user_id=auth.uid() for update;
 if not found then raise exception 'Abra sua conta no Banco Nacional antes de comprar.'; end if;
 if a.balance<total then raise exception 'Saldo insuficiente para esta compra.'; end if;
 update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=a.id;
 update public.government_finances set treasury_balance=treasury_balance+total,updated_at=clock_timestamp() where id=1;
 insert into public.transactions(from_account_id,amount,description,type,metadata,idempotency_key)
 values(a.id,total,'Compra: '||p.name,'purchase',q||jsonb_build_object('platform',case when p.residence_spec is null then 'Mercado Nacional' else 'Imobiliária Nacional' end,'state_enterprise_id',p.state_enterprise_id,'product_id',p.id,'base_price',p.price),p_idempotency_key) returning id into t;
 insert into public.commerce_orders(idempotency_key,buyer_id,product_id,buyer_account_id,state_enterprise_id,payment_method,base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id)
 values(p_idempotency_key,auth.uid(),p.id,a.id,p.state_enterprise_id,'balance',p.price,(q->>'buyer_tax')::numeric,(q->>'seller_tax')::numeric,total,net,t) returning id into o;
 insert into public.user_inventory(user_id,product_id,quantity,metadata) values(auth.uid(),p.id,1,jsonb_build_object('transaction_id',t,'origin',service_path,'purchase_price',p.price,'consumable_effects',p.consumable_effects)) returning id into inv;
 if p.residence_spec is not null then
   spec:=p.residence_spec;
   insert into public.citizen_residences(owner_id,inventory_id,product_id,transaction_id,name,city,state,area_sqm,purchase_price,quality)
   values(auth.uid(),inv,p.id,t,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer);
   insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_acquired','Você adquiriu '||p.name||'. Sua residência permite dormir e tomar banho.','/services/national-housing');
 end if;
 insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
 values('other','commerce_orders',o::text,auth.uid(),net,public.rp_now(),jsonb_build_object('state_enterprise_id',p.state_enterprise_id,'transaction_id',t));
 if tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','commerce_orders',o::text,auth.uid(),tax,public.rp_now(),q); end if;
 update public.products set sales_count=coalesce(sales_count,0)+1 where id=p.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('commerce_purchase_completed','economy','commerce_orders',o,auth.uid(),jsonb_build_object('stateEnterpriseId',p.state_enterprise_id,'productId',p.id,'total',total,'tax',tax,'transactionId',t),'commerce-purchase:'||p_idempotency_key);
 return jsonb_build_object('success',true,'message','Compra concluída.','transaction_id',t,'order_id',o,'total',total,'tax',tax);
end; $$;

create or replace function public.citizen_need_action(p_action text,p_reference_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype; item public.user_inventory%rowtype; effects jsonb; cfg jsonb; residence public.citizen_residences%rowtype; previous private.citizen_need_actions%rowtype; result jsonb;
begin
 if auth.uid() is null or p_idempotency_key is null then raise exception 'Autenticação e identificação da ação são necessárias.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into previous from private.citizen_need_actions where idempotency_key=p_idempotency_key;
 if found then
   if previous.user_id<>auth.uid() or previous.action<>p_action or previous.reference_id is distinct from p_reference_id then raise exception 'Esta ação já foi usada em outra operação.'; end if;
   return previous.result;
 end if;
 n:=private.refresh_citizen_needs(auth.uid());
 if n.user_id is null then raise exception 'Conclua sua cidadania antes de cuidar das necessidades.'; end if;
 select value into cfg from public.system_settings where key='citizen_needs';
 if p_action='consume' then
   perform private.assert_citizen_service('/services/inventory');
   select * into item from public.user_inventory where id=p_reference_id and user_id=auth.uid() and quantity>0 for update;
   if not found then raise exception 'Este item não está disponível no seu inventário.'; end if;
   select coalesce(item.metadata->'consumable_effects',consumable_effects) into effects from public.products where id=item.product_id;
   if effects is null or effects='{}' then raise exception 'Este produto não é consumível.'; end if;
   if (coalesce((effects->>'hunger')::numeric,0)=0 or n.hunger>=100) and (coalesce((effects->>'thirst')::numeric,0)=0 or n.thirst>=100) then raise exception 'Suas necessidades de alimentação e bebida já estão completas.'; end if;
   update public.user_inventory set quantity=quantity-1 where id=item.id;
   n.hunger:=least(100,n.hunger+coalesce((effects->>'hunger')::numeric,0));n.thirst:=least(100,n.thirst+coalesce((effects->>'thirst')::numeric,0));
 elsif p_action in('bath','sleep') then
   perform private.assert_citizen_service('/services/national-housing');
   select * into residence from public.citizen_residences where id=p_reference_id and owner_id=auth.uid() and status='owned';
   if not found then raise exception 'Você precisa possuir esta residência para usá-la.' using errcode='42501'; end if;
   if p_action='bath' then
     if n.last_bath_rp+make_interval(hours=>coalesce((cfg->>'bath_cooldown_rp_hours')::integer,8))>public.rp_now() then raise exception 'Você já tomou banho recentemente. Aguarde o intervalo do RP.'; end if;
     n.hygiene:=100;n.last_bath_rp:=public.rp_now();
   else
     if n.last_sleep_rp+make_interval(hours=>coalesce((cfg->>'sleep_cooldown_rp_hours')::integer,12))>public.rp_now() then raise exception 'Você já descansou recentemente. Aguarde o intervalo do RP.'; end if;
     n.sleep:=100;n.last_sleep_rp:=public.rp_now();
   end if;
 else raise exception 'Escolha consumir, tomar banho ou dormir.'; end if;
 update public.citizen_needs set hunger=n.hunger,thirst=n.thirst,hygiene=n.hygiene,sleep=n.sleep,last_bath_rp=n.last_bath_rp,last_sleep_rp=n.last_sleep_rp,updated_at=clock_timestamp(),alert_bands=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(n.alert_bands) where coalesce((to_jsonb(n)->>key)::numeric,0)<40) where user_id=auth.uid() returning * into n;
 result:=to_jsonb(n);
 insert into private.citizen_need_actions(user_id,action,reference_id,idempotency_key,result) values(auth.uid(),p_action,p_reference_id,p_idempotency_key,result);
 return result;
end; $$;

create or replace function private.social_need_reward()
returns trigger language plpgsql security definer set search_path='' as $$
declare n public.citizen_needs%rowtype; actor uuid:=new.user_id; reward numeric; cap numeric; today date:=(public.rp_now() at time zone 'UTC')::date;
begin
 if actor is null or not exists(select 1 from public.profiles where id=actor and onboarding_completed) then return new; end if;
 if tg_table_name in('comments','posts') and length(trim(coalesce(to_jsonb(new)->>'content','')))<10 then return new; end if;
 if tg_table_name='likes' and exists(select 1 from public.posts where id=(to_jsonb(new)->>'post_id')::uuid and user_id=actor) then return new; end if;
 n:=private.refresh_citizen_needs(actor);
 if n.last_social_at>clock_timestamp()-interval '5 minutes' then return new; end if;
 select coalesce((value->>'social_daily_cap')::numeric,12) into cap from public.system_settings where key='citizen_needs';
 if n.social_day is distinct from today then n.social_earned:=0; end if;
 reward:=least(greatest(0,cap-n.social_earned),case when tg_table_name='likes' then .5 else 3 end/(1+n.social_earned/6));
 if reward<=0 then return new; end if;
 update public.citizen_needs set social=least(100,social+reward),social_day=today,social_earned=n.social_earned+reward,last_social_at=clock_timestamp() where user_id=actor;
 insert into private.citizen_need_actions(user_id,action,reference_id,result) values(actor,'social:'||tg_table_name,coalesce((to_jsonb(new)->>'id')::uuid,(to_jsonb(new)->>'post_id')::uuid),jsonb_build_object('reward',reward));
 return new;
end; $$;
create trigger posts_need_reward after insert on public.posts for each row execute function private.social_need_reward();
create trigger comments_need_reward after insert on public.comments for each row execute function private.social_need_reward();
create trigger likes_need_reward after insert on public.likes for each row execute function private.social_need_reward();
create trigger stories_need_reward after insert on public.stories for each row execute function private.social_need_reward();

CREATE OR REPLACE FUNCTION public.buy_product(p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid:=auth.uid();v_product public.products%rowtype;v_business public.businesses%rowtype;
  v_buyer_account public.accounts%rowtype;v_seller_account public.accounts%rowtype;v_card public.cards%rowtype;
  v_base numeric;v_consumption_rate numeric;v_corporate_rate numeric;v_consumption_tax numeric;v_corporate_tax numeric;
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id); end if;
  perform public.process_due_legal_effects();
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  perform private.assert_citizen_service('/services/business');
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for share;
    if not found or v_business.status is distinct from 'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.owner_id is distinct from v_product.seller_id then raise exception 'SELLER_OWNERSHIP_CHANGED'; end if;
  end if;
  -- Consistent account lock order avoids opposing purchases deadlocking.
  perform id from public.accounts
    where user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id order by id for update;
  if v_product.business_id is null then
    select * into v_seller_account from public.accounts where user_id=v_product.seller_id;
  else
    select * into v_seller_account from public.accounts where id=v_business.bank_account_id;
  end if;
  if not found then raise exception 'SELLER_BANK_ACCOUNT_REQUIRED'; end if;
  if v_product.product_type='one-time' and coalesce(v_product.stock,0)<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
  v_base:=case when v_product.promotion_price is not null and v_product.promotion_expires_at>clock_timestamp() then v_product.promotion_price else v_product.price end;
  v_levies:=public.quote_legal_levies('purchase',v_base,v_product.business_id is not null,coalesce(v_product.economic_sector_id,v_business.economic_sector_id),v_product.category);
  if (v_levies->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_consumption_tax:=(v_levies->>'buyer_tax')::numeric;v_corporate_tax:=(v_levies->>'seller_tax')::numeric;
  v_total:=(v_levies->>'total_debited')::numeric;v_seller_net:=(v_levies->>'net_amount')::numeric;

  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where user_id=v_buyer for update;
    if not found then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED'; end if;
    if v_buyer_account.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
    update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_buyer_account.id;
  elsif p_payment_method='card' then
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active for update;
    if not found then raise exception 'INVALID_CARD'; end if;
    if v_card.card_limit-v_card.used_limit<v_total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
    update public.cards set used_limit=used_limit+v_total where id=v_card.id;
  else raise exception 'INVALID_PAYMENT_METHOD'; end if;

  update public.accounts set balance=balance+v_seller_net,updated_at=clock_timestamp() where id=v_seller_account.id;
  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  update public.government_finances set treasury_balance=treasury_balance+v_consumption_tax+v_corporate_tax,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_buyer_account.id,v_seller_account.id,v_total,'Compra: '||v_product.name,
    case when p_payment_method='card' then 'purchase_card' else 'purchase' end,
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at
  ) values(p_idempotency_key,v_buyer,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp()) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
  end if;

  if v_consumption_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('consumption_tax','commerce_orders',v_order.id::text,v_buyer,v_business.id,v_consumption_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;
  if v_corporate_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('corporate_tax','commerce_orders',v_order.id::text,v_business.owner_id,v_business.id,v_corporate_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;

  if v_product.product_type='subscription' then
    insert into public.user_subscriptions(user_id,product_id,seller_id,status,last_payment_date,next_payment_date)
    values(v_buyer,v_product.id,v_product.seller_id,'active',clock_timestamp(),clock_timestamp()+(v_product.subscription_interval)::interval);
    update public.products set subscribers_count=coalesce(subscribers_count,0)+1 where id=v_product.id;
  else
    insert into public.user_inventory(user_id,product_id,quantity,acquired_at,metadata) values(v_buyer,v_product.id,1,clock_timestamp(),jsonb_build_object('consumable_effects',v_product.consumable_effects,'transaction_id',v_transaction,'origin','Negócios Livres','purchase_price',v_base));
    update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=v_product.id;
  end if;
  if p_payment_method='card' then
    select id into v_invoice from public.card_invoices where card_id=v_card.id and status='open' order by created_at desc limit 1 for update;
    if v_invoice is null then
      insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
      values(v_card.id,v_buyer,current_date+30,current_date+40,v_total,'open') returning id into v_invoice;
    else update public.card_invoices set amount=amount+v_total,updated_at=clock_timestamp() where id=v_invoice; end if;
    insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(v_invoice,v_transaction,'Compra: '||v_product.name,v_total);
  end if;
  select full_name into v_buyer_name from public.profiles where id=v_buyer;
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(v_product.seller_id,v_buyer,'product_sold',coalesce(v_buyer_name,'Um cidadão')||' comprou: '||v_product.name,'/dashboard?tab=products');
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('commerce_purchase_completed','economy','commerce_orders',v_order.id,v_buyer,
    jsonb_build_object('businessId',v_business.id,'productId',v_product.id,'total',v_total,'tax',v_consumption_tax+v_corporate_tax,'transactionId',v_transaction),
    'commerce-purchase:'||p_idempotency_key,'processed',clock_timestamp());
  return jsonb_build_object('success',true,'message','Compra realizada com sucesso!','transaction_id',v_transaction,'order_id',v_order.id,
    'total',v_total,'tax',v_consumption_tax+v_corporate_tax);
exception when others then
  raise;
end;
$function$;

insert into public.state_enterprises(id,name,sector,description,is_system,is_active) values
 ('f2000000-0000-4000-8000-000000000001','Mercado Nacional','Comércio Varejista','Alimentos e bebidas essenciais para os cidadãos.',true,true),
 ('f2000000-0000-4000-8000-000000000002','Imobiliária Nacional','Habitação','Moradias acessíveis e patrimônio residencial no GOVRP.',true,true) on conflict do nothing;
insert into public.products(id,state_enterprise_id,name,description,price,category,stock,consumable_effects)
select ('f2100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f2000000-0000-4000-8000-000000000001',name,
 'Produto essencial do Mercado Nacional. Consuma pelo inventário.',price,category,1000000,jsonb_build_object(need,points)
from (values
 (1,'Pão do dia',5,'Alimentos','hunger',15),(2,'Arroz com feijão',18,'Alimentos','hunger',40),(3,'Refeição completa',30,'Alimentos','hunger',60),
 (4,'Banana',6,'Alimentos','hunger',15),(5,'Maçã',7,'Alimentos','hunger',18),(6,'Sanduíche simples',14,'Alimentos','hunger',30),
 (7,'Sopa de legumes',16,'Alimentos','hunger',35),(8,'Salada da estação',15,'Alimentos','hunger',30),(9,'Biscoitos',8,'Alimentos','hunger',18),
 (10,'Tapioca',12,'Alimentos','hunger',25),(11,'Água mineral',4,'Bebidas','thirst',40),(12,'Suco de laranja',9,'Bebidas','thirst',35),
 (13,'Água de coco',10,'Bebidas','thirst',45),(14,'Chá gelado',7,'Bebidas','thirst',30),(15,'Leite',8,'Bebidas','thirst',25)
) catalog(n,name,price,category,need,points) on conflict do nothing;
insert into public.products(id,state_enterprise_id,name,description,price,category,stock,residence_spec)
select ('f2200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f2000000-0000-4000-8000-000000000002',name,
 description,price,'Moradia',1000000,jsonb_build_object('city',city,'state',state,'area_sqm',area,'quality',quality,'type',kind)
from (values
 (1,'Kitnet Cidadã','Residência compacta com banheiro e espaço para descanso.',750,'Brasília','DF',24,1,'kitnet'),
 (2,'Apartamento Popular','Dois ambientes e todos os cuidados básicos do cidadão.',2500,'São Paulo','SP',42,1,'popular'),
 (3,'Apartamento Familiar','Mais espaço para sua vida civil.',7000,'Belo Horizonte','MG',70,2,'apartment'),
 (4,'Casa com Quintal','Uma casa com área externa e quartos confortáveis.',16000,'Curitiba','PR',100,2,'house'),
 (5,'Residência de Alto Padrão','Área ampla e acabamento superior, com as mesmas funções essenciais.',65000,'Rio de Janeiro','RJ',220,3,'luxury')
) catalog(n,name,description,price,city,state,area,quality,kind) on conflict do nothing;

create or replace function public.get_state_citizen_offers(p_housing boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('quote',public.quote_legal_levies('purchase',p.price,false,p.economic_sector_id,p.category)) order by p.price),'[]') into result
 from public.products p join public.state_enterprises s on s.id=p.state_enterprise_id
 where s.is_active and not s.is_privatized and (p.residence_spec is not null)=p_housing;
 return result;
end; $$;

-- Explicit owner, grants and replication for every new API surface.
do $$ declare f record; t text; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('assert_citizen_service','refresh_citizen_needs','validate_citizen_product','buy_state_product','social_need_reward')) or
 (n.nspname='public' and p.proname in('get_citizen_needs','citizen_need_action','get_state_citizen_offers','buy_product')) loop
   execute format('alter function %s owner to postgres',f.signature);
   execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 end loop;
 foreach t in array array['citizen_needs','citizen_residences','user_inventory'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
 end loop;
end; $$;
grant execute on function public.get_citizen_needs(),public.citizen_need_action(text,uuid,uuid),public.get_state_citizen_offers(boolean),public.buy_product(uuid,text,uuid,uuid) to authenticated,service_role;
alter table public.citizen_needs owner to postgres;
alter table public.citizen_residences owner to postgres;
alter table private.citizen_need_actions owner to postgres;
commit;
