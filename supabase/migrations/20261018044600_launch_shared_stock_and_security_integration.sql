begin;
-- Product stock is a projection of the existing physical company inventory.
alter table public.products add column resource_code text references public.economic_resources(code);
create unique index one_company_resource_listing on public.products(business_id,resource_code) where resource_code is not null;
create function private.sync_physical_listing_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare amount numeric;flag text:=current_setting('govrp.physical_stock_sync',true);delta numeric;
begin
 if tg_table_name='business_inventory' then
  perform set_config('govrp.physical_stock_sync','projection',true);
  update public.products set stock=greatest(0,floor(new.quantity))::int where business_id=new.business_id and resource_code=new.resource_code and stock is distinct from greatest(0,floor(new.quantity))::int;
  perform set_config('govrp.physical_stock_sync',coalesce(flag,''),true);return new;
 end if;
 if new.resource_code is null then return new;end if;
 if flag='projection' then return new;end if;
 if tg_op='INSERT' or new.resource_code is distinct from old.resource_code then
  if current_setting('govrp.physical_listing_authorized',true) is distinct from new.business_id::text then raise exception 'Publique o recurso pelo painel de estoque da empresa.' using errcode='42501';end if;
  select quantity into amount from public.business_inventory where business_id=new.business_id and resource_code=new.resource_code for update;
  new.stock:=greatest(0,floor(coalesce(amount,0)))::int;
 elsif new.stock is distinct from old.stock then
  delta:=old.stock-new.stock;
  if delta<0 then raise exception 'O estoque físico só aumenta por compra de insumos ou produção.';end if;
  select quantity into amount from public.business_inventory where business_id=new.business_id and resource_code=new.resource_code for update;
  if amount is null or amount<delta then raise exception 'O estoque desta oferta foi atualizado. Confira a disponibilidade.';end if;
  perform set_config('govrp.physical_stock_sync','checkout',true);
  update public.business_inventory set quantity=quantity-delta,updated_at=clock_timestamp() where business_id=new.business_id and resource_code=new.resource_code;
  perform set_config('govrp.physical_stock_sync',coalesce(flag,''),true);
 end if;
 return new;
end $$;
create trigger physical_listing_stock before insert or update of stock,resource_code on public.products for each row execute function private.sync_physical_listing_stock();
create trigger physical_inventory_projection after insert or update of quantity on public.business_inventory for each row when (current_setting('govrp.physical_stock_sync',true) is distinct from 'checkout') execute function private.sync_physical_listing_stock();
revoke all on function private.sync_physical_listing_stock() from public,anon,authenticated;

create function public.publish_company_resource_listing(p_business_id uuid,p_resource_code text,p_price numeric) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype;r public.economic_resources%rowtype;pid uuid;stock numeric;
begin
 if auth.uid() is null or not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode anunciar o estoque da empresa.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id and status='active' for update;
 select * into r from public.economic_resources where code=p_resource_code;
 select quantity into stock from public.business_inventory where business_id=b.id and resource_code=r.code for update;
 if b.id is null or b.owner_id is null or r.code is null or stock is null or p_price is null or p_price::text in ('NaN','Infinity','-Infinity') or p_price not between .01 and 1000000000 then raise exception 'Confira recurso, preço e empresa.';end if;
 select id into pid from public.products where business_id=b.id and resource_code=r.code for update;
 if pid is null then
  -- Reuse listing fees, moderation and existing purchase/tax pipeline.
  perform set_config('govrp.physical_listing_authorized',b.id::text,true);
  pid:=(public.publish_business_product(jsonb_build_object('p_business_id',b.id,'p_name',r.name,'p_description','Produto do estoque físico de '||b.name||'. Quantidade em '||r.unit||'.','p_price',p_price,'p_product_type','one-time','p_category','Insumos','p_stock',greatest(1,floor(stock))::int,'p_consumable_effects','{}'::jsonb),0,7,md5('resource-listing:'||b.id||':'||r.code)::uuid)).id;
  update public.products set resource_code=r.code where id=pid;
  perform set_config('govrp.physical_listing_authorized','',true);
 else update public.products set price=p_price,archived_at=null where id=pid;end if;
 perform economy_private.audit('company_resource_listed','products',pid::text,null,jsonb_build_object('resource_code',r.code,'price',p_price),'Anúncio vinculado ao estoque físico existente.',auth.uid());
 return pid;
end $$;
revoke all on function public.publish_company_resource_listing(uuid,text,numeric) from public,anon;
grant execute on function public.publish_company_resource_listing(uuid,text,numeric) to authenticated;

create function public.search_agies_targets(p_kind text,p_query text default '',p_offset integer default 0) returns table(id uuid,name text) language plpgsql stable security definer set search_path='' as $$
begin
 perform private.assert_agies();
 if length(coalesce(p_query,''))>120 or p_offset<0 or p_offset>1000000 then raise exception 'Busca inválida.';end if;
 if p_kind='party' then return query select p.id,p.name from public.political_parties p where p.is_active and position(lower(coalesce(p_query,'')) in lower(p.name||' '||p.acronym))>0 order by p.name,p.id limit 50 offset p_offset;
 elsif p_kind='company' then return query select b.id,b.name from public.businesses b where b.status='active' and position(lower(coalesce(p_query,'')) in lower(b.name))>0 order by b.name,b.id limit 50 offset p_offset;
 else raise exception 'Tipo de alvo inválido.';end if;
end $$;
create function public.get_agies_investigation_links(p_mission_id uuid) returns table(id uuid,number text) language plpgsql stable security definer set search_path='' as $$
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'Consulta restrita à direção.' using errcode='42501';end if;
 return query select c.id,c.investigation_number from public.criminal_investigations c join public.investigation_subjects s on s.investigation_id=c.id join public.agies_missions m on m.target_id=s.profile_id where m.id=p_mission_id and c.status not in ('closed','archived') order by c.opened_at desc;
end $$;
revoke all on function public.search_agies_targets(text,text,integer),public.get_agies_investigation_links(uuid) from public,anon;
grant execute on function public.search_agies_targets(text,text,integer),public.get_agies_investigation_links(uuid) to authenticated;

create function public.search_running_mates(p_election_id uuid,p_query text default '',p_offset integer default 0) returns table(id uuid,full_name text,username text,avatar_url text,role text,total_count bigint) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Entre para escolher o vice da chapa.' using errcode='42501';end if;
 if length(coalesce(p_query,''))>120 or p_offset<0 then raise exception 'Busca inválida.';end if;
 return query select p.id,p.full_name,p.username,p.avatar_url,p.role,count(*) over() from public.profiles p
 where p.id<>auth.uid() and p.deleted_at is null and (p.onboarding_completed or p.onboarding_mode='legacy_migration') and p.role not in ('Admin','Presidente')
 and position(lower(coalesce(p_query,'')) in lower(concat_ws(' ',p.full_name,p.username,p.x_handle,p.x_username)))>0
 and not exists(select 1 from public.candidates c where c.election_id=p_election_id and c.status in ('Pendente','Approved') and p.id in (c.user_id,c.vice_candidate_id))
 and not exists(select 1 from public.notifications n where n.user_id=p.id and n.type='vice_candidacy_invitation' and n.metadata->>'status'='pending' and n.metadata->>'election_id'=p_election_id::text)
 order by lower(p.full_name),p.id limit 50 offset p_offset;
end $$;
revoke all on function public.search_running_mates(uuid,text,integer) from public,anon;
grant execute on function public.search_running_mates(uuid,text,integer) to authenticated;

-- Canonical absence never satisfies a NOT IN authorization check through SQL NULL.
create or replace function public.get_authority_role(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when public.is_admin(p_user_id) then 'Admin' else coalesce(public.get_user_role(p_user_id),'Cidadão') end;
$$;

-- Install the established Admin preview write guard on every new world table.
do $$declare t text;begin
 foreach t in array array['citizen_happiness_events','agies_clearances','agies_dossiers','agies_reports','agies_report_recipients','agies_tasks'] loop
 execute format('create trigger audit_admin_world_write before insert or update or delete on public.%I for each row execute function private.audit_admin_world_write()',t);
 end loop;
end $$;

CREATE OR REPLACE FUNCTION private.buy_product_authoritative(p_buyer uuid, p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid, p_renewal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid:=p_buyer;v_product public.products%rowtype;v_business public.businesses%rowtype;
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
  perform 1 from public.state_enterprises where service_key='marketplace' for share;
  perform id from public.businesses where id=(select business_id from public.products where id=p_product_id) for update;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  if p_renewal is null then perform private.assert_citizen_service('/services/business');
  elsif not exists(select 1 from public.user_subscriptions where id=p_renewal and user_id=v_buyer and product_id=p_product_id and status in('active','past_due')) then raise exception 'SUBSCRIPTION_NOT_AVAILABLE';end if;
  if v_product.moderation_status<>'approved' or v_product.archived_at is not null then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select * into v_market from public.state_enterprises where service_key='marketplace' for share;
  if not found or not v_market.is_active then raise exception 'MARKETPLACE_UNAVAILABLE'; end if;
  v_market:=private.marketplace_seller_policy(v_market,v_product.business_id,true);
  if v_market.active_listing_fee_enabled and v_market.active_listing_fee_amount>0 and (v_product.listing_status='awaiting_renewal' or v_product.listing_paid_until<=clock_timestamp()) then raise exception 'LISTING_RENEWAL_REQUIRED';end if;
  if v_market.is_privatized then
    select coalesce(b.owner_id,v_market.privatization_buyer_id),b.bank_account_id into v_market_owner,v_market_account from public.businesses b where b.id=v_market.operating_business_id;
    if v_market_owner is null then v_market_owner:=v_market.privatization_buyer_id; end if;
    if v_market_account is null then select id into v_market_account from public.accounts where user_id=v_market_owner; end if;
    if v_market_account is null then raise exception 'MARKETPLACE_RECEIVING_ACCOUNT_REQUIRED'; end if;
  end if;

  if p_renewal is null and v_product.product_type='subscription' and exists(select 1 from public.user_subscriptions where user_id=v_buyer and product_id=v_product.id and status in('active','past_due')) then raise exception 'SUBSCRIPTION_ALREADY_ACTIVE';end if;
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for update;
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
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end+v_market.fixed_sale_fee,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'fixed_sale_fee',v_market.fixed_sale_fee,'percentage_amount',case when v_market.commission_type='percentage' then round(v_base*v_market.commission_value/100,2) else 0 end,'base_amount',v_base,'amount',v_commission,'seller_type',case when v_product.business_id is null then 'PF' else 'PJ' end,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
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
    jsonb_build_object('billing_subscription_id',p_renewal,'platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
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
    if p_renewal is null then
      insert into public.user_subscriptions(user_id,product_id,seller_id,status,last_payment_date,next_payment_date)
      values(v_buyer,v_product.id,v_product.seller_id,'active',clock_timestamp(),clock_timestamp()+(v_product.subscription_interval)::interval);
      update public.products set subscribers_count=coalesce(subscribers_count,0)+1 where id=v_product.id;
    else
      update public.user_subscriptions set status='active',seller_id=v_product.seller_id,last_payment_date=clock_timestamp(),next_payment_date=greatest(next_payment_date,clock_timestamp())+(v_product.subscription_interval)::interval,updated_at=clock_timestamp() where id=p_renewal;
    end if;
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
$function$
;
CREATE OR REPLACE FUNCTION public.checkout_marketplace_cart(p_items jsonb, p_payment_method text, p_card_id uuid, p_checkout_id uuid, p_expected_total numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare normalized jsonb; intent jsonb; previous public.commerce_orders%rowtype; item record; quantity integer; result jsonb; order_id uuid; total numeric; ids uuid[]; ids_business uuid[]; market public.state_enterprises%rowtype; market_account uuid; child_key uuid;
begin
 if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED';end if;
 perform private.assert_citizen_service('/services/business');
 if p_checkout_id is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'INVALID_CART';end if;
 if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'INVALID_CART';end if;
 if p_payment_method is null or p_payment_method not in('balance','card') or (p_payment_method='balance' and p_card_id is not null) then raise exception 'INVALID_PAYMENT_METHOD';end if;
 if p_expected_total is null or p_expected_total<0 or p_expected_total::text in('NaN','Infinity','-Infinity') then raise exception 'CART_PRICE_CHANGED';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item.value)<>'object' or jsonb_typeof(item.value->'product_id') is distinct from 'string' or jsonb_typeof(item.value->'quantity') is distinct from 'number'
     or coalesce(item.value->>'product_id','')!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_CART';end if;
  if (item.value->>'quantity')::numeric<1 or (item.value->>'quantity')::numeric>100 or trunc((item.value->>'quantity')::numeric)<>(item.value->>'quantity')::numeric then raise exception 'INVALID_CART';end if;
 end loop;
 if (select count(distinct (v->>'product_id')::uuid) from jsonb_array_elements(p_items) v)<>jsonb_array_length(p_items)
 or (select sum((v->>'quantity')::numeric) from jsonb_array_elements(p_items) v)>100 then raise exception 'INVALID_CART';end if;
 select jsonb_agg(jsonb_build_object('product_id',(v->>'product_id')::uuid,'quantity',(v->>'quantity')::integer) order by (v->>'product_id')::uuid),array_agg((v->>'product_id')::uuid)
 into normalized,ids from jsonb_array_elements(p_items) v;
 intent:=jsonb_build_object('items',normalized,'method',p_payment_method,'card_id',p_card_id,'expected_total',p_expected_total);
 perform pg_advisory_xact_lock(hashtextextended('cart:'||p_checkout_id::text,0));
 select * into previous from public.commerce_orders where checkout_id=p_checkout_id limit 1;
 if found then
   if previous.buyer_id is distinct from auth.uid() then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN';end if;
   if previous.checkout_request is distinct from intent then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
 else
   perform public.process_due_legal_effects();
   select * into market from public.state_enterprises where service_key='marketplace' for share;
   -- Lock the entire cart before invoking the existing purchase pipeline. A failure
   -- anywhere rolls back money, stock, subscriptions, invoices and notifications.
   select array_agg(distinct business_id) into ids_business from public.products where id=any(ids) and business_id is not null;
   perform id from public.businesses where id=any(ids_business) order by id for update;
   perform id from public.products where id=any(ids) order by id for update;
   if (select count(*) from public.products where id=any(ids))<>cardinality(ids) then raise exception 'PRODUCT_NOT_FOUND';end if;
   if exists(select 1 from public.products where id=any(ids) and state_enterprise_id is not null) then raise exception 'INVALID_CART';end if;
   select array_agg(distinct business_id) into ids_business from public.products where id=any(ids) and business_id is not null;
   perform id from public.businesses where id=any(ids_business) order by id for update;
   if market.is_privatized then
     select coalesce(b.bank_account_id,(select a.id from public.accounts a where a.user_id=coalesce(b.owner_id,market.privatization_buyer_id))) into market_account from public.businesses b where b.id=market.operating_business_id;
     if market_account is null then select id into market_account from public.accounts where user_id=market.privatization_buyer_id;end if;
   end if;
   perform a.id from public.accounts a where a.user_id=auth.uid() or a.id=market_account
     or a.id in(select bank_account_id from public.businesses where id=any(ids_business))
     or a.user_id in(select seller_id from public.products where id=any(ids) and business_id is null) order by a.id for update;
   for item in select (v->>'product_id')::uuid product_id,(v->>'quantity')::integer quantity from jsonb_array_elements(normalized) v loop
     if item.quantity<>1 and exists(select 1 from public.products where id=item.product_id and product_type='subscription') then raise exception 'SUBSCRIPTION_QUANTITY_INVALID';end if;
     for quantity in 1..item.quantity loop
       child_key:=md5(p_checkout_id::text||':'||item.product_id::text||':'||quantity::text)::uuid;
       result:=public.buy_product(item.product_id,p_payment_method,p_card_id,child_key);
       if not coalesce((result->>'success')::boolean,false) then raise exception 'CART_PURCHASE_FAILED';end if;
       order_id:=(result->>'order_id')::uuid;
       update public.commerce_orders set checkout_id=p_checkout_id,checkout_request=intent where id=order_id and buyer_id=auth.uid();
     end loop;
   end loop;
   select sum(total_amount) into total from public.commerce_orders where checkout_id=p_checkout_id;
   if total is distinct from p_expected_total then raise exception 'CART_PRICE_CHANGED';end if;
 end if;
 select jsonb_build_object('success',true,'checkout_id',p_checkout_id,'total',sum(o.total_amount),'base_amount',sum(o.base_amount),'buyer_tax',sum(o.consumption_tax),
   'orders',jsonb_agg(jsonb_build_object('id',o.id,'product_id',o.product_id,'base_amount',o.base_amount,'buyer_tax',o.consumption_tax,'total',o.total_amount,'levies',t.metadata->'levies') order by o.created_at,o.id))
 into result from public.commerce_orders o join public.transactions t on t.id=o.transaction_id where o.checkout_id=p_checkout_id and o.buyer_id=auth.uid();
 return result;
end $function$
;
commit;
