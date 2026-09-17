-- Reuse the authoritative purchase path, inventory, invoices and fiscal snapshots.
create or replace function private.buy_state_product(p_product_id uuid,p_payment_method text,p_card_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.products%rowtype; a public.accounts%rowtype; t uuid; inv uuid; q jsonb; total numeric; tax numeric; net numeric; o uuid; spec jsonb; service_path text; payment_card public.cards%rowtype; invoice_id uuid;
begin
 select * into p from public.products where id=p_product_id for update;
 service_path:=case when p.residence_spec is null then '/services/national-market' else '/services/national-housing' end;
 perform private.assert_citizen_service(service_path);
 if not exists(select 1 from public.state_enterprises where id=p.state_enterprise_id and is_active and not is_privatized) then raise exception 'Esta oferta estatal está indisponível.'; end if;
 if p.stock<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
 if p.price<=0 then raise exception 'A oferta precisa de um preço válido.'; end if;
 q:=public.quote_legal_levies('purchase',p.price,false,p.economic_sector_id,p.category);
 if (q->>'restricted')::boolean then raise exception 'Esta operação está temporariamente restrita por norma vigente.'; end if;
 total:=(q->>'total_debited')::numeric;tax:=(q->>'buyer_tax')::numeric+(q->>'seller_tax')::numeric;net:=(q->>'net_amount')::numeric;
 select * into a from public.accounts where user_id=auth.uid() for update;
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
 update public.government_finances set treasury_balance=treasury_balance+total,updated_at=clock_timestamp() where id=1;
 insert into public.transactions(from_account_id,amount,description,type,metadata,idempotency_key)
 values(case when p_payment_method='balance' then a.id else null end,total,'Compra: '||p.name,case when p_payment_method='card' then 'purchase_card' else 'purchase' end,q||jsonb_build_object('platform',case when p.residence_spec is null then 'Mercado Nacional' else 'Imobiliária Nacional' end,'state_enterprise_id',p.state_enterprise_id,'product_id',p.id,'base_price',p.price,'card_id',payment_card.id,'buyer_id',auth.uid()),p_idempotency_key) returning id into t;
 insert into public.commerce_orders(idempotency_key,buyer_id,product_id,buyer_account_id,state_enterprise_id,payment_method,card_id,base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id)
 values(p_idempotency_key,auth.uid(),p.id,a.id,p.state_enterprise_id,p_payment_method,payment_card.id,p.price,(q->>'buyer_tax')::numeric,(q->>'seller_tax')::numeric,total,net,t) returning id into o;
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
end; $$;


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
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id,'total',v_order.total_amount,'tax',v_order.consumption_tax+v_order.corporate_tax); end if;
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
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active and card_type='credit' for update;
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
