begin;
update public.state_enterprises set service_key=case when sector='Habitação' then 'national_housing' else 'national_market' end where service_key is null and sector in ('Habitação','Comércio Varejista');
alter table public.citizen_residences alter column owner_id drop not null, alter column inventory_id drop not null;
alter table public.citizen_residences add column state_enterprise_id uuid references public.state_enterprises(id),
 add column rooms jsonb not null default '{"bedrooms":1,"bathrooms":1,"living_rooms":1,"kitchens":1}',
 add column hygiene_recovery integer not null default 100 check(hygiene_recovery between 1 and 100),
 add column sleep_minutes numeric not null default 15 check(sleep_minutes between 1 and 120),
 add column listing_mode text not null default 'none' check(listing_mode in('none','sale','rent')),
 add column asking_price numeric check(asking_price>0 and asking_price<=100000000000),
 add column rent_period_days integer not null default 7 check(rent_period_days between 1 and 30),
 add column listed_at timestamptz;
alter table public.citizen_residences add constraint residence_holder_check check(owner_id is not null or state_enterprise_id is not null);
create index residences_market_idx on public.citizen_residences(state,listing_mode) where listing_mode<>'none';
create table public.residence_leases (
 id uuid primary key default gen_random_uuid(), residence_id uuid not null references public.citizen_residences(id),
 tenant_id uuid not null references public.profiles(id), landlord_id uuid references public.profiles(id),
 state_enterprise_id uuid references public.state_enterprises(id), price numeric not null check(price>0 and price<=100000000000),
 period_days integer not null check(period_days between 1 and 30), max_periods integer not null check(max_periods between 1 and 52),
 periods_paid integer not null default 0, started_at timestamptz not null default now(), paid_until timestamptz not null default now(),
 status text not null default 'active' check(status in('active','ending','arrears','ended')),
 ended_at timestamptz, idempotency_key uuid not null unique, updated_at timestamptz not null default now()
);
create unique index residence_one_lease on public.residence_leases(residence_id) where status<>'ended';
create index residence_tenant_idx on public.residence_leases(tenant_id,status);
alter table public.residence_leases enable row level security;
create policy residence_contract_read on public.residence_leases for select to authenticated using(tenant_id=(select auth.uid()) or landlord_id=(select auth.uid()));
revoke all on public.residence_leases from anon,authenticated;
grant select on public.residence_leases to authenticated;
create or replace function private.can_use_residence(p_id uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.citizen_residences r where r.id=p_id and r.status in('owned','listed') and (
 (r.owner_id=p_user and not exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.status<>'ended')) or
 exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.tenant_id=p_user and l.status in('active','ending') and l.paid_until>now())))
$$;
revoke all on function private.can_use_residence(uuid,uuid) from public,anon;
grant execute on function private.can_use_residence(uuid,uuid) to authenticated;
create policy residences_tenant_read on public.citizen_residences for select to authenticated using(private.can_use_residence(id,(select auth.uid())));
create or replace function public.get_my_residences() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('can_use',private.can_use_residence(r.id,auth.uid()),'is_tenant',r.owner_id is distinct from auth.uid(),'lease',(select to_jsonb(l) from public.residence_leases l where l.residence_id=r.id and l.status<>'ended')) order by r.acquired_at desc),'[]'::jsonb)
 from public.citizen_residences r where auth.uid() is not null and (r.owner_id=auth.uid() or exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.tenant_id=auth.uid() and l.status<>'ended'))
$$;
create or replace function public.get_residence_market() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'city',r.city,'state',r.state,'area_sqm',r.area_sqm,'rooms',r.rooms,'quality',r.quality,'hygiene_recovery',r.hygiene_recovery,'sleep_minutes',r.sleep_minutes,'listing_mode',r.listing_mode,'asking_price',r.asking_price,'rent_period_days',r.rent_period_days,'owner_id',r.owner_id,'state_enterprise_id',r.state_enterprise_id,'quote',public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia')) order by r.state,r.asking_price),'[]'::jsonb)
 from public.citizen_residences r where auth.uid() is not null and r.listing_mode<>'none' and r.asking_price>0 and not exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.status<>'ended')
$$;
create or replace function public.list_residence(p_residence_id uuid,p_mode text,p_price numeric,p_period_days integer default 7) returns void language plpgsql security definer set search_path='' as $$
declare r public.citizen_residences%rowtype;
begin
 perform private.assert_citizen_service('/services/national-housing');
 select * into r from public.citizen_residences where id=p_residence_id for update;
 if r.id is null or r.owner_id is distinct from auth.uid() then raise exception 'Somente o proprietário pode anunciar este imóvel.' using errcode='42501';end if;
 if p_mode not in('none','sale','rent') or p_mode is null or (p_mode<>'none' and (p_price is null or p_price<=0 or p_price>100000000000 or p_price<>round(p_price,2))) or p_period_days not between 1 and 30 or p_period_days is null then raise exception 'Confira a modalidade, o preço e o período do anúncio.';end if;
 if exists(select 1 from public.residence_leases where residence_id=r.id and status<>'ended') then raise exception 'Espere o encerramento do contrato de aluguel antes de anunciar.';end if;
 update public.citizen_residences set listing_mode=p_mode,asking_price=case when p_mode='none' then null else p_price end,rent_period_days=p_period_days,listed_at=case when p_mode='none' then null else now() end where id=r.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('residence_listing_changed','economy','citizen_residences',r.id,auth.uid(),jsonb_build_object('mode',p_mode,'price',p_price),'residence-listing:'||gen_random_uuid());
end $$;
create or replace function public.buy_residence(p_residence_id uuid,p_expected_price numeric,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.citizen_residences%rowtype; a public.accounts%rowtype; receiver uuid; t public.transactions%rowtype; q jsonb; total numeric; net numeric;
begin
 perform private.assert_citizen_service('/services/national-housing');
 if p_idempotency_key is null then raise exception 'Identifique a operação de compra.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into t from public.transactions where idempotency_key=p_idempotency_key;
 if found then
  if t.metadata->>'buyer_id' is distinct from auth.uid()::text or t.metadata->>'residence_id' is distinct from p_residence_id::text or t.type<>'residence_sale' then raise exception 'Esta identificação já pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'transaction_id',t.id);
 end if;
 select * into r from public.citizen_residences where id=p_residence_id for update;
 if r.id is null or r.listing_mode<>'sale' or r.asking_price is distinct from p_expected_price then raise exception 'O anúncio mudou. Confira o preço atual antes de comprar.';end if;
 if r.owner_id=auth.uid() or r.owner_id is null then raise exception 'Esta compra não está disponível.';end if;
 if exists(select 1 from public.residence_leases where residence_id=r.id and status<>'ended') then raise exception 'Este imóvel possui um contrato de aluguel em andamento.';end if;
 select id into receiver from public.accounts where user_id=r.owner_id;
 select * into a from public.accounts where user_id=auth.uid();
 if receiver is null or a.id is null then raise exception 'Comprador e vendedor precisam ter conta bancária.';end if;
 perform id from public.accounts where id in(a.id,receiver) order by id for update;
 select * into a from public.accounts where id=a.id;
 q:=public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia');
 if (q->>'restricted')::boolean then raise exception 'Esta operação está restrita por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 if a.balance<total then raise exception 'Saldo insuficiente para comprar o imóvel e pagar os tributos.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=a.id;
 update public.accounts set balance=balance+net,updated_at=now() where id=receiver;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(a.id,receiver,r.asking_price,'residence_sale','Compra de imóvel: '||r.name,q||jsonb_build_object('buyer_id',auth.uid(),'seller_id',r.owner_id,'residence_id',r.id),p_idempotency_key) returning * into t;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',t.id::text,auth.uid(),total-net,public.rp_now(),q);end if;
 update public.citizen_residences set owner_id=auth.uid(),listing_mode='none',asking_price=null,listed_at=null,purchase_price=r.asking_price,transaction_id=t.id,acquired_at=now(),status='owned' where id=r.id;
 update public.user_inventory set user_id=auth.uid(),metadata=coalesce(metadata,'{}')||jsonb_build_object('transaction_id',t.id,'previous_owner_id',r.owner_id) where id=r.inventory_id;
 insert into public.notifications(user_id,type,content,link) values(r.owner_id,'housing_sold','Seu imóvel '||r.name||' foi vendido. O valor líquido foi creditado na sua conta.','/services/national-housing'),(auth.uid(),'housing_acquired','Você adquiriu '||r.name||'.','/services/national-housing');
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('residence_sold','economy','citizen_residences',r.id,auth.uid(),jsonb_build_object('previous_owner_id',r.owner_id,'transaction_id',t.id),'residence-sale:'||p_idempotency_key);
 return jsonb_build_object('success',true,'transaction_id',t.id);
end $$;
CREATE OR REPLACE FUNCTION public.citizen_need_action(p_action text, p_reference_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if n.sleep_started_at is not null and p_action<>'wake' then raise exception 'Acorde antes de realizar outra atividade.'; end if;
 if p_action='wake' then
   n.sleep_started_at:=null;n.sleep_due_at:=null;n.sleep_start_value:=null;n.sleep_residence_id:=null;
 elsif p_action='consume' then
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
   select * into residence from public.citizen_residences where id=p_reference_id and private.can_use_residence(id,auth.uid());
   if not found then raise exception 'Você precisa ser proprietário ou ter um aluguel ativo e pago para usar esta residência.' using errcode='42501'; end if;
   if p_action='bath' then
     if n.last_bath_rp+make_interval(hours=>coalesce((cfg->>'bath_cooldown_rp_hours')::integer,8))>public.rp_now() then raise exception 'Você já tomou banho recentemente. Aguarde o intervalo do RP.'; end if;
     n.hygiene:=least(100,n.hygiene+residence.hygiene_recovery);n.last_bath_rp:=public.rp_now();
   else
     if n.last_sleep_rp+make_interval(hours=>coalesce((cfg->>'sleep_cooldown_rp_hours')::integer,12))>public.rp_now() then raise exception 'Você já descansou recentemente. Aguarde o intervalo do RP.'; end if;
     if n.sleep>=100 then raise exception 'Seu cidadão já está descansado.'; end if;
     n.last_sleep_rp:=public.rp_now();n.sleep_started_at:=clock_timestamp();n.sleep_start_value:=n.sleep;n.sleep_residence_id:=residence.id;
     n.sleep_due_at:=n.sleep_started_at+make_interval(secs=>greatest(1,residence.sleep_minutes*60*(100-n.sleep)/100)::double precision);
   end if;
 else raise exception 'Escolha consumir, tomar banho ou dormir.'; end if;
 update public.citizen_needs set hunger=n.hunger,thirst=n.thirst,hygiene=n.hygiene,sleep=n.sleep,last_bath_rp=n.last_bath_rp,last_sleep_rp=n.last_sleep_rp,sleep_started_at=n.sleep_started_at,sleep_due_at=n.sleep_due_at,sleep_start_value=n.sleep_start_value,sleep_residence_id=n.sleep_residence_id,updated_at=clock_timestamp(),alert_bands=(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(n.alert_bands) where coalesce((to_jsonb(n)->>key)::numeric,0)<40) where user_id=auth.uid() returning * into n;
 result:=to_jsonb(n)||jsonb_build_object('server_now',clock_timestamp(),'rp_now',public.rp_now());
 insert into private.citizen_need_actions(user_id,action,reference_id,idempotency_key,result) values(auth.uid(),p_action,p_reference_id,p_idempotency_key,result);
 return result;
end; $function$
;
CREATE OR REPLACE FUNCTION private.buy_state_product(p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; a public.accounts%rowtype; t uuid; inv uuid; q jsonb; total numeric; tax numeric; net numeric; o uuid; spec jsonb; service_path text; payment_card public.cards%rowtype; invoice_id uuid; enterprise public.state_enterprises%rowtype; recipient uuid;
begin
 select * into p from public.products where id=p_product_id for update;
 service_path:=case when p.residence_spec is null then '/services/national-market' else '/services/national-housing' end;
 perform private.assert_citizen_service(service_path);
 select * into enterprise from public.state_enterprises where id=p.state_enterprise_id and is_active for share;
 if not found or p.archived_at is not null or p.moderation_status<>'approved' then raise exception 'Esta oferta está indisponível.'; end if;
 if enterprise.is_privatized then select bank_account_id into recipient from public.businesses where id=enterprise.operating_business_id and status='active';if recipient is null then raise exception 'A empresa operadora está indisponível.';end if;end if;
 if p.stock<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
 if p.price<=0 then raise exception 'A oferta precisa de um preço válido.'; end if;
 q:=public.quote_legal_levies('purchase',p.price,enterprise.is_privatized,p.economic_sector_id,p.category);
 if (q->>'restricted')::boolean then raise exception 'Esta operação está temporariamente restrita por norma vigente.'; end if;
 total:=(q->>'total_debited')::numeric;tax:=(q->>'buyer_tax')::numeric+(q->>'seller_tax')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where user_id=auth.uid() or id=recipient order by id for update;
 select * into a from public.accounts where user_id=auth.uid();
 if not found then raise exception 'Abra sua conta no Banco Nacional antes de comprar.'; end if;
 if p_payment_method='balance' then
   if p_card_id is not null then raise exception 'INVALID_PAYMENT_METHOD'; end if;
   if a.balance<total then raise exception 'INSUFFICIENT_BALANCE'; end if;
   update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=a.id;
 elsif p_payment_method='card' then
   select * into payment_card from public.cards where id=p_card_id and user_id=auth.uid() and is_active and card_type='credit' for update;
   if not found then raise exception 'INVALID_CARD'; end if;
   if payment_card.card_limit-payment_card.used_limit<total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
   update public.cards set used_limit=used_limit+total where id=payment_card.id;
 else raise exception 'INVALID_PAYMENT_METHOD'; end if;
 update public.government_finances set treasury_balance=treasury_balance+case when enterprise.is_privatized then tax else total end,updated_at=clock_timestamp() where id=1;
 if recipient is not null then
 update public.accounts set balance=balance+net,updated_at=now() where id=recipient;
 insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'revenue',p.price,'Venda: '||p.name);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos: '||p.name);end if;
 end if;
 insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
 values(case when p_payment_method='balance' then a.id else null end,recipient,total,'Compra: '||p.name,case when p_payment_method='card' then 'purchase_card' else 'purchase' end,q||jsonb_build_object('platform',case when p.residence_spec is null then 'Mercado Nacional' else 'Imobiliária Nacional' end,'state_enterprise_id',p.state_enterprise_id,'product_id',p.id,'base_price',p.price,'card_id',payment_card.id,'buyer_id',auth.uid()),p_idempotency_key) returning id into t;
 insert into public.commerce_orders(idempotency_key,buyer_id,product_id,buyer_account_id,state_enterprise_id,payment_method,card_id,base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id)
 values(p_idempotency_key,auth.uid(),p.id,a.id,p.state_enterprise_id,p_payment_method,payment_card.id,p.price,(q->>'buyer_tax')::numeric,(q->>'seller_tax')::numeric,total,net,t) returning id into o;
 insert into public.user_inventory(user_id,product_id,quantity,metadata) values(auth.uid(),p.id,1,jsonb_build_object('transaction_id',t,'origin',service_path,'purchase_price',p.price,'consumable_effects',p.consumable_effects)) returning id into inv;
 if p.residence_spec is not null then
   spec:=p.residence_spec;
   insert into public.citizen_residences(owner_id,inventory_id,product_id,transaction_id,name,city,state,area_sqm,purchase_price,quality,rooms,hygiene_recovery,sleep_minutes)
   values(auth.uid(),inv,p.id,t,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer,coalesce(spec->'rooms','{"bedrooms":1,"bathrooms":1,"living_rooms":1,"kitchens":1}'),coalesce((spec->>'hygiene_recovery')::integer,100),coalesce((spec->>'sleep_minutes')::numeric,15));
   insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_acquired','Você adquiriu '||p.name||'. Sua residência permite dormir e tomar banho.','/services/national-housing');
 end if;
 if not enterprise.is_privatized then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
 values('other','commerce_orders',o::text,auth.uid(),net,public.rp_now(),jsonb_build_object('state_enterprise_id',p.state_enterprise_id,'transaction_id',t));end if;
 if tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','commerce_orders',o::text,auth.uid(),tax,public.rp_now(),q); end if;
 update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=p.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('commerce_purchase_completed','economy','commerce_orders',o,auth.uid(),jsonb_build_object('stateEnterpriseId',p.state_enterprise_id,'productId',p.id,'total',total,'tax',tax,'transactionId',t),'commerce-purchase:'||p_idempotency_key);
 if p_payment_method='card' then
   select id into invoice_id from public.card_invoices where card_id=payment_card.id and status='open' order by created_at desc limit 1 for update;
   if invoice_id is null then
     insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
     values(payment_card.id,auth.uid(),current_date+30,current_date+40,total,'open') returning id into invoice_id;
   else update public.card_invoices set amount=amount+total,updated_at=clock_timestamp() where id=invoice_id; end if;
   insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(invoice_id,t,'Compra: '||p.name,total);
 end if;
 return jsonb_build_object('success',true,'message','Compra concluída.','transaction_id',t,'order_id',o,'total',total,'tax',tax);
end; $function$
;
CREATE OR REPLACE FUNCTION public.get_state_citizen_offers(p_housing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('quote',public.quote_legal_levies('purchase',p.price,s.is_privatized,p.economic_sector_id,p.category)) order by p.price),'[]') into result
 from public.products p join public.state_enterprises s on s.id=p.state_enterprise_id
 where s.is_active and p.archived_at is null and p.moderation_status='approved' and (p.residence_spec is not null)=p_housing;
 return result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.buy_business_listing(p_listing_type text, p_listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer_id uuid := auth.uid();
  v_buyer_account public.accounts%rowtype;
  v_seller_account public.accounts%rowtype;
  v_business public.businesses%rowtype;
  v_enterprise public.state_enterprises%rowtype;
  v_finance public.government_finances%rowtype;
  v_price numeric(14,2);
  v_new_business_id uuid;
  v_business_type_id text;
begin
  if v_buyer_id is null then
    return jsonb_build_object('success', false, 'message', 'Sessao invalida.');
  end if;

  select * into v_buyer_account
  from public.accounts
  where user_id = v_buyer_id
  for update;

  if v_buyer_account.id is null then
    return jsonb_build_object('success', false, 'message', 'Voce precisa ter conta bancaria para comprar empresas.');
  end if;

  if p_listing_type = 'private' then
    select * into v_business
    from public.businesses
    where id = p_listing_id
      and is_for_sale = true
    for update;

    if v_business.id is null then
      return jsonb_build_object('success', false, 'message', 'Empresa privada nao encontrada ou nao esta mais a venda.');
    end if;

    if v_business.owner_id = v_buyer_id then
      return jsonb_build_object('success', false, 'message', 'Voce nao pode comprar a propria empresa.');
    end if;

    v_price := coalesce(v_business.sale_price, 0);
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'Preco de venda invalido.');
    end if;

    if coalesce(v_buyer_account.balance, 0) < v_price then
      return jsonb_build_object('success', false, 'message', 'Saldo insuficiente para comprar esta empresa.');
    end if;

    select * into v_seller_account
    from public.accounts
    where user_id = v_business.owner_id
    for update;

    if v_seller_account.id is null then
      return jsonb_build_object('success', false, 'message', 'Conta bancaria do vendedor nao encontrada.');
    end if;

    update public.accounts
    set balance = balance - v_price,
        updated_at = now()
    where id = v_buyer_account.id;

    update public.accounts
    set balance = balance + v_price,
        updated_at = now()
    where id = v_seller_account.id;

    update public.businesses
    set previous_owner_id = owner_id,
        owner_id = v_buyer_id,
        is_for_sale = false,
        sale_price = null,
        sale_listed_at = null,
        sold_at = now(),
        status = coalesce(nullif(status, ''), 'active')
    where id = v_business.id;

    update public.products set seller_id=v_buyer_id where business_id=v_business.id;
    insert into public.transactions (from_account_id, to_account_id, amount, type, description, created_at, metadata)
    values (
      v_buyer_account.id,
      v_seller_account.id,
      v_price,
      'business_sale',
      'Compra da empresa: ' || v_business.name,
      now(),
      jsonb_build_object('business_id', v_business.id, 'listing_type', 'private')
    );

    return jsonb_build_object('success', true, 'message', 'Empresa comprada com sucesso.', 'business_id', v_business.id);
  end if;

  if p_listing_type = 'state' then
    select * into v_enterprise
    from public.state_enterprises
    where id = p_listing_id
      and privatization_status = 'for_sale'
      and coalesce(is_privatized, false) = false
    for update;

    if v_enterprise.id is null then
      return jsonb_build_object('success', false, 'message', 'Estatal nao encontrada ou privatizacao indisponivel.');
    end if;

    v_price := coalesce(v_enterprise.privatization_price, 0);
    if v_price <= 0 then
      return jsonb_build_object('success', false, 'message', 'Preco de privatizacao invalido.');
    end if;

    if coalesce(v_buyer_account.balance, 0) < v_price then
      return jsonb_build_object('success', false, 'message', 'Saldo insuficiente para comprar esta estatal.');
    end if;

    select * into v_finance
    from public.government_finances
    order by updated_at desc
    limit 1
    for update;

    if v_finance.id is null then
      return jsonb_build_object('success', false, 'message', 'Financas do governo nao encontradas.');
    end if;

    v_business_type_id := case v_enterprise.sector
      when 'Energia Elétrica' then 'fabrica'
      when 'Água' then 'distribuidora'
      when 'Gás' then 'distribuidora'
      when 'Internet' then 'consultoria'
      when 'Telefonia' then 'consultoria'
      else 'consultoria'
    end;

    update public.accounts
    set balance = balance - v_price,
        updated_at = now()
    where id = v_buyer_account.id;

    update public.government_finances
    set treasury_balance = treasury_balance + v_price,
        updated_at = now()
    where id = v_finance.id;

    insert into public.businesses (
      owner_id,
      business_type_id,
      name,
      description,
      status,
      employees,
      monthly_revenue
    )
    values (
      v_buyer_id,
      v_business_type_id,
      v_enterprise.name,
      coalesce(v_enterprise.description, 'Empresa privatizada a partir de estatal.'),
      'active',
      0,
      0
    )
    returning id into v_new_business_id;

    update public.state_enterprises
    set is_privatized = true,
        is_active = case when v_enterprise.service_key in('marketplace','national_housing','national_market') then true else false end,
        operating_business_id=v_new_business_id,
        privatization_status = 'sold',
        privatization_buyer_id = v_buyer_id,
        privatized_at = now(),
        updated_at = now()
    where id = v_enterprise.id;

    insert into public.transactions (from_account_id, to_account_id, amount, type, description, created_at, metadata)
    values (
      v_buyer_account.id,
      null,
      v_price,
      'privatization_purchase',
      'Compra de estatal privatizada: ' || v_enterprise.name,
      now(),
      jsonb_build_object(
        'state_enterprise_id', v_enterprise.id,
        'business_id', v_new_business_id,
        'treasury_credit', true,
        'listing_type', 'state'
      )
    );

    return jsonb_build_object('success', true, 'message', 'Estatal comprada e privatizada com sucesso.', 'business_id', v_new_business_id);
  end if;

  return jsonb_build_object('success', false, 'message', 'Tipo de listagem invalido.');
end;
$function$
;
create or replace function private.pay_residence_lease(p_lease_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare l public.residence_leases%rowtype; r public.citizen_residences%rowtype; a public.accounts%rowtype; receiver uuid; e public.state_enterprises%rowtype; t uuid; q jsonb; total numeric; net numeric; due timestamptz; k uuid;
begin
 select * into l from public.residence_leases where id=p_lease_id for update;
 if l.id is null or l.status not in('active','arrears') or (l.periods_paid>0 and l.paid_until>now()) then return false;end if;
 if l.periods_paid>=l.max_periods then update public.residence_leases set status='ended',ended_at=now(),updated_at=now() where id=l.id;return false;end if;
 select * into r from public.citizen_residences where id=l.residence_id;
 select * into a from public.accounts where user_id=l.tenant_id;
 if l.state_enterprise_id is not null then
  select * into e from public.state_enterprises where id=l.state_enterprise_id;
  if e.is_privatized then select bank_account_id into receiver from public.businesses where id=e.operating_business_id;end if;
 else select id into receiver from public.accounts where user_id=l.landlord_id;end if;
 if a.id is null or (receiver is null and (l.state_enterprise_id is null or e.is_privatized)) then raise exception 'Não foi possível identificar a conta do contrato.';end if;
 perform id from public.accounts where id in(a.id,receiver) order by id for update;
 select * into a from public.accounts where id=a.id;
 q:=public.quote_legal_levies('purchase',l.price,false,null,'Moradia');total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 if (q->>'restricted')::boolean or a.balance<total then
  if l.status<>'arrears' then insert into public.notifications(user_id,type,content,link) values(l.tenant_id,'housing_rent_due','Seu aluguel está pendente. Confira o saldo e as regras vigentes para regularizar o contrato.','/services/national-housing');end if;
  update public.residence_leases set status='arrears',updated_at=now() where id=l.id;
  return false;
 end if;
 due:=greatest(l.paid_until,clock_timestamp());
 k:=md5('residence-rent:'||l.id||':'||l.periods_paid)::uuid;
 update public.accounts set balance=balance-total,updated_at=now() where id=a.id;
 if receiver is not null then update public.accounts set balance=balance+net,updated_at=now() where id=receiver;end if;
 update public.government_finances set treasury_balance=treasury_balance+case when receiver is null then total else total-net end,updated_at=now() where id=1;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 values(a.id,receiver,l.price,'residence_rent','Aluguel: '||r.name,q||jsonb_build_object('lease_id',l.id,'residence_id',r.id,'tenant_id',l.tenant_id,'landlord_id',l.landlord_id,'period',l.periods_paid+1,'period_start',due,'period_end',due+make_interval(days=>l.period_days)),k) returning id into t;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',t::text,l.tenant_id,total-net,public.rp_now(),q);end if;
 if receiver is null then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('other','transactions',t::text,l.tenant_id,net,public.rp_now(),jsonb_build_object('lease_id',l.id));
 elsif e.is_privatized then
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(e.operating_business_id,'revenue',l.price,'Aluguel: '||r.name,jsonb_build_object('transaction_id',t),'rent:'||k);
  if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(e.operating_business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre aluguel',q,'rent-tax:'||k);end if;
 end if;
 update public.residence_leases set paid_until=due+make_interval(days=>l.period_days),periods_paid=periods_paid+1,status='active',updated_at=now() where id=l.id;
 return true;
end $$;
revoke all on function private.pay_residence_lease(uuid) from public,anon,authenticated;
create or replace function public.rent_residence(p_reference_id uuid,p_is_product boolean,p_expected_price numeric,p_periods integer,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.citizen_residences%rowtype; p public.products%rowtype; l public.residence_leases%rowtype; spec jsonb;
begin
 perform private.assert_citizen_service('/services/national-housing');
 if p_idempotency_key is null or p_periods is null or p_periods not between 1 and 52 or p_is_product is null then raise exception 'Confira a duração e a identificação do contrato.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into l from public.residence_leases where idempotency_key=p_idempotency_key;
 if found then
  select * into r from public.citizen_residences where id=l.residence_id;
  if l.tenant_id<>auth.uid() or l.max_periods<>p_periods or l.price is distinct from p_expected_price or (case when p_is_product then r.product_id else r.id end) is distinct from p_reference_id then raise exception 'Esta identificação já pertence a outro contrato.';end if;
  return to_jsonb(l);
 end if;
 if p_is_product then
  select * into p from public.products where id=p_reference_id for update;
  if p.id is null or p.stock<=0 or p.archived_at is not null or p.moderation_status<>'approved' or p.residence_spec is null or not exists(select 1 from public.state_enterprises where id=p.state_enterprise_id and is_active) then raise exception 'Este imóvel não está disponível para aluguel.';end if;
  spec:=p.residence_spec;
  if coalesce((spec->>'rent_price')::numeric,0)<=0 or (spec->>'rent_price')::numeric is distinct from p_expected_price then raise exception 'O preço do aluguel mudou. Confira a oferta atual.';end if;
  insert into public.citizen_residences(state_enterprise_id,product_id,name,city,state,area_sqm,purchase_price,quality,rooms,hygiene_recovery,sleep_minutes,listing_mode,asking_price,rent_period_days)
  values(p.state_enterprise_id,p.id,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer,spec->'rooms',(spec->>'hygiene_recovery')::integer,(spec->>'sleep_minutes')::numeric,'rent',p_expected_price,coalesce((spec->>'rent_period_days')::integer,7)) returning * into r;
  update public.products set stock=stock-1 where id=p.id;
 else
  select * into r from public.citizen_residences where id=p_reference_id for update;
  if r.id is null or r.listing_mode<>'rent' or r.asking_price is distinct from p_expected_price then raise exception 'O anúncio mudou. Confira a oferta atual.';end if;
 end if;
 if r.owner_id=auth.uid() then raise exception 'Você já é proprietário deste imóvel.';end if;
 if exists(select 1 from public.residence_leases where residence_id=r.id and status<>'ended') then raise exception 'Este imóvel já possui um contrato de aluguel.';end if;
 insert into public.residence_leases(residence_id,tenant_id,landlord_id,state_enterprise_id,price,period_days,max_periods,idempotency_key)
 values(r.id,auth.uid(),r.owner_id,r.state_enterprise_id,r.asking_price,r.rent_period_days,p_periods,p_idempotency_key) returning * into l;
 if not private.pay_residence_lease(l.id) then raise exception 'O primeiro aluguel não pôde ser pago. Confira seu saldo e as regras vigentes.';end if;
 insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_rented','Seu contrato de aluguel de '||r.name||' está ativo. Você já pode descansar e tomar banho.','/services/national-housing');
 if r.owner_id is not null then insert into public.notifications(user_id,type,content,link) values(r.owner_id,'housing_rented','Seu imóvel '||r.name||' foi alugado e o primeiro pagamento foi creditado.','/services/national-housing');end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('residence_leased','economy','residence_leases',l.id,auth.uid(),jsonb_build_object('residence_id',r.id,'price',l.price,'period_days',l.period_days,'max_periods',l.max_periods),'residence-lease:'||p_idempotency_key);
 select * into l from public.residence_leases where id=l.id;
 return to_jsonb(l);
end $$;
create or replace function public.manage_residence_lease(p_lease_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare l public.residence_leases%rowtype;
begin
 select * into l from public.residence_leases where id=p_lease_id for update;
 if auth.uid() is null or l.id is null or (l.tenant_id is distinct from auth.uid() and l.landlord_id is distinct from auth.uid()) then raise exception 'Você não participa deste contrato.' using errcode='42501';end if;
 if p_action='pay' and l.tenant_id=auth.uid() then
  if not private.pay_residence_lease(l.id) then raise exception 'Pagamento não concluído. Confira se existe parcela vencida, saldo disponível e contrato ativo.';end if;
 elsif p_action='end' and l.status<>'ended' then
  update public.residence_leases set status=case when paid_until>now() then 'ending' else 'ended' end,ended_at=case when paid_until<=now() then now() end,updated_at=now() where id=l.id;
  insert into public.notifications(user_id,type,content,link) values(l.tenant_id,'housing_lease_ending','O contrato de aluguel será encerrado ao final do período já pago.','/services/national-housing');
 else raise exception 'Escolha uma operação disponível para este contrato.';end if;
end $$;
create or replace function private.process_residence_leases() returns integer language plpgsql security definer set search_path='' as $$
declare l record; n integer:=0;
begin
 update public.residence_leases set status='ended',ended_at=now(),updated_at=now() where (status='ending' and paid_until<=now()) or (status='arrears' and paid_until<now()-interval '7 days') or (status='active' and periods_paid>=max_periods and paid_until<=now());
 for l in select id from public.residence_leases where status in('active','arrears') and paid_until<=now() and periods_paid<max_periods order by paid_until for update skip locked loop
  if private.pay_residence_lease(l.id) then n:=n+1;end if;
 end loop;
 return n;
end $$;
revoke all on function private.process_residence_leases() from public,anon,authenticated;
create or replace function private.broadcast_housing_market() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform realtime.send(jsonb_build_object('changed',true),'housing-market-changed','housing-market',false);
 return coalesce(new,old);
end $$;
revoke all on function private.broadcast_housing_market() from public,anon,authenticated;
create trigger housing_market_changed after insert or update or delete on public.citizen_residences for each statement execute function private.broadcast_housing_market();
create trigger housing_leases_changed after insert or update or delete on public.residence_leases for each statement execute function private.broadcast_housing_market();
create or replace function public.can_manage_citizen_enterprise(p_enterprise_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.state_enterprises s left join public.businesses b on b.id=s.operating_business_id where s.id=p_enterprise_id and s.service_key in('national_housing','national_market') and (public.is_admin(auth.uid()) or case when s.is_privatized then b.owner_id=auth.uid() else public.get_user_role(auth.uid())='Presidente' or s.manager_id=auth.uid() end))
$$;
create or replace function public.configure_citizen_offer(p_enterprise_id uuid,p_product_id uuid,p_offer jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.state_enterprises%rowtype; spec jsonb; pid uuid; v numeric; k text;
begin
 if not coalesce(public.can_manage_citizen_enterprise(p_enterprise_id),false) then raise exception 'Você não tem permissão para administrar esta empresa.' using errcode='42501';end if;
 select * into e from public.state_enterprises where id=p_enterprise_id for update;
 if jsonb_typeof(p_offer)<>'object' or length(btrim(coalesce(p_offer->>'name','')))<3 or length(p_offer->>'name')>120 or (p_offer->>'price') is null or (p_offer->>'price')::numeric<=0 or (p_offer->>'price')::numeric>1000000000 or (p_offer->>'stock') is null or (p_offer->>'stock')::integer not between 0 and 1000000 then raise exception 'Confira nome, preço e estoque da oferta.';end if;
 if e.service_key='national_housing' then
  spec:=p_offer->'residence_spec';
  if spec is null or not exists(select 1 from public.economic_regions where code=spec->>'state') or length(btrim(coalesce(spec->>'city','')))<2 or coalesce((spec->>'area_sqm')::numeric,0) not between 12 and 10000 or coalesce((spec->>'quality')::integer,0) not between 1 and 3 or coalesce((spec->>'hygiene_recovery')::integer,0) not between 1 and 100 or coalesce((spec->>'sleep_minutes')::numeric,0) not between 1 and 120 or coalesce((spec->>'rent_price')::numeric,0) not between 0 and 1000000000 or coalesce((spec->>'rent_period_days')::integer,0) not between 1 and 30 then raise exception 'Confira estado, cidade, área, qualidade, recuperação e condições de aluguel.';end if;
  foreach k in array array['bedrooms','bathrooms','living_rooms','kitchens'] loop
   if coalesce((spec->'rooms'->>k)::integer,-1) not between 0 and 50 then raise exception 'Informe a quantidade de cômodos de cada tipo.';end if;
  end loop;
 else
  if jsonb_typeof(p_offer->'consumable_effects')<>'object' or coalesce(p_offer->'consumable_effects','{}')='{}' then raise exception 'Informe os efeitos do alimento ou bebida.';end if;
  for k,v in select key,value::numeric from jsonb_each_text(p_offer->'consumable_effects') loop
   if k not in('hunger','thirst') or v not between 1 and 100 then raise exception 'A recuperação de fome ou sede deve ficar entre 1 e 100.';end if;
  end loop;
 end if;
 if p_product_id is not null then
  update public.products set name=btrim(p_offer->>'name'),description=left(coalesce(p_offer->>'description',''),2000),price=round((p_offer->>'price')::numeric,2),stock=(p_offer->>'stock')::integer,residence_spec=spec,consumable_effects=case when spec is null then p_offer->'consumable_effects' else '{}'::jsonb end,archived_at=case when coalesce((p_offer->>'archived')::boolean,false) then now() end where id=p_product_id and state_enterprise_id=e.id returning id into pid;
  if pid is null then raise exception 'A oferta não pertence a esta empresa.';end if;
 else
  insert into public.products(state_enterprise_id,name,description,price,stock,category,residence_spec,consumable_effects) values(e.id,btrim(p_offer->>'name'),left(coalesce(p_offer->>'description',''),2000),round((p_offer->>'price')::numeric,2),(p_offer->>'stock')::integer,case when spec is null then 'Alimentação' else 'Moradia' end,spec,case when spec is null then p_offer->'consumable_effects' else '{}'::jsonb end) returning id into pid;
 end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('citizen_offer_configured','economy','products',pid,auth.uid(),jsonb_build_object('enterprise_id',e.id,'offer',p_offer),'offer-config:'||gen_random_uuid());
 return pid;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Use números válidos nos preços, cômodos, estoque e recuperação.';
end $$;
-- Existing purchases keep their recovery snapshots; only subsequent purchases use the edited catalog.
update public.products set residence_spec=residence_spec||jsonb_build_object('rooms',jsonb_build_object('bedrooms',case when (residence_spec->>'quality')::integer=3 then 4 when price<1000 then 0 else 2 end,'bathrooms',case when (residence_spec->>'quality')::integer=3 then 3 else 1 end,'living_rooms',1,'kitchens',1),'hygiene_recovery',case when (residence_spec->>'quality')::integer=3 then 100 when price<1000 then 50 else 75 end,'sleep_minutes',case when (residence_spec->>'quality')::integer=3 then 6 when price<1000 then 18 else 12 end,'rent_price',greatest(25,round(price*.02,2)),'rent_period_days',7) where residence_spec is not null;
insert into public.products(id,state_enterprise_id,name,description,price,stock,category,residence_spec,consumable_effects)
select md5('govrp-housing:'||r.code||':'||tier)::uuid,e.id,case tier when 1 then 'Kitnet' when 2 then 'Apartamento familiar' else 'Casa ampla' end||' em '||r.capital,'Moradia do catálogo da Imobiliária Nacional, com cômodos e recuperação definidos no contrato de aquisição.',case tier when 1 then 850 when 2 then 7500 else 21000 end,100,'Moradia',jsonb_build_object('city',r.capital,'state',r.code,'type',case tier when 1 then 'kitnet' when 2 then 'apartment' else 'house' end,'quality',tier,'area_sqm',case tier when 1 then 28 when 2 then 72 else 140 end,'rooms',jsonb_build_object('bedrooms',tier,'bathrooms',case tier when 3 then 2 else 1 end,'living_rooms',1,'kitchens',1),'hygiene_recovery',case tier when 1 then 50 when 2 then 75 else 100 end,'sleep_minutes',case tier when 1 then 18 when 2 then 12 else 6 end,'rent_price',case tier when 1 then 30 when 2 then 150 else 420 end,'rent_period_days',7),'{}'::jsonb
from public.economic_regions r cross join generate_series(1,3) tier cross join public.state_enterprises e where e.service_key='national_housing'
on conflict(id) do nothing;
revoke all on function public.get_my_residences(),public.get_residence_market(),public.list_residence(uuid,text,numeric,integer),public.buy_residence(uuid,numeric,uuid),public.rent_residence(uuid,boolean,numeric,integer,uuid),public.manage_residence_lease(uuid,text),public.can_manage_citizen_enterprise(uuid),public.configure_citizen_offer(uuid,uuid,jsonb) from public,anon;
grant execute on function public.get_my_residences(),public.get_residence_market(),public.list_residence(uuid,text,numeric,integer),public.buy_residence(uuid,numeric,uuid),public.rent_residence(uuid,boolean,numeric,integer,uuid),public.manage_residence_lease(uuid,text),public.can_manage_citizen_enterprise(uuid),public.configure_citizen_offer(uuid,uuid,jsonb) to authenticated;
alter publication supabase_realtime add table public.residence_leases;
CREATE OR REPLACE FUNCTION economy_private.run_operational_engine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  currency_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  perform private.process_residence_leases();
  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  currency_result:=public.recalculate_currency_market('BR','operational:'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24'),true);
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_month(period_row.id,true,null);
    closed_months:=closed_months+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_quarter(period_row.id,true,null);
    closed_quarters:=closed_quarters+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_year(period_row.id,true,null);
    closed_years:=closed_years+1;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,'currency',currency_result,
    'closed_months',closed_months,
    'closed_quarters',closed_quarters,
    'closed_years',closed_years
  );
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    raise;
end;
$function$
;
notify pgrst,'reload schema';
commit;
