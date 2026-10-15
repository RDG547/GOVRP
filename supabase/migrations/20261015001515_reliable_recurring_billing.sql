begin;
CREATE OR REPLACE FUNCTION private.buy_product_authoritative(p_buyer uuid, p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid, p_renewal uuid DEFAULT NULL)
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

revoke all on function private.buy_product_authoritative(uuid,uuid,text,uuid,uuid,uuid) from public,anon,authenticated;
create or replace function public.buy_product(p_product_id uuid,p_payment_method text,p_card_id uuid,p_idempotency_key uuid) returns jsonb language sql security definer set search_path='' as $$
 select private.buy_product_authoritative(auth.uid(),p_product_id,p_payment_method,p_card_id,p_idempotency_key,null);
$$;
alter table public.user_services add column next_billing_at timestamptz,add column billing_status text not null default 'active' check(billing_status in('active','past_due','recovery_pending'));
update public.user_services set next_billing_at=greatest(coalesce(last_billed_at,contracted_at)+interval '7 days',clock_timestamp());

-- Requeue only essential services carrying the legacy scheduler's deactivation
-- notice. The new atomic processor verifies balance before restoring access.
update public.user_services s set billing_status='recovery_pending',due_amount=price,next_billing_at=clock_timestamp()
where not s.is_active and s.service_type in('Internet','Telefonia','Energia Elétrica','Água','Gás')
and exists(select 1 from public.notifications n where n.user_id=s.user_id and n.type='service_deactivated'
 and n.content='Seu serviço de '||s.service_type||' foi desativado por falta de pagamento.'
 and n.created_at>=coalesce(s.last_billed_at,s.contracted_at));

create table private.recurring_billing_cycles(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in('service','subscription')),subscription_id uuid not null,user_id uuid not null references public.profiles(id) on delete cascade,
 due_at timestamptz not null,amount numeric(18,2),status text not null default 'pending' check(status in('pending','paid','insufficient','technical_failure')),
 attempts integer not null default 0,next_attempt_at timestamptz default clock_timestamp(),transaction_id uuid references public.transactions(id) on delete set null,
 last_error text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(kind,subscription_id,due_at)
);
alter table private.recurring_billing_cycles enable row level security;
revoke all on private.recurring_billing_cycles from public,anon,authenticated;
create index recurring_billing_retry_idx on private.recurring_billing_cycles(next_attempt_at) where status<>'paid';
create or replace function private.guard_service_billing() returns trigger language plpgsql set search_path='' as $$
declare prices jsonb; k text;
begin
 if tg_op='INSERT' then new.next_billing_at:=coalesce(new.next_billing_at,clock_timestamp()+interval '7 days');end if;
 if current_user in('authenticated','anon') then
  if tg_op='UPDATE' and (new.user_id is distinct from old.user_id or new.contracted_at is distinct from old.contracted_at or new.last_billed_at is distinct from old.last_billed_at or new.next_billing_at is distinct from old.next_billing_at or new.due_amount is distinct from old.due_amount or new.billing_status is distinct from old.billing_status or (old.billing_status='past_due' and new.is_active)) then raise exception 'Os dados de cobrança são atualizados pelo banco.' using errcode='42501';end if;
  if tg_op='INSERT' then new.next_billing_at:=clock_timestamp()+interval '7 days';new.last_billed_at:=null;new.due_amount:=0;new.billing_status:='active';end if;
  if new.service_type in('Internet','Telefonia') then
    select coalesce(value,'{}') into prices from public.system_settings settings where settings.key='basic_service_prices';
    prices:='{"Internet_Básico":79.90,"Internet_Ultra":99.90,"Internet_Mega":149.90,"Telefonia_Básico":29.90,"Telefonia_Intermediário":49.90,"Telefonia_Premium":79.90}'::jsonb||coalesce(prices,'{}');
    k:=new.service_type||'_'||new.plan_name;
    if not prices?k then raise exception 'Escolha um plano disponível.';end if;
    new.price:=(prices->>k)::numeric;
  end if;
 end if;
 if new.price is null or new.price<0 or new.price::text in('NaN','Infinity','-Infinity') then raise exception 'O valor do serviço deve ser válido.';end if;
 return new;
end $$;
create trigger guard_service_billing before insert or update on public.user_services for each row execute function private.guard_service_billing();
revoke all on function private.guard_service_billing() from public,anon,authenticated;

create or replace function private.charge_recurring_cycle(p_kind text,p_id uuid,p_due timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
<<billing>>
declare s public.user_services%rowtype;sub public.user_subscriptions%rowtype;c private.recurring_billing_cycles%rowtype;a public.accounts%rowtype;tx uuid;r jsonb;amount numeric;cfg jsonb;k text;link text;label text;uid uuid;next_due timestamptz;details text;provider public.state_enterprises%rowtype;recipient uuid;key uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('recurring:'||p_kind||':'||p_id::text,0));
 if p_kind='service' then
  select * into s from public.user_services where id=p_id for update;
  if s.id is null or not(s.is_active or s.billing_status in('past_due','recovery_pending')) or s.next_billing_at is distinct from p_due or p_due>clock_timestamp() then return jsonb_build_object('skipped',true);end if;
  uid:=s.user_id;amount:=s.price;label:=s.service_type;
  select coalesce(value,'{}') into cfg from public.system_settings settings where settings.key='basic_service_prices';k:=case when s.service_type in('Internet','Telefonia') then s.service_type||'_'||s.plan_name else s.service_type end;
  if cfg?k then amount:=(cfg->>k)::numeric;end if;
  link:=case s.service_type when 'Internet' then '/services/internet' when 'Telefonia' then '/services/phone' when 'Energia Elétrica' then '/services/electricity' when 'Água' then '/services/water' when 'Gás' then '/services/gas' else '/services/bank' end;
 else
  select * into sub from public.user_subscriptions where id=p_id for update;
  if sub.id is null or sub.status not in('active','past_due') or sub.next_payment_date is distinct from p_due or p_due>clock_timestamp() then return jsonb_build_object('skipped',true);end if;
  uid:=sub.user_id;select name,price into label,amount from public.products where id=sub.product_id;link:='/dashboard/citizen?tab=inventory';
 end if;
 insert into private.recurring_billing_cycles(kind,subscription_id,user_id,due_at,amount) values(p_kind,p_id,uid,p_due,amount) on conflict(kind,subscription_id,due_at) do nothing;
 select * into c from private.recurring_billing_cycles where kind=p_kind and subscription_id=p_id and due_at=p_due for update;
 if c.status='paid' or c.next_attempt_at is null or c.next_attempt_at>clock_timestamp() then return jsonb_build_object('skipped',true);end if;
 key:=md5('recurring:'||c.id::text)::uuid;
 -- The subtransaction rolls back every monetary write on failure, while the outer
 -- transaction preserves a bounded retry record. A technical error never suspends.
 begin
  if p_kind='subscription' then
   r:=private.buy_product_authoritative(uid,sub.product_id,'balance',null,key,sub.id);
   tx:=(r->>'transaction_id')::uuid;amount:=(r->>'total')::numeric;
   select next_payment_date into next_due from public.user_subscriptions where id=sub.id;
  else
   if amount is null or amount<0 or amount::text in('NaN','Infinity','-Infinity') then raise exception 'INVALID_SERVICE_PRICE';end if;
   select * into provider from public.state_enterprises where sector=s.service_type and is_active order by is_system desc,id limit 1 for share;
   if provider.is_privatized then
    select bank_account_id into recipient from public.businesses where id=provider.operating_business_id;
    if recipient is null then select id into recipient from public.accounts where user_id=provider.privatization_buyer_id and account_kind='personal';end if;
    if recipient is null then raise exception 'SERVICE_RECEIVING_ACCOUNT_REQUIRED';end if;
   end if;
   perform id from public.accounts where (user_id=uid and account_kind='personal') or id=recipient order by id for update;
   select * into a from public.accounts where user_id=uid and account_kind='personal';
   if a.id is null then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED';end if;
   if a.balance<amount then raise exception 'INSUFFICIENT_BALANCE';end if;
   update public.accounts set balance=balance-amount,updated_at=clock_timestamp() where id=a.id;
   if recipient is not null then update public.accounts set balance=balance+amount,updated_at=clock_timestamp() where id=recipient;
   else insert into public.government_finances(id) values(1) on conflict do nothing;update public.government_finances set treasury_balance=treasury_balance+amount,updated_at=clock_timestamp() where id=1;end if;
   next_due:=greatest(p_due,clock_timestamp())+interval '7 days';
   insert into public.transactions(from_account_id,to_account_id,amount,description,type,idempotency_key,metadata)
   values(a.id,recipient,amount,'Renovação: '||label,'service_payment',key,jsonb_build_object('service_id',s.id,'billing_cycle_id',c.id,'billing_period',p_due,'gross_amount',amount,'total_debited',amount,'net_amount',amount,'tax_amount',0,'next_billing_at',next_due)) returning id into tx;
   if recipient is null and amount>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('other','transactions',tx::text,uid,amount,public.rp_now(),jsonb_build_object('billing_cycle_id',c.id));end if;
   update public.user_services set is_active=true,billing_status='active',price=amount,last_billed_at=clock_timestamp(),next_billing_at=next_due,due_amount=0 where id=s.id;
  end if;
  update private.recurring_billing_cycles set status='paid',amount=billing.amount,attempts=attempts+1,transaction_id=tx,next_attempt_at=null,last_error=null,updated_at=clock_timestamp() where id=c.id;
  insert into public.notifications(user_id,type,content,link,metadata) values(uid,'subscription_renewed',label||' renovada. Valor: R$ '||replace(to_char(amount,'FM999999999990.00'),'.',',')||'. Próxima cobrança: '||to_char(next_due at time zone 'America/Sao_Paulo','DD/MM/YYYY')||'.',link,jsonb_build_object('billing_cycle_id',c.id,'transaction_id',tx,'amount',amount,'next_billing_at',next_due));
  return jsonb_build_object('paid',true,'amount',amount,'transaction_id',tx);
 exception when others then
  get stacked diagnostics details=message_text;
  update private.recurring_billing_cycles set attempts=attempts+1,status=case when details='INSUFFICIENT_BALANCE' then 'insufficient' else 'technical_failure' end,last_error=left(details,2000),
   next_attempt_at=case when details='INSUFFICIENT_BALANCE' and attempts>=2 then null when details='INSUFFICIENT_BALANCE' then clock_timestamp()+interval '1 day' else clock_timestamp()+make_interval(secs=>least(86400,300*power(2,least(attempts,8)))::integer) end,updated_at=clock_timestamp() where id=c.id;
  if details='INSUFFICIENT_BALANCE' then
   if p_kind='service' then update public.user_services set is_active=false,billing_status='past_due',due_amount=amount where id=s.id;
   else update public.user_subscriptions set status='past_due',updated_at=clock_timestamp() where id=sub.id;end if;
   if c.status<>'insufficient' then insert into public.notifications(user_id,type,content,link,metadata) values(uid,'subscription_payment_failed','Não foi possível renovar '||label||' por saldo insuficiente na sua conta pessoal.',link,jsonb_build_object('billing_cycle_id',c.id,'amount',amount));end if;
  else
   raise log 'Recurring billing cycle % failed: %',c.id,details;
  end if;
  return jsonb_build_object('paid',false,'technical_failure',details<>'INSUFFICIENT_BALANCE');
 end;
end $$;
revoke all on function private.charge_recurring_cycle(text,uuid,timestamptz) from public,anon,authenticated;
create or replace function public.process_weekly_service_bills() returns json language plpgsql security definer set search_path='' as $$
declare item record;r jsonb;paid integer:=0;total numeric:=0;
begin
 for item in select 'service' kind,id,next_billing_at due from public.user_services where (is_active or billing_status in('past_due','recovery_pending')) and next_billing_at<=clock_timestamp()
 and not exists(select 1 from private.recurring_billing_cycles c where c.kind='service' and c.subscription_id=user_services.id and c.due_at=user_services.next_billing_at and (c.status='paid' or c.next_attempt_at is null or c.next_attempt_at>clock_timestamp()))
 union all select 'subscription',id,next_payment_date from public.user_subscriptions where status in('active','past_due') and next_payment_date<=clock_timestamp() and not exists(select 1 from private.recurring_billing_cycles c where c.kind='subscription' and c.subscription_id=user_subscriptions.id and c.due_at=user_subscriptions.next_payment_date and (c.status='paid' or c.next_attempt_at is null or c.next_attempt_at>clock_timestamp())) order by due limit 250 loop
  r:=private.charge_recurring_cycle(item.kind,item.id,item.due);
  if coalesce((r->>'paid')::boolean,false) then paid:=paid+1;total:=total+(r->>'amount')::numeric;end if;
 end loop;
 return json_build_object('success',true,'total_billed',total,'users_billed',paid);
end $$;
revoke all on function public.process_weekly_service_bills() from public,anon,authenticated;
grant execute on function public.process_weekly_service_bills() to service_role;
select cron.schedule('govrp-recurring-billing','* * * * *','select public.process_weekly_service_bills()');
notify pgrst,'reload schema';
create or replace function public.retry_my_recurring_payment(p_kind text,p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare due timestamptz;r jsonb;cycle private.recurring_billing_cycles%rowtype;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para renovar.' using errcode='42501';end if;
 if p_kind='service' then select next_billing_at into due from public.user_services where id=p_id and user_id=auth.uid() and billing_status='past_due';
 elsif p_kind='subscription' then select next_payment_date into due from public.user_subscriptions where id=p_id and user_id=auth.uid() and status='past_due';end if;
 if due is null then raise exception 'Não há cobrança pendente disponível para esta conta.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('recurring:'||p_kind||':'||p_id::text,0));
 select * into cycle from private.recurring_billing_cycles where kind=p_kind and subscription_id=p_id and due_at=due for update;
 if cycle.updated_at>clock_timestamp()-interval '1 minute' then raise exception 'Aguarde um minuto antes de tentar novamente.';end if;
 update private.recurring_billing_cycles set next_attempt_at=clock_timestamp() where id=cycle.id;
 r:=private.charge_recurring_cycle(p_kind,p_id,due);
 return jsonb_build_object('success',coalesce((r->>'paid')::boolean,false),'message',case when (r->>'paid')::boolean then 'Pagamento registrado. O serviço está ativo e o próximo vencimento foi atualizado.' when coalesce((r->>'technical_failure')::boolean,false) then 'A cobrança está temporariamente indisponível. Uma nova tentativa foi agendada.' else 'O saldo disponível na conta pessoal ainda é insuficiente.' end);
end $$;
revoke all on function public.retry_my_recurring_payment(text,uuid) from public,anon;
grant execute on function public.retry_my_recurring_payment(text,uuid) to authenticated;
create or replace function private.clear_recurring_cycles() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from private.recurring_billing_cycles where subscription_id=old.id and kind=case when tg_table_name='user_services' then 'service' else 'subscription' end;return old;
end $$;
revoke all on function private.clear_recurring_cycles() from public,anon,authenticated;
create trigger clear_service_billing_cycles after delete on public.user_services for each row execute function private.clear_recurring_cycles();
create trigger clear_subscription_billing_cycles after delete on public.user_subscriptions for each row execute function private.clear_recurring_cycles();
notify pgrst,'reload schema';

create or replace function private.guard_subscription_billing() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in('authenticated','anon') then
  if tg_op='INSERT' or tg_op='DELETE' then raise exception 'Assinaturas são contratadas e canceladas pelas ações do serviço.' using errcode='42501';end if;
  if new.status not in('cancelled','canceled') or (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) then raise exception 'Datas e valores da assinatura são atualizados pelo banco.' using errcode='42501';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.guard_subscription_billing() from public,anon,authenticated;
create trigger guard_subscription_billing before insert or update or delete on public.user_subscriptions for each row execute function private.guard_subscription_billing();
revoke delete on public.user_services from authenticated,anon;

CREATE OR REPLACE FUNCTION public.admin_execute_rp_reset(p_request_id uuid, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=private.assert_reset_admin(); req private.rp_reset_requests%rowtype;
  t record; tr record; s jsonb; v_ids uuid[]; v_result jsonb; v_progress integer;
  v_assignments text; v_brazil jsonb; v_selic numeric; v_monthly numeric;
begin
  -- Serialize administrative resets; each request is bound to its administrator
  -- and is idempotent even if the browser retries after losing the response.
  perform pg_catalog.pg_advisory_xact_lock(725104,1);
  select * into req from private.rp_reset_requests where id=p_request_id for update;
  if not found or req.requested_by<>v_actor then raise exception 'Solicitação de reset inválida.'; end if;
  if p_confirmation is distinct from 'RESETAR' then
    raise exception 'Digite a frase de confirmação exatamente como exibida.';
  end if;
  if req.completed_at is not null then return req.result; end if;
  if req.expires_at<clock_timestamp() then raise exception 'A prévia expirou. Prepare uma nova confirmação.'; end if;

  -- Locks include catalogs/configuration because gameplay triggers may write to
  -- them. No other transaction can observe or write a half-reset world.
  for t in select * from private.rp_reset_policy() order by table_name loop
    execute format('lock table public.%I in access exclusive mode',t.table_name);
  end loop;
  perform private.assert_reset_admin();
  if req.scope<>'selected_users' then
    select coalesce(array_agg(id order by id),'{}') into v_ids from public.profiles where deleted_at is null;
    if v_ids is distinct from req.user_ids then raise exception 'A lista de usuários mudou. Revise uma nova prévia.'; end if;
  elsif exists(select 1 from unnest(req.user_ids) x where not exists(
    select 1 from public.profiles where id=x and deleted_at is null
  )) then raise exception 'Uma conta selecionada foi removida. Revise uma nova prévia.'; end if;
  if req.scope='full_rp' and (
    exists(select 1 from public.country_rp_states c where c.is_playable
      and not exists(select 1 from jsonb_array_elements(req.country_snapshots) x where x->>'country_code'=c.country_code))
    or exists(select 1 from jsonb_array_elements(req.country_snapshots) x where x->>'country_code'<>'BR'
      and not exists(select 1 from public.country_rp_states c where c.is_playable and c.country_code=x->>'country_code'))
  ) then
    raise exception 'A lista de países mudou. Consulte novamente as referências reais.';
  end if;
  lock table private.business_daily_effort, private.company_operations,
    private.population_demand_runs in access exclusive mode;
  v_result:=private.build_rp_reset_plan(req.scope,req.user_ids);
  -- The plan includes dependent/shared records; re-check under the write locks.
  -- Only user triggers are suspended, never FK/check/unique constraints. Their
  -- original enable modes are restored before commit (and on error by rollback).
  drop table if exists pg_temp.rp_reset_triggers;
  create temporary table rp_reset_triggers on commit drop as
    select c.relname table_name,g.tgname,g.tgenabled
    from pg_catalog.pg_trigger g join pg_catalog.pg_class c on c.oid=g.tgrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    join private.rp_reset_policy() p on p.table_name=c.relname
    where n.nspname='public' and not g.tgisinternal and g.tgenabled<>'D' and p.reset_mode<>'keep';
  update public.party_treasuries fund set balance=coalesce((select sum(entry.amount) from public.party_treasury_entries entry where entry.party_id=fund.party_id),0),updated_at=clock_timestamp() where fund.party_id is not null;

  set constraints public.accounts_business_id_fkey immediate;
  set constraints public.accounts_business_id_fkey deferred;
  for tr in select * from pg_temp.rp_reset_triggers loop
    execute format('alter table public.%I disable trigger %I',tr.table_name,tr.tgname);
  end loop;

  -- Profiles are stable login anchors. Replace only the character and its fields.
  select string_agg(format('%I=default',attname),',') into v_assignments
  from pg_catalog.pg_attribute where attrelid='public.profiles'::regclass and attnum>0 and not attisdropped
    and attname not in ('id','created_at','role','username','username_is_generated','deleted_at','anonymized_at','deletion_reason');
  execute 'update public.profiles set '||v_assignments||
    ',username=''u_''||left(replace(gen_random_uuid()::text,''-'',''''),18),username_is_generated=true,role=case when role=''Admin'' then ''Admin'' else ''Cidadão'' end where id=any($1)'
    using req.user_ids;

  delete from private.recurring_billing_cycles where req.scope='full_rp' or user_id=any(req.user_ids);
  delete from private.citizen_need_actions where user_id=any(req.user_ids);
  -- A removed party cannot remain attached to another citizen's profile.
  update public.profiles set party_affiliation=null where party_affiliation in (
    select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.political_parties'::regclass
  );
  delete from private.professional_work_answers where session_id in(select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.professional_work_sessions'::regclass);
  delete from private.infrastructure_maintenance where project_id in(select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.government_projects'::regclass);
  delete from private.business_daily_effort where business_id in (
    select (row_key->>'id')::uuid from pg_temp.rp_reset_rows where relation='public.businesses'::regclass
  );
  delete from private.company_operations where req.scope='full_rp' or actor_id=any(req.user_ids)
    or payload->>'business_id' in (
      select row_key->>'id' from pg_temp.rp_reset_rows where relation='public.businesses'::regclass
    );
  if req.scope='full_rp' then
    delete from private.population_demand_runs where operation_date is not null;
  end if;
  -- Delete children before parents, letting PostgreSQL enforce every FK. Self
  -- references are deleted together. Any unhandled dependency aborts everything.
  while exists(select 1 from pg_temp.rp_reset_rows) loop
    v_progress:=0;
    for t in select * from pg_temp.rp_reset_tables where relation in (select relation from pg_temp.rp_reset_rows) order by table_name loop
      begin
        execute format('delete from public.%I r using pg_temp.rp_reset_rows chosen where chosen.relation=$1 and chosen.row_key=%s',t.table_name,t.key_sql) using t.relation;
        delete from pg_temp.rp_reset_rows where relation=t.relation;
        v_progress:=v_progress+1;
      exception when foreign_key_violation then null;
      end;
    end loop;
    if v_progress=0 then raise exception 'Uma dependência impediu o reset; nenhuma alteração foi salva.'; end if;
  end loop;

  update public.system_settings set value=coalesce(private.remove_reset_profile_references(value,req.user_ids),'{}'),updated_at=clock_timestamp()
  where key in ('executive_governance','election_office_sync');
  -- Private ownership must not survive via a privatized state enterprise.
  update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_buyer_id=null,
    privatized_at=null,privatization_price=null,operating_business_id=null,manager_id=null,commission_value=0,publication_mode='automatic',updated_at=clock_timestamp()
  where privatization_buyer_id=any(req.user_ids);
  update public.state_enterprises set manager_id=null where manager_id=any(req.user_ids);
  update public.political_parties set president_id=null where president_id=any(req.user_ids);
  update public.political_parties set vice_president_id=null where vice_president_id=any(req.user_ids);

  if req.scope='full_rp' then
    -- Reset mutable state to schema defaults; retain only catalog definitions.
    for t in select * from (values
      ('economic_state','{id}'::text[]),
      ('government_finances','{id}'::text[]),
      ('government_popularity_state','{country_code}'::text[]),
      ('country_population_segments','{country_code,segment_key,name,description,population_share}'::text[])
    ) x(table_name,keep_columns) loop
      select string_agg(format('%I=default',attname),',') into v_assignments
      from pg_catalog.pg_attribute where attrelid=to_regclass('public.'||t.table_name) and attnum>0 and not attisdropped
        and not attname=any(t.keep_columns);
      execute format('update public.%I set %s where %I is not null',t.table_name,v_assignments,t.keep_columns[1]);
    end loop;
    insert into public.economic_state(id) values(true) on conflict do nothing;
    insert into public.government_finances(id) values(1) on conflict do nothing;
    insert into public.government_popularity_state(country_code) values('BR') on conflict do nothing;
    update public.government_finances set treasury_balance=0,loans_balance=0,corporate_card_used=0 where id=1;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind) values
      ('corporate_tax_rate',0.10,'ratio','Alíquota sobre receitas empresariais','system'),
      ('consumption_tax_rate',0.03,'ratio','Alíquota incidente sobre compras de produtos','system'),
      ('business_license_fee',250,'BRL','Taxa para abertura de empresa','system'),
      ('public_safety_policy_index',50,'index','Intensidade da política nacional de segurança','system'),
      ('social_welfare_policy_index',50,'index','Intensidade da política nacional de bem-estar','system');

    update public.government_rules set rule_kind='tax',definition=jsonb_build_object('basis','purchase','payer',case when rule_key='corporate_tax_rate' then 'seller' else 'buyer' end,'nature','percentage','audience',case when rule_key='corporate_tax_rate' then 'business' else 'all' end) where rule_key in('corporate_tax_rate','consumption_tax_rate');
    update public.government_rules set rule_kind='fee',definition='{"basis":"license","nature":"fixed","payer":"buyer","audience":"all"}' where rule_key='business_license_fee';
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition) values('transaction_tax',0,'ratio','Imposto sobre transferências','system','tax','{"basis":"transfer","nature":"percentage","payer":"buyer","audience":"all"}');
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'penalty_'||replace(id::text,'-',''),maximum_sentence_units,'years_rp',name,'system','penalty',jsonb_build_object('penal_code_id',id,'minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine) from public.penal_code;
    insert into public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
    select 'license_'||id,registration_fee,'BRL','Licenciamento específico: '||name,'system','fee',
      jsonb_build_object('basis','license','payer','buyer','nature','fixed','audience','business','category',id)
    from public.business_types where is_active and registration_fee>0;
    update public.government_ministries set annual_budget=0,spent_budget=0,efficiency_score=default,public_impact=0,created_by=null where id is not null;
    update public.price_basket_items set current_price=base_price,updated_at=clock_timestamp() where id is not null;
    delete from public.state_enterprises where not is_system;
    update public.state_enterprises set is_privatized=false,privatization_status='none',privatization_price=null,
      privatization_buyer_id=null,privatized_at=null,created_by=null,market_value=default,health_score=default,is_active=true,operating_business_id=null,manager_id=null,commission_type='percentage',commission_value=0,publication_mode='automatic',fixed_sale_fee=default,active_listing_fee_enabled=default,active_listing_fee_amount=default,active_listing_fee_period=default,seller_fees=default,management_settings=default,last_fiscal_cycle_at=clock_timestamp() where is_system;
    update public.rp_time_settings set rp_epoch_real_at=clock_timestamp(),rp_epoch_game_at=clock_timestamp(),
      is_paused=false,paused_real_at=null,paused_rp_at=null,updated_by=v_actor,updated_at=clock_timestamp() where id=true;
    insert into public.rp_time_settings(id,rp_epoch_game_at) values(true,clock_timestamp()) on conflict do nothing;
    delete from public.system_settings where key in (
      'executive_governance','election_office_sync','government_budget','national_budget','government_balance',
      'economic_policy','bank_policy','tax_rates','transaction_tax','enterprise_costs','basic_service_prices','national_health_policy','stock_market_session','automatic_elections'
    );
    select value into v_brazil from jsonb_array_elements(req.country_snapshots) where value->>'country_code'='BR';
    v_selic:=(v_brazil->'economy'->>'selic')::numeric;
    v_monthly:=round((power(1+v_selic/100,1.0/12)-1)*100,2);
    update public.economic_state set current_selic=v_selic,exchange_rate=(v_brazil->'economy'->>'exchangeUsd')::numeric,
      base_monthly_gdp=(v_brazil->'economy'->>'gdp')::numeric*(v_brazil->'economy'->>'exchangeUsd')::numeric/12,
      simulated_share=0.5,player_share=0.5,metadata=jsonb_build_object('origin','real_baseline','reset_request_id',req.id) where id=true;
    insert into public.system_settings(key,value) values
      ('economic_policy',jsonb_build_object('selic_rate',v_selic)),
      ('bank_policy',jsonb_build_object('loan_interest_spread',1.66,'credit_card_revolving_spread',8.06,
        'government_debt_interest_spread',0.91,'loan_interest_rate',v_monthly+1.66,
        'credit_card_revolving_rate',v_monthly+8.06,'government_debt_interest_rate',v_monthly+0.91,'credit_card_default_limit',5000)),
      ('tax_rates','{"product_tax":0,"service_tax":0}'),
      ('transaction_tax','{"type":"percentage","value":0}'),
      ('government_budget','{"areas":[]}'),('national_budget','0'),
      ('national_health_policy','{"daily_budget":5000,"cost_per_visit":25,"recovery":20,"daily_capacity":200}'),
      ('stock_market_session','{"is_open":true,"quote_interval_seconds":60}');
    update public.investment_options set annual_return_rate=round(greatest(0.5,
      v_selic*case risk_level when 'low' then .9 when 'high' then 1.2 when 'very-high' then 1.35 else 1.05 end
      +case risk_level when 'low' then -.4 when 'high' then 2.2 when 'very-high' then 4.5 else .8 end)/100,4) where id is not null;
    update public.country_rp_states set is_playable=false,economic_baseline='{}',economic_current='{}',
      political_current='{}',demographic_current='{}',economic_engine_cursor='{}',reference_snapshot_at=null,
      economy_influence=0,politics_influence=0,society_influence=0,revision=0,last_event_type=null,last_event_summary=null,
      started_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=v_actor where country_code is not null;
    for s in select * from jsonb_array_elements(req.country_snapshots) loop
      insert into public.country_rp_states(country_code,country_name,is_playable,economic_baseline,economic_current,
        political_current,demographic_current,economic_engine_cursor,reference_snapshot_at,started_at,updated_by)
      values(s->>'country_code',s->>'country_name',true,s->'economy',s->'economy',s->'politics',s->'demographics',
        jsonb_build_object('exchangeUsd',(s->'economy'->>'exchangeUsd')::numeric),clock_timestamp(),clock_timestamp(),v_actor)
      on conflict(country_code) do update set is_playable=true,economic_baseline=excluded.economic_baseline,
        economic_current=excluded.economic_current,political_current=excluded.political_current,
        demographic_current=excluded.demographic_current,economic_engine_cursor=excluded.economic_engine_cursor,
        reference_snapshot_at=excluded.reference_snapshot_at,started_at=excluded.started_at;
      insert into public.country_rp_economic_snapshots(country_code,revision,economic_state,event_type)
      values(s->>'country_code',0,s->'economy','rp_reference_snapshot');
    end loop;
    delete from public.country_population_segments where country_code is not null;
    insert into public.country_population_segments(country_code,segment_key,name,description,population_share,
      population_count,welfare_index,political_influence,economic_participation)
    select c.country_code,v.segment_key,v.name,v.description,v.share,
      round((c.demographic_current->>'population')::numeric*v.share)::bigint,v.welfare,v.influence,v.participation
    from public.country_rp_states c cross join (values
      ('urban_workers','Trabalhadores urbanos','Cidadãos empregados nos centros urbanos.',.34,55,62,82),
      ('rural_workers','Trabalhadores rurais','Cidadãos ligados à produção e às comunidades rurais.',.14,49,45,74),
      ('entrepreneurs','Empreendedores','Proprietários e gestores de negócios produtivos.',.08,66,70,91),
      ('public_servants','Servidores públicos','Profissionais das instituições e serviços do Estado.',.09,61,72,79),
      ('students','Estudantes','População em formação acadêmica ou profissional.',.16,58,48,28),
      ('retirees','Aposentados','Cidadãos fora da população economicamente ativa.',.11,54,58,12),
      ('unemployed','Desempregados','Cidadãos em busca ativa de ocupação.',.08,35,40,8)
    ) v(segment_key,name,description,share,welfare,influence,participation) where c.is_playable;
    -- Rebuild the exchange market from real quotes, with no old RP strength/trend.
    delete from public.currency_market_states where country_code is not null;
    insert into public.currency_market_states(country_code,currency_code,base_brl_per_unit,
      economic_strength,interest_factor,inflation_factor,risk_factor,stability_factor,trend,international_demand,volatility)
    select 'BR',d.currency_code,case when d.currency_code='BRL' then 1 else (v_brazil->'exchange_rates'->>d.currency_code)::numeric end,
      d.economic_strength,d.interest_factor,d.inflation_factor,d.risk_factor,d.stability_factor,d.trend,d.international_demand,d.volatility
    from private.currency_market_defaults() d;
    insert into public.country_rp_exchange_rates(country_code,currency_code,brl_per_unit,source)
    select 'BR',key,value::numeric,'real_baseline' from jsonb_each_text(v_brazil->'exchange_rates') where key in ('USD','EUR','GBP','JPY','CNY');
  else
    -- Reset bypasses gameplay award triggers, so reconcile remaining social counts.
    update public.posts p set likes_count=(select count(*) from (
        select user_id from public.post_likes where post_id=p.id union select user_id from public.likes where post_id=p.id
      ) liked),
      comments_count=(select count(*) from public.comments c where c.post_id=p.id and c.parent_comment_id is null and c.deleted_at is null),
      reposts_count=(select count(*) from public.reposts r where r.post_id=p.id) where p.id is not null;
    update public.comments c set replies_count=(select count(*) from public.comments reply where reply.parent_comment_id=c.id and reply.deleted_at is null) where c.id is not null;
    delete from public.trends where hashtag is not null;
    insert into public.trends(hashtag,post_count,last_used_at)
    select tag,count(distinct p.id),max(p.created_at) from public.posts p,
      lateral unnest(public.extract_hashtags(p.content)) tag group by tag;
  end if;

  update public.party_treasuries fund set balance=coalesce((select sum(entry.amount) from public.party_treasury_entries entry where entry.party_id=fund.party_id),0),updated_at=clock_timestamp() where fund.party_id is not null;

  set constraints public.accounts_business_id_fkey immediate;
  set constraints public.accounts_business_id_fkey deferred;
  for tr in select * from pg_temp.rp_reset_triggers loop
    execute format('alter table public.%I %s trigger %I',tr.table_name,
      case tr.tgenabled when 'A' then 'enable always' when 'R' then 'enable replica' else 'enable' end,tr.tgname);
  end loop;
  if req.scope='full_rp' then perform private.refresh_regional_infrastructure();end if;
  v_result:=v_result||jsonb_build_object('success',true,'request_id',req.id,'scope',req.scope,'completed_at',clock_timestamp());
  update private.rp_reset_requests set completed_at=clock_timestamp(),result=v_result where id=req.id;
  return v_result;
end; $function$

;
commit;
