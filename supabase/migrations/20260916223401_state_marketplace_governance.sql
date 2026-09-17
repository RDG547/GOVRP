begin;
alter table public.state_enterprises add column if not exists service_key text unique;
alter table public.state_enterprises add column if not exists operating_business_id uuid references public.businesses(id) on delete set null;
alter table public.state_enterprises add column if not exists manager_id uuid references public.profiles(id) on delete set null;
alter table public.state_enterprises add column if not exists commission_type text not null default 'percentage' check(commission_type in ('percentage','fixed'));
alter table public.state_enterprises add column if not exists commission_value numeric not null default 0 check(commission_value>=0 and commission_value<=1000000);
alter table public.state_enterprises add column if not exists publication_mode text not null default 'automatic' check(publication_mode in ('automatic','approval'));
insert into public.state_enterprises(name,sector,description,is_system,is_active,service_key)
values('Negócios Livre','Marketplace','Marketplace de cidadãos e empresas, integrado à economia nacional.',true,true,'marketplace') on conflict(service_key) do nothing;
alter table public.products add column if not exists moderation_status text not null default 'approved' check(moderation_status in ('pending','approved','suspended','removed'));
alter table public.products add column if not exists moderation_reason text;
alter table public.products add column if not exists moderated_by uuid references public.profiles(id) on delete set null;
alter table public.products add column if not exists moderated_at timestamptz;
alter table public.commerce_orders add column if not exists marketplace_enterprise_id uuid references public.state_enterprises(id);
alter table public.commerce_orders add column if not exists commission_amount numeric not null default 0 check(commission_amount>=0);
alter table public.commerce_orders add column if not exists commission_snapshot jsonb;

create or replace function public.can_manage_marketplace() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (coalesce(public.is_admin(auth.uid()),false) or exists(select 1 from public.state_enterprises s left join public.businesses b on b.id=s.operating_business_id where s.service_key='marketplace' and case when s.is_privatized then coalesce(b.owner_id,s.privatization_buyer_id)=auth.uid() else public.get_user_role(auth.uid())='Presidente' or s.manager_id=auth.uid() end))
$$;
revoke all on function public.can_manage_marketplace() from public,anon;
grant execute on function public.can_manage_marketplace() to authenticated;
create or replace function public.configure_marketplace(p_commission_type text,p_commission_value numeric,p_publication_mode text,p_manager_id uuid default null)
returns public.state_enterprises language plpgsql security definer set search_path='' as $$
declare s public.state_enterprises%rowtype; old_state jsonb;
begin
 if not public.can_manage_marketplace() then raise exception 'Você não tem permissão para gerir este marketplace.'; end if;
 if not coalesce(p_commission_type in('percentage','fixed') and p_commission_value>=0 and p_commission_value<=case when p_commission_type='percentage' then 100 else 1000000 end and p_publication_mode in('automatic','approval'),false) then raise exception 'Confira a comissão e o modo de publicação.'; end if;
 select * into s from public.state_enterprises where service_key='marketplace' for update;
 if p_manager_id is distinct from s.manager_id and not coalesce(public.is_admin(auth.uid()),false) and not (not s.is_privatized and public.get_user_role(auth.uid())='Presidente') then raise exception 'Somente a autoridade institucional pode nomear a gestão estatal.'; end if;
 if p_manager_id is not null and not exists(select 1 from public.profiles where id=p_manager_id and deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration')) then raise exception 'Gestor indisponível.'; end if;
 old_state:=to_jsonb(s);
 update public.state_enterprises set commission_type=p_commission_type,commission_value=round(p_commission_value,2),publication_mode=p_publication_mode,manager_id=p_manager_id,updated_at=clock_timestamp() where id=s.id returning * into s;
 perform public.justice_write_audit('marketplace.configured','state_enterprise',s.id,old_state,to_jsonb(s),'Configurações operacionais do marketplace');
 return s;
end; $$;
revoke all on function public.configure_marketplace(text,numeric,text,uuid) from public,anon;
grant execute on function public.configure_marketplace(text,numeric,text,uuid) to authenticated;
create or replace function private.guard_marketplace_product() returns trigger language plpgsql set search_path='' as $$
declare mode text;
begin
 if new.state_enterprise_id is not null then return new; end if;
 if tg_op='UPDATE' and current_user not in('postgres','supabase_admin','service_role') and (new.moderation_status is distinct from old.moderation_status or new.moderation_reason is distinct from old.moderation_reason or new.moderated_by is distinct from old.moderated_by or new.moderated_at is distinct from old.moderated_at) then raise exception 'A moderação exige uma ação autorizada.'; end if;
 select publication_mode into mode from public.state_enterprises where service_key='marketplace';
 if tg_op='INSERT' then new.moderation_status:=case when mode='approval' then 'pending' else 'approved' end;
 elsif mode='approval' and new.moderation_status='approved' and (new.name is distinct from old.name or new.description is distinct from old.description or new.image_url is distinct from old.image_url or new.category is distinct from old.category) then new.moderation_status:='pending'; end if;
 return new;
end; $$;
revoke all on function private.guard_marketplace_product() from public,anon,authenticated;
create trigger guard_marketplace_product before insert or update on public.products for each row execute function private.guard_marketplace_product();
create or replace function public.moderate_marketplace_product(p_product_id uuid,p_status text,p_reason text)
returns public.products language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; old_state jsonb;
begin
 if not public.can_manage_marketplace() then raise exception 'Você não tem permissão para moderar anúncios.'; end if;
 if not coalesce(p_status in ('approved','suspended','removed'),false) or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Selecione a decisão e explique o motivo em pelo menos 10 caracteres.'; end if;
 select * into p from public.products where id=p_product_id and state_enterprise_id is null for update;
 if not found then raise exception 'Anúncio não encontrado.'; end if;
 if p.moderation_status=p_status then return p; end if;
 old_state:=to_jsonb(p);
 update public.products set moderation_status=p_status,moderation_reason=btrim(p_reason),moderated_by=auth.uid(),moderated_at=clock_timestamp() where id=p.id returning * into p;
 insert into public.notifications(user_id,type,content,link,metadata) values(p.seller_id,'marketplace_moderation','Seu anúncio "'||p.name||'" foi '||case p_status when 'approved' then 'aprovado' when 'suspended' then 'suspenso' else 'removido' end||'. Motivo: '||btrim(p_reason),'/dashboard?tab=products',jsonb_build_object('product_id',p.id,'status',p_status));
 perform public.justice_write_audit('marketplace.product_'||p_status,'product',p.id,old_state,to_jsonb(p),p_reason);
 return p;
end; $$;
revoke all on function public.moderate_marketplace_product(uuid,text,text) from public,anon;
grant execute on function public.moderate_marketplace_product(uuid,text,text) to authenticated;
create or replace function public.archive_my_product(p_product_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype;
begin
 select * into p from public.products where id=p_product_id and seller_id=auth.uid() and state_enterprise_id is null for update;
 if not found then raise exception 'Você só pode remover seus próprios anúncios.'; end if;
 update public.products set moderation_status='removed',moderation_reason='Removido pelo vendedor',moderated_by=auth.uid(),moderated_at=clock_timestamp() where id=p.id;
end; $$;
revoke all on function public.archive_my_product(uuid) from public,anon;
grant execute on function public.archive_my_product(uuid) to authenticated;
-- Keep sold listings and invoice references. Removing an advertisement never deletes its history.
revoke delete on public.products from authenticated,anon;

create table public.marketplace_reports(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id) on delete restrict,reporter_id uuid not null references public.profiles(id) on delete cascade,reason text not null check(length(reason) between 20 and 2000),status text not null default 'pending' check(status in ('pending','reviewed')),resolution text,reviewed_by uuid references public.profiles(id) on delete set null,created_at timestamptz not null default now(),reviewed_at timestamptz,unique(product_id,reporter_id));
alter table public.marketplace_reports enable row level security;
create policy marketplace_reports_read on public.marketplace_reports for select to authenticated using(reporter_id=(select auth.uid()) or (select public.can_manage_marketplace()));
grant select on public.marketplace_reports to authenticated;
grant all on public.marketplace_reports to service_role;
create or replace function public.report_marketplace_product(p_product_id uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare id uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para denunciar.'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 20 and 2000 then raise exception 'Explique a denúncia em 20 a 2.000 caracteres.'; end if;
 if not exists(select 1 from public.products where products.id=p_product_id and state_enterprise_id is null and moderation_status='approved') then raise exception 'Anúncio indisponível.'; end if;
 insert into public.marketplace_reports(product_id,reporter_id,reason) values(p_product_id,auth.uid(),btrim(p_reason)) on conflict(product_id,reporter_id) do nothing returning marketplace_reports.id into id;
 if id is null then select r.id into id from public.marketplace_reports r where product_id=p_product_id and reporter_id=auth.uid(); end if;
 return id;
end; $$;
create or replace function public.review_marketplace_report(p_report_id uuid,p_resolution text) returns void language plpgsql security definer set search_path='' as $$
declare r public.marketplace_reports%rowtype;
begin
 if not public.can_manage_marketplace() then raise exception 'Você não tem permissão para revisar denúncias.'; end if;
 if length(btrim(coalesce(p_resolution,'')))<10 then raise exception 'Explique o resultado da análise.'; end if;
 select * into r from public.marketplace_reports where id=p_report_id for update;
 if not found then raise exception 'Denúncia não encontrada.'; end if;
 if r.status='reviewed' then return; end if;
 update public.marketplace_reports set status='reviewed',resolution=btrim(p_resolution),reviewed_by=auth.uid(),reviewed_at=clock_timestamp() where id=r.id;
 perform public.justice_write_audit('marketplace.report_reviewed','marketplace_report',r.id,to_jsonb(r),jsonb_build_object('resolution',p_resolution),p_resolution);
 insert into public.notifications(user_id,type,content,link) values(r.reporter_id,'marketplace_report_reviewed','Sua denúncia de anúncio foi analisada: '||btrim(p_resolution),'/services/business');
end; $$;
revoke all on function public.report_marketplace_product(uuid,text),public.review_marketplace_report(uuid,text) from public,anon;
grant execute on function public.report_marketplace_product(uuid,text),public.review_marketplace_report(uuid,text) to authenticated;

do $$ declare t text; begin foreach t in array array['state_enterprises','marketplace_reports','election_office_assignments'] loop if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if; end loop; end $$;
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
        is_active = case when v_enterprise.service_key='marketplace' then true else false end,
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
$function$;
CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,coalesce(product.metadata,'{}')||jsonb_build_object('stock_depleted_at',product.stock_depleted_at),product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category) AS value) levy
  where seller.deleted_at is null and product.archived_at is null and product.moderation_status='approved' and exists(select 1 from public.state_enterprises ms where ms.service_key='marketplace' and ms.is_active)
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$;
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
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb; v_market public.state_enterprises%rowtype; v_market_account uuid; v_market_owner uuid; v_commission numeric; v_commission_snapshot jsonb;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id,'total',v_order.total_amount,'tax',v_order.consumption_tax+v_order.corporate_tax); end if;
  perform public.process_due_legal_effects();
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  perform private.assert_citizen_service('/services/business');
  if v_product.moderation_status<>'approved' or v_product.archived_at is not null then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select * into v_market from public.state_enterprises where service_key='marketplace' for share;
  if not found or not v_market.is_active then raise exception 'MARKETPLACE_UNAVAILABLE'; end if;
  if v_market.is_privatized then
    select coalesce(b.owner_id,v_market.privatization_buyer_id),b.bank_account_id into v_market_owner,v_market_account from public.businesses b where b.id=v_market.operating_business_id;
    if v_market_owner is null then v_market_owner:=v_market.privatization_buyer_id; end if;
    if v_market_account is null then select id into v_market_account from public.accounts where user_id=v_market_owner; end if;
    if v_market_account is null then raise exception 'MARKETPLACE_RECEIVING_ACCOUNT_REQUIRED'; end if;
  end if;

  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for share;
    if not found or v_business.status is distinct from 'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.owner_id is distinct from v_product.seller_id then raise exception 'SELLER_OWNERSHIP_CHANGED'; end if;
  end if;
  -- Consistent account lock order avoids opposing purchases deadlocking.
  perform id from public.accounts
    where user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id or id=v_market_account order by id for update;
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
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'base_amount',v_base,'amount',v_commission,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
  v_levies:=v_levies||jsonb_build_object('net_amount',v_seller_net,'commission_amount',v_commission,'commission_snapshot',v_commission_snapshot);


  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where user_id=v_buyer for update;
    if not found then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED'; end if;
    if v_buyer_account.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
    update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_buyer_account.id;
  elsif p_payment_method='card' then
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active and card_type='credit' for update;
    if not found then raise exception 'INVALID_CARD'; end if;
    if v_card.card_limit-v_card.used_limit<v_total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
    update public.cards set used_limit=used_limit+v_total where id=v_card.id;
  else raise exception 'INVALID_PAYMENT_METHOD'; end if;

  update public.accounts set balance=balance+v_seller_net,updated_at=clock_timestamp() where id=v_seller_account.id;
  if v_market.is_privatized and v_commission>0 then update public.accounts set balance=balance+v_commission,updated_at=clock_timestamp() where id=v_market_account; end if;
  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  update public.government_finances set treasury_balance=treasury_balance+v_consumption_tax+v_corporate_tax+case when not v_market.is_privatized then v_commission else 0 end,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_buyer_account.id,v_seller_account.id,v_total,'Compra: '||v_product.name,
    case when p_payment_method='card' then 'purchase_card' else 'purchase' end,
    jsonb_build_object('platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at,marketplace_enterprise_id,commission_amount,commission_snapshot
  ) values(p_idempotency_key,v_buyer,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp(),v_market.id,v_commission,v_commission_snapshot) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
  end if;

  if v_commission>0 then
    if v_product.business_id is not null then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'expense',-v_commission,'Comissão Negócios Livre: '||v_product.name); end if;
    if v_market.is_privatized then
      insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(null,v_market_account,v_commission,'marketplace_commission','Comissão de venda no Negócios Livre',jsonb_build_object('commerce_order_id',v_order.id,'gross_amount',v_commission,'net_amount',v_commission,'tax_amount',0,'commission_snapshot',v_commission_snapshot));
    else
      insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('fee','commerce_orders',v_order.id::text,v_product.seller_id,v_commission,public.rp_now(),jsonb_build_object('kind','marketplace_commission','transaction_id',v_transaction,'snapshot',v_commission_snapshot));
    end if;
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

create or replace function private.protect_marketplace_configuration() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and (new.commission_type is distinct from old.commission_type or new.commission_value is distinct from old.commission_value or new.publication_mode is distinct from old.publication_mode or new.manager_id is distinct from old.manager_id or new.operating_business_id is distinct from old.operating_business_id or new.service_key is distinct from old.service_key) then raise exception 'Use a ação autorizada de configuração do marketplace.'; end if;
 return new;
end; $$;
revoke all on function private.protect_marketplace_configuration() from public,anon,authenticated;
create trigger protect_marketplace_configuration before update on public.state_enterprises for each row execute function private.protect_marketplace_configuration();
commit;
