
DO $test$
DECLARE firm record; inv_before numeric; amount_before numeric; amount_after numeric; row1 jsonb; row2 jsonb; k uuid; after_audit jsonb; n integer:=0; oldpop numeric; spend numeric; current_run date:=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 IF private.company_utilization_overhead(100,0,10)<>70 OR private.company_utilization_overhead(100,5,10)<>85 OR private.company_utilization_overhead(100,10,10)<>100 OR private.company_utilization_overhead(100,100,10)<>100 OR private.company_utilization_overhead(100,0,0)<>70 THEN RAISE EXCEPTION 'Overhead scenario failure';END IF;
 IF EXISTS(SELECT 1 FROM public.businesses b JOIN public.business_inventory i ON i.business_id=b.id WHERE private.unreserved_company_stock(b.id,i.resource_code,current_run)<0 OR private.unreserved_company_stock(b.id,i.resource_code,current_run)>i.quantity) THEN RAISE EXCEPTION 'Invalid available stock';END IF;
 SELECT coalesce(sum(balance),0)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO amount_before FROM public.accounts;
 FOR firm IN SELECT x.id,i.resource_code,i.quantity FROM public.businesses x JOIN public.business_inventory i ON i.business_id=x.id WHERE x.control_kind='population' AND x.status='active' AND i.available_for_sale AND i.quantity>=4 AND private.unreserved_company_stock(x.id,i.resource_code,current_run)>0 ORDER BY x.id LOOP
  SELECT quantity INTO inv_before FROM public.business_inventory WHERE business_id=firm.id AND resource_code=firm.resource_code;
  k:=md5('balance-test:'||firm.id||':'||firm.resource_code)::uuid;
  row1:=private.buy_national_production(firm.id,firm.resource_code,k,NULL);
  IF coalesce((row1->>'quantity')::numeric,0)<=0 THEN RAISE EXCEPTION 'Expected real NPC purchase, got %',row1;END IF;
  row2:=private.buy_national_production(firm.id,firm.resource_code,k,NULL);
  IF row1 IS DISTINCT FROM row2 THEN RAISE EXCEPTION 'Purchase replay changed result';END IF;
  IF (SELECT quantity FROM public.business_inventory WHERE business_id=firm.id AND resource_code=firm.resource_code)<>inv_before-(row1->>'quantity')::numeric THEN RAISE EXCEPTION 'Stock deducted more than once';END IF;
  IF EXISTS(SELECT 1 FROM public.products p JOIN public.business_inventory i ON i.business_id=p.business_id AND i.resource_code=p.resource_code WHERE p.business_id=firm.id AND p.resource_code=firm.resource_code AND p.stock<>floor(i.quantity)) THEN RAISE EXCEPTION 'Marketplace projection mismatch';END IF;
  n:=n+1;
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'No NPC sales exercised';END IF;
 SELECT balance INTO oldpop FROM public.accounts WHERE account_kind='population';
 spend:=private.consume_national_market(current_run+1,200);
 IF spend<=0 OR spend>200 OR (SELECT balance FROM public.accounts WHERE account_kind='population')<>oldpop-spend THEN RAISE EXCEPTION 'Demand budget failure: %',spend;END IF;
 SELECT coalesce(sum(balance),0)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO amount_after FROM public.accounts;
 IF amount_after<>amount_before THEN RAISE EXCEPTION 'Money conservation error %',amount_after-amount_before;END IF;
 SELECT private.economy_accounting_reconciliation_snapshot() INTO after_audit;
 IF (after_audit->>'population_difference')::numeric<>0 OR (after_audit->>'business_daily_mismatch_count')::numeric<>0 OR EXISTS(SELECT 1 FROM public.accounts WHERE balance<0) OR EXISTS(SELECT 1 FROM public.business_inventory WHERE quantity<0) THEN RAISE EXCEPTION 'Accounting failure: %',after_audit;END IF;
 RAISE NOTICE 'Validated % purchases, allocated % demand, conservation zero',n,spend;
END $test$;
SELECT 'passed' AS tests,private.economy_accounting_reconciliation_snapshot() AS accounting,(SELECT count(*) FROM public.national_market_consumption WHERE operation_date=current_date+1) AS simulated_resource_purchases;
