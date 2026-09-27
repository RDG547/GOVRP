BEGIN;
ALTER TABLE public.state_enterprises
 ADD COLUMN fixed_sale_fee numeric NOT NULL DEFAULT 0 CHECK(fixed_sale_fee>=0 AND fixed_sale_fee<=1000000),
 ADD COLUMN active_listing_fee_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN active_listing_fee_amount numeric NOT NULL DEFAULT 0 CHECK(active_listing_fee_amount>=0 AND active_listing_fee_amount<=1000000),
 ADD COLUMN active_listing_fee_period integer NOT NULL DEFAULT 7 CHECK(active_listing_fee_period BETWEEN 1 AND 365);
-- Preserve old fixed commissions as the fixed-sale part of the same configuration.
UPDATE public.state_enterprises SET fixed_sale_fee=commission_value,commission_value=0,commission_type='percentage' WHERE service_key='marketplace' AND commission_type='fixed';
ALTER TABLE public.products
 ADD COLUMN listing_paid_until timestamptz,
 ADD COLUMN listing_status text NOT NULL DEFAULT 'active' CHECK(listing_status IN ('active','awaiting_renewal')),
 ADD COLUMN listing_fee_snapshot jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN publication_request_key uuid UNIQUE,
 ADD COLUMN publication_request_hash text;
CREATE INDEX products_listing_expiry_idx ON public.products(listing_paid_until) WHERE listing_status='active' AND state_enterprise_id IS NULL;

CREATE OR REPLACE FUNCTION public.configure_marketplace_fees(p_percentage numeric,p_fixed_fee numeric,p_publication_mode text,p_manager_id uuid,p_listing_enabled boolean,p_listing_amount numeric,p_period_days integer)
RETURNS public.state_enterprises LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.state_enterprises%rowtype; result public.state_enterprises%rowtype;
BEGIN
 IF NOT coalesce(public.can_manage_marketplace(),false) THEN RAISE EXCEPTION 'Você não tem permissão para gerir este marketplace.' USING errcode='42501';END IF;
 IF p_fixed_fee IS NULL OR p_fixed_fee<0 OR p_fixed_fee>1000000 OR p_listing_amount IS NULL OR p_listing_amount<0 OR p_listing_amount>1000000 OR p_period_days IS NULL OR p_period_days NOT BETWEEN 1 AND 365 OR p_listing_enabled IS NULL THEN RAISE EXCEPTION 'Confira os valores das taxas e o período de 1 a 365 dias reais.'; END IF;
 SELECT * INTO previous FROM public.state_enterprises WHERE service_key='marketplace' FOR UPDATE;
 PERFORM public.configure_marketplace('percentage',p_percentage,p_publication_mode,p_manager_id);
 UPDATE public.state_enterprises SET fixed_sale_fee=round(p_fixed_fee,2),active_listing_fee_enabled=p_listing_enabled,
  active_listing_fee_amount=round(p_listing_amount,2),active_listing_fee_period=p_period_days,updated_at=clock_timestamp()
  WHERE id=previous.id RETURNING * INTO result;
 IF p_listing_enabled AND p_listing_amount>0 AND (NOT previous.active_listing_fee_enabled OR previous.active_listing_fee_amount=0) THEN
  -- Existing advertisements get a full free adaptation period. No automatic debit.
  UPDATE public.products SET listing_paid_until=clock_timestamp()+make_interval(days=>p_period_days),listing_status='active',
   listing_fee_snapshot=jsonb_build_object('amount',0,'period_days',p_period_days,'grace_period',true,'policy_amount',p_listing_amount)
   WHERE state_enterprise_id IS NULL AND archived_at IS NULL AND listing_paid_until IS NULL;
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  SELECT DISTINCT seller_id,'marketplace_listing_policy','A taxa de anúncio ativo foi habilitada. Seus anúncios existentes têm um período gratuito de adaptação; a renovação será manual.',
   '/dashboard/citizen?tab=business',jsonb_build_object('amount',p_listing_amount,'period_days',p_period_days)
   FROM public.products WHERE state_enterprise_id IS NULL AND archived_at IS NULL;
 ELSIF NOT p_listing_enabled OR p_listing_amount=0 THEN
  UPDATE public.products SET listing_status='active' WHERE state_enterprise_id IS NULL AND listing_status='awaiting_renewal';
 END IF;
 PERFORM public.justice_write_audit('marketplace.fees','state_enterprise',result.id,to_jsonb(previous),to_jsonb(result),'Taxas de venda e anúncio configuradas.');
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.configure_marketplace_fees(numeric,numeric,text,uuid,boolean,numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_marketplace_fees(numeric,numeric,text,uuid,boolean,numeric,integer) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_listing_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE fee_active boolean;
BEGIN
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF tg_op='INSERT' OR new.listing_paid_until IS DISTINCT FROM old.listing_paid_until OR new.listing_fee_snapshot IS DISTINCT FROM old.listing_fee_snapshot
   OR new.listing_status IS DISTINCT FROM old.listing_status OR new.publication_request_key IS DISTINCT FROM old.publication_request_key
   OR new.publication_request_hash IS DISTINCT FROM old.publication_request_hash OR new.state_enterprise_id IS DISTINCT FROM old.state_enterprise_id THEN
   RAISE EXCEPTION 'Use a confirmação autorizada para publicar ou renovar o anúncio.' USING errcode='42501';
  END IF;
 END IF;
 IF tg_op='INSERT' AND new.state_enterprise_id IS NULL THEN
  SELECT active_listing_fee_enabled AND active_listing_fee_amount>0 INTO fee_active FROM public.state_enterprises WHERE service_key='marketplace';
  IF fee_active THEN new.listing_status:='awaiting_renewal'; END IF;
 END IF;
 RETURN new;
END; $$;
REVOKE ALL ON FUNCTION private.guard_listing_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_listing_fields BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION private.guard_listing_fields();

CREATE OR REPLACE FUNCTION private.activate_marketplace_listing(p_product_id uuid,p_confirmed_fee numeric,p_period_days integer,p_idempotency_key uuid) RETURNS public.products
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE product public.products%rowtype; market public.state_enterprises%rowtype; payer uuid; recipient uuid; recipient_owner uuid; fee numeric; balance numeric; snapshot jsonb; tx public.transactions%rowtype; until_time timestamptz;
BEGIN
 IF auth.uid() IS NULL OR p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Entre na sua conta e confirme o anúncio.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 SELECT * INTO market FROM public.state_enterprises WHERE service_key='marketplace' FOR SHARE;
 IF market.id IS NULL OR NOT market.is_active THEN RAISE EXCEPTION 'O marketplace está temporariamente indisponível.'; END IF;
 SELECT * INTO product FROM public.products WHERE id=p_product_id FOR UPDATE;
 IF product.id IS NULL OR product.seller_id IS DISTINCT FROM auth.uid() OR product.state_enterprise_id IS NOT NULL THEN RAISE EXCEPTION 'Este anúncio não pertence a você.' USING errcode='42501'; END IF;
 SELECT * INTO tx FROM public.transactions WHERE idempotency_key=p_idempotency_key;
 IF tx.id IS NOT NULL THEN
  IF tx.type<>'marketplace_listing_fee' OR tx.metadata->>'product_id'<>p_product_id::text OR tx.metadata->>'seller_id'<>auth.uid()::text THEN RAISE EXCEPTION 'Esta confirmação pertence a outra operação.'; END IF;
  RETURN product;
 END IF;
 IF product.archived_at IS NOT NULL OR product.moderation_status IN ('removed','suspended') THEN RAISE EXCEPTION 'Um anúncio removido ou suspenso não pode ser renovado.'; END IF;
 IF product.listing_paid_until>clock_timestamp() AND product.listing_status='active' THEN RETURN product; END IF;
 fee:=CASE WHEN market.active_listing_fee_enabled THEN market.active_listing_fee_amount ELSE 0 END;
 IF p_confirmed_fee IS DISTINCT FROM fee OR p_period_days IS DISTINCT FROM market.active_listing_fee_period THEN RAISE EXCEPTION 'Os custos do anúncio mudaram. Confira os valores e confirme novamente.';END IF;
 IF product.business_id IS NULL THEN SELECT id INTO payer FROM public.accounts WHERE user_id=auth.uid();
 ELSE SELECT bank_account_id INTO payer FROM public.businesses WHERE id=product.business_id AND owner_id=auth.uid() AND status IN ('active','pending');END IF;
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
 snapshot:=jsonb_build_object('amount',fee,'period_days',market.active_listing_fee_period,'paid_at',clock_timestamp(),'valid_until',until_time,'enterprise_id',market.id,'private',market.is_privatized,'recipient_account_id',recipient);
 IF fee>0 THEN
  UPDATE public.accounts SET balance=public.accounts.balance-fee,updated_at=clock_timestamp() WHERE id=payer;
  IF market.is_privatized THEN UPDATE public.accounts SET balance=public.accounts.balance+fee,updated_at=clock_timestamp() WHERE id=recipient;
  ELSE
   INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
   UPDATE public.government_finances SET treasury_balance=treasury_balance+fee,updated_at=clock_timestamp() WHERE id=1;
  END IF;
  INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(payer,recipient,fee,'marketplace_listing_fee','Ativação de anúncio: '||product.name,
   jsonb_build_object('product_id',product.id,'seller_id',product.seller_id,'business_id',product.business_id,'gross_amount',fee,'total_debited',fee,'net_amount',fee,'tax_amount',0,'listing_fee_snapshot',snapshot),p_idempotency_key) RETURNING * INTO tx;
  IF product.business_id IS NOT NULL THEN INSERT INTO public.business_transactions(business_id,type,amount,description) VALUES(product.business_id,'expense',-fee,'Anúncio ativo no Negócios Livre: '||product.name);END IF;
  IF NOT market.is_privatized THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
   VALUES('fee','transactions',tx.id::text,auth.uid(),fee,public.rp_now(),jsonb_build_object('kind','marketplace_listing_fee','snapshot',snapshot));END IF;
 END IF;
 UPDATE public.products SET listing_paid_until=until_time,listing_status='active',listing_fee_snapshot=snapshot WHERE id=product.id RETURNING * INTO product;
 PERFORM public.justice_write_audit('marketplace.listing_activated','product',product.id,NULL,snapshot,'Ativação confirmada pelo vendedor.');
 RETURN product;
END; $$;
REVOKE ALL ON FUNCTION private.activate_marketplace_listing(uuid,numeric,integer,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.renew_marketplace_listing(p_product_id uuid,p_confirmed_fee numeric,p_period_days integer,p_idempotency_key uuid) RETURNS public.products
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.assert_citizen_service('/services/business');
 RETURN private.activate_marketplace_listing(p_product_id,p_confirmed_fee,p_period_days,p_idempotency_key);
END; $$;
REVOKE ALL ON FUNCTION public.renew_marketplace_listing(uuid,numeric,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renew_marketplace_listing(uuid,numeric,integer,uuid) TO authenticated;

ALTER FUNCTION public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz,jsonb) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.publish_business_product(p_product jsonb,p_confirmed_fee numeric,p_period_days integer,p_idempotency_key uuid) RETURNS public.products
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
   IF result.seller_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Esta confirmação pertence a outra conta.';END IF;
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
END; $$;
REVOKE ALL ON FUNCTION public.publish_business_product(jsonb,numeric,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_business_product(jsonb,numeric,integer,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.expire_marketplace_listings() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p record; active_fee boolean;
BEGIN
 SELECT active_listing_fee_enabled AND active_listing_fee_amount>0 INTO active_fee FROM public.state_enterprises WHERE service_key='marketplace' FOR SHARE;
 IF NOT coalesce(active_fee,false) THEN RETURN;END IF;
 FOR p IN UPDATE public.products SET listing_status='awaiting_renewal' WHERE state_enterprise_id IS NULL AND listing_status='active'
  AND listing_paid_until<=clock_timestamp() AND archived_at IS NULL RETURNING id,seller_id,name,listing_paid_until LOOP
  INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(p.seller_id,'marketplace_listing_expired',
   'O anúncio '||p.name||' aguarda renovação. Nenhum valor foi debitado automaticamente.','/dashboard/citizen?tab=business',jsonb_build_object('product_id',p.id,'expired_at',p.listing_paid_until));
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION private.expire_marketplace_listings() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('govrp-marketplace-listing-expiry','* * * * *','select private.expire_marketplace_listings()');

CREATE OR REPLACE FUNCTION public.save_business_product(p_product_id uuid, p_business_id uuid, p_name text, p_description text, p_price numeric, p_image_url text, p_product_type text, p_subscription_interval text, p_category text, p_stock integer, p_promotion_price numeric, p_promotion_expires_at timestamp with time zone, p_consumable_effects jsonb)
 RETURNS products
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if p_product_id is null and exists(select 1 from public.state_enterprises where service_key='marketplace' and active_listing_fee_enabled and active_listing_fee_amount>0) then
  raise exception 'Confira os custos do anúncio e confirme a publicação antes de continuar.';
 end if;
 return private.save_business_product(p_product_id,p_business_id,p_name,p_description,p_price,p_image_url,p_product_type,p_subscription_interval,p_category,p_stock,p_promotion_price,p_promotion_expires_at,p_consumable_effects);
end; $function$;
REVOKE ALL ON FUNCTION public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_business_product(uuid,uuid,text,text,numeric,text,text,text,text,integer,numeric,timestamptz,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.protect_marketplace_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if current_user not in ('postgres','supabase_admin','service_role') and (new.fixed_sale_fee is distinct from old.fixed_sale_fee or new.active_listing_fee_enabled is distinct from old.active_listing_fee_enabled or new.active_listing_fee_amount is distinct from old.active_listing_fee_amount or new.active_listing_fee_period is distinct from old.active_listing_fee_period or new.commission_type is distinct from old.commission_type or new.commission_value is distinct from old.commission_value or new.publication_mode is distinct from old.publication_mode or new.manager_id is distinct from old.manager_id or new.operating_business_id is distinct from old.operating_business_id or new.service_key is distinct from old.service_key or new.is_privatized is distinct from old.is_privatized or new.privatization_buyer_id is distinct from old.privatization_buyer_id) then raise exception 'Use a ação autorizada de configuração do marketplace.'; end if;
 return new;
end; $function$
;

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
  perform 1 from public.state_enterprises where service_key='marketplace' for share;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  perform private.assert_citizen_service('/services/business');
  if v_product.moderation_status<>'approved' or v_product.archived_at is not null then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select * into v_market from public.state_enterprises where service_key='marketplace' for share;
  if not found or not v_market.is_active then raise exception 'MARKETPLACE_UNAVAILABLE'; end if;
  if v_market.active_listing_fee_enabled and v_market.active_listing_fee_amount>0 and (v_product.listing_status='awaiting_renewal' or v_product.listing_paid_until<=clock_timestamp()) then raise exception 'LISTING_RENEWAL_REQUIRED';end if;
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
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end+v_market.fixed_sale_fee,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'fixed_sale_fee',v_market.fixed_sale_fee,'percentage_amount',case when v_market.commission_type='percentage' then round(v_base*v_market.commission_value/100,2) else 0 end,'base_amount',v_base,'amount',v_commission,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
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
  values(v_product.seller_id,v_buyer,'product_sold',coalesce(v_buyer_name,'Um cidadão')||' comprou: '||v_product.name,'/dashboard/citizen?tab=business');
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
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'business_logo_url',business.logo_url,'business_font_key',business.font_key,'business_brand_color',business.brand_color,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category) AS value) levy
  where seller.deleted_at is null and product.archived_at is null and product.moderation_status='approved' and exists(select 1 from public.state_enterprises ms where ms.service_key='marketplace' and ms.is_active and (not ms.active_listing_fee_enabled or ms.active_listing_fee_amount=0 or (product.listing_status='active' and (product.listing_paid_until is null or product.listing_paid_until>statement_timestamp()))))
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
