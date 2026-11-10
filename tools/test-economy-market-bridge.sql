-- Run only against a staging clone AFTER applying the bridge migration.
-- Read-only invariants; BEGIN/ROLLBACK for consistent behavior alongside QA scripts.
BEGIN;
DO $qa$
DECLARE buyer_count bigint;def text;accounts_total numeric;treasury numeric;
BEGIN
 SELECT count(*) INTO buyer_count FROM public.accounts WHERE account_kind='population';
 IF buyer_count<>1 THEN RAISE EXCEPTION 'Expected precisely one demographic consumption account, found %',buyer_count;END IF;
 IF NOT has_function_privilege('authenticated','public.fund_population_consumption(numeric,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.fund_population_consumption(numeric,uuid)','EXECUTE')
 OR has_function_privilege('PUBLIC','public.fund_population_consumption(numeric,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Population budget RPC grants do not restrict calls to authenticated users';END IF;
 IF NOT has_function_privilege('authenticated','public.get_national_market_operations_status()','EXECUTE')
 OR has_function_privilege('anon','public.get_national_market_operations_status()','EXECUTE')
 THEN RAISE EXCEPTION 'Market diagnostics RPC grants invalid';END IF;
 def:=pg_get_functiondef('private.buy_national_production(uuid,text,uuid,uuid)'::regprocedure);
 IF position('contract_reserved' in def)=0 OR position('marketplace_reserved' in def)=0
 OR position('i.quantity*.25' in def)=0 THEN
  RAISE EXCEPTION 'Purchasing must preserve contracts, marketplace listings, and a daily automatic limit';END IF;
 def:=pg_get_functiondef('private.seed_reset_world(uuid)'::regprocedure);
 IF position('POPULATION-ECONOMY' in def)=0 THEN
  RAISE EXCEPTION 'World reset must recreate the demographic account without minting funds';END IF;
 def:=pg_get_functiondef('public.fund_population_consumption(numeric,uuid)'::regprocedure);
 IF position('treasury_balance=treasury_balance-p_amount' in def)=0
 OR position('balance=balance+p_amount' in def)=0
 OR position('idempotency_key=p_key' in def)=0 THEN
  RAISE EXCEPTION 'Population financing must conserve cash and remain idempotent';END IF;
 def:=pg_get_functiondef('public.quote_legal_levies(text,numeric,boolean,uuid,text,text,text)'::regprocedure);
 IF position('government_rules' in def)=0 THEN
  RAISE EXCEPTION 'Legal tax engine must remain the source for purchase quotes';END IF;
 SELECT coalesce(sum(balance),0) INTO accounts_total FROM public.accounts;
 SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1;
 IF accounts_total IS NULL OR treasury IS NULL THEN RAISE EXCEPTION 'Missing real ledger';END IF;
 RAISE NOTICE 'PASS: account, access control, protected inventory, reset, conserved financing, legal tax engine and ledger';
END $qa$;
ROLLBACK;

-- Additional staging-only transaction tests (run manually under a properly
-- authenticated test administrator, never with production citizens):
-- 1. Record treasury + all accounts balances, transfer R$ 100 to population;
--    assert treasury -100, population +100, total invariant.
-- 2. Reuse idempotency UUID: assert no second transfer or ledger record.
-- 3. Attempt exceeding treasury, negative reversal exceeding balance, and
--    non-admin invocation: expect rejection and no financial changes.
-- 4. List a physical company resource and create an active B2B supply contract.
--    Procure national supply: assert reserved quantity cannot be purchased.
-- 5. Invoke the same auto idempotency UUID twice: only one stock/purchase/payment.
-- 6. Fund and consume the demographic stock on a new date: one consumption,
--    decreasing physical stock, credit to national market, conserved balances.
-- 7. Assert actual 20% legal purchase levies stay unchanged; 4% fiscal
--    policy decision is merely reported, not silently applied to a decree.
-- 8. Verify original business sale, supply contract, salaries and marketplace
--    flows still work; complete the staging transaction with ROLLBACK.
