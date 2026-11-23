BEGIN;
-- No plan exists on installation. Only an explicit administrative decision can
-- authorize finite operational Treasury spending; national GDP is never cash.
CREATE TABLE private.population_circulation_plans(
 id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true,
 daily_limit numeric(15,2) NOT NULL CHECK(daily_limit>0 AND daily_limit<=100000),
 total_limit numeric(15,2) NOT NULL CHECK(total_limit>0 AND total_limit<=1000000),
 total_paid numeric(15,2) NOT NULL DEFAULT 0 CHECK(total_paid>=0 AND total_paid<=total_limit),
 starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),
 authority_reference text NOT NULL CHECK(length(btrim(authority_reference))>=20),
 approved_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 ended_at timestamptz,ended_by uuid REFERENCES public.profiles(id)
);
CREATE UNIQUE INDEX population_circulation_one_active ON private.population_circulation_plans(active) WHERE active;
CREATE TABLE private.population_circulation_payments(
 plan_id uuid NOT NULL REFERENCES private.population_circulation_plans(id),operation_date date NOT NULL,
 amount numeric(15,2) NOT NULL CHECK(amount>=0),transaction_id uuid REFERENCES public.transactions(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(plan_id,operation_date)
);
ALTER TABLE private.population_circulation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.population_circulation_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.population_circulation_plans,private.population_circulation_payments FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.approve_population_circulation(p_key uuid,p_daily_limit numeric,p_total_limit numeric,p_ends_on date,p_authority_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous private.population_circulation_plans%rowtype; today date:=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
 PERFORM private.require_competition_admin();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Decisão administrativa identificada obrigatória.' USING errcode='42501';END IF;
 IF p_key IS NULL OR p_daily_limit IS NULL OR p_total_limit IS NULL OR p_ends_on IS NULL OR p_authority_reference IS NULL
  OR p_daily_limit::text IN ('NaN','Infinity','-Infinity') OR p_total_limit::text IN ('NaN','Infinity','-Infinity')
  OR p_daily_limit<=0 OR p_daily_limit>100000 OR p_total_limit<p_daily_limit OR p_total_limit>1000000
  OR p_daily_limit<>round(p_daily_limit,2) OR p_total_limit<>round(p_total_limit,2)
  OR p_ends_on<today OR p_ends_on>today+90 OR length(btrim(p_authority_reference))<20 THEN
  RAISE EXCEPTION 'Informe limites finitos, prazo de até 90 dias reais e referência da decisão autorizadora.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO previous FROM private.population_circulation_plans WHERE id=p_key;
 IF FOUND THEN
  IF previous.approved_by IS DISTINCT FROM auth.uid() OR previous.daily_limit<>p_daily_limit
   OR previous.total_limit<>p_total_limit OR previous.ends_on<>p_ends_on OR previous.authority_reference<>btrim(p_authority_reference) THEN
   RAISE EXCEPTION 'Identificação já usada para outra decisão.';
  END IF;
  RETURN to_jsonb(previous)||jsonb_build_object('idempotent',true);
 END IF;
 UPDATE private.population_circulation_plans SET active=false,ended_at=clock_timestamp(),ended_by=auth.uid() WHERE active;
 INSERT INTO private.population_circulation_plans(id,daily_limit,total_limit,starts_on,ends_on,authority_reference,approved_by)
 VALUES(p_key,p_daily_limit,p_total_limit,today,p_ends_on,btrim(p_authority_reference),auth.uid()) RETURNING * INTO previous;
 -- Existing public state invalidation carries no private mandate details.
 UPDATE public.government_finances SET updated_at=clock_timestamp() WHERE id=1;
 RETURN to_jsonb(previous);
END $$;
CREATE OR REPLACE FUNCTION public.stop_population_circulation(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.require_competition_admin();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Decisão identificada obrigatória.' USING errcode='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 UPDATE private.population_circulation_plans SET active=false,ended_at=clock_timestamp(),ended_by=auth.uid() WHERE id=p_plan_id AND active;
 UPDATE public.government_finances SET updated_at=clock_timestamp() WHERE id=1;
END $$;
CREATE OR REPLACE FUNCTION public.get_population_circulation_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.require_competition_admin();
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso administrativo obrigatório.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('plans',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
  SELECT * FROM private.population_circulation_plans ORDER BY created_at DESC LIMIT 12) x),
  'treasury',(SELECT treasury_balance FROM public.government_finances WHERE id=1),
  'payments',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM (
  SELECT * FROM private.population_circulation_payments ORDER BY created_at DESC LIMIT 30) x));
END $$;
REVOKE ALL ON FUNCTION public.approve_population_circulation(uuid,numeric,numeric,date,text),public.stop_population_circulation(uuid),public.get_population_circulation_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_population_circulation(uuid,numeric,numeric,date,text),public.stop_population_circulation(uuid),public.get_population_circulation_status() TO authenticated;

CREATE OR REPLACE FUNCTION private.process_population_circulation(p_day date)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan private.population_circulation_plans%rowtype; wallet public.accounts%rowtype; treasury numeric; amount numeric; tx uuid;
BEGIN
 IF p_day IS NULL OR p_day<>(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Pagamento apenas no dia operacional atual.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO plan FROM private.population_circulation_plans WHERE active AND p_day BETWEEN starts_on AND ends_on FOR UPDATE;
 IF NOT FOUND THEN RETURN 0;END IF;
 IF EXISTS(SELECT 1 FROM private.population_circulation_payments WHERE plan_id=plan.id AND operation_date=p_day) THEN RETURN 0;END IF;
 SELECT * INTO wallet FROM public.accounts WHERE account_kind='population' FOR UPDATE;
 SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1 FOR UPDATE;
 IF wallet.id IS NULL OR treasury IS NULL THEN RAISE EXCEPTION 'Conta demográfica ou Tesouro ausente.';END IF;
 amount:=trunc(greatest(0,least(plan.daily_limit,plan.total_limit-plan.total_paid,treasury)),2);
 IF amount>0 THEN
  UPDATE public.accounts SET balance=balance+amount,updated_at=clock_timestamp() WHERE id=wallet.id;
  UPDATE public.government_finances SET treasury_balance=treasury_balance-amount,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.transactions(to_account_id,amount,type,description,metadata,idempotency_key)
  VALUES(wallet.id,amount,'population_endowment','Dotação populacional autorizada',
   jsonb_build_object('plan_id',plan.id,'actor_id',plan.approved_by,'signed_amount',amount,'treasury_transfer',true,'population_consumption',true,'operation_date',p_day),
   md5('population-circulation:'||plan.id||':'||p_day)::uuid) RETURNING id INTO tx;
  INSERT INTO public.government_expenditures(expenditure_type,source_table,source_id,amount,occurred_at_real,occurred_at_rp,metadata)
  VALUES('social_assistance','transactions',tx::text,amount,clock_timestamp(),public.rp_now(),
   jsonb_build_object('accounting_scope','operational','bank_disbursement',true,'plan_id',plan.id,'authority_reference',plan.authority_reference,'transaction_id',tx));
  UPDATE private.population_circulation_plans SET total_paid=total_paid+amount WHERE id=plan.id;
 END IF;
 INSERT INTO private.population_circulation_payments(plan_id,operation_date,amount,transaction_id) VALUES(plan.id,p_day,amount,tx);
 RETURN amount;
END $$;
REVOKE ALL ON FUNCTION private.process_population_circulation(date) FROM PUBLIC,anon,authenticated;
-- Integration with the existing daily company engine follows.
CREATE OR REPLACE FUNCTION private.run_company_economy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b record; company_row public.businesses%rowtype; start_day date; day date; result jsonb; cycles integer:=0; processed integer:=0; sold numeric:=0; period_start date:=date_trunc('week',now())::date-7;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 perform private.process_population_circulation((statement_timestamp() at time zone 'America/Sao_Paulo')::date);
 perform private.manage_autonomous_enterprises((statement_timestamp() at time zone 'America/Sao_Paulo')::date);
 -- A common lock order keeps payroll, capital and B2B settlement atomic with the hourly engine.
 perform id from public.businesses order by id for update;
 perform id from public.accounts order by id for update;
 select greatest(current_date-6,coalesce(min(coalesce(last_simulated_on+1,created_at::date)),current_date)) into start_day from public.businesses where status='active' and region_code is not null;
 for day in select generate_series(start_day,current_date,interval '1 day')::date loop
  for b in select id from public.businesses where status='active' and region_code is not null and created_at::date<=day and (last_simulated_on is null or last_simulated_on<day) order by id loop
   perform private.simulate_company_day(b.id,day);processed:=processed+1;
  end loop;
  perform private.sync_population_marketplace();
  sold:=sold+private.simulate_population_demand(day);
 end loop;
 for company_row in select * from public.businesses where status in('active','suspended') order by id loop
  if company_row.last_fiscal_cycle_at+interval '7 days'<=now() then
   perform private.pay_company_wages(company_row.id);
   while company_row.last_fiscal_cycle_at+interval '7 days'<=now() loop
    result:=private.close_company_fiscal_cycle(company_row.id,now());
    exit when result is null;
    cycles:=cycles+1;
    select * into company_row from public.businesses where id=company_row.id;
   end loop;
  end if;
 end loop;
 update public.business_supply_contracts set status='expired' where status='active' and ends_at<=now();
 insert into public.business_national_cycles(cycle_start,cycle_end,revenue,profit,employment,output,company_count,by_region)
 select period_start,period_start+7,coalesce(sum(d.revenue),0),coalesce(sum(d.revenue-d.payroll_accrued-d.input_cost-d.overhead),0),(select count(*) from public.business_employees where fired_at is null),coalesce(sum(d.produced_quantity),0),(select count(*) from public.businesses where status='active'),coalesce((select jsonb_object_agg(region_code,stats) from(select biz.region_code,jsonb_build_object('revenue',sum(x.revenue),'output',sum(x.produced_quantity),'companies',count(distinct biz.id)) stats from public.business_daily_operations x join public.businesses biz on biz.id=x.business_id where x.operation_date>=period_start and x.operation_date<period_start+7 and biz.region_code is not null group by biz.region_code) regions),'{}'::jsonb) from public.business_daily_operations d where d.operation_date>=period_start and d.operation_date<period_start+7
 on conflict(cycle_start) do nothing;
 perform private.close_state_enterprise_cycles();
 return jsonb_build_object('success',true,'processed_company_days',processed,'closed_cycles',cycles,'population_spending',sold,'processed_at',now());
end $function$;
ALTER FUNCTION private.run_company_economy() SET timezone='America/Sao_Paulo';
COMMIT;
