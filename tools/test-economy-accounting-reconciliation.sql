-- Smoke tests for the GOV.RP economic accounting reconciliation migration.
-- Run in a disposable QA database after the migration, NOT in production.
-- All generated data is rolled back. An exception aborts the test.
BEGIN;
DO $test$
DECLARE
  account_id uuid; wallet_before numeric; treasury_before numeric;
  citizen_id uuid; state_code text; biz_id uuid;
  visit_id uuid; d1 date:=current_date+100; d2 date:=current_date+101;
  got numeric; tx_type text; snapshot_before jsonb; snapshot_after jsonb;
BEGIN
  SELECT id,balance INTO account_id,wallet_before FROM public.accounts WHERE account_kind='population';
  SELECT treasury_balance INTO treasury_before FROM public.government_finances WHERE id=1;
  SELECT id INTO citizen_id FROM public.profiles ORDER BY id LIMIT 1;
  SELECT code INTO state_code FROM public.economic_regions ORDER BY code LIMIT 1;
  SELECT id INTO biz_id FROM public.businesses ORDER BY id LIMIT 1;
  IF account_id IS NULL OR citizen_id IS NULL OR biz_id IS NULL OR state_code IS NULL THEN
    RAISE EXCEPTION 'QA fixture missing population, citizen, region, or business';
  END IF;
  snapshot_before:=private.economy_accounting_reconciliation_snapshot();

  INSERT INTO public.healthcare_visits(
    user_id,region_code,idempotency_key,health_before,health_after,cost
  ) VALUES(citizen_id,state_code,gen_random_uuid(),30,50,25) RETURNING id INTO visit_id;
  SELECT type INTO tx_type FROM public.transactions
  WHERE idempotency_key=md5('govrp-healthcare-ledger:'||visit_id::text)::uuid
    AND amount=25 AND to_account_id=account_id;
  IF tx_type IS DISTINCT FROM 'public_healthcare_outlay' THEN
    RAISE EXCEPTION 'Healthcare visit has no financial ledger entry';
  END IF;

  INSERT INTO public.business_daily_operations(business_id,operation_date,status)
  VALUES(biz_id,d1,'operating');
  INSERT INTO public.business_transactions(
    business_id,type,amount,description,metadata,accounting_date
  ) VALUES(biz_id,'revenue',123.45,'QA citizen sale',
            '{"buyer_kind":"citizen"}'::jsonb,d1);
  SELECT revenue INTO got FROM public.business_daily_operations
  WHERE business_id=biz_id AND operation_date=d1;
  IF got <> 123.45 THEN RAISE EXCEPTION 'Citizen sale not reflected'; END IF;

  INSERT INTO public.business_transactions(
    business_id,type,amount,description,metadata,accounting_date
  ) VALUES(biz_id,'revenue',67.00,'QA national sale',
            '{"kind":"national_market_sale"}'::jsonb,d1);
  SELECT revenue INTO got FROM public.business_daily_operations
  WHERE business_id=biz_id AND operation_date=d1;
  IF got <> 123.45 THEN RAISE EXCEPTION 'National sale was duplicated'; END IF;
  UPDATE public.business_daily_operations
  SET revenue=revenue+67 WHERE business_id=biz_id AND operation_date=d1;

  INSERT INTO public.business_transactions(
    business_id,type,amount,description,metadata,accounting_date
  ) VALUES(biz_id,'revenue',12.11,'QA business supply',
            '{"kind":"b2b_sale"}'::jsonb,d1);
  SELECT revenue INTO got FROM public.business_daily_operations
  WHERE business_id=biz_id AND operation_date=d1;
  IF got <> 202.56 THEN RAISE EXCEPTION 'B2B or national sale was not counted exactly once'; END IF;

  -- Entry before daily simulation must be captured when the daily row is created.
  INSERT INTO public.business_transactions(
    business_id,type,amount,description,metadata,accounting_date
  ) VALUES(biz_id,'revenue',9.25,'QA earlier sale',
            '{"buyer_kind":"citizen"}'::jsonb,d2);
  INSERT INTO public.business_daily_operations(business_id,operation_date,status)
  VALUES(biz_id,d2,'operating');
  SELECT revenue INTO got FROM public.business_daily_operations
  WHERE business_id=biz_id AND operation_date=d2;
  IF got <> 9.25 THEN RAISE EXCEPTION 'Pre-simulation revenue was not carried forward'; END IF;

  IF (SELECT balance FROM public.accounts WHERE id=account_id) <> wallet_before
     OR (SELECT treasury_balance FROM public.government_finances WHERE id=1) <> treasury_before
  THEN RAISE EXCEPTION 'Bookkeeping incorrectly moved treasury or household money'; END IF;
  snapshot_after:=private.economy_accounting_reconciliation_snapshot();
  IF (snapshot_before->>'business_daily_revenue_difference')::numeric
      <> (snapshot_after->>'business_daily_revenue_difference')::numeric
  THEN RAISE EXCEPTION 'New accounting entries broke daily reconciliation'; END IF;
END;
$test$;
ROLLBACK;

-- Read-only post-test checks. They MUST be stable after the rollback.
SELECT private.economy_accounting_reconciliation_snapshot() AS accounting_status;
SELECT (SELECT count(*) FROM cron.job
        WHERE jobname='govrp-economic-accounting-audit') = 1 AS audit_job_installed;
SELECT has_function_privilege('anon','public.get_economy_accounting_reconciliation()','EXECUTE')
       AS anonymous_can_read_admin_diagnostics,
       has_function_privilege('authenticated','public.get_economy_accounting_reconciliation()','EXECUTE')
       AS authenticated_may_call_guarded_diagnostics;