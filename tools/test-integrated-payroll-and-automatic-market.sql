BEGIN;
SELECT set_config('request.headers',jsonb_build_object('x-govrp-world-generation',(SELECT value->>'generation_id' FROM public.system_settings WHERE key='world_runtime'))::text,true);
CREATE TEMP TABLE qa_salary_people(id uuid,role text,amount numeric);
DO $test$
DECLARE person uuid;job text;r jsonb;before_total numeric;after_total numeric;expected numeric;paid numeric;b uuid;acct uuid;market uuid;k uuid:=gen_random_uuid();sold numeric;stock numeric;original_price numeric;service_code text;service_type text;n integer;
BEGIN
 FOREACH job IN ARRAY ARRAY['Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário','Juiz Federal','Procurador-Geral da República'] LOOP
  person:=gen_random_uuid();
  INSERT INTO auth.users(id,email) VALUES(person,'qa-payroll-'||person||'@example.invalid');
  IF job NOT IN('Juiz Federal','Procurador-Geral da República') THEN INSERT INTO public.public_careers(profile_id,role,source) VALUES(person,job,'recovery');END IF;
  UPDATE public.profiles SET role=job,full_name='Teste de folha '||job,character_gender='male',onboarding_completed=true,onboarding_step='completed' WHERE id=person;
  IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE user_id=person AND account_kind='personal') THEN INSERT INTO public.accounts(user_id,account_kind,account_number,balance) VALUES(person,'personal','QA-'||person,0);END IF;
  INSERT INTO qa_salary_people VALUES(person,job,CASE WHEN job='Juiz Federal' THEN 17500 WHEN job IN('Promotor','Defensor Público','Procurador-Geral da República') THEN 14000 WHEN job='Agente Secreto' THEN 10500 ELSE 7000 END);
 END LOOP;
 UPDATE public.government_finances SET treasury_balance=10000000 WHERE id=1;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO before_total;
 r:=public.process_official_payroll();IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'Official payroll failed: %',r;END IF;
 IF EXISTS(SELECT 1 FROM qa_salary_people q WHERE NOT EXISTS(SELECT 1 FROM public.salary_payments p WHERE p.user_id=q.id AND p.role=q.role AND p.amount=q.amount)) THEN RAISE EXCEPTION 'Missing salary or wrong amount for new roles';END IF;
 r:=public.process_official_payroll();IF (r->>'processedCount')::integer<>0 THEN RAISE EXCEPTION 'Payroll duplicated';END IF;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO after_total;
 IF before_total<>after_total THEN RAISE EXCEPTION 'Payroll did not conserve money';END IF;
 IF private.official_salary_rule_key('Juiz Federal') IS DISTINCT FROM (SELECT rule_key FROM public.government_rules WHERE definition->>'role'='Juiz Federal' LIMIT 1) THEN RAISE EXCEPTION 'Renamed salary rule disconnected';END IF;
 PERFORM private.validate_legal_measure('policy',jsonb_build_object('action','change','rule_key',private.official_salary_rule_key('Juiz Federal'),'value',18000,'definition',jsonb_build_object('operation','official_salary','role','Juiz Federal')),'bill');
 PERFORM private.validate_legal_measure('policy',jsonb_build_object('action','change','rule_key',private.official_salary_rule_key('Juiz'),'value',18000,'definition',jsonb_build_object('operation','official_salary','role','Juiz')),'bill');
 -- Isolate supplier participation without changing production outside QA.
 UPDATE public.businesses SET national_market_auto=false;
 SELECT id INTO person FROM qa_salary_people WHERE role='Professor';
 INSERT INTO public.businesses(owner_id,business_type_id,name,status,region_code,national_market_auto,last_simulated_on) VALUES(person,'pecuaria','Compra automática QA','active','SP',true,current_date) RETURNING id INTO b;
 INSERT INTO public.accounts(account_kind,business_id,account_number,balance) VALUES('business',b,'QA-'||b,0) ON CONFLICT(business_id) DO UPDATE SET account_kind=excluded.account_kind RETURNING id INTO acct;
 UPDATE public.businesses SET bank_account_id=acct WHERE id=b;
 INSERT INTO public.business_inventory(business_id,resource_code,quantity,unit_cost,selling_price,available_for_sale) VALUES(b,'milk',100000,2,6,true) ON CONFLICT(business_id,resource_code) DO UPDATE SET quantity=100000,available_for_sale=true;
 SELECT id INTO market FROM public.accounts WHERE account_kind='national_market';
 UPDATE public.accounts SET balance=1000 WHERE id=market;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO before_total;
 PERFORM private.procure_national_market(current_date);
 SELECT quantity,unit_price INTO sold,original_price FROM public.national_market_purchases WHERE business_id=b;
 IF sold<=0 OR sold>=100000 OR (SELECT balance FROM public.accounts WHERE id=market)<0 THEN RAISE EXCEPTION 'Automatic purchase failed partial budget limit';END IF;
 PERFORM private.procure_national_market(current_date);
 IF (SELECT count(*) FROM public.national_market_purchases WHERE business_id=b)<>1 THEN RAISE EXCEPTION 'Automatic purchase duplicated';END IF;
 UPDATE public.national_market_references SET unit_price=unit_price+1 WHERE resource_code='milk';
 IF (SELECT unit_price FROM public.national_market_purchases WHERE business_id=b)<>original_price THEN RAISE EXCEPTION 'History price changed';END IF;
 SELECT quantity INTO stock FROM public.business_inventory WHERE business_id=b AND resource_code='milk';
 UPDATE public.businesses SET national_market_auto=false WHERE id=b;
 PERFORM private.procure_national_market(current_date+1);
 IF (SELECT quantity FROM public.business_inventory WHERE business_id=b AND resource_code='milk')<>stock THEN RAISE EXCEPTION 'Opt-out ignored';END IF;
 SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) INTO after_total;
 IF before_total<>after_total THEN RAISE EXCEPTION 'Automatic trade did not conserve money';END IF;
 -- Exercise the real existing daily orchestrator, including its retry guards.
 r:=private.run_company_economy();IF NOT (r->>'success')::boolean THEN RAISE EXCEPTION 'Daily economy failed: %',r;END IF;
 IF private.simulate_population_demand(current_date)<>0 THEN RAISE EXCEPTION 'Population day ran twice';END IF;
 -- Services are contracted capacity, never fictional physical inventory.
 SELECT recipe.business_type_id,recipe.output_resource INTO service_type,service_code FROM public.business_recipes recipe JOIN public.economic_resources e ON e.code=recipe.output_resource WHERE e.is_service ORDER BY recipe.business_type_id LIMIT 1;
 INSERT INTO public.businesses(owner_id,business_type_id,name,status,national_market_auto) VALUES(person,service_type,'Serviços QA','active',false) RETURNING id INTO b;
 INSERT INTO public.accounts(account_kind,business_id,account_number,balance) VALUES('business',b,'QA-'||b,0) ON CONFLICT(business_id) DO UPDATE SET account_kind=excluded.account_kind RETURNING id INTO acct;UPDATE public.businesses SET bank_account_id=acct WHERE id=b;
 INSERT INTO public.business_inventory(business_id,resource_code,quantity,unit_cost,selling_price,available_for_sale) VALUES(b,service_code,10,1,10,true) ON CONFLICT(business_id,resource_code) DO UPDATE SET quantity=10,available_for_sale=true;
 UPDATE public.accounts SET balance=1000000 WHERE id=market;
 r:=private.buy_national_production(b,service_code,k,NULL);
 IF (r->>'quantity')::numeric<>10 OR (r->>'service_remaining')::numeric<>10 OR EXISTS(SELECT 1 FROM public.national_market_stock WHERE resource_code=service_code) THEN RAISE EXCEPTION 'Service modeled as physical stock';END IF;
 PERFORM private.consume_national_market(current_date+2,1000000);
 IF (SELECT service_remaining FROM public.national_market_purchases WHERE id=(r->>'id')::uuid)<>0 THEN RAISE EXCEPTION 'Service capacity not consumed';END IF;
 SELECT count(*) INTO n FROM private.reset_catalog() WHERE table_name IN('public_competitions','public_competition_applications','public_careers','public_competition_exams','national_market_references','national_market_stock','national_market_purchases','national_market_consumption');
 IF n<>8 THEN RAISE EXCEPTION 'Reset catalogue missing new state';END IF;
 RAISE NOTICE 'PASS: nine salary roles, payroll idempotency/conservation, legal salary alias, automatic partial purchase, opt-out, history, daily orchestrator, service capacity and reset catalogue';
END $test$;
ROLLBACK;
