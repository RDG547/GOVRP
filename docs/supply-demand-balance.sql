
-- Prospective supply and demand balance. No retroactive settlements or changes to tax or salary law.
CREATE OR REPLACE FUNCTION private.national_procurement_cap(p_cash numeric,p_spent numeric,p_daily_receipts numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $f$
 SELECT trunc(greatest(0,least(greatest(0,p_cash),
  least(.30*greatest(0,p_cash+p_spent),greatest(0,p_daily_receipts)+.10*greatest(0,p_cash+p_spent))-greatest(0,p_spent))),2)
$f$;
REVOKE ALL ON FUNCTION private.national_procurement_cap(numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.national_procurement_remaining()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 WITH day AS (SELECT (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date d),
 market AS (SELECT a.id,a.balance FROM public.accounts a JOIN public.state_enterprises s ON s.id=a.state_enterprise_id WHERE a.account_kind='national_market' AND s.service_key='national_market' AND s.is_active),
 spent AS (SELECT coalesce(sum(n.gross_amount),0) total FROM public.national_market_purchases n CROSS JOIN day WHERE n.created_at>=day.d::timestamp AT TIME ZONE 'America/Sao_Paulo' AND n.created_at<(day.d+1)::timestamp AT TIME ZONE 'America/Sao_Paulo'),
 receipts AS (SELECT coalesce(sum(coalesce((t.metadata->>'net_amount')::numeric,t.amount)),0)/7 daily FROM public.transactions t JOIN market m ON m.id=t.to_account_id CROSS JOIN day WHERE t.created_at>=(day.d-7)::timestamp AT TIME ZONE 'America/Sao_Paulo' AND t.created_at<day.d::timestamp AT TIME ZONE 'America/Sao_Paulo' AND t.type IN ('population_purchase','purchase','purchase_card','business_supply'))
 SELECT coalesce((SELECT private.national_procurement_cap(m.balance,s.total,r.daily) FROM market m CROSS JOIN spent s CROSS JOIN receipts r),0)
$f$;
REVOKE ALL ON FUNCTION private.national_procurement_remaining() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.national_replenishment_target(p_resource text,p_day date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 WITH market AS (SELECT id FROM public.accounts WHERE account_kind='national_market'),
 sales AS (SELECT coalesce(sum(CASE WHEN jsonb_typeof(t.metadata->'quantity')='number' THEN greatest(0,(t.metadata->>'quantity')::numeric) ELSE 0 END),0)/7 daily
 FROM public.transactions t JOIN market m ON m.id=t.to_account_id WHERE t.created_at>=(p_day-7)::timestamp AT TIME ZONE 'America/Sao_Paulo' AND t.created_at<p_day::timestamp AT TIME ZONE 'America/Sao_Paulo'
 AND t.type IN('population_purchase','purchase','purchase_card','business_supply') AND t.metadata->>'resource_code'=p_resource),
 demand AS (SELECT coalesce(sum(quantity),0) stock FROM public.national_market_stock WHERE resource_code=p_resource)
 SELECT coalesce((SELECT greatest(CASE WHEN private.household_category(e.code,e.is_service) IN('food','health','education','energy') THEN 2 ELSE 1 END,
  sales.daily*CASE WHEN e.is_service THEN 1 ELSE least(3,greatest(1,r.reserve_days)) END)
 FROM public.national_market_references r JOIN public.economic_resources e ON e.code=r.resource_code CROSS JOIN sales WHERE r.resource_code=p_resource),0)
$f$;
REVOKE ALL ON FUNCTION private.national_replenishment_target(text,date) FROM PUBLIC,anon,authenticated;

-- Contracts deliver up to the authorized quantity, never above the agreed price,
-- respecting existing listing/contract reservations and real cash. One settlement per day.
CREATE OR REPLACE FUNCTION private.fulfill_supply_contract(p_contract uuid,p_day date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE c public.business_supply_contracts%rowtype; i public.business_inventory%rowtype; s public.businesses%rowtype; buyer public.businesses%rowtype; cash numeric; qty numeric; q jsonb; total numeric; k uuid; prev public.business_supply_orders%rowtype; attempt integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO c FROM public.business_supply_contracts WHERE id=p_contract AND status='active' FOR UPDATE;
 IF NOT FOUND OR p_day IS NULL OR p_day>current_date OR p_day<current_date-30 OR c.ends_at<=p_day::timestamp AT TIME ZONE 'America/Sao_Paulo' OR c.created_at>=(p_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo' THEN RAISE EXCEPTION 'Contrato fora do período de vigência.';END IF;
 k:=md5('supply-contract:'||c.id||':'||p_day)::uuid;
 SELECT * INTO prev FROM public.business_supply_orders WHERE idempotency_key=k;
 IF FOUND THEN RETURN to_jsonb(prev);END IF;
 IF c.last_processed_on>=p_day THEN RAISE EXCEPTION 'Contrato já avaliado neste dia.';END IF;
 SELECT * INTO s FROM public.businesses WHERE id=c.seller_business_id AND status='active';
 SELECT * INTO buyer FROM public.businesses WHERE id=c.buyer_business_id AND status='active';
 IF s.id IS NULL OR buyer.id IS NULL THEN RAISE EXCEPTION 'Comprador ou fornecedor inativo.';END IF;
 SELECT * INTO i FROM public.business_inventory WHERE business_id=s.id AND resource_code=c.resource_code FOR UPDATE;
 IF i.selling_price IS NULL OR i.selling_price<=0 OR NOT coalesce(i.available_for_sale,false) THEN RAISE EXCEPTION 'Fornecedor sem oferta ativa deste insumo.';END IF;
 IF i.selling_price>c.max_unit_price THEN RAISE EXCEPTION 'Preço do fornecedor acima do limite contratado: R$ % > R$ %.',i.selling_price,c.max_unit_price;END IF;
 SELECT balance INTO cash FROM public.accounts WHERE id=buyer.bank_account_id FOR UPDATE;
 qty:=trunc(least(c.daily_quantity,private.unreserved_company_stock(s.id,c.resource_code,p_day,c.id),greatest(0,coalesce(cash,0))/i.selling_price),3);
 IF qty<=0 THEN RAISE EXCEPTION 'Sem estoque livre ou caixa; confira anúncios e reservas de fornecimento.';END IF;
 FOR attempt IN 1..4 LOOP
  IF round(qty*i.selling_price,2)<=0 THEN RAISE EXCEPTION 'Quantidade disponível inferior à unidade monetária.';END IF;
  q:=public.quote_legal_levies('purchase',round(qty*i.selling_price,2),true,s.economic_sector_id,'Insumos',NULL,s.region_code);
  IF coalesce((q->>'restricted')::boolean,true) THEN RAISE EXCEPTION 'Fornecimento restrito por norma vigente.';END IF;
  total:=(q->>'total_debited')::numeric;
  EXIT WHEN total<=cash;
  qty:=greatest(0,trunc(qty*cash/greatest(total,.01)-.001,3));
 END LOOP;
 IF qty<=0 OR total IS NULL OR total>cash THEN RAISE EXCEPTION 'Caixa insuficiente para o fornecimento e seus tributos.';END IF;
 RETURN private.trade_company_resource(c.buyer_business_id,c.seller_business_id,c.resource_code,qty,c.max_unit_price,k,c.created_by,p_day);
END $f$;
REVOKE ALL ON FUNCTION private.fulfill_supply_contract(uuid,date) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE d text; old text;
BEGIN
 d:=pg_get_functiondef('private.buy_national_production(uuid,text,uuid,uuid)'::regprocedure);
 old:='available_qty numeric;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Procurement declaration changed';END IF;
 d:=replace(d,old,old||' spending_limit numeric;');
 old:='IF p_actor IS NULL THEN available_qty:=least(available_qty,trunc(i.quantity*.25,3));END IF;';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Procurement limit changed';END IF;
 d:=replace(d,old,$s$
 spending_limit:=a.balance;
 IF p_actor IS NULL THEN
  available_qty:=least(available_qty,trunc(i.quantity*.25,3));
  spending_limit:=least(a.balance,private.national_procurement_remaining());
  demand:=least(demand,greatest(0,private.national_replenishment_target(p_resource,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)-held));
 END IF;$s$);
 d:=replace(d,'trunc(a.balance/r.unit_price,3)','trunc(spending_limit/r.unit_price,3)');
 d:=replace(d,'EXIT WHEN gross<=a.balance;','EXIT WHEN gross<=spending_limit;');
 d:=replace(d,'qty*a.balance/greatest(gross,.01)','qty*spending_limit/greatest(gross,.01)');
 d:=replace(d,'gross>a.balance OR gross IS NULL','gross>spending_limit OR gross IS NULL');
 IF strpos(d,'gross>spending_limit OR gross IS NULL')=0 THEN RAISE EXCEPTION 'Quote limit changed';END IF;
 EXECUTE d;
 d:=pg_get_functiondef('private.procure_national_market(date)'::regprocedure);
 old:='ORDER BY md5(p_day::text||'':''||i.business_id::text||'':''||i.resource_code),i.business_id,i.resource_code';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Procurement order changed';END IF;
 d:=replace(d,old,$s$ORDER BY
 CASE private.household_category(i.resource_code,(SELECT e.is_service FROM public.economic_resources e WHERE e.code=i.resource_code)) WHEN 'food' THEN 0 WHEN 'health' THEN 0 WHEN 'education' THEN 0 WHEN 'energy' THEN 1 ELSE 2 END,
 coalesce((SELECT st.quantity FROM public.national_market_stock st WHERE st.resource_code=i.resource_code),0)/greatest(1,private.national_replenishment_target(i.resource_code,(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)),
 md5(p_day::text||':'||i.business_id::text||':'||i.resource_code),i.business_id,i.resource_code$s$);
 EXECUTE d;
 d:=pg_get_functiondef('private.simulate_company_day(uuid,date)'::regprocedure);
 old:='perform private.trade_company_resource(b.id,contract.seller_business_id,contract.resource_code,contract.daily_quantity,contract.max_unit_price,contract_key,contract.created_by,p_day);';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Contract settlement changed';END IF;
 d:=replace(d,old,$s$ supply_quote:=private.fulfill_supply_contract(contract.id,p_day);
   IF coalesce((supply_quote->>'quantity')::numeric,0)<contract.daily_quantity AND b.owner_id IS NOT NULL THEN
    INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(b.owner_id,'company_supply_pending','Fornecimento parcial: '||b.name||' recebeu '||(supply_quote->>'quantity')||' de '||contract.daily_quantity||' unidades de '||contract.resource_code||'.','/services/companies/'||b.id,jsonb_build_object('contract_id',contract.id,'operation_date',p_day,'delivered_quantity',supply_quote->'quantity'));
   END IF;$s$);
 old:='Um fornecimento de ''||b.name||'' não foi concluído. Confira estoque, preço e caixa.';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Contract warning changed';END IF;
 d:=replace(d,old,$s$Um fornecimento de '||b.name||' não foi concluído. '||SQLERRM||'$s$);
 -- use safe bounded fixed error messages rather than exposing SQL errors in notifications
 d:=replace(d,$s$'Um fornecimento de '||b.name||' não foi concluído. '||SQLERRM||''$s$,$s$'Um fornecimento de '||b.name||' não foi concluído. '||CASE WHEN SQLSTATE='P0001' THEN CASE WHEN SQLERRM LIKE 'Preço do fornecedor acima%' THEN 'Preço acima do limite contratado.' WHEN SQLERRM LIKE 'Sem estoque livre%' THEN 'Sem estoque livre ou caixa; confira anúncios e reservas.' WHEN SQLERRM LIKE 'Fornecedor sem oferta%' THEN 'Fornecedor sem oferta ativa.' ELSE 'Confira estoque, preço, caixa e vigência.' END ELSE 'Confira estoque, preço, caixa e vigência.' END$s$);
 old:='(last_processed_on is null or last_processed_on<p_day) for update loop';
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Contract ordering changed';END IF;
 d:=replace(d,old,'(last_processed_on is null or last_processed_on<p_day) order by created_at,id for update loop');
 -- Only genuine free direct offers determine the national share.
 EXECUTE d;
 d:=pg_get_functiondef('private.simulate_population_demand(date)'::regprocedure);
 old:=$s$and (e.is_service or e.code in('energy','food','drinks','bread','meals','retail_food',
                                   'retail_electronics','retail_clothing','retail_medicine','retail_vehicles'))$s$;
 IF strpos(d,old)=0 THEN RAISE EXCEPTION 'Population demand eligibility changed';END IF;
 d:=replace(d,old,$s$and private.household_category(e.code,e.is_service) IS NOT NULL
     and private.unreserved_company_stock(b.id,i.resource_code,p_day)>0$s$);
 EXECUTE d;
END $patch$;
