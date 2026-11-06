BEGIN;
ALTER TABLE public.products ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.products DROP CONSTRAINT products_owner_kind;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_owner_kind;
ALTER TABLE public.products ADD CONSTRAINT products_owner_kind CHECK((state_enterprise_id IS NULL AND (seller_id IS NOT NULL OR business_id IS NOT NULL)) OR (seller_id IS NULL AND state_enterprise_id IS NOT NULL));
ALTER TABLE public.commerce_orders ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.commerce_orders DROP CONSTRAINT IF EXISTS commerce_seller_entity;
ALTER TABLE public.commerce_orders ADD CONSTRAINT commerce_seller_entity CHECK(seller_id IS NOT NULL OR business_id IS NOT NULL OR state_enterprise_id IS NOT NULL);

-- Common actors use the existing bank ledger. No synthetic Auth identity or
-- new balance is created to represent the population or a company.
ALTER TABLE public.user_inventory ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.user_inventory ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id);
ALTER TABLE public.user_inventory DROP CONSTRAINT IF EXISTS inventory_owner;
ALTER TABLE public.user_inventory ADD CONSTRAINT inventory_owner CHECK((user_id IS NOT NULL AND business_id IS NULL) OR (user_id IS NULL AND business_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS company_product_inventory ON public.user_inventory(business_id,acquired_at DESC) WHERE business_id IS NOT NULL;
ALTER TABLE public.product_ownership_history ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.product_ownership_history ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id);
ALTER TABLE public.product_ownership_history DROP CONSTRAINT IF EXISTS product_history_owner;
ALTER TABLE public.product_ownership_history ADD CONSTRAINT product_history_owner CHECK((user_id IS NOT NULL AND business_id IS NULL) OR (user_id IS NULL AND business_id IS NOT NULL));
DROP POLICY IF EXISTS company_inventory_read ON public.user_inventory;
CREATE POLICY company_inventory_read ON public.user_inventory FOR SELECT TO authenticated USING(business_id IS NOT NULL AND private.can_manage_company(business_id));
DROP POLICY IF EXISTS company_product_history_read ON public.product_ownership_history;
CREATE POLICY company_product_history_read ON public.product_ownership_history FOR SELECT TO authenticated USING(business_id IS NOT NULL AND private.can_manage_company(business_id));
CREATE OR REPLACE FUNCTION public.handle_inventory_ownership() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN
 INSERT INTO public.product_ownership_history(inventory_item_id,user_id,business_id,start_date) VALUES(new.id,new.user_id,new.business_id,new.acquired_at);RETURN new;
END $$;

ALTER TABLE public.commerce_orders ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE public.commerce_orders ADD COLUMN IF NOT EXISTS buyer_kind text NOT NULL DEFAULT 'citizen';
ALTER TABLE public.commerce_orders ADD COLUMN IF NOT EXISTS buyer_business_id uuid REFERENCES public.businesses(id);
ALTER TABLE public.commerce_orders DROP CONSTRAINT IF EXISTS commerce_order_buyer_kind;
ALTER TABLE public.commerce_orders ADD CONSTRAINT commerce_order_buyer_kind CHECK (
 (buyer_kind='citizen' AND buyer_id IS NOT NULL AND buyer_business_id IS NULL) OR
 (buyer_kind='population' AND buyer_id IS NULL AND buyer_business_id IS NULL AND buyer_account_id IS NOT NULL) OR
 (buyer_kind='business' AND buyer_business_id IS NOT NULL AND buyer_account_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS commerce_orders_buyer_business ON public.commerce_orders(buyer_business_id,created_at DESC) WHERE buyer_business_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.withdraw_company_cash(p_business_id uuid,p_amount numeric,p_destination_account_id uuid,p_reason text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();b public.businesses%rowtype;destination public.accounts%rowtype;t public.transactions%rowtype;q jsonb;cash numeric;reserved numeric;debited numeric;received numeric;BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre para movimentar o caixa.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount<=0 OR p_amount>100000000000 OR p_amount<>round(p_amount,2) OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Informe um valor positivo com até duas casas decimais.';END IF;
 IF length(btrim(coalesce(p_reason,'')))<3 OR length(p_reason)>500 THEN RAISE EXCEPTION 'Informe uma justificativa de 3 a 500 caracteres.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO t FROM public.transactions WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF t.type<>'company_withdrawal' OR t.metadata->>'actor_id' IS DISTINCT FROM actor::text OR t.metadata->>'business_id' IS DISTINCT FROM p_business_id::text OR (t.metadata->>'requested_amount')::numeric<>p_amount OR t.to_account_id IS DISTINCT FROM p_destination_account_id OR t.metadata->>'reason' IS DISTINCT FROM btrim(p_reason) THEN RAISE EXCEPTION 'Este identificador já pertence a outra operação.';END IF;
  RETURN jsonb_build_object('success',true,'transaction_id',t.id,'snapshot',t.metadata);
 END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id FOR UPDATE;
 IF b.id IS NULL OR (b.owner_id IS DISTINCT FROM actor AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente o proprietário ou a administração autorizada pode retirar recursos.' USING errcode='42501';END IF;
 SELECT * INTO destination FROM public.accounts WHERE id=p_destination_account_id AND ((account_kind='personal' AND user_id=b.owner_id) OR (b.control_kind='population' AND b.owner_id IS NULL AND account_kind='population'));
 IF destination.id IS NULL OR destination.id=b.bank_account_id THEN RAISE EXCEPTION 'Selecione a conta do proprietário ou o fundo de origem da empresa simulada.';END IF;
 PERFORM id FROM public.accounts WHERE id IN(destination.id,b.bank_account_id) ORDER BY id FOR UPDATE;
 SELECT balance INTO cash FROM public.accounts WHERE id=b.bank_account_id;
 SELECT coalesce(sum(wage_due),0) INTO reserved FROM public.business_employees WHERE business_id=b.id;
 q:=public.quote_legal_levies('transfer',p_amount,false,b.economic_sector_id,NULL,NULL,b.region_code);
 IF coalesce((q->>'restricted')::boolean,false) THEN RAISE EXCEPTION 'A movimentação está restrita por norma vigente.';END IF;
 debited:=(q->>'total_debited')::numeric;received:=(q->>'net_amount')::numeric;
 IF cash IS NULL OR cash-debited<reserved THEN RAISE EXCEPTION 'O caixa disponível não cobre a retirada e os salários já devidos.';END IF;
 UPDATE public.accounts SET balance=balance-debited,updated_at=clock_timestamp() WHERE id=b.bank_account_id;
 UPDATE public.accounts SET balance=balance+received,updated_at=clock_timestamp() WHERE id=destination.id;
 UPDATE public.government_finances SET treasury_balance=treasury_balance+debited-received,updated_at=clock_timestamp() WHERE id=1;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(b.bank_account_id,destination.id,p_amount,'company_withdrawal','Retirada do proprietário: '||b.name,q||jsonb_build_object('business_id',b.id,'actor_id',actor,'owner_id',b.owner_id,'requested_amount',p_amount,'reason',btrim(p_reason),'administrative',b.owner_id IS DISTINCT FROM actor,'economic_classification','financial_transfer'),p_idempotency_key) RETURNING * INTO t;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 VALUES(b.id,'other',-debited,'Retirada do proprietário: '||btrim(p_reason),jsonb_build_object('kind','owner_withdrawal','transaction_id',t.id,'actor_id',actor),'withdrawal:'||p_idempotency_key);
 IF debited>received THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,business_id,actor_profile_id,amount,occurred_at_rp,metadata) VALUES('financial','transactions',t.id::text,b.id,actor,debited-received,public.rp_now(),q||jsonb_build_object('kind','transaction_tax'));END IF;
 PERFORM economy_private.audit('company_cash_withdrawn','businesses',b.id::text,NULL,jsonb_build_object('transaction_id',t.id,'destination',destination.id,'amount',p_amount,'snapshot',q),p_reason,actor);
 RETURN jsonb_build_object('success',true,'transaction_id',t.id,'snapshot',t.metadata);
END $$;
REVOKE ALL ON FUNCTION public.withdraw_company_cash(uuid,numeric,uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdraw_company_cash(uuid,numeric,uuid,text,uuid) TO authenticated;

-- Read the real balance sheet only while a company is on the market, or with
-- management authorization. Private companies are not exposed wholesale.
CREATE OR REPLACE FUNCTION public.get_company_sale_details(p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;r jsonb;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar os detalhes.' USING errcode='42501';END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id;
 IF b.id IS NULL OR (NOT b.is_for_sale AND NOT private.can_manage_company(b.id) AND NOT EXISTS(SELECT 1 FROM public.state_enterprises WHERE operating_business_id=b.id AND privatization_status='for_sale')) THEN RAISE EXCEPTION 'A empresa não está disponível para negociação.' USING errcode='42501';END IF;
 SELECT jsonb_build_object('revenue',coalesce(sum(amount)FILTER(WHERE type='revenue'),0),'expenses',coalesce(sum(abs(amount))FILTER(WHERE type IN('expense','tax')),0),'profit',coalesce(sum(amount)FILTER(WHERE type='revenue'),0)-coalesce(sum(abs(amount))FILTER(WHERE type IN('expense','tax')),0),'entries',count(*),'first_recorded_at',min(created_at)) INTO r FROM public.business_transactions WHERE business_id=b.id;
 RETURN jsonb_build_object('company',public.get_company_page(b.id),'financials',r,'cash',(SELECT balance FROM public.accounts WHERE id=b.bank_account_id),'payroll_due',(SELECT coalesce(sum(wage_due),0) FROM public.business_employees WHERE business_id=b.id),'staff',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',role,'salary',salary,'qualification_level',qualification_level)),'[]') FROM public.business_employees WHERE business_id=b.id AND fired_at IS NULL),'inventory',(SELECT coalesce(jsonb_agg(jsonb_build_object('resource',i.resource_code,'name',r.name,'quantity',i.quantity,'unit_cost',i.unit_cost)),'[]') FROM public.business_inventory i JOIN public.economic_resources r ON r.code=i.resource_code WHERE i.business_id=b.id),'operations',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM(SELECT * FROM public.business_daily_operations WHERE business_id=b.id ORDER BY operation_date DESC LIMIT 14)d),'cycles',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM(SELECT * FROM public.business_balance_cycles WHERE business_id=b.id ORDER BY cycle_start_at DESC LIMIT 12)c),'infrastructure',(SELECT jsonb_build_object('energy',energy,'roads',roads,'digital',telecom) FROM public.economic_regions WHERE code=b.region_code));
END $$;
REVOKE ALL ON FUNCTION public.get_company_sale_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_company_sale_details(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.buy_product_authoritative(p_buyer uuid, p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid, p_renewal uuid, p_agent_account uuid, p_agent_kind text, p_agent_budget numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid:=p_buyer;v_is_agent boolean:=p_agent_account IS NOT NULL;v_buyer_business uuid;v_simulated boolean;v_product public.products%rowtype;v_business public.businesses%rowtype;
  v_buyer_account public.accounts%rowtype;v_seller_account public.accounts%rowtype;v_card public.cards%rowtype;
  v_base numeric;v_consumption_rate numeric;v_corporate_rate numeric;v_consumption_tax numeric;v_corporate_tax numeric;
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb; v_market public.state_enterprises%rowtype; v_market_account uuid; v_market_owner uuid; v_commission numeric; v_commission_snapshot jsonb;
begin
  if v_buyer is null and not v_is_agent then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if v_is_agent then
   if p_agent_kind not in('population','business') or p_payment_method<>'balance' or p_card_id is not null or p_renewal is not null or p_agent_budget is null or p_agent_budget<=0 or p_agent_budget::text in('NaN','Infinity','-Infinity') then raise exception 'Agente econômico ou orçamento inválido.';end if;
   select * into v_buyer_account from public.accounts where id=p_agent_account and account_kind=case when p_agent_kind='population' then 'population' else 'business' end;
   if v_buyer_account.id is null then raise exception 'O agente econômico não possui caixa válido.';end if;
   v_buyer_business:=v_buyer_account.business_id;
   if p_agent_kind='population' and auth.uid() is not null and not public.has_full_admin_access() then raise exception 'O consumo da população é processado pelo motor econômico.' using errcode='42501';end if;
   if p_agent_kind='business' and auth.uid() is not null and not private.can_manage_company(v_buyer_business) then raise exception 'Sem autorização para movimentar o caixa comprador.' using errcode='42501';end if;
  end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer or (v_is_agent and (v_order.buyer_account_id is distinct from p_agent_account or v_order.buyer_kind is distinct from p_agent_kind)) then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_is_agent and (v_order.checkout_request->>'max_budget')::numeric is distinct from p_agent_budget then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH';end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id,'total',v_order.total_amount,'tax',v_order.consumption_tax+v_order.corporate_tax); end if;
  perform public.process_due_legal_effects();
  perform 1 from public.state_enterprises where service_key='marketplace' for share;
  perform id from public.businesses where id in(v_buyer_business,(select business_id from public.products where id=p_product_id)) order by id for update;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_is_agent and (v_product.state_enterprise_id is not null or v_product.product_type<>'one-time' or v_product.business_id is null or v_product.business_id=v_buyer_business) then raise exception 'Produto incompatível com o consumo deste agente.';end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  if not v_is_agent and p_renewal is null then perform private.assert_citizen_service('/services/business');
  elsif not v_is_agent and not exists(select 1 from public.user_subscriptions where id=p_renewal and user_id=v_buyer and product_id=p_product_id and status in('active','past_due')) then raise exception 'SUBSCRIPTION_NOT_AVAILABLE';end if;
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
    where id=p_agent_account or user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id or id=v_market_account order by id for update;
  if v_product.business_id is null then
    select * into v_seller_account from public.accounts where user_id=v_product.seller_id;
  else
    select * into v_seller_account from public.accounts where id=v_business.bank_account_id;
  end if;
  if not found then raise exception 'SELLER_BANK_ACCOUNT_REQUIRED'; end if;
  v_simulated:=coalesce(p_agent_kind='population',false) or exists(select 1 from public.businesses where id in(v_buyer_business,v_business.id) and control_kind='population');
  if v_product.product_type='one-time' and coalesce(v_product.stock,0)<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
  v_base:=case when v_product.promotion_price is not null and v_product.promotion_expires_at>clock_timestamp() then v_product.promotion_price else v_product.price end;
  v_levies:=public.quote_legal_levies('purchase',v_base,v_product.business_id is not null,coalesce(v_product.economic_sector_id,v_business.economic_sector_id),v_product.category,NULL,coalesce(v_business.region_code,(SELECT residence_state_code FROM public.profiles WHERE id=v_product.seller_id)));
  if (v_levies->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_consumption_tax:=(v_levies->>'buyer_tax')::numeric;v_corporate_tax:=(v_levies->>'seller_tax')::numeric;
  v_total:=(v_levies->>'total_debited')::numeric;v_seller_net:=(v_levies->>'net_amount')::numeric;
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end+v_market.fixed_sale_fee,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'fixed_sale_fee',v_market.fixed_sale_fee,'percentage_amount',case when v_market.commission_type='percentage' then round(v_base*v_market.commission_value/100,2) else 0 end,'base_amount',v_base,'amount',v_commission,'seller_type',case when v_product.business_id is null then 'PF' else 'PJ' end,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
  v_levies:=v_levies||jsonb_build_object('net_amount',v_seller_net,'commission_amount',v_commission,'commission_snapshot',v_commission_snapshot);


  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where (v_is_agent and id=p_agent_account) or (not v_is_agent and user_id=v_buyer and account_kind='personal') for update;
    if v_is_agent and v_total>p_agent_budget then raise exception 'O orçamento reservado não cobre esta compra.';end if;
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
    jsonb_build_object('buyer_kind',coalesce(p_agent_kind,'citizen'),'buyer_business_id',v_buyer_business,'is_simulated',v_simulated,'final_consumption',coalesce(p_agent_kind,'citizen')<>'business','billing_subscription_id',p_renewal,'platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,buyer_kind,buyer_business_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at,marketplace_enterprise_id,commission_amount,commission_snapshot,checkout_request
  ) values(p_idempotency_key,v_buyer,coalesce(p_agent_kind,'citizen'),v_buyer_business,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp(),v_market.id,v_commission,v_commission_snapshot,case when v_is_agent then jsonb_build_object('max_budget',p_agent_budget,'buyer_kind',p_agent_kind,'buyer_account_id',p_agent_account) end) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description,metadata) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name,jsonb_build_object('transaction_id',v_transaction,'buyer_kind',coalesce(p_agent_kind,'citizen'),'buyer_business_id',v_buyer_business,'is_simulated',v_simulated));
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description,metadata) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name,jsonb_build_object('transaction_id',v_transaction,'is_simulated',v_simulated)); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
  end if;

  if v_commission>0 then
    if v_product.business_id is not null then insert into public.business_transactions(business_id,type,amount,description,metadata) values(v_business.id,'expense',-v_commission,'Comissão Negócios Livre: '||v_product.name,jsonb_build_object('transaction_id',v_transaction,'is_simulated',v_simulated)); end if;
    if v_market.is_privatized then
      insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(null,v_market_account,v_commission,'marketplace_commission','Comissão de venda no Negócios Livre',jsonb_build_object('commerce_order_id',v_order.id,'gross_amount',v_commission,'net_amount',v_commission,'tax_amount',0,'commission_snapshot',v_commission_snapshot));
    else
      insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('fee','commerce_orders',v_order.id::text,v_product.seller_id,v_commission,public.rp_now(),jsonb_build_object('kind','marketplace_commission','transaction_id',v_transaction,'is_simulated',v_simulated,'snapshot',v_commission_snapshot));
    end if;
  end if;
  if v_consumption_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('consumption_tax','commerce_orders',v_order.id::text,v_buyer,v_business.id,v_consumption_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction,'is_simulated',v_simulated)); end if;
  if v_corporate_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('corporate_tax','commerce_orders',v_order.id::text,v_business.owner_id,v_business.id,v_corporate_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction,'is_simulated',v_simulated)); end if;

  if v_product.product_type='subscription' then
    if p_renewal is null then
      insert into public.user_subscriptions(user_id,product_id,seller_id,status,last_payment_date,next_payment_date)
      values(v_buyer,v_product.id,v_product.seller_id,'active',clock_timestamp(),clock_timestamp()+(v_product.subscription_interval)::interval);
      update public.products set subscribers_count=coalesce(subscribers_count,0)+1 where id=v_product.id;
    else
      update public.user_subscriptions set status='active',seller_id=v_product.seller_id,last_payment_date=clock_timestamp(),next_payment_date=greatest(next_payment_date,clock_timestamp())+(v_product.subscription_interval)::interval,updated_at=clock_timestamp() where id=p_renewal;
    end if;
  else
    if not v_is_agent then insert into public.user_inventory(user_id,product_id,quantity,acquired_at,metadata) values(v_buyer,v_product.id,1,clock_timestamp(),jsonb_build_object('consumable_effects',v_product.consumable_effects,'transaction_id',v_transaction,'origin','Negócios Livres','purchase_price',v_base));end if;
    if p_agent_kind='business' and v_product.resource_code is null then insert into public.user_inventory(business_id,product_id,quantity,metadata) values(v_buyer_business,v_product.id,1,jsonb_build_object('transaction_id',v_transaction,'unit_cost_snapshot',v_total,'purchase_price',v_base,'item_name',v_product.name,'consumable_effects',v_product.consumable_effects,'origin','company_marketplace_purchase'));end if;
    if p_agent_kind='business' and v_product.resource_code is not null then insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(v_buyer_business,v_product.resource_code,1,v_total) on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+v_total)/(public.business_inventory.quantity+1),quantity=public.business_inventory.quantity+1,updated_at=clock_timestamp();end if;
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
  if p_agent_kind='business' then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(v_buyer_business,'other',-v_total,'Compra empresarial: '||v_product.name,jsonb_build_object('transaction_id',v_transaction,'product_id',v_product.id,'is_simulated',v_simulated,'kind','inventory_purchase'),'product-agent:'||p_idempotency_key);end if;
  if p_agent_kind='business' then select name into v_buyer_name from public.businesses where id=v_buyer_business;else select full_name into v_buyer_name from public.profiles where id=v_buyer;end if;
  if v_product.seller_id is not null then
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(v_product.seller_id,v_buyer,'product_sold',coalesce(v_buyer_name,case when p_agent_kind='population' then 'A população simulada' else 'Uma empresa' end)||' comprou: '||v_product.name,'/dashboard?tab=products');end if;
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

CREATE OR REPLACE FUNCTION private.buy_product_authoritative(p_buyer uuid,p_product_id uuid,p_payment_method text,p_card_id uuid,p_idempotency_key uuid,p_renewal uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN private.buy_product_authoritative(p_buyer,p_product_id,p_payment_method,p_card_id,p_idempotency_key,p_renewal,NULL,NULL,NULL);END $$;
REVOKE ALL ON FUNCTION private.buy_product_authoritative(uuid,uuid,text,uuid,uuid,uuid,uuid,text,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.buy_company_product(p_business_id uuid,p_product_id uuid,p_max_total numeric,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid;BEGIN
 IF auth.uid() IS NULL OR NOT private.can_manage_company(p_business_id) THEN RAISE EXCEPTION 'Você não possui autorização para comprar com esse caixa.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT bank_account_id INTO a FROM public.businesses WHERE id=p_business_id AND status='active';
 IF a IS NULL THEN RAISE EXCEPTION 'A empresa compradora precisa estar ativa e ter conta.';END IF;
 RETURN private.buy_product_authoritative(auth.uid(),p_product_id,'balance',NULL,p_idempotency_key,NULL,a,'business',p_max_total);
END $$;
REVOKE ALL ON FUNCTION public.buy_company_product(uuid,uuid,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.buy_company_product(uuid,uuid,numeric,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.simulate_retail_demand(p_day date,p_budget numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid;offer record;i integer;spent numeric:=0;result jsonb;key uuid;BEGIN
 IF p_budget IS NULL OR p_budget<=0 THEN RETURN 0;END IF;
 SELECT id INTO a FROM public.accounts WHERE account_kind='population' ORDER BY id LIMIT 1;
 IF a IS NULL THEN RETURN 0;END IF;
 -- Stable daily rotation avoids always favoring the first company, while price,
 -- stock, moderation, legal restrictions and finite cash remain authoritative.
 FOR offer IN SELECT p.id,p.stock,p.price FROM public.products p JOIN public.businesses b ON b.id=p.business_id
 WHERE b.status='active' AND p.product_type='one-time' AND p.is_final_good AND p.stock>0 AND p.price>0 AND p.moderation_status='approved' AND p.archived_at IS NULL
 ORDER BY p.price/power(greatest(b.reputation,1),.2),md5(p_day::text||p.id::text) LIMIT 12 LOOP
  FOR i IN 1..least(5,offer.stock) LOOP
   IF spent>=p_budget THEN EXIT;END IF;
   key:=md5('retail-population:'||p_day||':'||offer.id||':'||i)::uuid;
   BEGIN
    result:=private.buy_product_authoritative(NULL,offer.id,'balance',NULL,key,NULL,a,'population',p_budget-spent);
    spent:=spent+(result->>'total')::numeric;
   EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'GOVRP retail demand %, product % refused [%]: %',p_day,offer.id,sqlstate,sqlerrm;
    EXIT;
   END;
  END LOOP;
 END LOOP;
 RETURN spent;
END $$;
REVOKE ALL ON FUNCTION private.simulate_retail_demand(date,numeric) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric;retail_share numeric:=.3;population_scale numeric:=1;inflation numeric:=0;employment numeric:=1; resource_count integer; player_count integer; npc_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('govrp:population-demand:'||p_day,0));
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select least(1,greatest(.01,coalesce(sum(population_count),0)::numeric/200000000)) into population_scale from public.country_population_segments where country_code='BR';
 select greatest(0,coalesce((economic_current->>'inflation')::numeric,0)),greatest(.05,1-coalesce((economic_current->>'unemployment')::numeric,0)/100) into inflation,employment from public.country_rp_states where country_code='BR';
 total_budget:=round(total_budget*population_scale*coalesce(employment,1)/(1+coalesce(inflation,0)/100),2);
 select count(*) into resource_count from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles');
 for resource in select * from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles') order by code loop
  budget:=total_budget*(1-retail_share)/greatest(resource_count,1);
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  select sum((.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.region_code,b.owner_id,b.name,b.control_kind,(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' order by b.id for update of i loop
   v_quantity:=least(offer.quantity,trunc(budget*offer.score/greatest(score_sum,.00001)/offer.selling_price/1.25,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   if (q->>'restricted')::boolean then continue;end if;
   total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
   select * into population from public.accounts where account_kind='population';
   if total>population.balance or spent+total>total_budget then continue;end if;
   update public.accounts set balance=balance-total,updated_at=now() where id=population.id;
   update public.accounts set balance=balance+net,updated_at=now() where id=offer.bank_account_id;
   update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
   update public.business_inventory set quantity=public.business_inventory.quantity-v_quantity,updated_at=now() where business_id=offer.business_id and resource_code=resource.code;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(population.id,offer.bank_account_id,amount,'population_purchase','Consumo da população: '||offer.name,q||jsonb_build_object('business_id',offer.business_id,'resource_code',resource.code,'quantity',v_quantity,'operation_date',p_day),md5('population-demand:'||p_day||':'||offer.business_id||':'||resource.code)::uuid) returning id into tx;
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'revenue',amount,'Venda para a população: '||resource.name,jsonb_build_object('kind','population_sale','transaction_id',tx,'quantity',v_quantity),'population-sale:'||p_day||':'||resource.code,p_day);
   if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre consumo da população',q,'population-tax:'||p_day||':'||resource.code,p_day);end if;
   if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,offer.business_id,total-net,public.rp_now(),q);end if;
   update public.business_daily_operations set sold_quantity=sold_quantity+v_quantity,revenue=revenue+amount where business_id=offer.business_id and operation_date=p_day;
   spent:=spent+total;
  end loop;
 end loop;
 spent:=spent+private.simulate_retail_demand(p_day,greatest(0,total_budget-spent));
 insert into private.population_demand_runs(operation_date,spent) values(p_day,spent);
 return spent;
end $function$;

CREATE OR REPLACE FUNCTION public.configure_company_operations(p_business_id uuid, p_region_code text, p_owner_operates boolean, p_price_multiplier numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','configure_company_operations'),'Gestão administrativa autorizada.',auth.uid());end if;
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or (b.owner_id is distinct from auth.uid() and not public.has_full_admin_access()) then raise exception 'Somente o proprietário pode definir a sede e a estratégia.' using errcode='42501';end if;
 if not exists(select 1 from public.economic_regions where code=p_region_code) or p_price_multiplier is null or p_price_multiplier not between .5 and 3 or p_owner_operates is null then raise exception 'Confira a sede, participação na operação e política de preços.';end if;
 update public.businesses set region_code=p_region_code,owner_operates=p_owner_operates,price_multiplier=p_price_multiplier,updated_at=now() where id=b.id;
 update public.business_inventory i set selling_price=round(r.base_price*p_price_multiplier,2),updated_at=now() from public.economic_resources r where i.business_id=b.id and i.resource_code=r.code and i.price_policy='automatic';
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_strategy_changed','economy','businesses',b.id,auth.uid(),jsonb_build_object('region',p_region_code,'owner_operates',p_owner_operates,'price_multiplier',p_price_multiplier),'company-strategy:'||gen_random_uuid());
end $function$;

CREATE OR REPLACE FUNCTION public.contribute_company_capital(p_business_id uuid, p_amount numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; a public.accounts%rowtype; t public.transactions%rowtype;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','contribute_company_capital'),'Gestão administrativa autorizada.',auth.uid());end if;
 if not private.can_manage_company(p_business_id) then raise exception 'Somente o proprietário pode aportar capital.' using errcode='42501';end if;
 if p_idempotency_key is null or p_amount is null or p_amount<=0 or p_amount>100000000000 or p_amount<>round(p_amount,2) then raise exception 'Informe um valor positivo com até duas casas decimais.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into t from public.transactions where idempotency_key=p_idempotency_key;
 if found then
  if t.metadata->>'actor_id' is distinct from auth.uid()::text or t.metadata->>'business_id' is distinct from p_business_id::text or t.amount<>p_amount or t.type<>'company_capital' then raise exception 'Esta identificação já pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'transaction_id',t.id);
 end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.owner_id<>auth.uid() and not public.has_full_admin_access() then raise exception 'A propriedade da empresa mudou. Atualize a operação.';end if;
 select * into a from public.accounts where user_id=auth.uid() and account_kind='personal';
 if a.id is null then raise exception 'Abra sua conta pessoal antes de aportar capital.';end if;
 perform id from public.accounts where id in(a.id,b.bank_account_id) order by id for update;
 select * into a from public.accounts where id=a.id;
 if a.balance<p_amount then raise exception 'Saldo pessoal insuficiente para este aporte.';end if;
 update public.accounts set balance=balance-p_amount,updated_at=clock_timestamp() where id=a.id;
 update public.accounts set balance=balance+p_amount,updated_at=clock_timestamp() where id=b.bank_account_id;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 values(a.id,b.bank_account_id,p_amount,'company_capital','Aporte de capital: '||b.name,jsonb_build_object('actor_id',auth.uid(),'business_id',b.id,'gross_amount',p_amount,'net_amount',p_amount,'total_debited',p_amount,'tax_amount',0),p_idempotency_key) returning * into t;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 values(b.id,'other',p_amount,'Aporte do proprietário',jsonb_build_object('kind','capital','transaction_id',t.id),'capital:'||p_idempotency_key);
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('company_capital_contributed','economy','businesses',b.id,auth.uid(),jsonb_build_object('amount',p_amount,'transaction_id',t.id),'capital:'||p_idempotency_key);
 return jsonb_build_object('success',true,'transaction_id',t.id);
end $function$;

CREATE OR REPLACE FUNCTION public.distribute_company_dividend(p_business_id uuid, p_amount numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;o public.investment_options%rowtype;d public.company_dividends%rowtype;h record;profit numeric;cash numeric;payment numeric;distributed numeric:=0;retained numeric;target uuid;population uuid;reserve uuid;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','distribute_company_dividend'),'Gestão administrativa autorizada.',auth.uid());end if;
 if auth.uid() is null or p_amount is null or p_amount<=0 or p_amount>1000000000 or p_amount<>round(p_amount,2) or p_idempotency_key is null then raise exception 'Informe um valor positivo para distribuir.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into d from public.company_dividends where idempotency_key=p_idempotency_key;
 if found then if d.declared_by<>auth.uid() or d.business_id<>p_business_id or d.amount<>p_amount then raise exception 'Este identificador pertence a outra distribuição.';end if;return to_jsonb(d);end if;
 select * into b from public.businesses where id=p_business_id for update;
 if (b.owner_id is distinct from auth.uid() and not public.has_full_admin_access()) then raise exception 'Somente o proprietário pode distribuir dividendos.' using errcode='42501';end if;
 select * into o from public.investment_options where business_id=b.id and asset_type='stock' for update;
 if o.id is null then raise exception 'A empresa precisa estar listada na BNV.';end if;
 select coalesce(sum(net_result),0)-(select coalesce(sum(amount),0) from public.company_dividends where business_id=b.id) into profit from public.business_balance_cycles where business_id=b.id;
 if profit<p_amount or exists(select 1 from public.business_employees where business_id=b.id and wage_due>0) then raise exception 'A distribuição exige lucro acumulado suficiente e salários quitados.';end if;
 select id into population from public.accounts where account_kind='population';select id into reserve from public.accounts where investment_id=o.id;
 if exists(select 1 from public.user_investments u where investment_id=o.id and quantity>0 and not exists(select 1 from public.accounts a where a.user_id=u.user_id and a.account_kind='personal')) then raise exception 'Um acionista precisa regularizar a conta bancária antes da distribuição.';end if;
 perform id from public.accounts where id in(b.bank_account_id,population,reserve) or user_id=b.owner_id or user_id in(select user_id from public.user_investments where investment_id=o.id and quantity>0) order by id for update;
 select balance into cash from public.accounts where id=b.bank_account_id;if cash<p_amount then raise exception 'O caixa da empresa é insuficiente.';end if;
 insert into public.company_dividends(business_id,investment_id,amount,per_share,declared_by,idempotency_key) values(b.id,o.id,p_amount,p_amount/o.total_shares,auth.uid(),p_idempotency_key) returning * into d;
 update public.accounts set balance=balance-p_amount,updated_at=now() where id=b.bank_account_id;
 for h in select * from public.user_investments where investment_id=o.id and quantity>0 order by user_id loop
  payment:=floor(p_amount*h.quantity/o.total_shares*100)/100;if payment<=0 then continue;end if;
  select id into target from public.accounts where user_id=h.user_id and account_kind='personal';
  update public.accounts set balance=balance+payment,updated_at=now() where id=target;distributed:=distributed+payment;
  insert into public.stock_dividend_receipts(dividend_id,user_id,amount,quantity_snapshot) values(d.id,h.user_id,payment,h.quantity);
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,target,payment,'stock_dividend','Dividendos de '||o.asset_symbol,jsonb_build_object('dividend_id',d.id,'quantity',h.quantity,'investment_id',o.id));
  insert into public.notifications(user_id,type,content,link,metadata) values(h.user_id,'stock_dividend','Você recebeu R$ '||payment||' em dividendos de '||o.asset_symbol||'.','/services/stock-exchange',jsonb_build_object('dividend_id',d.id));
 end loop;
 payment:=floor(p_amount*o.available_shares/o.total_shares*100)/100;
 if payment>0 then update public.accounts set balance=balance+payment,updated_at=now() where id=reserve;distributed:=distributed+payment;insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,reserve,payment,'stock_dividend','Dividendos das ações em oferta',jsonb_build_object('dividend_id',d.id));end if;
 retained:=p_amount-distributed;select id into target from public.accounts where user_id=b.owner_id and account_kind='personal';
 if target is null then raise exception 'O proprietário precisa regularizar sua conta bancária.';end if;
 if retained>0 then update public.accounts set balance=balance+retained,updated_at=now() where id=target;insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(b.bank_account_id,target,retained,'stock_dividend','Dividendos da participação do controlador',jsonb_build_object('dividend_id',d.id,'controller_shares',o.total_shares-o.floated_shares));end if;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-p_amount,'Dividendos distribuídos',jsonb_build_object('kind','dividend','dividend_id',d.id),'dividend:'||d.id);
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_dividend_paid','economy','company_dividends',d.id,auth.uid(),jsonb_build_object('business_id',b.id,'amount',p_amount,'ticker',o.asset_symbol),'dividend:'||d.id);
 return to_jsonb(d);
end $function$;

CREATE OR REPLACE FUNCTION public.link_company_cnpj(p_business_id uuid, p_document_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; d public.documents%rowtype;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','link_company_cnpj'),'Gestão administrativa autorizada.',auth.uid());end if;
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or (b.owner_id is distinct from auth.uid() and not public.has_full_admin_access()) then raise exception 'Somente o proprietário pode vincular CNPJs.' using errcode='42501'; end if;
 select * into d from public.documents where id=p_document_id and user_id=b.owner_id and type='CNPJ' and is_valid and (expires_at is null or expires_at>clock_timestamp()) for update;
 if d.id is null or not exists(select 1 from public.business_types where id=d.metadata->>'business_type_id' and is_active) or (not exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid and (expires_at is null or expires_at>clock_timestamp())) and d.metadata->>'business_type_id' is distinct from b.business_type_id) then raise exception 'Selecione um CNPJ ativo e compatível com a atividade.'; end if;
 if d.metadata->>'business_id' is not null and d.metadata->>'business_id'<>b.id::text then raise exception 'CNPJ já vinculado a outra empresa.'; end if;
 update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('business_id',b.id) where id=d.id;
 update public.businesses set cnpj_document_id=case when exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid and (expires_at is null or expires_at>clock_timestamp())) then b.cnpj_document_id else d.id end,metadata=coalesce(metadata,'{}')-'cnpj_regularization_required' where id=b.id;
end $function$;

CREATE OR REPLACE FUNCTION public.manage_company_workforce(p_business_id uuid, p_action text, p_data jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; t public.business_role_templates%rowtype; e public.business_employees%rowtype; v public.business_vacancies%rowtype; application public.business_applications%rowtype; oldop private.company_operations%rowtype; result jsonb; target uuid; level integer; wage numeric; xp integer; person_name text; is_owner boolean; payload jsonb:=jsonb_build_object('business_id',p_business_id,'action',p_action,'data',p_data);
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','manage_company_workforce'),'Gestão administrativa autorizada.',auth.uid());end if;
 if auth.uid() is null or p_idempotency_key is null then raise exception 'Entre e identifique a operação de trabalho.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into oldop from private.company_operations where idempotency_key=p_idempotency_key;
 if found then
  if oldop.actor_id<>auth.uid() or oldop.operation<>'workforce' or oldop.payload<>payload then raise exception 'Esta identificação já pertence a outra operação.';end if;
  return oldop.result;
 end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null then raise exception 'Empresa indisponível.';end if;
 is_owner:=b.owner_id=auth.uid() or public.has_full_admin_access();
 if p_action<>'quit' and not private.can_manage_company(b.id) then raise exception 'Somente o proprietário ou gestor pode administrar a equipe.' using errcode='42501';end if;
 if p_action in('open_vacancy','hire_npc','change') then
  select * into t from public.business_role_templates where id=p_data->>'role_template_id' and business_type_id=b.business_type_id;
  if t.id is null then raise exception 'Escolha uma função compatível com a atividade da empresa.';end if;
  if t.can_manage and not is_owner then raise exception 'Somente o proprietário pode nomear gestores.' using errcode='42501';end if;
  wage:=(p_data->>'salary')::numeric;
  if wage is null or wage<t.base_weekly_salary or wage>100000000 or wage<>round(wage,2) then raise exception 'O salário semanal deve respeitar o mínimo da função e ter até duas casas decimais.';end if;
 end if;
 if p_action='open_vacancy' then
  level:=coalesce((p_data->>'min_level')::integer,1);
  if level not between 1 and 20 or coalesce((p_data->>'positions')::integer,0) not between 1 and 100 then raise exception 'Confira o nível mínimo e a quantidade de vagas.';end if;
  insert into public.business_vacancies(business_id,role_template_id,salary,min_level,positions,description) values(b.id,t.id,wage,level,(p_data->>'positions')::integer,left(coalesce(p_data->>'description',''),2000)) returning id into target;
 elsif p_action='close_vacancy' then
  update public.business_vacancies set status='closed' where id=(p_data->>'vacancy_id')::uuid and business_id=b.id returning id into target;
  if target is null then raise exception 'Vaga não encontrada nesta empresa.';end if;
 elsif p_action='hire_npc' then
  if b.status in('closed','suspended') then raise exception 'Regularize a empresa antes de contratar.';end if;
  level:=coalesce((p_data->>'level')::integer,1);
  if level not in(1,3,5) then raise exception 'Escolha uma das qualificações disponíveis da população.';end if;
  if wage<round(t.base_weekly_salary*(1+(level-1)*.08),2) then raise exception 'O salário oferecido está abaixo da expectativa desta qualificação.';end if;
  if (select count(*) from public.business_employees where business_id=b.id and fired_at is null)>=500 then raise exception 'O limite operacional desta unidade é de 500 trabalhadores.';end if;
  person_name:=(array['Ana','Bruno','Carla','Diego','Elisa','Felipe','Gabriela','Henrique'])[1+abs(hashtext(p_idempotency_key::text)::bigint)%8]||' '||(array['Silva','Santos','Oliveira','Souza','Lima','Costa','Pereira','Almeida'])[1+abs(hashtext(b.id::text||p_idempotency_key)::bigint)%8];
  insert into public.business_employees(business_id,name,role,salary,is_npc,role_template_id,skill_area,experience,qualification_level,last_accrued_on) values(b.id,person_name,t.name,wage,true,t.id,t.skill_area,(level-1)*100,level,current_date) returning id into target;
 elsif p_action in('accept','reject') then
  select * into application from public.business_applications where id=(p_data->>'application_id')::uuid for update;
  select * into v from public.business_vacancies where id=application.vacancy_id and business_id=b.id for update;
  if application.id is null or application.status<>'pending' or v.id is null then raise exception 'Candidatura indisponível nesta empresa.';end if;
  if p_action='accept' then
   if v.status<>'open' or v.positions<=0 or b.status in('closed','suspended') then raise exception 'Esta vaga já foi encerrada.';end if;
   select * into t from public.business_role_templates where id=v.role_template_id;
   if t.can_manage and not is_owner then raise exception 'Somente o proprietário pode contratar gestores.';end if;
   perform id from public.profiles where id=application.profile_id for update;
   if exists(select 1 from public.business_employees where profile_id=application.profile_id and fired_at is null) then raise exception 'Este cidadão já tem um emprego principal. Ele precisa encerrar o vínculo anterior.';end if;
   select coalesce(experience,0) into xp from public.citizen_professional_experience where profile_id=application.profile_id and skill_area=t.skill_area;
   level:=least(20,1+coalesce(xp,0)/100);
   if level<v.min_level then raise exception 'A experiência atual ainda não atende ao nível mínimo da vaga.';end if;
   select full_name into person_name from public.profiles where id=application.profile_id and deleted_at is null and onboarding_completed;
   if person_name is null then raise exception 'O cadastro deste candidato está indisponível.';end if;
   insert into public.business_employees(business_id,profile_id,name,role,salary,is_npc,role_template_id,skill_area,experience,qualification_level,last_accrued_on) values(b.id,application.profile_id,person_name,t.name,v.salary,false,t.id,t.skill_area,coalesce(xp,0),level,current_date) returning id into target;
   update public.business_vacancies set positions=positions-1,status=case when positions=1 then 'closed' else status end where id=v.id;
   update public.business_applications set status='accepted',updated_at=now() where id=application.id;
   update public.business_applications set status='withdrawn',updated_at=now() where profile_id=application.profile_id and status='pending';
   insert into public.notifications(user_id,type,content,link) values(application.profile_id,'company_hired','Você foi contratado como '||t.name||' em '||b.name||'.','/services/my-work');
  else
   update public.business_applications set status='rejected',updated_at=now() where id=application.id;
   target:=application.id;
   insert into public.notifications(user_id,type,content,link) values(application.profile_id,'company_application','Sua candidatura para '||b.name||' foi analisada e não foi selecionada.','/services/my-work');
  end if;
 elsif p_action in('change','fire','quit') then
  select * into e from public.business_employees where id=(p_data->>'employee_id')::uuid and business_id=b.id and fired_at is null for update;
  if e.id is null then raise exception 'Vínculo de trabalho indisponível.';end if;
  if p_action='quit' then
   if e.profile_id is distinct from auth.uid() then raise exception 'Você só pode encerrar o próprio vínculo.' using errcode='42501';end if;
  elsif not is_owner and (e.profile_id=auth.uid() or exists(select 1 from public.business_role_templates where id=e.role_template_id and can_manage)) then raise exception 'Somente o proprietário pode alterar o vínculo de um gestor.' using errcode='42501';end if;
  -- Accrue completed days at the previous salary before changing/ending the employment.
  update public.business_employees set wage_due=wage_due+round(e.salary/7*greatest(0,current_date-coalesce(e.last_accrued_on,e.hired_at::date)),2),last_accrued_on=current_date where id=e.id;
  if p_action='change' then
   update public.business_employees set role_template_id=t.id,role=t.name,skill_area=t.skill_area,salary=wage where id=e.id;
  else update public.business_employees set fired_at=now() where id=e.id;end if;
  target:=e.id;
  if e.profile_id is not null then insert into public.notifications(user_id,type,content,link) values(e.profile_id,'company_employment_changed',case when p_action='change' then 'Sua função ou remuneração em '||b.name||' foi atualizada.' else 'Seu vínculo com '||b.name||' foi encerrado. Valores devidos permanecem registrados.' end,'/services/my-work');end if;
 else raise exception 'Escolha uma ação válida de gestão de equipe.';end if;
 update public.businesses set employees=(select count(*) from public.business_employees where business_id=b.id and fired_at is null),updated_at=now() where id=b.id;
 result:=jsonb_build_object('success',true,'id',target);
 insert into private.company_operations values(p_idempotency_key,auth.uid(),'workforce',payload,result,now());
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_workforce_changed','economy','businesses',b.id,auth.uid(),payload||result,'workforce:'||p_idempotency_key);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Confira os números e identificações da operação.';
end $function$;

CREATE OR REPLACE FUNCTION public.resume_company_operations(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;cash numeric;debt numeric;wages numeric;headcount integer;minimum integer;overhead numeric;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','resume_company_operations'),'Gestão administrativa autorizada.',auth.uid());end if;
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or (b.owner_id is distinct from auth.uid() and not public.has_full_admin_access()) then raise exception 'Somente o proprietário pode reestruturar a empresa.' using errcode='42501';end if;
 if b.status<>'active' or not exists(select 1 from public.documents where id=b.cnpj_document_id and is_valid) then raise exception 'Regularize a empresa e seu CNPJ antes de retomar a operação.';end if;
 if b.operational_status not in('closed','insolvent') then raise exception 'Esta empresa não está encerrada nem em insolvência.';end if;
 select coalesce(sum(wage_due),0),coalesce(sum(salary) filter(where fired_at is null),0),count(*) filter(where fired_at is null) into debt,wages,headcount from public.business_employees where business_id=b.id;
 select min_employees,daily_overhead into minimum,overhead from public.business_types where id=b.business_type_id;
 select balance into cash from public.accounts where id=b.bank_account_id for update;
 if debt>0 then raise exception 'Pague os salários devidos antes de retomar a operação.';end if;
 if headcount<minimum then raise exception 'Contrate a equipe mínima de % trabalhadores antes de retomar.',minimum;end if;
 if cash<wages+7*overhead then raise exception 'O caixa precisa cobrir uma semana de salários e custos operacionais.';end if;
 update public.businesses set operational_status='starting',updated_at=now() where id=b.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_operations_resumed','economy','businesses',b.id,auth.uid(),jsonb_build_object('previous_status',b.operational_status,'cash',cash,'headcount',headcount,'loss_cycles_preserved',b.loss_cycles),'company-resumed:'||gen_random_uuid());
end $function$;

CREATE OR REPLACE FUNCTION public.set_company_sale(p_business_id uuid, p_price numeric, p_for_sale boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','set_company_sale'),'Gestão administrativa autorizada.',auth.uid());end if;
 select * into b from public.businesses where id=p_business_id for update;
 if auth.uid() is null or (b.owner_id is distinct from auth.uid() and not public.has_full_admin_access()) then raise exception 'Somente o proprietário pode vender a empresa.' using errcode='42501';end if;
 if p_for_sale is null or (p_for_sale and (p_price is null or p_price<=0 or p_price>100000000000 or p_price<>round(p_price,2))) then raise exception 'Informe um preço de venda válido.';end if;
 update public.businesses set is_for_sale=p_for_sale,sale_price=case when p_for_sale then p_price end,sale_listed_at=case when p_for_sale then now() end,updated_at=now() where id=b.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_sale_listing_changed','economy','businesses',b.id,auth.uid(),jsonb_build_object('for_sale',p_for_sale,'price',p_price),'company-listing:'||gen_random_uuid());
end $function$;

CREATE OR REPLACE FUNCTION public.update_company_brand(p_business_id uuid, p_brand jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b public.businesses%rowtype;
begin
 perform public.assert_admin_real_action(auth.uid());
 if public.has_full_admin_access() then perform economy_private.audit('admin_company_action','businesses',p_business_id::text,null,jsonb_build_object('rpc','update_company_brand'),'Gestão administrativa autorizada.',auth.uid());end if;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id FOR UPDATE;
 IF auth.uid() IS NULL OR (b.owner_id IS DISTINCT FROM auth.uid() AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente o proprietário pode personalizar a empresa.' USING errcode='42501'; END IF;
 IF NOT coalesce(public.valid_brand_font(p_brand->>'font_key'),false) OR coalesce(p_brand->>'color','')!~'^#[0-9a-fA-F]{6}$'
  OR (coalesce(p_brand->>'logo_url','')<>'' AND p_brand->>'logo_url'!~'^https://') THEN RAISE EXCEPTION 'Confira a fonte, a cor e a imagem da empresa.'; END IF;
 IF jsonb_typeof(coalesce(p_brand->'palette','[]'))<>'array' OR jsonb_array_length(coalesce(p_brand->'palette','[]'))>3 OR EXISTS(select 1 from jsonb_array_elements_text(coalesce(p_brand->'palette','[]')) c where c!~'^#[0-9a-fA-F]{6}$') THEN RAISE EXCEPTION 'Escolha até três cores válidas.';END IF;
 UPDATE public.businesses SET brand_palette=coalesce(p_brand->'palette','[]'),logo_url=nullif(p_brand->>'logo_url',''),font_key=p_brand->>'font_key',brand_color=p_brand->>'color' WHERE id=b.id;
 PERFORM public.justice_write_audit('business.brand_updated','business',b.id,jsonb_build_object('font_key',b.font_key,'color',b.brand_color,'logo_url',b.logo_url),p_brand,'Personalização empresarial.');
END; $function$;

CREATE OR REPLACE FUNCTION public.get_company_management(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; result jsonb;
begin
 if not private.can_manage_company(p_business_id) then raise exception 'Acesso restrito à gestão desta empresa.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id;
 result:=jsonb_build_object('business',to_jsonb(b),'product_inventory',(SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('name',coalesce(i.metadata->>'item_name',p.name),'image_url',p.image_url) ORDER BY i.acquired_at DESC),'[]') FROM public.user_inventory i JOIN public.products p ON p.id=i.product_id WHERE i.business_id=b.id AND i.quantity>0),'withdrawal_destinations',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',case when account_kind='population' then 'Fundo da população' else 'Conta do proprietário' end)),'[]') from public.accounts where (user_id=b.owner_id and account_kind='personal') or (b.owner_id is null and b.control_kind='population' and account_kind='population')),'cash',(select balance from public.accounts where id=b.bank_account_id),
 'staff',coalesce((select jsonb_agg(to_jsonb(e) order by e.fired_at nulls first,e.hired_at) from public.business_employees e where e.business_id=b.id),'[]'::jsonb),
 'roles',coalesce((select jsonb_agg(to_jsonb(t) order by t.name) from public.business_role_templates t where t.business_type_id=b.business_type_id),'[]'::jsonb),
 'vacancies',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc) from public.business_vacancies v where v.business_id=b.id),'[]'::jsonb),
 'applications',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('full_name',p.full_name,'role',t.name,'level',least(20,1+coalesce(x.experience,0)/100)) order by a.created_at desc) from public.business_applications a join public.business_vacancies v on v.id=a.vacancy_id join public.business_role_templates t on t.id=v.role_template_id join public.profiles p on p.id=a.profile_id left join public.citizen_professional_experience x on x.profile_id=p.id and x.skill_area=t.skill_area where v.business_id=b.id),'[]'::jsonb),
 'inventory',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',r.name,'unit',r.unit,'base_price',r.base_price)) from public.business_inventory i join public.economic_resources r on r.code=i.resource_code where i.business_id=b.id),'[]'::jsonb),
 'recipes',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('resource_name',e.name)) from public.business_recipes r join public.economic_resources e on e.code=r.output_resource where r.business_type_id=b.business_type_id),'[]'::jsonb),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t)) from (select * from public.business_transactions where business_id=b.id order by created_at desc limit 100) t),'[]'::jsonb),
 'cycles',coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.business_balance_cycles where business_id=b.id order by cycle_start_at desc limit 12) c),'[]'::jsonb));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION economy_private.classify_transaction(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  transaction_row public.transactions%rowtype;
  transaction_type text;
  buyer_id uuid;
  seller_id uuid;
  seller_business_id uuid;
  sector_id uuid;
  tax_value numeric := 0;
  base_value numeric;
  group_key text;
  classification text;
  output_id uuid;
  expenditure_id uuid;
  tax_id uuid;
  canonical_commerce boolean;
  simulated boolean;
begin
  select * into transaction_row
  from public.transactions
  where id = p_transaction_id;

  if not found then
    raise exception 'Transação não encontrada.';
  end if;

  transaction_type := lower(coalesce(transaction_row.type, 'transfer'));
  canonical_commerce:=coalesce(transaction_row.metadata->>'buyer_kind' in('citizen','population','business'),false) and transaction_row.metadata ? 'product_id';
  simulated:=coalesce(transaction_row.metadata->>'is_simulated'='true',false);
  buyer_id := economy_private.account_owner(transaction_row.from_account_id);
  seller_id := economy_private.account_owner(transaction_row.to_account_id);
  select business_id into seller_business_id from public.accounts where id=transaction_row.to_account_id;
  seller_business_id := coalesce(seller_business_id,economy_private.profile_business(seller_id));
  sector_id := economy_private.resolve_sector(
    seller_business_id,
    null,
    transaction_row.description
  );
  group_key := 'transaction:' || transaction_row.id::text;

  if coalesce(transaction_row.metadata->>'tax_amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    tax_value := greatest((transaction_row.metadata->>'tax_amount')::numeric, 0);
  end if;

  if coalesce(transaction_row.metadata->>'base_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    base_value := greatest((transaction_row.metadata->>'base_price')::numeric, 0);
  else
    base_value := greatest(transaction_row.amount - tax_value, 0);
  end if;

  if canonical_commerce and transaction_row.metadata->>'buyer_kind'='business' then
    expenditure_id:=economy_private.record_event('business_inventory_purchase','financial_operation','transactions',transaction_row.id::text,transaction_row.amount,buyer_id,(transaction_row.metadata->>'buyer_business_id')::uuid,null,sector_id,null,null,tax_value,0,transaction_row.created_at,public.real_date_to_rp_date(transaction_row.created_at),simulated,1,transaction_row.metadata,group_key);
    return jsonb_build_object('classification','financial_operation','expenditure_event_id',expenditure_id);
  end if;
  if transaction_type='population_purchase' then
    expenditure_id:=economy_private.record_event('population_consumption','household_consumption','transactions',transaction_row.id::text,transaction_row.amount,null,seller_business_id,null,sector_id,null,null,tax_value,0,transaction_row.created_at,public.real_date_to_rp_date(transaction_row.created_at),true,1,transaction_row.metadata,group_key);
    return jsonb_build_object('classification','household_consumption','expenditure_event_id',expenditure_id);
  end if;

  if transaction_type in (
    'purchase',
    'purchase_card',
    'subscription_payment',
    'subscription_payment_card',
    'service_payment'
  ) then
    expenditure_id := economy_private.record_event(
      'household_consumption',
      'household_consumption',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      seller_business_id,
      null,
      sector_id,
      1,
      transaction_row.amount,
      tax_value,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'seller_profile_id', seller_id
        ),
      group_key
    );

    if not canonical_commerce or seller_business_id is null then
    output_id := economy_private.record_event(
      'domestic_gross_output',
      'gross_output',
      'transactions',
      transaction_row.id::text,
      base_value,
      seller_id,
      seller_business_id,
      null,
      sector_id,
      1,
      base_value,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'buyer_profile_id', buyer_id
        ),
      group_key
    );

    end if;

    if tax_value > 0 and not canonical_commerce then
      tax_id := economy_private.record_event(
        'product_tax',
        'product_tax',
        'transactions',
        transaction_row.id::text,
        tax_value,
        buyer_id,
        seller_business_id,
        null,
        sector_id,
        1,
        tax_value,
        tax_value,
        0,
        transaction_row.created_at,
        public.real_date_to_rp_date(transaction_row.created_at),
        simulated,
        1,
        coalesce(transaction_row.metadata, '{}'::jsonb),
        group_key
      );
    end if;

    classification := 'household_consumption';
  elsif transaction_type in ('daily_check_in_reward', 'citizen_income') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'social_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'social_transfer';
  elsif transaction_type = 'fine_payment' then
    expenditure_id := economy_private.record_event(
      'fine_payment',
      'not_in_gdp',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('reason', 'fine_is_transfer'),
      group_key
    );
    classification := 'not_in_gdp';
  elsif transaction_type in ('admin_credit', 'admin_debit') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'capital_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      null,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'capital_transfer';
  else
    expenditure_id := economy_private.record_event(
      transaction_type,
      'financial_operation',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      seller_business_id,
      null,
      sector_id,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      simulated,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('does_not_directly_change_gdp', true),
      group_key
    );
    classification := 'financial_operation';
  end if;

  return jsonb_build_object(
    'transaction_id', transaction_row.id,
    'classification', classification,
    'expenditure_event_id', expenditure_id,
    'output_event_id', output_id,
    'tax_event_id', tax_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION economy_private.on_business_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  business_row public.businesses%rowtype;
  classification text;
  event_type text;
begin
  select * into business_row
  from public.businesses
  where id = new.business_id;

  classification := case when new.metadata->>'kind'='payroll_accrual' then 'compensation' else case lower(new.type)
    when 'revenue' then 'gross_output'
    when 'expense' then 'intermediate_consumption'
    when 'monthly_cost' then 'intermediate_consumption'
    when 'tax' then 'income_tax'
    when 'registration' then 'capital_transfer'
    else 'not_in_gdp'
  end end;

  event_type := case classification
    when 'gross_output' then 'business_gross_output'
    when 'intermediate_consumption' then 'business_intermediate_consumption'
    else 'business_' || lower(new.type)
  end;

  perform economy_private.record_event(
    event_type,
    classification,
    'business_transactions',
    new.id::text,
    abs(new.amount),
    business_row.owner_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, new.description)
    ),
    null,
    null,
    case when classification = 'income_tax' then abs(new.amount) else 0 end,
    0,
    new.created_at,
    public.real_date_to_rp_date(new.created_at),
    coalesce((business_row.control_kind='population' OR new.metadata->>'is_simulated'='true' OR new.metadata->>'kind'='population_sale' OR EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=CASE WHEN new.metadata->>'transaction_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (new.metadata->>'transaction_id')::uuid END AND (tx.type='population_purchase' OR tx.metadata->>'is_simulated'='true'))),false),
    1,
    coalesce(new.metadata,'{}')||jsonb_build_object('business_transaction_type', new.type),
    'business_transaction:' || new.id::text
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION economy_private.on_government_revenue_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  classification text;
begin
  classification := case
    when new.revenue_type in ('consumption_tax', 'tariff') then 'product_tax'
    when new.revenue_type in ('income_tax', 'corporate_tax', 'payroll_tax', 'property_tax') then 'income_tax'
    when new.revenue_type = 'privatization' then 'capital_transfer'
    else 'not_in_gdp'
  end;

  perform economy_private.record_event(
    'government_revenue_' || new.revenue_type,
    classification,
    'government_revenues',
    new.id::text,
    new.amount,
    new.actor_profile_id,
    new.business_id,
    null,
    null,
    null,
    null,
    case when classification = 'product_tax' then new.amount else 0 end,
    0,
    new.occurred_at_real,
    new.occurred_at_rp,
    coalesce(new.metadata->>'is_simulated'='true',false) OR EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=CASE WHEN coalesce(new.metadata->>'transactionId',new.metadata->>'transaction_id',CASE WHEN new.source_table='transactions' THEN new.source_id END) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN coalesce(new.metadata->>'transactionId',new.metadata->>'transaction_id',CASE WHEN new.source_table='transactions' THEN new.source_id END)::uuid END AND (tx.type='population_purchase' OR tx.metadata->>'is_simulated'='true')),
    1,
    new.metadata,
    'government_revenue:' || new.id::text
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.trade_company_resource(p_buyer uuid, p_seller uuid, p_resource text, p_quantity numeric, p_max_price numeric, p_key uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; s public.businesses%rowtype; stock public.business_inventory%rowtype; a public.accounts%rowtype; q jsonb; total numeric; net numeric; amount numeric; order_row public.business_supply_orders%rowtype; tx uuid;
begin
 if p_buyer is null or p_seller is null or p_buyer=p_seller or p_key is null or p_quantity is null or p_quantity<=0 or p_quantity>1000000 or p_quantity<>round(p_quantity,3) or p_max_price is null or p_max_price<=0 then raise exception 'Confira as empresas, quantidade e preço máximo do fornecimento.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into order_row from public.business_supply_orders where idempotency_key=p_key;
 if found then
  if order_row.buyer_business_id<>p_buyer or order_row.seller_business_id<>p_seller or order_row.actor_id is distinct from p_actor or order_row.resource_code<>p_resource or order_row.quantity<>p_quantity then raise exception 'Esta identificação já pertence a outro fornecimento.';end if;
  return to_jsonb(order_row);
 end if;
 perform id from public.businesses where id in(p_buyer,p_seller) order by id for update;
 select * into b from public.businesses where id=p_buyer and status='active';select * into s from public.businesses where id=p_seller and status='active';
 if b.id is null or s.id is null then raise exception 'Comprador e fornecedor precisam estar ativos.';end if;
 select * into stock from public.business_inventory where business_id=s.id and resource_code=p_resource for update;
 if stock.resource_code is null or not stock.available_for_sale or stock.quantity<p_quantity or stock.selling_price is null or stock.selling_price>p_max_price then raise exception 'O preço ou estoque do fornecedor mudou. Confira a oferta.';end if;
 amount:=round(stock.selling_price*p_quantity,2);
 q:=public.quote_legal_levies('purchase',amount,true,s.economic_sector_id,'Insumos',NULL,s.region_code);
 if (q->>'restricted')::boolean then raise exception 'Fornecimento restrito por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where id in(b.bank_account_id,s.bank_account_id) order by id for update;
 select * into a from public.accounts where id=b.bank_account_id;
 if a.balance<total then raise exception 'O caixa da empresa não cobre este fornecimento.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=b.bank_account_id;
 update public.accounts set balance=balance+net,updated_at=now() where id=s.bank_account_id;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 update public.business_inventory set quantity=quantity-p_quantity,updated_at=now() where business_id=s.id and resource_code=p_resource;
 insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(b.id,p_resource,p_quantity,total/p_quantity)
 on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+total)/(public.business_inventory.quantity+p_quantity),quantity=public.business_inventory.quantity+p_quantity,updated_at=now();
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,s.bank_account_id,amount,'business_supply','Fornecimento: '||s.name||' → '||b.name,q||jsonb_build_object('buyer_kind','business','is_simulated',b.control_kind='population' OR s.control_kind='population','final_consumption',false,'buyer_business_id',b.id,'seller_business_id',s.id,'resource_code',p_resource,'quantity',p_quantity),p_key) returning id into tx;
 insert into public.business_supply_orders(buyer_business_id,seller_business_id,resource_code,quantity,unit_price,total,tax_snapshot,transaction_id,actor_id,idempotency_key) values(b.id,s.id,p_resource,p_quantity,stock.selling_price,total,q,tx,p_actor,p_key) returning * into order_row;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-total,'Aquisição de insumos: '||p_resource,jsonb_build_object('kind','inventory_purchase','transaction_id',tx),'supply-buyer:'||p_key),(s.id,'revenue',amount,'Fornecimento para '||b.name,jsonb_build_object('kind','b2b_sale','transaction_id',tx),'supply-seller:'||p_key);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(s.id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre fornecimento',q,'supply-tax:'||p_key);end if;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,p_actor,s.id,total-net,public.rp_now(),q);end if;
 return to_jsonb(order_row);
end $function$;

CREATE OR REPLACE FUNCTION public.get_country_companies(p_search text DEFAULT ''::text, p_type text DEFAULT ''::text, p_state text DEFAULT ''::text, p_size text DEFAULT ''::text, p_product text DEFAULT ''::text, p_status text DEFAULT 'active'::text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar empresas.' using errcode='42501';end if;
 with companies as (
 select b.id,b.name,b.description,b.logo_url,b.brand_color,b.font_key,b.region_code,b.size_class,b.status,b.operational_status,b.market_value,b.business_type_id,t.name activity,
 coalesce(p.full_name,'Capital da população') owner_name,p.avatar_url owner_avatar,b.owner_id,(SELECT document_number FROM public.documents WHERE id=b.cnpj_document_id) cnpj,
 case when public.is_admin() then b.control_kind else null end control_kind,
 array(select distinct name from (
   select r.name from public.business_inventory i join public.economic_resources r on r.code=i.resource_code where i.business_id=b.id and i.available_for_sale and i.quantity>0
   union select pr.name from public.products pr where pr.business_id=b.id and pr.archived_at is null and pr.moderation_status='approved' and pr.listing_status='active'
 ) offers order by name) products
 from public.businesses b left join public.business_types t on t.id=b.business_type_id left join public.profiles p on p.id=b.owner_id
 where (coalesce(p_search,'')='' or b.name ilike '%'||left(p_search,120)||'%')
 and (coalesce(p_type,'')='' or b.business_type_id=p_type)
 and (coalesce(p_state,'')='' or b.region_code=p_state)
 and (coalesce(p_size,'')='' or b.size_class=p_size)
 and (coalesce(p_status,'')='' or b.status=p_status)
 ), matched as(select * from companies where coalesce(p_product,'')='' or array_to_string(products,' ') ilike '%'||left(p_product,120)||'%'),
 page as(select * from matched order by name,id limit 36 offset greatest(0,least(coalesce(p_offset,0),100000)))
 select jsonb_build_object('total',(select count(*) from matched),'companies',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]')) into result;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.get_company_market()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'owner_id',b.owner_id,'business_type_id',b.business_type_id,'name',b.name,'description',b.description,'sale_price',b.sale_price,'sale_listed_at',b.sale_listed_at,'market_value',b.market_value,'employees',b.employees,'region_code',b.region_code,'control_kind',b.control_kind,'owner',jsonb_build_object('id',p.id,'avatar_url',p.avatar_url,'full_name',coalesce(p.full_name,'Capital da população'))) order by b.sale_listed_at desc),'[]'::jsonb)
 from public.businesses b left join public.profiles p on p.id=b.owner_id where auth.uid() is not null and b.is_for_sale and b.sale_price>0 and b.status<>'closed'
$function$;

CREATE OR REPLACE FUNCTION private.list_company_stock(p_business_id uuid, p_symbol text, p_total_shares bigint, p_offered_percent numeric, p_price numeric, p_actor uuid, p_bootstrap boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; cash numeric; offering numeric; liquidity numeric; float_count bigint; population public.accounts%rowtype; reserve uuid; option uuid; cycle_count integer; profitable numeric; current_staff integer;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into b from public.businesses where id=p_business_id and status='active' for update;
 if b.id is null or (not p_bootstrap and b.owner_id is distinct from p_actor and not public.has_full_admin_access()) or (p_bootstrap and b.control_kind<>'population') then raise exception 'Somente o proprietário pode abrir capital.' using errcode='42501';end if;
 if exists(select 1 from public.investment_options where business_id=b.id) then raise exception 'Esta empresa já possui ações listadas.';end if;
 if p_symbol is null or upper(p_symbol)!~'^[A-Z]{3,5}[0-9]$' or p_total_shares is null or p_total_shares not between 1000 and 100000000 or p_offered_percent is null or p_offered_percent not between 5 and 49 or p_price is null or p_price<.01 or p_price>1000000 or p_price<>round(p_price,2) then raise exception 'Informe ticker (3 a 5 letras e um número), quantidade entre mil e 100 milhões, oferta de 5%% a 49%% e preço com centavos.';end if;
 select count(*),coalesce(sum(net_result),0) into cycle_count,profitable from public.business_balance_cycles where business_id=b.id;
 select count(*) into current_staff from public.business_employees where business_id=b.id and fired_at is null;
 if b.market_value<1000000 or current_staff<20 or (not p_bootstrap and cycle_count<2) or b.operational_status in('closed','insolvent') or exists(select 1 from public.business_employees where business_id=b.id and wage_due>salary) or not exists(select 1 from public.documents where id=b.cnpj_document_id and type='CNPJ' and is_valid and (expires_at is null or expires_at>now())) then raise exception 'A abertura exige valor de R$ 1 milhão, 20 trabalhadores, dois balanços completos, CNPJ válido e salários regulares.';end if;
 if p_price*p_total_shares<b.market_value*.5 or p_price*p_total_shares>b.market_value*1.5 then raise exception 'O valor total das ações deve ficar entre 50%% e 150%% da avaliação atual da empresa.';end if;
 float_count:=floor(p_total_shares*p_offered_percent/100);offering:=round(float_count*p_price,2);liquidity:=round(offering*.25,2);
 select * into population from public.accounts where account_kind='population';
 perform id from public.accounts where id in(population.id,b.bank_account_id) order by id for update;select * into population from public.accounts where id=population.id;
 if population.balance<offering+liquidity then raise exception 'O fundo de mercado não possui caixa para subscrever esta oferta. Reduza o percentual ou aguarde liquidez.';end if;
 insert into public.investment_options(name,description,risk_level,annual_return_rate,minimum_amount,is_active,asset_symbol,asset_type,current_unit_price,business_id,total_shares,floated_shares,available_shares,initial_unit_price,previous_close,listed_at,listing_metadata) values(b.name,'Participação econômica na empresa. A compra de ações não concede controle administrativo.','high',0,p_price,true,upper(p_symbol),'stock',p_price,b.id,p_total_shares,float_count,float_count,p_price,p_price,now(),jsonb_build_object('offered_percent',p_offered_percent,'valuation_at_listing',b.market_value,'initial_subscribed_capital',offering,'bootstrap',p_bootstrap,'listed_by',p_actor)) returning id into option;
 insert into public.accounts(account_kind,investment_id,account_number,agency_number,balance) values('investment_reserve',option,'BNV-'||replace(option::text,'-',''),'0003',liquidity) returning id into reserve;
 update public.accounts set balance=balance-offering-liquidity,updated_at=now() where id=population.id;
 update public.accounts set balance=balance+offering,updated_at=now() where id=b.bank_account_id;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(population.id,b.bank_account_id,offering,'company_capital','Subscrição de capital na BNV: '||b.name,jsonb_build_object('business_id',b.id,'investment_id',option,'kind','ipo_capital')),(population.id,reserve,liquidity,'investment_reserve_funding','Reserva de liquidez: '||upper(p_symbol),jsonb_build_object('investment_id',option));
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',offering,'Capital recebido na abertura de capital',jsonb_build_object('kind','ipo_capital','investment_id',option),'ipo:'||option);
 insert into public.stock_price_history(investment_id,price,reason,metadata) values(option,p_price,'listing',jsonb_build_object('bootstrap',p_bootstrap));
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('company_stock_listed','economy','investment_options',option,p_actor,jsonb_build_object('business_id',b.id,'name',b.name,'ticker',upper(p_symbol),'price',p_price,'offered_shares',float_count),'stock-listing:'||b.id);
 return option;
end $function$;
CREATE OR REPLACE FUNCTION public.get_company_available_cnpjs(p_business_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;BEGIN
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id;
 IF auth.uid() IS NULL OR b.id IS NULL OR (b.owner_id IS DISTINCT FROM auth.uid() AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'Somente o proprietário ou a administração autorizada pode consultar os CNPJs disponíveis.' USING errcode='42501';END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'document_number',d.document_number,'activity',d.metadata->>'activity_name','business_type_id',d.metadata->>'business_type_id')),'[]') FROM public.documents d WHERE d.user_id=b.owner_id AND d.type='CNPJ' AND d.is_valid AND (d.expires_at IS NULL OR d.expires_at>clock_timestamp()) AND nullif(d.metadata->>'business_id','') IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.get_company_available_cnpjs(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_company_available_cnpjs(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.save_business_product(p_product_id uuid, p_business_id uuid, p_name text, p_description text, p_price numeric, p_image_url text, p_product_type text, p_subscription_interval text, p_category text, p_stock integer, p_promotion_price numeric, p_promotion_expires_at timestamp with time zone, p_consumable_effects jsonb)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_seller uuid:=auth.uid();v_business public.businesses%rowtype;v_product public.products%rowtype;
begin
  perform public.assert_admin_real_action(v_actor);
  perform private.assert_citizen_service('/services/business');
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=v_actor and onboarding_completed and deleted_at is null) then
    raise exception 'CITIZENSHIP_REQUIRED';
  end if;
  if p_business_id is not null then
    select * into v_business from public.businesses where id=p_business_id for share;
    if not found or (v_business.owner_id is distinct from v_actor and not public.has_full_admin_access()) then raise exception 'BUSINESS_OWNERSHIP_REQUIRED'; end if;
    v_seller:=v_business.owner_id;
    if v_business.status not in('active','pending') then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.bank_account_id is null then raise exception 'BUSINESS_BANK_ACCOUNT_REQUIRED'; end if;
  elsif not exists(select 1 from public.accounts where user_id=v_actor) then
    raise exception 'BANK_ACCOUNT_REQUIRED';
  end if;
  if length(btrim(coalesce(p_name,'')))<3 or length(btrim(coalesce(p_description,'')))<5 then raise exception 'PRODUCT_DETAILS_INCOMPLETE'; end if;
  if p_price is null or p_price<=0 or p_price::text in('NaN','Infinity','-Infinity') then raise exception 'INVALID_PRODUCT_PRICE'; end if;
  if p_product_type is null or p_product_type not in('one-time','subscription') then raise exception 'INVALID_PRODUCT_TYPE'; end if;
  if p_product_type='one-time' and (p_stock is null or p_stock<0 or (p_product_id is null and p_stock<1)) then raise exception 'INVALID_PRODUCT_STOCK'; end if;
  if p_product_type='subscription' and (p_subscription_interval is null or p_subscription_interval not in('7 days','30 days')) then raise exception 'INVALID_SUBSCRIPTION_INTERVAL'; end if;
  if p_promotion_price is not null and (p_promotion_price::text in('NaN','Infinity','-Infinity') or p_promotion_price<=0 or p_promotion_price>=p_price or p_promotion_expires_at is null) then
    raise exception 'INVALID_PROMOTION';
  end if;
  if p_product_id is null then
    insert into public.products(
      seller_id,business_id,name,description,price,image_url,product_type,subscription_interval,
      subscription_price,category,stock,promotion_price,promotion_expires_at,consumable_effects
    ) values(
      v_seller,p_business_id,btrim(p_name),btrim(p_description),p_price,nullif(btrim(coalesce(p_image_url,'')),''),
      p_product_type,case when p_product_type='subscription' then p_subscription_interval end,
      case when p_product_type='subscription' then p_price end,btrim(p_category),
      case when p_product_type='one-time' then p_stock end,p_promotion_price,p_promotion_expires_at,coalesce(p_consumable_effects,'{}')
    ) returning * into v_product;
  else
    update public.products set business_id=p_business_id,name=btrim(p_name),description=btrim(p_description),price=p_price,
      image_url=nullif(btrim(coalesce(p_image_url,'')),''),product_type=p_product_type,
      subscription_interval=case when p_product_type='subscription' then p_subscription_interval end,
      subscription_price=case when p_product_type='subscription' then p_price end,category=btrim(p_category),
      stock=case when p_product_type='one-time' then p_stock end,promotion_price=p_promotion_price,
      promotion_expires_at=p_promotion_expires_at,consumable_effects=coalesce(p_consumable_effects,'{}')
    where id=p_product_id and (seller_id=v_actor or (business_id is not null and public.has_full_admin_access())) returning * into v_product;
    if not found then raise exception 'PRODUCT_NOT_FOUND_OR_FORBIDDEN'; end if;
  end if;
  if v_business.owner_id is distinct from v_actor and p_business_id is not null then perform economy_private.audit('admin_company_product_saved','products',v_product.id::text,null,jsonb_build_object('business_id',p_business_id),'Edição administrativa autorizada de produto empresarial.',v_actor);end if;
  return v_product;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_business_product(p_product jsonb, p_confirmed_fee numeric, p_period_days integer, p_idempotency_key uuid)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result public.products%rowtype; market public.state_enterprises%rowtype; product_id uuid; fingerprint text;
BEGIN
 IF auth.uid() IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Entre na sua conta e confirme a publicação.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO market FROM public.state_enterprises WHERE service_key='marketplace' FOR SHARE;
 product_id:=nullif(p_product->>'p_product_id','')::uuid;
 fingerprint:=md5(p_product::text);
 IF product_id IS NULL THEN
  SELECT * INTO result FROM public.products WHERE publication_request_key=p_idempotency_key;
  IF result.id IS NOT NULL THEN
   IF result.seller_id IS DISTINCT FROM auth.uid() AND NOT(public.has_full_admin_access() AND result.business_id IS NOT NULL) THEN RAISE EXCEPTION 'Esta confirmação pertence a outra conta.';END IF;
   IF result.publication_request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'Os dados desta confirmação mudaram. Confira o anúncio já publicado antes de enviar novamente.'; END IF;
   RETURN result;
  END IF;
 END IF;
 result:=private.save_business_product(product_id,nullif(p_product->>'p_business_id','')::uuid,p_product->>'p_name',p_product->>'p_description',(p_product->>'p_price')::numeric,p_product->>'p_image_url',p_product->>'p_product_type',p_product->>'p_subscription_interval',p_product->>'p_category',(p_product->>'p_stock')::integer,(p_product->>'p_promotion_price')::numeric,(p_product->>'p_promotion_expires_at')::timestamptz,coalesce(p_product->'p_consumable_effects','{}'));
 IF product_id IS NULL THEN
  UPDATE public.products SET publication_request_key=p_idempotency_key,publication_request_hash=fingerprint WHERE id=result.id;
  result:=private.activate_marketplace_listing(result.id,p_confirmed_fee,p_period_days,p_idempotency_key);
 END IF;
 RETURN result;
END; $function$;

CREATE OR REPLACE FUNCTION public.publish_company_resource_listing(p_business_id uuid, p_resource_code text, p_price numeric, p_confirmed_fee numeric, p_period_days integer, p_idempotency_key uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;r public.economic_resources%rowtype;pid uuid;stock numeric;
begin
 if auth.uid() is null or not private.can_manage_company(p_business_id) then raise exception 'Somente a gestão pode anunciar o estoque da empresa.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id and status='active' for update;
 if b.owner_id is distinct from auth.uid() and not public.has_full_admin_access() then raise exception 'O proprietário deve confirmar a publicação no marketplace.' using errcode='42501';end if;
 select * into r from public.economic_resources where code=p_resource_code;
 select quantity into stock from public.business_inventory where business_id=b.id and resource_code=r.code for update;
 if b.id is null or r.code is null or stock is null or floor(stock)<1 or p_price is null or p_price::text in ('NaN','Infinity','-Infinity') or p_price not between .01 and 1000000000 or p_idempotency_key is null then raise exception 'Confira recurso, estoque, preço e confirmação.';end if;
 select id into pid from public.products where business_id=b.id and resource_code=r.code for update;
 if pid is null then
  perform set_config('govrp.physical_listing_authorized',b.id::text,true);
  pid:=(public.publish_business_product(jsonb_build_object('p_business_id',b.id,'p_name',r.name,'p_description','Produto do estoque físico de '||b.name||'. Quantidade em '||r.unit||'.','p_price',p_price,'p_product_type','one-time','p_category','Insumos','p_stock',floor(stock)::int,'p_consumable_effects','{}'::jsonb),p_confirmed_fee,p_period_days,p_idempotency_key)).id;
  update public.products set resource_code=r.code where id=pid;
  perform set_config('govrp.physical_listing_authorized','',true);
 else
  update public.products set price=p_price,archived_at=null where id=pid;
  perform private.activate_marketplace_listing(pid,p_confirmed_fee,p_period_days,p_idempotency_key);
 end if;
 perform economy_private.audit('company_resource_listed','products',pid::text,null,jsonb_build_object('resource_code',r.code,'price',p_price),'Anúncio vinculado ao estoque físico existente.',auth.uid());
 return pid;
end $function$;

CREATE OR REPLACE FUNCTION private.activate_marketplace_listing(p_product_id uuid, p_confirmed_fee numeric, p_period_days integer, p_idempotency_key uuid)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE product public.products%rowtype; market public.state_enterprises%rowtype; payer uuid; recipient uuid; recipient_owner uuid; fee numeric; balance numeric; snapshot jsonb; tx public.transactions%rowtype; until_time timestamptz;
BEGIN
 IF auth.uid() IS NOT NULL THEN PERFORM public.assert_admin_real_action(auth.uid());END IF;
 IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Entre na sua conta e confirme o anúncio.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO market FROM public.state_enterprises WHERE service_key='marketplace' FOR SHARE;
 IF market.id IS NULL OR NOT market.is_active THEN RAISE EXCEPTION 'O marketplace está temporariamente indisponível.'; END IF;
 SELECT * INTO product FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF product.id IS NULL OR (product.seller_id IS DISTINCT FROM auth.uid() AND NOT(public.has_full_admin_access() AND product.business_id IS NOT NULL)) OR (auth.uid() IS NULL AND NOT EXISTS(SELECT 1 FROM public.businesses WHERE id=product.business_id AND owner_id IS NULL AND control_kind='population')) OR product.state_enterprise_id IS NOT NULL THEN RAISE EXCEPTION 'Este anúncio não pertence a você.' USING errcode='42501'; END IF;
 SELECT * INTO tx FROM public.transactions WHERE idempotency_key=p_idempotency_key;
 IF tx.id IS NOT NULL THEN
  IF tx.type<>'marketplace_listing_fee' OR tx.metadata->>'product_id'<>p_product_id::text OR tx.metadata->>'seller_id' IS DISTINCT FROM product.seller_id::text THEN RAISE EXCEPTION 'Esta confirmação pertence a outra operação.'; END IF;
  RETURN product;
 END IF;
 IF product.archived_at IS NOT NULL OR product.moderation_status IN ('removed','suspended') THEN RAISE EXCEPTION 'Um anúncio removido ou suspenso não pode ser renovado.'; END IF;
 IF product.listing_paid_until>clock_timestamp() AND product.listing_status='active' THEN RETURN product; END IF;
 market:=private.marketplace_seller_policy(market,product.business_id,product.listing_fee_snapshot<>'{}'::jsonb);
 fee:=CASE WHEN market.active_listing_fee_enabled THEN market.active_listing_fee_amount ELSE 0 END;
 IF p_confirmed_fee IS DISTINCT FROM fee OR p_period_days IS DISTINCT FROM market.active_listing_fee_period THEN RAISE EXCEPTION 'Os custos do anúncio mudaram. Confira os valores e confirme novamente.';END IF;
 IF product.business_id IS NULL THEN SELECT id INTO payer FROM public.accounts WHERE user_id=auth.uid();
 ELSE SELECT bank_account_id INTO payer FROM public.businesses WHERE id=product.business_id AND (owner_id=auth.uid() OR public.has_full_admin_access() OR (auth.uid() IS NULL AND owner_id IS NULL AND control_kind='population')) AND status IN ('active','pending');END IF;
 IF payer IS NULL THEN RAISE EXCEPTION 'A conta de pagamento do vendedor não está disponível.'; END IF;
 IF market.is_privatized THEN
  SELECT coalesce(b.owner_id,market.privatization_buyer_id),b.bank_account_id INTO recipient_owner,recipient FROM public.businesses b WHERE b.id=market.operating_business_id;
  recipient_owner:=coalesce(recipient_owner,market.privatization_buyer_id);
  IF recipient IS NULL THEN SELECT id INTO recipient FROM public.accounts WHERE user_id=recipient_owner;END IF;
  IF recipient IS NULL AND fee>0 THEN RAISE EXCEPTION 'A gestão do marketplace precisa regularizar sua conta de recebimento.';END IF;
 END IF;
 PERFORM id FROM public.accounts WHERE id IN (payer,recipient) ORDER BY id FOR UPDATE;
 SELECT a.balance INTO balance FROM public.accounts a WHERE id=payer;
 IF balance<fee THEN RAISE EXCEPTION 'Seu saldo é insuficiente para publicar ou renovar este anúncio.'; END IF;
 until_time:=CASE WHEN fee>0 THEN clock_timestamp()+make_interval(days=>market.active_listing_fee_period) ELSE NULL END;
 snapshot:=jsonb_build_object('amount',fee,'seller_type',case when product.business_id is null then 'PF' else 'PJ' end,'period_days',market.active_listing_fee_period,'paid_at',clock_timestamp(),'valid_until',until_time,'enterprise_id',market.id,'private',market.is_privatized,'recipient_account_id',recipient);
 IF fee>0 THEN
  UPDATE public.accounts SET balance=public.accounts.balance-fee,updated_at=clock_timestamp() WHERE id=payer;
  IF market.is_privatized THEN UPDATE public.accounts SET balance=public.accounts.balance+fee,updated_at=clock_timestamp() WHERE id=recipient;
  ELSE
   INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
   UPDATE public.government_finances SET treasury_balance=treasury_balance+fee,updated_at=clock_timestamp() WHERE id=1;
  END IF;
  INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(payer,recipient,fee,'marketplace_listing_fee','Ativação de anúncio: '||product.name,
   jsonb_build_object('actor_id',auth.uid(),'product_id',product.id,'seller_id',product.seller_id,'business_id',product.business_id,'gross_amount',fee,'total_debited',fee,'net_amount',fee,'tax_amount',0,'listing_fee_snapshot',snapshot),p_idempotency_key) RETURNING * INTO tx;
  IF product.business_id IS NOT NULL THEN INSERT INTO public.business_transactions(business_id,type,amount,description) VALUES(product.business_id,'expense',-fee,'Anúncio ativo no Negócios Livre: '||product.name);END IF;
  IF NOT market.is_privatized THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
   VALUES('fee','transactions',tx.id::text,auth.uid(),fee,public.rp_now(),jsonb_build_object('kind','marketplace_listing_fee','snapshot',snapshot));END IF;
 END IF;
 UPDATE public.products SET listing_paid_until=until_time,listing_status='active',listing_fee_snapshot=snapshot WHERE id=product.id RETURNING * INTO product;
 PERFORM public.justice_write_audit('marketplace.listing_activated','product',product.id,NULL,snapshot,'Ativação confirmada pelo vendedor.');
 RETURN product;
END; $function$;
CREATE OR REPLACE FUNCTION private.sync_population_marketplace(p_business_id uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE offer record;market public.state_enterprises%rowtype;policy public.state_enterprises%rowtype;pid uuid;fee numeric;BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.has_full_admin_access() THEN RETURN;END IF;
 SELECT * INTO market FROM public.state_enterprises WHERE service_key='marketplace' AND is_active;
 IF market.id IS NULL THEN RETURN;END IF;
 FOR offer IN SELECT b.id,b.name,i.resource_code,i.quantity,i.selling_price,r.name resource_name,r.is_service
 FROM public.businesses b JOIN public.business_inventory i ON i.business_id=b.id JOIN public.economic_resources r ON r.code=i.resource_code JOIN public.accounts a ON a.id=b.bank_account_id
 WHERE (p_business_id IS NULL OR b.id=p_business_id) AND b.control_kind='population' AND b.owner_id IS NULL AND b.status='active' AND i.available_for_sale AND i.quantity>=1 AND i.selling_price>0
 AND a.balance>=CASE WHEN market.active_listing_fee_enabled THEN market.active_listing_fee_amount ELSE 0 END
 AND NOT EXISTS(SELECT 1 FROM public.products WHERE business_id=b.id AND resource_code=i.resource_code)
 ORDER BY b.id,i.resource_code LIMIT 50 LOOP
  BEGIN
   policy:=private.marketplace_seller_policy(market,offer.id,false);fee:=CASE WHEN policy.active_listing_fee_enabled THEN policy.active_listing_fee_amount ELSE 0 END;
   PERFORM set_config('govrp.physical_listing_authorized',offer.id::text,true);
   INSERT INTO public.products(seller_id,business_id,name,description,price,product_type,category,stock,resource_code,is_final_good,moderation_status,consumable_effects)
   VALUES(NULL,offer.id,offer.resource_name,'Oferta da empresa '||offer.name||', vinculada ao estoque produzido. Quantidade por unidade do recurso.',offer.selling_price,'one-time','Insumos',floor(offer.quantity)::int,offer.resource_code,offer.is_service OR offer.resource_code IN('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'),'approved','{}') RETURNING id INTO pid;
   PERFORM private.activate_marketplace_listing(pid,fee,policy.active_listing_fee_period,md5('npc-marketplace:'||offer.id||':'||offer.resource_code)::uuid);
   PERFORM set_config('govrp.physical_listing_authorized','',true);
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'GOVRP NPC listing refused for company % resource % [%]: %',offer.id,offer.resource_code,sqlstate,sqlerrm;END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.sync_population_marketplace(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.supply_population_company_from_marketplace(p_business_id uuid,p_resource text,p_quantity numeric,p_day date) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;offer record;n int:=0;i int;limit_units int;cash numeric;reserved numeric;budget numeric;result jsonb;spent numeric:=0;BEGIN
 IF auth.uid() IS NOT NULL AND NOT public.has_full_admin_access() THEN RETURN 0;END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business_id AND control_kind='population' AND owner_id IS NULL AND status='active';
 IF b.id IS NULL OR p_quantity<1 THEN RETURN 0;END IF;
 SELECT balance INTO cash FROM public.accounts WHERE id=b.bank_account_id;
 SELECT coalesce(sum(wage_due),0) INTO reserved FROM public.business_employees WHERE business_id=b.id;
 budget:=greatest(0,cash-reserved)*.2;limit_units:=least(20,floor(p_quantity)::int);
 FOR offer IN SELECT p.id,p.stock FROM public.products p JOIN public.businesses seller ON seller.id=p.business_id JOIN public.economic_resources r ON r.code=p.resource_code
 WHERE p.business_id<>b.id AND p.resource_code=p_resource AND p.product_type='one-time' AND p.stock>0 AND p.moderation_status='approved' AND p.archived_at IS NULL AND seller.status='active' AND p.price<=r.base_price*3
 ORDER BY p.price,seller.reputation DESC,p.id LIMIT 5 LOOP
  FOR i IN 1..least(offer.stock,limit_units-n) LOOP
   IF n>=limit_units OR spent>=budget THEN RETURN spent;END IF;
   BEGIN
    result:=private.buy_product_authoritative(NULL,offer.id,'balance',NULL,md5('npc-retail-supply:'||b.id||':'||p_day||':'||offer.id||':'||i)::uuid,NULL,b.bank_account_id,'business',budget-spent);
    spent:=spent+(result->>'total')::numeric;n:=n+1;
   EXCEPTION WHEN OTHERS THEN RAISE LOG 'GOVRP NPC marketplace supply refused for company % [%]: %',b.id,sqlstate,sqlerrm;EXIT;END;
  END LOOP;
 END LOOP;RETURN spent;
END $$;
REVOKE ALL ON FUNCTION private.supply_population_company_from_marketplace(uuid,text,numeric,date) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.simulate_company_day(p_business_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; kind public.business_types%rowtype; region public.economic_regions%rowtype; recipe public.business_recipes%rowtype; employee public.business_employees%rowtype; item record; supplier record; contract record; cash numeric; available numeric; cost numeric:=0; wages numeric:=0; wage numeric; overhead numeric:=0; units numeric; work_efficiency numeric; skill numeric; headcount integer; boost numeric; resource_price numeric; population_account uuid; produced numeric:=0; result_status text:='operating'; input_quantity numeric; unit_cost numeric; tx uuid; contract_key uuid;
begin
 if p_day>current_date or p_day<current_date-30 then raise exception 'Data de simulação fora do período operacional.';end if;
 select * into b from public.businesses where id=p_business_id for update;
 if b.id is null or b.status<>'active' or b.operational_status='closed' or exists(select 1 from public.business_daily_operations where business_id=b.id and operation_date=p_day) then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;
 select * into region from public.economic_regions where code=b.region_code;
 select * into recipe from public.business_recipes where business_type_id=b.business_type_id order by id limit 1;
 if region.code is null or recipe.id is null then return;end if;
 select id into population_account from public.accounts where account_kind='population';
 for employee in select * from public.business_employees where business_id=b.id and fired_at is null and hired_at::date<=p_day order by id for update loop
  wage:=round(employee.salary/7*greatest(0,p_day+1-coalesce(employee.last_accrued_on,employee.hired_at::date)),2);
  update public.business_employees set wage_due=wage_due+wage,last_accrued_on=greatest(coalesce(last_accrued_on,hired_at::date),p_day+1),experience=experience+case when is_npc then 2 else 0 end,qualification_level=case when is_npc then least(20,1+(experience+2)/100) else qualification_level end,satisfaction=greatest(0,least(100,satisfaction+case when wage_due>salary then -3 else 0 end)) where id=employee.id;
  wages:=wages+wage;
 end loop;
 if wages>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-wages,'Salários trabalhados no dia',jsonb_build_object('kind','payroll_accrual','operation_date',p_day),'wage-accrual:'||p_day,p_day);end if;
 select count(*),coalesce(avg((1+least(.3,(qualification_level-1)*.02))*(.7+satisfaction*.006)),0) into headcount,skill from public.business_employees where business_id=b.id and fired_at is null and hired_at::date<=p_day;
 select coalesce(e.boost,0) into boost from private.business_daily_effort e where e.business_id=b.id and e.effort_date=p_day;
 work_efficiency:=least(10,(headcount+case when b.owner_operates and b.control_kind='player' then .25 else 0 end)/greatest(kind.min_employees,1)::numeric)*greatest(.7,skill)*(.65+(region.roads+region.energy+region.telecom+region.industry+region.ports+region.airports)/2000)*(1+coalesce(boost,0));
 units:=round(kind.base_daily_capacity*work_efficiency,3);
 if headcount<kind.min_employees then result_status:='understaffed';end if;
 -- Agreed standing orders are capped by quantity, price and expiry; no unrestricted auto-debit.
 for contract in select * from public.business_supply_contracts where buyer_business_id=b.id and status='active' and ends_at>p_day::timestamptz and (last_processed_on is null or last_processed_on<p_day) for update loop
  begin
   contract_key:=md5('supply-contract:'||contract.id||':'||p_day)::uuid;
   perform private.trade_company_resource(b.id,contract.seller_business_id,contract.resource_code,contract.daily_quantity,contract.max_unit_price,contract_key,contract.created_by);
  exception when others then
   if b.owner_id is not null then insert into public.notifications(user_id,type,content,link,metadata) values(b.owner_id,'company_supply_pending','Um fornecimento de '||b.name||' não foi concluído. Confira estoque, preço e caixa.','/services/companies/'||b.id,jsonb_build_object('contract_id',contract.id,'operation_date',p_day));end if;
   raise log 'GOVRP supply contract % failed [%]: %',contract.id,sqlstate,sqlerrm;
  end;
  update public.business_supply_contracts set last_processed_on=p_day where id=contract.id;
 end loop;
 -- Population businesses buy from actual available suppliers and their own finite company cash.
 if b.control_kind='population' and units>0 then
  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   perform private.supply_population_company_from_marketplace(b.id,item.key,greatest(0,units*item.required-coalesce(available,0))*.25,p_day);
  end loop;

  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select coalesce(quantity,0) into available from public.business_inventory where business_id=b.id and resource_code=item.key;
   input_quantity:=greatest(0,round(units*item.required-coalesce(available,0),3));
   if input_quantity>0 then
    for supplier in select i.*,r.base_price from public.business_inventory i join public.businesses s on s.id=i.business_id join public.economic_resources r on r.code=i.resource_code where i.resource_code=item.key and i.business_id<>b.id and s.status='active' and i.available_for_sale and i.quantity>0 and i.selling_price<=r.base_price*2 order by i.selling_price,i.business_id limit 3 loop
     select balance into cash from public.accounts where id=b.bank_account_id;
     input_quantity:=least(input_quantity,supplier.quantity,round(greatest(0,cash-wages-kind.daily_overhead)/greatest(supplier.selling_price*1.5,.01),3));
     if input_quantity<=0 then exit;end if;
     begin perform private.trade_company_resource(b.id,supplier.business_id,item.key,input_quantity,supplier.selling_price,md5('npc-supply:'||b.id||':'||supplier.business_id||':'||item.key||':'||p_day)::uuid,null);
     exception when others then raise log 'GOVRP population supply % failed [%]: %',b.id,sqlstate,sqlerrm;end;
     exit;
    end loop;
   end if;
  end loop;
 end if;
 -- Every input limits physical production. Missing input never creates imaginary sales.
 for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
  select quantity into available from public.business_inventory where business_id=b.id and resource_code=item.key for update;
  if coalesce(available,0)<units*item.required then units:=greatest(0,trunc(coalesce(available,0)/item.required,3));result_status:='missing_inputs';end if;
 end loop;
 perform id from public.accounts where id in(b.bank_account_id,population_account) order by id for update;
 select balance into cash from public.accounts where id=b.bank_account_id;
 overhead:=round(kind.daily_overhead*(1.25-(region.energy+region.roads)/400),2);
 if cash<overhead then units:=0;overhead:=0;result_status:='cash_shortage';
 elsif overhead>0 then
  update public.accounts set balance=balance-overhead,updated_at=now() where id=b.bank_account_id;
  update public.accounts set balance=balance+overhead,updated_at=now() where id=population_account;
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,population_account,overhead,'company_operating_cost','Serviços operacionais: '||b.name,jsonb_build_object('business_id',b.id,'operation_date',p_day,'regional_energy',region.energy,'regional_roads',region.roads),md5('company-overhead:'||b.id||':'||p_day)::uuid);
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-overhead,'Infraestrutura e manutenção diária',jsonb_build_object('kind','overhead'),'overhead:'||p_day,p_day);
 end if;
 if units>0 then
  for item in select key,value::numeric required from jsonb_each_text(recipe.inputs) loop
   select i.unit_cost into unit_cost from public.business_inventory i where i.business_id=b.id and i.resource_code=item.key;
   cost:=cost+units*item.required*unit_cost;
   update public.business_inventory set quantity=greatest(0,quantity-units*item.required),updated_at=now() where business_id=b.id and resource_code=item.key;
  end loop;
  produced:=round(units*recipe.output_quantity,3);
  select base_price into resource_price from public.economic_resources where code=recipe.output_resource;
  insert into public.business_inventory(business_id,resource_code,quantity,unit_cost,selling_price,available_for_sale) values(b.id,recipe.output_resource,produced,round((cost+wages+overhead)/produced,4),round(resource_price*b.price_multiplier,2),true)
  on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+cost+wages+overhead)/(public.business_inventory.quantity+produced),quantity=public.business_inventory.quantity+produced,selling_price=case when public.business_inventory.price_policy='automatic' then excluded.selling_price else coalesce(public.business_inventory.selling_price,excluded.selling_price) end,updated_at=now();
  if cost>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(b.id,'expense',-round(cost,2),'Insumos consumidos na produção',jsonb_build_object('kind','input_consumption','recipe_id',recipe.id),'inputs:'||p_day,p_day);end if;
 end if;
 insert into public.business_daily_operations(business_id,operation_date,produced_quantity,payroll_accrued,input_cost,overhead,productivity,status,metadata) values(b.id,p_day,produced,wages,round(cost,2),overhead,work_efficiency*100,result_status,jsonb_build_object('region_code',region.code,'headcount',headcount,'recipe_id',recipe.id,'effort_boost',coalesce(boost,0)));
 update public.businesses set employees=headcount,operational_status=case when loss_cycles>=3 and result_status='operating' then 'insolvent' else result_status end,productivity_index=least(300,work_efficiency*100),last_simulated_on=p_day,updated_at=now() where id=b.id;
end $function$;

CREATE OR REPLACE FUNCTION private.run_company_economy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b record; company_row public.businesses%rowtype; start_day date; day date; result jsonb; cycles integer:=0; processed integer:=0; sold numeric:=0; period_start date:=date_trunc('week',now())::date-7;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 -- A common lock order keeps payroll, capital and B2B settlement atomic with the hourly engine.
 perform id from public.businesses order by id for update;
 perform id from public.accounts order by id for update;
 select greatest(current_date-6,coalesce(min(coalesce(last_simulated_on+1,created_at::date)),current_date)) into start_day from public.businesses where status='active' and region_code is not null;
 for day in select generate_series(start_day,current_date,interval '1 day')::date loop
  for b in select id from public.businesses where status='active' and region_code is not null and created_at::date<=day and (last_simulated_on is null or last_simulated_on<day) order by id loop
   perform private.simulate_company_day(b.id,day);processed:=processed+1;
  end loop;
  perform private.sync_population_marketplace();
  sold:=sold+private.simulate_population_demand(day);
 end loop;
 for company_row in select * from public.businesses where status in('active','suspended') order by id loop
  if company_row.last_fiscal_cycle_at+interval '7 days'<=now() then
   perform private.pay_company_wages(company_row.id);
   while company_row.last_fiscal_cycle_at+interval '7 days'<=now() loop
    result:=private.close_company_fiscal_cycle(company_row.id,now());
    exit when result is null;
    cycles:=cycles+1;
    select * into company_row from public.businesses where id=company_row.id;
   end loop;
  end if;
 end loop;
 update public.business_supply_contracts set status='expired' where status='active' and ends_at<=now();
 insert into public.business_national_cycles(cycle_start,cycle_end,revenue,profit,employment,output,company_count,by_region)
 select period_start,period_start+7,coalesce(sum(d.revenue),0),coalesce(sum(d.revenue-d.payroll_accrued-d.input_cost-d.overhead),0),(select count(*) from public.business_employees where fired_at is null),coalesce(sum(d.produced_quantity),0),(select count(*) from public.businesses where status='active'),coalesce((select jsonb_object_agg(region_code,stats) from(select biz.region_code,jsonb_build_object('revenue',sum(x.revenue),'output',sum(x.produced_quantity),'companies',count(distinct biz.id)) stats from public.business_daily_operations x join public.businesses biz on biz.id=x.business_id where x.operation_date>=period_start and x.operation_date<period_start+7 and biz.region_code is not null group by biz.region_code) regions),'{}'::jsonb) from public.business_daily_operations d where d.operation_date>=period_start and d.operation_date<period_start+7
 on conflict(cycle_start) do nothing;
 perform private.close_state_enterprise_cycles();
 return jsonb_build_object('success',true,'processed_company_days',processed,'closed_cycles',cycles,'population_spending',sold,'processed_at',now());
end $function$;

CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,coalesce(product.metadata,'{}')||jsonb_build_object('stock_depleted_at',product.stock_depleted_at,'quote',levy.value,'consumable_effects',product.consumable_effects,'resource_code',product.resource_code),product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',coalesce(seller.full_name,business.name),'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_control_kind',business.control_kind,'business_status',business.status,'business_logo_url',business.logo_url,'business_font_key',business.font_key,'business_brand_color',business.brand_color,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  left join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category,NULL,coalesce(business.region_code,seller.residence_state_code)) AS value) levy
  where seller.deleted_at is null and product.archived_at is null and product.moderation_status='approved' and exists(select 1 from public.state_enterprises ms where ms.service_key='marketplace' and ms.is_active and (not (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_enabled or (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_amount=0 or (product.listing_status='active' and (product.listing_paid_until is null or product.listing_paid_until>statement_timestamp()))))
    and ((seller.onboarding_completed or seller.onboarding_mode='legacy_migration') OR (product.seller_id IS NULL AND business.control_kind='population' AND business.owner_id IS NULL))
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$;
CREATE OR REPLACE FUNCTION public.get_state_company_sale_details(p_enterprise_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.state_enterprises%rowtype;r jsonb;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar a empresa.' USING errcode='42501';END IF;
 SELECT * INTO e FROM public.state_enterprises WHERE id=p_enterprise_id;
 IF e.id IS NULL OR (e.privatization_status IS DISTINCT FROM 'for_sale' AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'A empresa pública não está disponível para venda.' USING errcode='42501';END IF;
 IF e.operating_business_id IS NOT NULL THEN r:=public.get_company_sale_details(e.operating_business_id);ELSE
  SELECT jsonb_build_object('financials',jsonb_build_object('revenue',sum(gross_revenue),'expenses',sum(operating_cost),'profit',sum(net_result),'entries',count(*),'first_recorded_at',min(cycle_start_at)),'cycles',coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.cycle_start_at DESC),'[]'),'cash',NULL,'staff','[]'::jsonb,'inventory','[]'::jsonb,'operations','[]'::jsonb) INTO r FROM public.business_balance_cycles c WHERE c.state_enterprise_id=e.id;
 END IF;
 RETURN r||jsonb_build_object('enterprise',jsonb_build_object('id',e.id,'name',e.name,'description',e.description,'sector',e.sector,'is_public',NOT e.is_privatized,'price',e.privatization_price),'owner',jsonb_build_object('name','Governo Federal','public',true));
END $$;
REVOKE ALL ON FUNCTION public.get_state_company_sale_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_state_company_sale_details(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.consume_company_product(p_business_id uuid,p_inventory_id uuid,p_quantity int,p_reason text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.user_inventory%rowtype;op private.company_operations%rowtype;payload jsonb:=jsonb_build_object('business_id',p_business_id,'inventory_id',p_inventory_id,'quantity',p_quantity,'reason',btrim(p_reason));cost numeric;r jsonb;BEGIN
 IF auth.uid() IS NULL OR NOT private.can_manage_company(p_business_id) THEN RAISE EXCEPTION 'Somente a gestão autorizada pode registrar uso do estoque.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_idempotency_key IS NULL OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 1000 OR length(btrim(coalesce(p_reason,'')))<5 OR length(p_reason)>500 THEN RAISE EXCEPTION 'Informe quantidade positiva e justificativa entre 5 e 500 caracteres.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO op FROM private.company_operations WHERE idempotency_key=p_idempotency_key;
 IF op.idempotency_key IS NOT NULL THEN
  IF op.actor_id<>auth.uid() OR op.operation<>'inventory_use' OR op.payload<>payload THEN RAISE EXCEPTION 'Esta confirmação pertence a outra operação.';END IF;RETURN op.result;
 END IF;
 PERFORM id FROM public.businesses WHERE id=p_business_id FOR UPDATE;
 SELECT * INTO i FROM public.user_inventory WHERE id=p_inventory_id AND business_id=p_business_id FOR UPDATE;
 IF i.id IS NULL OR i.quantity<p_quantity THEN RAISE EXCEPTION 'O estoque não cobre a quantidade informada.';END IF;
 IF i.metadata->>'unit_cost_snapshot' IS NULL THEN RAISE EXCEPTION 'Este item não possui custo histórico registrado para apropriação.';END IF;
 cost:=round((i.metadata->>'unit_cost_snapshot')::numeric*p_quantity,2);
 UPDATE public.user_inventory SET quantity=quantity-p_quantity WHERE id=i.id;
 IF i.quantity=p_quantity THEN UPDATE public.product_ownership_history SET end_date=clock_timestamp() WHERE inventory_item_id=i.id AND end_date IS NULL;END IF;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key) VALUES(p_business_id,'expense',-cost,'Uso empresarial: '||coalesce(i.metadata->>'item_name','Produto adquirido'),jsonb_build_object('kind','inventory_consumption','inventory_id',i.id,'quantity',p_quantity,'unit_cost_snapshot',i.metadata->'unit_cost_snapshot','reason',btrim(p_reason),'actor_id',auth.uid()),'inventory-use:'||p_idempotency_key);
 r:=jsonb_build_object('success',true,'quantity',i.quantity-p_quantity,'cost',cost);
 INSERT INTO private.company_operations VALUES(p_idempotency_key,auth.uid(),'inventory_use',payload,r,clock_timestamp());
 PERFORM economy_private.audit('company_inventory_consumed','user_inventory',i.id::text,to_jsonb(i),r,p_reason,auth.uid());
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.consume_company_product(uuid,uuid,int,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consume_company_product(uuid,uuid,int,text,uuid) TO authenticated;
COMMIT;
