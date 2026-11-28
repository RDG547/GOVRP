-- Test environment only; transaction-local liquidity and test orders are reverted.
BEGIN;

DO $test$
DECLARE m uuid; opening numeric; ending numeric; money_before numeric; money_after numeric; budget numeric; purchase_before numeric; purchase_after numeric; n_before bigint; n_after bigint; d text; offer record; k uuid; res jsonb; again jsonb; tested integer:=0; bought numeric:=0;
BEGIN
 SELECT id INTO m FROM public.accounts WHERE account_kind='national_market';
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO money_before;
 UPDATE public.government_finances SET treasury_balance=treasury_balance-50000 WHERE id=1;
 UPDATE public.accounts SET balance=balance+50000 WHERE id=m;
 SELECT balance INTO opening FROM public.accounts WHERE id=m;
 SELECT coalesce(sum(gross_amount),0),count(*) INTO purchase_before,n_before FROM public.national_market_purchases;
 budget:=private.national_procurement_remaining();
 FOR offer IN SELECT b.id,i.resource_code,i.quantity FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id WHERE b.status='active' AND b.national_market_auto AND i.available_for_sale AND i.quantity>0 AND private.unreserved_company_stock(b.id,i.resource_code,current_date)>0 ORDER BY b.id,i.resource_code LOOP
  k:=gen_random_uuid();
  res:=private.buy_national_production(offer.id,offer.resource_code,k,NULL);
  IF coalesce((res->>'quantity')::numeric,0)>0 THEN
   again:=private.buy_national_production(offer.id,offer.resource_code,k,NULL);
   IF res IS DISTINCT FROM again OR (res->>'quantity')::numeric>trunc(offer.quantity*.25,3) THEN RAISE EXCEPTION 'Idempotency or inventory cap failure';END IF;
   tested:=tested+1;bought:=bought+(res->>'gross_amount')::numeric;
  END IF;
 END LOOP;
 SELECT balance INTO ending FROM public.accounts WHERE id=m;
 SELECT coalesce(sum(gross_amount),0),count(*) INTO purchase_after,n_after FROM public.national_market_purchases;
 IF opening-ending<=0 OR tested=0 OR n_after-n_before<>tested OR opening-ending>budget OR purchase_after-purchase_before<>opening-ending OR bought<>opening-ending THEN RAISE EXCEPTION 'Positive budget test failed: budget %, spent %, orders %',budget,opening-ending,tested;END IF;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO money_after;
 IF money_before<>money_after OR EXISTS(SELECT 1 FROM public.accounts WHERE balance<0) OR EXISTS(SELECT 1 FROM public.business_inventory WHERE quantity<0) THEN RAISE EXCEPTION 'Conservation failed';END IF;
 SELECT prosrc INTO d FROM pg_proc WHERE oid='private.simulate_company_day(uuid,date)'::regprocedure;
 IF strpos(d,'SQLERRM||')>0 OR strpos(d,'Preço acima do limite contratado.')=0 OR strpos(d,'private.fulfill_supply_contract(contract.id,p_day)')=0 THEN RAISE EXCEPTION 'Notification patch not correctly generated';END IF;
END $test$;
SELECT 'positive_budget_procurement_passed' result;

ROLLBACK;
