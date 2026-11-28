-- Run only after migration in a test environment. All changes are reverted.
BEGIN;

DO $test$
DECLARE before_money numeric; after_money numeric; c record; res jsonb; again jsonb; refused boolean:=false; market_before numeric; market_after numeric; budget numeric; tested_contract boolean:=false;
BEGIN
 IF private.national_procurement_cap(1000,0,100)<>200 OR private.national_procurement_cap(1000,0,1000)<>300 OR private.national_procurement_cap(800,200,100)<>0 OR private.national_procurement_cap(0,0,100)<>0 THEN RAISE EXCEPTION 'Budget cap scenarios failed';END IF;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO before_money;
 SELECT balance INTO market_before FROM public.accounts WHERE account_kind='national_market';
 budget:=private.national_procurement_remaining();
 PERFORM private.procure_national_market(current_date);
 SELECT balance INTO market_after FROM public.accounts WHERE account_kind='national_market';
 IF market_before-market_after>budget OR market_after<0 THEN RAISE EXCEPTION 'Market budget exceeded';END IF;
 -- Reset one existing contract's attempt marker inside the rollback transaction only.
 SELECT c0.id,c0.daily_quantity,c0.resource_code,private.unreserved_company_stock(s.id,c0.resource_code,current_date,c0.id) AS free_qty
 INTO c FROM public.business_supply_contracts c0 JOIN public.businesses s ON s.id=c0.seller_business_id JOIN public.business_inventory i ON i.business_id=s.id AND i.resource_code=c0.resource_code
 WHERE c0.status='active' AND c0.ends_at>now() AND i.available_for_sale AND i.selling_price<=c0.max_unit_price AND private.unreserved_company_stock(s.id,c0.resource_code,current_date,c0.id)>0
 AND private.unreserved_company_stock(s.id,c0.resource_code,current_date,c0.id)<c0.daily_quantity
 AND NOT EXISTS(SELECT 1 FROM public.business_supply_orders o WHERE o.idempotency_key=md5('supply-contract:'||c0.id||':'||current_date)::uuid)
 ORDER BY c0.id LIMIT 1;
 IF c.id IS NOT NULL THEN
 UPDATE public.business_supply_contracts SET last_processed_on=current_date-1 WHERE id=c.id;
 res:=private.fulfill_supply_contract(c.id,current_date);
 again:=private.fulfill_supply_contract(c.id,current_date);
 IF res IS DISTINCT FROM again OR (res->>'quantity')::numeric<=0 OR (res->>'quantity')::numeric>c.daily_quantity OR (res->>'quantity')::numeric>c.free_qty THEN RAISE EXCEPTION 'Partial delivery or idempotency failed';END IF;
 tested_contract:=true;
 END IF;
 SELECT c0.id INTO c FROM public.business_supply_contracts c0 JOIN public.business_inventory i ON i.business_id=c0.seller_business_id AND i.resource_code=c0.resource_code WHERE c0.status='active' AND c0.ends_at>now() AND i.selling_price>c0.max_unit_price AND NOT EXISTS(SELECT 1 FROM public.business_supply_orders o WHERE o.idempotency_key=md5('supply-contract:'||c0.id||':'||current_date)::uuid) ORDER BY c0.id LIMIT 1;
 IF c.id IS NOT NULL THEN
 UPDATE public.business_supply_contracts SET last_processed_on=current_date-1 WHERE id=c.id;
 BEGIN PERFORM private.fulfill_supply_contract(c.id,current_date);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Preço do fornecedor acima%' THEN RAISE;END IF;refused:=true;END;
 END IF;
 IF NOT tested_contract OR NOT refused THEN RAISE EXCEPTION 'Required contract test coverage unavailable';END IF;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO after_money;
 IF before_money<>after_money OR EXISTS(SELECT 1 FROM public.accounts WHERE balance<0) OR EXISTS(SELECT 1 FROM public.business_inventory WHERE quantity<0) THEN RAISE EXCEPTION 'Settlement conservation failed';END IF;
 IF has_function_privilege('anon','private.fulfill_supply_contract(uuid,date)','EXECUTE') OR has_function_privilege('authenticated','private.national_procurement_remaining()','EXECUTE') THEN RAISE EXCEPTION 'Private helper exposed';END IF;
END $test$;
SELECT 'budget_limits_partial_contract_idempotency_price_ceiling_money_conservation_passed' AS result,private.national_procurement_remaining() remaining;

ROLLBACK;
