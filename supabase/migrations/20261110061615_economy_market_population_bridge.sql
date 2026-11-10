BEGIN;
-- Incremental integration: no reset, artificial cash creation, or change to legal tax rates.
-- The legacy population account was originally seeded in 20260930110008 but
-- is absent after a subsequent world reset. Restore its identity with zero cash.
INSERT INTO public.accounts(account_kind,account_number,agency_number,user_id,balance)
SELECT 'population','POPULATION-ECONOMY','0003',NULL,0
WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE account_kind='population')
ON CONFLICT (account_number) DO NOTHING;

DO $check$ BEGIN
 IF (SELECT count(*) FROM public.accounts WHERE account_kind='population') <> 1
 THEN RAISE EXCEPTION 'A conta da população deve existir exatamente uma vez; verifique a integridade antes de prosseguir.';END IF;
END $check$;

-- Also restore the account after a future RP reset; funding intentionally starts at zero.
DO $seed$ DECLARE source text;anchor text:='PERFORM private.refresh_regional_infrastructure();';BEGIN
 source:=pg_get_functiondef('private.seed_reset_world(uuid)'::regprocedure);
 IF position(anchor in source)=0 THEN RAISE EXCEPTION 'A semente do RP mudou; revisão necessária.';END IF;
 IF position('POPULATION-ECONOMY' in source)=0 THEN
  source:=replace(source,anchor,$reset_inject$
  INSERT INTO public.accounts(account_kind,account_number,agency_number,user_id,balance)
  SELECT 'population','POPULATION-ECONOMY','0003',NULL,0
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE account_kind='population')
  ON CONFLICT (account_number) DO NOTHING;
  $reset_inject$||anchor);
  EXECUTE source;
 END IF;
END $seed$;

-- Strictly conserved transfers to/from the demographic consumer wallet. This
-- is a treasury transfer, never a synthetic debit/credit.
CREATE OR REPLACE FUNCTION public.fund_population_consumption(p_amount numeric,p_key uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fund$
DECLARE buyer public.accounts%rowtype; treasury numeric; old_tx public.transactions%rowtype;
BEGIN
 PERFORM private.require_competition_admin();
 IF p_key IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
    OR p_amount=0 OR abs(p_amount)>100000
    OR p_amount<>round(p_amount,2)
 THEN RAISE EXCEPTION 'Informe um aporte ou devolução válido de até R$ 100.000,00.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO old_tx FROM public.transactions WHERE idempotency_key=p_key;
 IF old_tx.id IS NOT NULL THEN
  IF old_tx.type<>'population_endowment'
    OR old_tx.metadata->>'actor_id' IS DISTINCT FROM auth.uid()::text
    OR (old_tx.metadata->>'signed_amount')::numeric IS DISTINCT FROM p_amount
  THEN RAISE EXCEPTION 'Identificação de operação já utilizada.';END IF;
  RETURN (SELECT balance FROM public.accounts WHERE account_kind='population');
 END IF;
 SELECT * INTO buyer FROM public.accounts WHERE account_kind='population' FOR UPDATE;
 SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1 FOR UPDATE;
 IF buyer.id IS NULL OR treasury IS NULL
    OR (p_amount>0 AND treasury<p_amount)
    OR (p_amount<0 AND buyer.balance<abs(p_amount))
 THEN RAISE EXCEPTION 'Conta ou saldo disponível insuficiente.';END IF;
 UPDATE public.accounts SET balance=balance+p_amount,updated_at=clock_timestamp() WHERE id=buyer.id;
 UPDATE public.government_finances SET treasury_balance=treasury_balance-p_amount,updated_at=clock_timestamp() WHERE id=1;
 INSERT INTO public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 VALUES(CASE WHEN p_amount<0 THEN buyer.id END,CASE WHEN p_amount>0 THEN buyer.id END,
 abs(p_amount),'population_endowment','Dotação para consumo demográfico',
 jsonb_build_object('actor_id',auth.uid(),'signed_amount',p_amount,'treasury_transfer',true,'population_consumption',true),p_key);
 PERFORM economy_private.audit('population_consumption_funding','accounts',buyer.id::text,
    jsonb_build_object('balance',buyer.balance),
    jsonb_build_object('balance',buyer.balance+p_amount),
    'Transferência contabilizada entre o Tesouro e a população.',auth.uid());
 RETURN buyer.balance+p_amount;
END $fund$;
REVOKE ALL ON FUNCTION public.fund_population_consumption(numeric,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fund_population_consumption(numeric,uuid) TO authenticated;

-- Read-only admin diagnostic shows the actual legal rates separately from
-- fiscal policy decisions. Never silently rewrite an existing RP decree.
CREATE OR REPLACE FUNCTION public.get_national_market_operations_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $status$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_full_admin_access()
 THEN RAISE EXCEPTION 'Consulta administrativa não autorizada.' USING errcode='42501';END IF;
 RETURN jsonb_build_object(
  'population_account_present',EXISTS(SELECT 1 FROM public.accounts WHERE account_kind='population'),
  'population_budget',coalesce((SELECT balance FROM public.accounts WHERE account_kind='population'),0),
  'consumption_last_run',(SELECT max(operation_date) FROM private.population_demand_runs),
  'consumption_last_spent',(SELECT spent FROM private.population_demand_runs ORDER BY operation_date DESC LIMIT 1),
  'law_consumption_tax',(SELECT round(numeric_value*100,4) FROM public.government_rules
    WHERE rule_key='consumption_tax_rate' AND is_active AND valid_from<=statement_timestamp()
      AND (valid_until IS NULL OR valid_until>statement_timestamp()) LIMIT 1),
  'law_corporate_tax',(SELECT round(numeric_value*100,4) FROM public.government_rules
    WHERE rule_key='corporate_tax_rate' AND is_active AND valid_from<=statement_timestamp()
      AND (valid_until IS NULL OR valid_until>statement_timestamp()) LIMIT 1),
  'policy_consumption_tax',(SELECT new_value FROM public.economic_policy_decisions
    WHERE policy_type='consumption_tax' AND status='effective' ORDER BY announced_at_real DESC LIMIT 1),
  'policy_corporate_tax',(SELECT new_value FROM public.economic_policy_decisions
    WHERE policy_type='corporate_tax' AND status='effective' ORDER BY announced_at_real DESC LIMIT 1)
 );
END $status$;
REVOKE ALL ON FUNCTION public.get_national_market_operations_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_national_market_operations_status() TO authenticated;

-- Keep the original single-transaction settlement, locks, audit and idempotency.
-- Amend only the computed purchasable quantity to protect prior commerce.
CREATE OR REPLACE FUNCTION private.buy_national_production(p_business uuid,p_resource text,p_key uuid,p_actor uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.businesses%rowtype;i public.business_inventory%rowtype;r public.national_market_references%rowtype;a public.accounts%rowtype;existing public.national_market_purchases%rowtype;service boolean;population numeric;held numeric;demand numeric;qty numeric;amount numeric;q jsonb;gross numeric;net numeric;tx uuid;attempt integer;contract_reserved numeric;marketplace_reserved numeric;available_qty numeric;
BEGIN
 IF p_key IS NULL THEN RAISE EXCEPTION 'Identificação de operação obrigatória.';END IF;
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
 available_qty:=greatest(0,i.quantity-least(i.quantity,contract_reserved+marketplace_reserved));
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
END $$;
REVOKE ALL ON FUNCTION private.buy_national_production(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
