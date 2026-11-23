BEGIN;
CREATE OR REPLACE FUNCTION private.buy_national_production(p_business uuid, p_resource text, p_key uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE b public.businesses%rowtype;i public.business_inventory%rowtype;r public.national_market_references%rowtype;a public.accounts%rowtype;existing public.national_market_purchases%rowtype;service boolean;population numeric;held numeric;demand numeric;qty numeric;amount numeric;q jsonb;gross numeric;net numeric;tx uuid;attempt integer;contract_reserved numeric;marketplace_reserved numeric;available_qty numeric;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'Identificação de operação obrigatória.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO existing FROM public.national_market_purchases WHERE idempotency_key=p_key;
 IF existing.id IS NOT NULL THEN
  IF existing.business_id<>p_business OR existing.resource_code<>p_resource OR existing.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Identificação pertence a outra compra.';END IF;
  RETURN to_jsonb(existing);
 END IF;
 SELECT * INTO b FROM public.businesses WHERE id=p_business AND status='active' FOR UPDATE;
 SELECT * INTO r FROM public.national_market_references WHERE resource_code=p_resource FOR SHARE;
 SELECT is_service INTO service FROM public.economic_resources WHERE code=p_resource;
 SELECT * INTO i FROM public.business_inventory WHERE business_id=p_business AND resource_code=p_resource FOR UPDATE;
 IF b.id IS NULL OR r.resource_code IS NULL OR i.quantity IS NULL OR i.quantity<=0 OR NOT i.available_for_sale THEN RETURN jsonb_build_object('quantity',0,'reason','Sem produção disponível para venda.');END IF;
 -- Acquire the same account locks as all existing company settlements.
 PERFORM id FROM public.accounts WHERE id=b.bank_account_id OR (account_kind='national_market' AND state_enterprise_id IN(SELECT id FROM public.state_enterprises WHERE service_key='national_market' AND is_active)) ORDER BY id FOR UPDATE;
 SELECT a0.* INTO a FROM public.accounts a0 JOIN public.state_enterprises s ON s.id=a0.state_enterprise_id WHERE s.service_key='national_market' AND s.is_active AND a0.account_kind='national_market';
 IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=b.bank_account_id AND business_id=b.id) THEN RAISE EXCEPTION 'Conta oficial do comprador ou da empresa indisponível.';END IF;
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 IF service THEN SELECT coalesce(sum(service_remaining),0) INTO held FROM public.national_market_purchases WHERE resource_code=p_resource AND service_remaining>0;
 ELSE SELECT coalesce(sum(quantity),0) INTO held FROM public.national_market_stock WHERE resource_code=p_resource;END IF;
 demand:=greatest(0,population*r.per_capita_daily*(CASE WHEN service THEN 1 ELSE r.reserve_days END)-held);
 -- Protect existing supply contracts and live marketplace listings before any government purchase.
 SELECT coalesce(sum(c.daily_quantity),0) INTO contract_reserved
 FROM public.business_supply_contracts c
 WHERE c.seller_business_id=p_business AND c.resource_code=p_resource
   AND c.status='active' AND c.ends_at>clock_timestamp();
 SELECT coalesce(sum(p.stock),0) INTO marketplace_reserved
 FROM public.products p
 WHERE p.business_id=p_business AND p.resource_code=p_resource
   AND p.moderation_status='approved' AND p.archived_at IS NULL AND p.stock>0;
 available_qty:=private.unreserved_company_stock(p_business,p_resource,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date);
 -- The unattended daily buyer can acquire at most 25% of the current inventory.
 -- A deliberate seller action can sell the remaining unreserved inventory.
 IF p_actor IS NULL THEN available_qty:=least(available_qty,trunc(i.quantity*.25,3));END IF;
 qty:=least(available_qty,trunc(demand,3),trunc(a.balance/r.unit_price,3),1000000);
 IF qty<=0 THEN RETURN jsonb_build_object('quantity',0,'reason','Orçamento ou demanda de abastecimento indisponível.');END IF;
 -- Quotes are computed by the current legal engine. Downsize partial orders
 -- to the actual gross debit, including current taxes and fixed levies.
 FOR attempt IN 1..4 LOOP
  amount:=round(qty*r.unit_price,2);
  IF amount<=0 THEN RETURN jsonb_build_object('quantity',0,'reason','Quantidade inferior à unidade monetária.');END IF;
  q:=public.quote_legal_levies('purchase',amount,true,b.economic_sector_id,'Insumos',NULL,b.region_code);
  IF coalesce((q->>'restricted')::boolean,false) THEN RETURN jsonb_build_object('quantity',0,'reason','Operação restrita por norma vigente.');END IF;
  gross:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
  EXIT WHEN gross<=a.balance;
  qty:=greatest(0,trunc(qty*a.balance/greatest(gross,.01)-.001,3));
 END LOOP;
 IF qty<=0 OR gross>a.balance OR gross IS NULL OR net IS NULL OR net<0 THEN RETURN jsonb_build_object('quantity',0,'reason','Orçamento insuficiente para tributos e produção.');END IF;
 UPDATE public.accounts SET balance=balance-gross,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.accounts SET balance=balance+net,updated_at=clock_timestamp() WHERE id=b.bank_account_id;
 IF gross>net THEN UPDATE public.government_finances SET treasury_balance=treasury_balance+gross-net,updated_at=clock_timestamp() WHERE id=1;IF NOT FOUND THEN RAISE EXCEPTION 'Tesouro indisponível para recolhimento.';END IF;END IF;
 UPDATE public.business_inventory SET quantity=quantity-qty,updated_at=clock_timestamp() WHERE business_id=b.id AND resource_code=p_resource;
 IF NOT service THEN
  INSERT INTO public.national_market_stock(resource_code,quantity,unit_cost) VALUES(p_resource,qty,gross/qty)
  ON CONFLICT(resource_code) DO UPDATE SET unit_cost=(public.national_market_stock.quantity*public.national_market_stock.unit_cost+gross)/(public.national_market_stock.quantity+qty),quantity=public.national_market_stock.quantity+qty,updated_at=clock_timestamp();
 END IF;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(a.id,b.bank_account_id,amount,'business_supply','Venda ao Mercado Nacional: '||p_resource,q||jsonb_build_object('business_id',b.id,'seller_business_id',b.id,'buyer_kind','government','resource_code',p_resource,'quantity',qty,'reference_price',r.unit_price,'final_consumption',false,'national_market',true),p_key) RETURNING id INTO tx;
 INSERT INTO public.national_market_purchases(business_id,resource_code,quantity,unit_price,gross_amount,net_amount,is_service,service_remaining,transaction_id,idempotency_key,actor_id)
 VALUES(b.id,p_resource,qty,r.unit_price,gross,net,service,CASE WHEN service THEN qty ELSE 0 END,tx,p_key,p_actor) RETURNING * INTO existing;
 INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key)
 VALUES(b.id,'revenue',amount,'Venda ao Mercado Nacional',jsonb_build_object('kind','national_market_sale','quantity',qty,'resource_code',p_resource,'unit_price',r.unit_price,'transaction_id',tx),'national-sale:'||p_key);
 IF amount>net THEN INSERT INTO public.business_transactions(business_id,type,amount,description,metadata,operation_key) VALUES(b.id,'tax',net-amount,'Tributos da venda ao Mercado Nacional',q,'national-tax:'||p_key);END IF;
 IF gross>net THEN INSERT INTO public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) VALUES('consumption_tax','transactions',tx::text,b.id,gross-net,public.rp_now(),q);END IF;
 UPDATE public.business_daily_operations SET sold_quantity=sold_quantity+qty,revenue=revenue+amount WHERE business_id=b.id AND operation_date=current_date;
 RETURN to_jsonb(existing);
END $function$;
CREATE OR REPLACE FUNCTION private.consume_national_market(p_day date, p_budget numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE row record;contract record;population numeric;demand numeric;held numeric;qty numeric;remaining numeric;amount numeric;spent numeric:=0;market uuid;buyer public.accounts%rowtype;q jsonb;total_debit numeric;net_credit numeric;taxes numeric;v_tx uuid; attempt integer; spending_limit numeric;
BEGIN
 IF p_budget IS NULL OR p_budget<=0 THEN RETURN 0;END IF;
 IF p_budget::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Orçamento inválido.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 PERFORM id FROM public.accounts WHERE account_kind IN ('national_market','population') ORDER BY id FOR UPDATE;
 SELECT id INTO market FROM public.accounts WHERE account_kind='national_market';
 SELECT * INTO buyer FROM public.accounts WHERE account_kind='population' FOR UPDATE;
 IF market IS NULL OR buyer.id IS NULL THEN RETURN 0;END IF;
 SELECT coalesce(sum(population_count),0) INTO population FROM public.country_population_segments WHERE country_code='BR';
 FOR row IN SELECT r.*,e.is_service FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code ORDER BY r.resource_code LOOP
  IF EXISTS(SELECT 1 FROM public.national_market_consumption WHERE operation_date=p_day AND resource_code=row.resource_code) THEN CONTINUE;END IF;
  IF row.is_service THEN SELECT coalesce(sum(service_remaining),0) INTO held FROM public.national_market_purchases WHERE resource_code=row.resource_code AND service_remaining>0;
  ELSE SELECT coalesce(sum(quantity),0) INTO held FROM public.national_market_stock WHERE resource_code=row.resource_code;END IF;
  demand:=population*row.per_capita_daily;
  qty:=least(held,trunc(demand,3),trunc(greatest(0,least(p_budget-spent,buyer.balance-spent))/row.unit_price,3));
  spending_limit:=greatest(0,least(p_budget-spent,buyer.balance-spent));
  FOR attempt IN 1..4 LOOP
  amount:=round(qty*row.unit_price,2);
  IF qty<=0 OR amount<=0 THEN EXIT;END IF;
  -- Tax and fees use the same live legislative rules as an ordinary checkout.
  q:=public.quote_legal_levies('purchase',amount,true,null,row.resource_code,null,null);
  IF coalesce((q->>'restricted')::boolean,false) THEN EXIT;END IF;
  total_debit:=(q->>'total_debited')::numeric;
  net_credit:=(q->>'net_amount')::numeric;
  EXIT WHEN total_debit<=spending_limit;
  qty:=greatest(0,trunc(qty*spending_limit/greatest(total_debit,.01)-.001,3));
  END LOOP;
  IF qty<=0 OR amount<=0 OR coalesce((q->>'restricted')::boolean,false) OR total_debit IS NULL OR net_credit IS NULL THEN CONTINUE;END IF;
  taxes:=round(greatest(0,total_debit-net_credit),2);
  IF total_debit<=0 OR net_credit<0 OR spent+total_debit>p_budget OR total_debit>buyer.balance-spent THEN CONTINUE;END IF;
  IF row.is_service THEN
   remaining:=qty;
   FOR contract IN SELECT * FROM public.national_market_purchases WHERE resource_code=row.resource_code AND service_remaining>0 ORDER BY created_at,id FOR UPDATE LOOP
    UPDATE public.national_market_purchases SET service_remaining=service_remaining-least(remaining,contract.service_remaining) WHERE id=contract.id;
    remaining:=remaining-least(remaining,contract.service_remaining);EXIT WHEN remaining<=0;
   END LOOP;
  ELSE UPDATE public.national_market_stock SET quantity=quantity-qty,updated_at=clock_timestamp() WHERE resource_code=row.resource_code;END IF;
  UPDATE public.accounts SET balance=balance-total_debit,updated_at=clock_timestamp() WHERE id=buyer.id;
  UPDATE public.accounts SET balance=balance+net_credit,updated_at=clock_timestamp() WHERE id=market;
  INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(buyer.id,market,amount,'population_purchase','Consumo do estoque nacional: '||row.resource_code,q||jsonb_build_object('resource_code',row.resource_code,'quantity',qty,'operation_date',p_day,'national_market',true,'final_consumption',true),md5('national-consumption:'||p_day||':'||row.resource_code)::uuid)
  RETURNING id INTO v_tx;
  INSERT INTO public.national_market_consumption VALUES(p_day,row.resource_code,qty,amount);
  IF taxes>0 THEN
    UPDATE public.government_finances
    SET treasury_balance=treasury_balance+taxes,updated_at=clock_timestamp()
    WHERE id=1;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tesouro indisponível para recolhimento.';END IF;
    INSERT INTO public.government_revenues(revenue_type,source_table,source_id,amount,occurred_at_rp,metadata)
    VALUES('consumption_tax','transactions',v_tx::text,taxes,public.rp_now(),
      q||jsonb_build_object('market_channel','national_market','simulated_households',true,'resource_code',row.resource_code));
  END IF;
  spent:=spent+total_debit;
 END LOOP;
 RETURN spent;
END $function$;
CREATE OR REPLACE FUNCTION private.sync_population_marketplace(p_business_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   IF private.unreserved_company_stock(offer.id,offer.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)<4 THEN CONTINUE;END IF;
   policy:=private.marketplace_seller_policy(market,offer.id,false);fee:=CASE WHEN policy.active_listing_fee_enabled THEN policy.active_listing_fee_amount ELSE 0 END;
   PERFORM set_config('govrp.physical_listing_authorized',offer.id::text,true);
   INSERT INTO public.products(seller_id,business_id,name,description,price,product_type,category,stock,resource_code,is_final_good,moderation_status,consumable_effects)
   VALUES(NULL,offer.id,offer.resource_name,'Oferta da empresa '||offer.name||', vinculada ao estoque produzido. Quantidade por unidade do recurso.',offer.selling_price,'one-time','Insumos',floor(private.unreserved_company_stock(offer.id,offer.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)*.25)::int,offer.resource_code,offer.is_service OR offer.resource_code IN('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles'),'approved','{}') RETURNING id INTO pid;
   PERFORM private.activate_marketplace_listing(pid,fee,policy.active_listing_fee_period,md5('npc-marketplace:'||offer.id||':'||offer.resource_code)::uuid);
   PERFORM set_config('govrp.physical_listing_authorized','',true);
  EXCEPTION WHEN OTHERS THEN RAISE LOG 'GOVRP NPC listing refused for company % resource % [%]: %',offer.id,offer.resource_code,sqlstate,sqlerrm;END;
 END LOOP;
END $function$;

COMMIT;
