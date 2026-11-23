BEGIN;
-- Published aggregates consume an immutable input set, not a changing ledger.
CREATE TABLE economy_private.period_input_manifests(
 period_id uuid PRIMARY KEY REFERENCES public.economic_periods(id),captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE economy_private.period_event_inputs(
 period_id uuid NOT NULL REFERENCES public.economic_periods(id),event_id uuid NOT NULL REFERENCES public.economic_events(id),
 payload jsonb NOT NULL,PRIMARY KEY(period_id,event_id)
);
CREATE TABLE economy_private.period_fiscal_inputs(
 period_id uuid NOT NULL REFERENCES public.economic_periods(id),source_table text NOT NULL,source_id text NOT NULL,
 payload jsonb NOT NULL,PRIMARY KEY(period_id,source_table,source_id)
);
ALTER TABLE economy_private.period_input_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE economy_private.period_event_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE economy_private.period_fiscal_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.period_fiscal_inputs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON economy_private.period_input_manifests,economy_private.period_event_inputs FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.capture_period_inputs(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.economic_periods%rowtype;
BEGIN
 SELECT * INTO p FROM public.economic_periods WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR p.status='closed' THEN RAISE EXCEPTION 'Captura exige período ainda não publicado.';END IF;
 IF EXISTS(SELECT 1 FROM economy_private.period_input_manifests WHERE period_id=p_id) THEN RETURN;END IF;
 IF p.period_type='month' THEN
  WITH captured_events AS (
   INSERT INTO economy_private.period_event_inputs SELECT p_id,e.id,to_jsonb(e) FROM public.economic_events e
    WHERE e.occurred_at_rp>=p.starts_at_rp AND e.occurred_at_rp<p.ends_at_rp RETURNING event_id
  ) INSERT INTO economy_private.period_fiscal_inputs
   SELECT p_id,'government_revenues',r.id::text,to_jsonb(r) FROM public.government_revenues r WHERE r.occurred_at_rp>=p.starts_at_rp AND r.occurred_at_rp<p.ends_at_rp
   UNION ALL SELECT p_id,'government_expenditures',r.id::text,to_jsonb(r) FROM public.government_expenditures r WHERE r.occurred_at_rp>=p.starts_at_rp AND r.occurred_at_rp<p.ends_at_rp;
 ELSE
  IF (SELECT count(*) FROM public.economic_periods c JOIN economy_private.period_input_manifests m ON m.period_id=c.id
    WHERE c.period_type=CASE p.period_type WHEN 'quarter' THEN 'month' ELSE 'quarter' END
     AND c.status='closed' AND c.starts_at_rp>=p.starts_at_rp AND c.ends_at_rp<=p.ends_at_rp)
    <>(CASE p.period_type WHEN 'quarter' THEN 3 ELSE 4 END) THEN
   RAISE EXCEPTION 'Períodos anteriores sem captura auditável exigem revisão administrativa.';
  END IF;
  INSERT INTO economy_private.period_event_inputs SELECT DISTINCT ON (i.event_id) p_id,i.event_id,i.payload
  FROM economy_private.period_event_inputs i JOIN public.economic_periods c ON c.id=i.period_id
  WHERE c.period_type=CASE p.period_type WHEN 'quarter' THEN 'month' ELSE 'quarter' END
   AND c.starts_at_rp>=p.starts_at_rp AND c.ends_at_rp<=p.ends_at_rp ORDER BY i.event_id,c.starts_at_rp;
  INSERT INTO economy_private.period_fiscal_inputs SELECT p_id,i.source_table,i.source_id,i.payload
  FROM economy_private.period_fiscal_inputs i JOIN public.economic_periods c ON c.id=i.period_id
  WHERE c.period_type=CASE p.period_type WHEN 'quarter' THEN 'month' ELSE 'quarter' END
   AND c.starts_at_rp>=p.starts_at_rp AND c.ends_at_rp<=p.ends_at_rp ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO economy_private.period_input_manifests(period_id) VALUES(p_id);
END $$;
CREATE OR REPLACE FUNCTION economy_private.period_input_events(p_id uuid)
RETURNS SETOF public.economic_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (jsonb_populate_record(NULL::public.economic_events,i.payload)).* FROM economy_private.period_event_inputs i WHERE period_id=p_id
$$;
CREATE OR REPLACE FUNCTION economy_private.period_input_revenues(p_id uuid)
RETURNS SETOF public.government_revenues LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (jsonb_populate_record(NULL::public.government_revenues,i.payload)).* FROM economy_private.period_fiscal_inputs i WHERE i.period_id=p_id AND source_table='government_revenues'
$$;
CREATE OR REPLACE FUNCTION economy_private.period_input_expenditures(p_id uuid)
RETURNS SETOF public.government_expenditures LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (jsonb_populate_record(NULL::public.government_expenditures,i.payload)).* FROM economy_private.period_fiscal_inputs i WHERE i.period_id=p_id AND source_table='government_expenditures'
$$;
REVOKE ALL ON FUNCTION economy_private.period_input_revenues(uuid),economy_private.period_input_expenditures(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION economy_private.queue_missing_period_events()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 -- Also catches transactions committed after closing took its snapshot.
 INSERT INTO economy_private.period_revision_queue(event_id,period_id,reason)
 SELECT e.id,p.id,'outside_published_snapshot' FROM economy_private.period_input_manifests m
 JOIN public.economic_periods p ON p.id=m.period_id AND p.status='closed'
 JOIN public.economic_events e ON e.occurred_at_rp>=p.starts_at_rp AND e.occurred_at_rp<p.ends_at_rp
 WHERE NOT EXISTS(SELECT 1 FROM economy_private.period_event_inputs i WHERE i.period_id=p.id AND i.event_id=e.id)
 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION economy_private.capture_period_inputs(uuid),economy_private.period_input_events(uuid),economy_private.queue_missing_period_events() FROM PUBLIC,anon,authenticated;

-- Immutable legal history enables time-weighted prospective fiscal estimates.
-- No alteration to the laws, Treasury balance or outstanding debt on installation.
CREATE TABLE economy_private.fiscal_model_config(id boolean PRIMARY KEY DEFAULT true CHECK(id),
 effective_from_rp timestamptz NOT NULL,model_version text NOT NULL DEFAULT 'national_fiscal_v2');
INSERT INTO economy_private.fiscal_model_config(id,effective_from_rp)
 SELECT true,(date_trunc('month',public.rp_now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC';
CREATE TABLE economy_private.fiscal_rule_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,rule_key text NOT NULL,
 observed_from timestamptz NOT NULL,observed_until timestamptz,rule_snapshot jsonb NOT NULL
);
CREATE INDEX fiscal_rule_history_window ON economy_private.fiscal_rule_history(rule_key,observed_from);
INSERT INTO economy_private.fiscal_rule_history(rule_key,observed_from,rule_snapshot)
 SELECT rule_key,clock_timestamp(),to_jsonb(r) FROM public.government_rules r;
CREATE OR REPLACE FUNCTION economy_private.track_fiscal_rule_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP<>'INSERT' THEN UPDATE economy_private.fiscal_rule_history SET observed_until=stamp WHERE rule_key=OLD.rule_key AND observed_until IS NULL;END IF;
 IF TG_OP<>'DELETE' THEN INSERT INTO economy_private.fiscal_rule_history(rule_key,observed_from,rule_snapshot) VALUES(NEW.rule_key,stamp,to_jsonb(NEW));RETURN NEW;END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER structural_fiscal_rule_history AFTER INSERT OR UPDATE OR DELETE ON public.government_rules
 FOR EACH ROW EXECUTE FUNCTION economy_private.track_fiscal_rule_history();
CREATE TABLE economy_private.national_fiscal_months(
 period_id uuid PRIMARY KEY REFERENCES public.economic_periods(id),
 estimated_tax numeric NOT NULL,government_consumption numeric NOT NULL,
 operational_revenue numeric NOT NULL,operational_primary_expense numeric NOT NULL,
 simulated_transfers numeric NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE economy_private.fiscal_model_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE economy_private.fiscal_rule_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE economy_private.national_fiscal_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.fiscal_model_config,economy_private.fiscal_rule_history,economy_private.national_fiscal_months FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION economy_private.track_fiscal_rule_history() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.capture_national_fiscal_month(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.economic_periods%rowtype; tax numeric:=0; government numeric:=0;
 op_revenue numeric;op_expense numeric;transfers numeric; rules jsonb; excluded jsonb;
BEGIN
 SELECT * INTO p FROM public.economic_periods WHERE id=p_id;
 IF p.period_type<>'month' OR p.starts_at_rp<(SELECT effective_from_rp FROM economy_private.fiscal_model_config WHERE id) THEN
  RETURN jsonb_build_object('status','before_prospective_model');END IF;
 IF EXISTS(SELECT 1 FROM economy_private.national_fiscal_months WHERE period_id=p_id) THEN RETURN jsonb_build_object('status','already_captured');END IF;
 IF NOT EXISTS(SELECT 1 FROM economy_private.period_input_manifests WHERE period_id=p_id) THEN RAISE EXCEPTION 'Captura dos eventos obrigatória.';END IF;
 -- GDP is not a bank account. Tax bases cover only synthetic turnover, never
 -- player/NPC settlements that already have an operational tax receipt.
 WITH turnover AS (
  SELECT sector_id,sum(economic_amount) amount FROM economy_private.period_input_events(p_id)
  WHERE is_simulated AND source_table='economy_simulation' AND economic_classification='gross_output' GROUP BY sector_id
 ), applicable AS (
  SELECT h.*,h.rule_snapshot->'definition' d,
   greatest(0,extract(epoch FROM least(coalesce(h.observed_until,p.ends_at),coalesce((h.rule_snapshot->>'valid_until')::timestamptz,p.ends_at),p.ends_at)
    -greatest(h.observed_from,(h.rule_snapshot->>'valid_from')::timestamptz,p.starts_at)))
     /greatest(1,extract(epoch FROM p.ends_at-p.starts_at)) fraction
  FROM economy_private.fiscal_rule_history h WHERE h.observed_from<p.ends_at AND coalesce(h.observed_until,p.ends_at)>p.starts_at
   AND (h.rule_snapshot->>'is_active')::boolean AND h.rule_snapshot->>'rule_kind'='tax'
 ), supported AS (
  SELECT * FROM applicable WHERE d->>'nature'='percentage' AND coalesce(d->>'basis','purchase')='purchase'
   AND coalesce(d->>'audience','all') IN ('all','business')
   AND NOT d ?| ARRAY['category','document_type','min_amount','max_amount','exempt_below','weekdays','hour_from']
 ) SELECT coalesce(sum(t.amount*(r.rule_snapshot->>'numeric_value')::numeric*r.fraction
    *(1-CASE WHEN NOT r.d ? 'discount_sector_id' OR r.d->>'discount_sector_id'=t.sector_id::text THEN coalesce((r.d->>'discount_rate')::numeric,0) ELSE 0 END)
    *CASE WHEN r.d ? 'region_codes' THEN coalesce((SELECT sum(population)::numeric FROM public.economic_regions WHERE country_code='BR' AND r.d->'region_codes' ? code)/nullif((SELECT sum(population) FROM public.economic_regions WHERE country_code='BR'),0),0) ELSE 1 END),0),
    coalesce(jsonb_agg(DISTINCT jsonb_build_object('rule',r.rule_snapshot,'time_fraction',r.fraction)),'[]')
 INTO tax,rules FROM turnover t JOIN supported r ON NOT r.d ? 'sector_id' OR r.d->>'sector_id'=t.sector_id::text;
 SELECT coalesce(jsonb_agg(DISTINCT h.rule_snapshot),'[]') INTO excluded FROM economy_private.fiscal_rule_history h
 WHERE h.observed_from<p.ends_at AND coalesce(h.observed_until,p.ends_at)>p.starts_at
  AND (h.rule_snapshot->>'is_active')::boolean AND h.rule_snapshot->>'rule_kind' IN ('tax','fee')
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rules) x WHERE x->'rule'=h.rule_snapshot);
 SELECT coalesce(sum(economic_amount),0) INTO government FROM economy_private.period_input_events(p_id)
 WHERE is_simulated AND source_table='economy_simulation' AND economic_classification='government_spending';
 SELECT coalesce(sum(amount),0) INTO op_revenue FROM economy_private.period_input_revenues(p_id);
 -- The same tax can exist as a receipt and classified ledger event; use only one.
 SELECT op_revenue+coalesce(sum(abs(e.nominal_amount)),0) INTO op_revenue FROM economy_private.period_input_events(p_id) e
 WHERE e.source_table='transactions' AND e.economic_classification IN ('product_tax','income_tax')
  AND NOT EXISTS(SELECT 1 FROM economy_private.period_input_revenues(p_id) r WHERE r.source_table=e.source_table AND r.source_id=e.source_id);
 SELECT coalesce(sum(amount) FILTER(WHERE source_table IS DISTINCT FROM 'automatic_stabilizers' AND expenditure_type<>'debt_interest'),0),
  coalesce(sum(amount) FILTER(WHERE source_table='automatic_stabilizers'),0) INTO op_expense,transfers
 FROM economy_private.period_input_expenditures(p_id);
 INSERT INTO economy_private.national_fiscal_months VALUES(p_id,round(tax,2),round(government,2),op_revenue,op_expense,transfers,
  jsonb_build_object('model','national_fiscal_v2','rules',rules,'unestimated_rules',excluded,
   'basis','synthetic_gross_turnover_excluding_transactional_firms','regional_basis','normalized_regional_population',
   'treasury_credit',false,'operational_values_are_separate',true,'fiscal_coverage_complete',jsonb_array_length(excluded)=0),clock_timestamp());
 RETURN jsonb_build_object('status','captured','estimated_tax',tax,'government_consumption',government,'unestimated_rules',jsonb_array_length(excluded));
END $$;
REVOKE ALL ON FUNCTION economy_private.capture_national_fiscal_month(uuid) FROM PUBLIC,anon,authenticated;

CREATE TABLE economy_private.national_financial_position(
 id boolean PRIMARY KEY DEFAULT true CHECK(id),financial_assets numeric NOT NULL DEFAULT 0 CHECK(financial_assets>=0)
);
INSERT INTO economy_private.national_financial_position(id) VALUES(true);
ALTER TABLE economy_private.national_financial_position ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.national_financial_position FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION economy_private.national_debt_rollforward(p_debt numeric,p_assets numeric,p_selic numeric,p_revenue numeric,p_primary_expense numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE interest numeric;nominal numeric;closing_debt numeric;closing_assets numeric;
BEGIN
 IF p_debt IS NULL OR p_assets IS NULL OR p_selic IS NULL OR p_revenue IS NULL OR p_primary_expense IS NULL
  OR p_debt<0 OR p_assets<0 OR p_selic<0
  OR p_debt::text IN ('NaN','Infinity','-Infinity') OR p_assets::text IN ('NaN','Infinity','-Infinity')
  OR p_selic::text IN ('NaN','Infinity','-Infinity') OR p_revenue::text IN ('NaN','Infinity','-Infinity')
  OR p_primary_expense::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Posição fiscal inválida.';END IF;
 interest:=p_debt*p_selic/100/4;
 nominal:=p_revenue-p_primary_expense-interest;
 IF nominal>=0 THEN closing_debt:=greatest(0,p_debt-nominal);closing_assets:=p_assets+greatest(0,nominal-p_debt);
 ELSE closing_assets:=greatest(0,p_assets+nominal);closing_debt:=p_debt+greatest(0,-nominal-p_assets);END IF;
 RETURN jsonb_build_object('interest',interest,'primary_result',p_revenue-p_primary_expense,'nominal_result',nominal,
  'opening_debt',p_debt,'closing_debt',closing_debt,'opening_assets',p_assets,'closing_assets',closing_assets,
  'bank_disbursement',false,'interest_convention','annual_selic_divided_by_four');
END $$;
REVOKE ALL ON FUNCTION economy_private.national_debt_rollforward(numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.national_fiscal_quarter(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('status',CASE WHEN count(*)=3 THEN 'complete' ELSE 'transition' END,'months',count(*),
 'national_tax',coalesce(sum(f.estimated_tax),0),'government_consumption',coalesce(sum(f.government_consumption),0),
 'operational_revenue',coalesce(sum(f.operational_revenue),0),'operational_primary_expense',coalesce(sum(f.operational_primary_expense),0),
 'simulated_transfers',coalesce(sum(f.simulated_transfers),0),'method','synthetic_turnover_tax_plus_operational_receipts',
 'coverage',coalesce(jsonb_agg(jsonb_build_object('period_id',f.period_id,'metadata',f.metadata)),'[]'))
 FROM economy_private.national_fiscal_months f JOIN public.economic_periods m ON m.id=f.period_id
 JOIN public.economic_periods q ON q.id=p_id AND q.period_type='quarter'
 WHERE m.starts_at_rp>=q.starts_at_rp AND m.ends_at_rp<=q.ends_at_rp
$$;
REVOKE ALL ON FUNCTION economy_private.national_fiscal_quarter(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION economy_private.close_month(p_period_id uuid, p_force boolean DEFAULT false, p_initiated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  readiness jsonb;
  period_row public.economic_periods%rowtype;
  run_id uuid;
  cpi_result jsonb;
  labor_result jsonb;
  confidence_result jsonb;
  result jsonb;
  event_hash text;
  consumer_spending numeric;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:month:'||p_period_id::text));
  readiness := economy_private.period_close_readiness(p_period_id);
  if readiness->>'status' <> 'ready' then return readiness; end if;

  select * into period_row
  from public.economic_periods
  where id=p_period_id
  for update;

  if not found or period_row.period_type<>'month' then
    raise exception 'Período mensal inválido.';
  end if;
  if period_row.status='closed' then
    return jsonb_build_object('status','already_closed','period_id',p_period_id);
  end if;
  if not p_force and now()<period_row.ends_at then
    return jsonb_build_object('status','not_due','period_id',p_period_id);
  end if;

  insert into public.economic_engine_runs (
    run_type,period_id,engine_version,status,initiated_by
  )
  values ('monthly_close',p_period_id,'1.0.0','running',p_initiated_by)
  returning id into run_id;

  update public.economic_periods set status='closing' where id=p_period_id;

  perform economy_private.generate_simulated_base(p_period_id);
  perform economy_private.capture_period_inputs(p_period_id);
  perform economy_private.capture_national_fiscal_month(p_period_id);
  cpi_result := economy_private.calculate_cpi(p_period_id);
  labor_result := economy_private.calculate_labor_market(p_period_id);
  perform economy_private.calculate_citizen_snapshots(p_period_id);
  perform economy_private.calculate_business_snapshots(p_period_id);
  confidence_result := economy_private.update_confidence(p_period_id);

  select coalesce(sum(e.economic_amount),0) into consumer_spending
  from economy_private.period_input_events(p_period_id) e
  where e.economic_classification='household_consumption'
    and e.occurred_at_rp>=period_row.starts_at_rp
    and e.occurred_at_rp<period_row.ends_at_rp;

  perform economy_private.upsert_indicator(
    p_period_id,'household_consumption',consumer_spending,
    consumer_spending/greatest((cpi_result->>'cpi')::numeric/100,.000001),
    null,'BRL','{}'::jsonb
  );

  select encode(
    extensions.digest(
      coalesce(string_agg(e.id::text||':'||e.economic_amount::text,'|' order by e.id),'empty'),
      'sha256'
    ),
    'hex'
  ) into event_hash
  from economy_private.period_input_events(p_period_id) e
  where e.occurred_at_rp>=period_row.starts_at_rp
    and e.occurred_at_rp<period_row.ends_at_rp;

  result := jsonb_build_object(
    'period_id',p_period_id,
    'cpi',cpi_result,
    'labor',labor_result,
    'confidence',confidence_result,
    'household_consumption',consumer_spending
  );

  update public.economic_periods
  set status='closed',closed_at=now(),close_hash=event_hash,engine_version='1.0.0'
  where id=p_period_id;

  update public.economic_engine_runs
  set
    status='completed',
    finished_at=now(),
    results=result,
    input_hash=event_hash,
    output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;

  update public.economic_state
  set last_monthly_close_at=now(),updated_at=now()
  where id=true;

  perform economy_private.publish_bulletin(p_period_id,'monthly');

  if (cpi_result->>'annual_inflation')::numeric
      > (select inflation_target+2 from public.economic_state where id=true) then
    perform economy_private.create_alert(
      'inflation_above_target','warning','Inflação acima da meta',
      format('A inflação anual atingiu %s%%.',to_char((cpi_result->>'annual_inflation')::numeric,'FM999990.00')),
      p_period_id
    );
  end if;

  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    if p_period_id is not null then
      update public.economic_periods set status='failed' where id=p_period_id and status<>'closed';
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.close_quarter(p_period_id uuid, p_force boolean DEFAULT false, p_initiated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  readiness jsonb;
  period_row public.economic_periods%rowtype;
  run_id uuid;
  gross_output numeric;
  intermediate numeric;
  product_taxes numeric;
  subsidies numeric;
  consumption numeric;
  investment numeric;
  government_spending numeric;
  exports numeric;
  imports numeric;
  gdp_production numeric;
  gdp_expenditure numeric;
  discrepancy numeric;
  tolerance numeric := economy_private.calibration_numeric('reconciliation_tolerance',.03);
  deflator numeric;
  real_gdp numeric;
  previous_real_gdp numeric;
  year_ago_real_gdp numeric;
  growth_quarter numeric;
  growth_year numeric;
  population numeric := economy_private.national_population();
  revenue numeric;
  expenditure_primary numeric;
  transfers numeric;
  interest_cost numeric;
  primary_result numeric;
  nominal_result numeric;
  old_debt numeric;
  new_debt numeric;
  debt_ratio numeric;
  v_fiscal_confidence numeric;
  fiscal_risk text;
  cycle text;
  result jsonb;
  fiscal_snapshot jsonb; fiscal_current numeric; fiscal_investment numeric; fiscal_dividends numeric; fiscal_tax numeric; fiscal_metadata jsonb; debt_flow jsonb; financial_assets numeric;
  event_hash text; fx_snapshot numeric;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:quarter:'||p_period_id::text));
  readiness := economy_private.period_close_readiness(p_period_id);
  if readiness->>'status' <> 'ready' then return readiness; end if;

  select * into period_row
  from public.economic_periods
  where id=p_period_id
  for update;

  if not found or period_row.period_type<>'quarter' then
    raise exception 'Período trimestral inválido.';
  end if;
  if period_row.status='closed' then
    return jsonb_build_object('status','already_closed','period_id',p_period_id);
  end if;
  if not p_force and now()<period_row.ends_at then
    return jsonb_build_object('status','not_due','period_id',p_period_id);
  end if;

  for period_row in
    select *
    from public.economic_periods p
    where p.period_type='month'
      and p.starts_at_rp >= (select starts_at_rp from public.economic_periods where id=p_period_id)
      and p.ends_at_rp <= (select ends_at_rp from public.economic_periods where id=p_period_id)
      and p.status<>'closed'
    order by p.starts_at_rp
  loop
    perform economy_private.close_month(period_row.id,true,p_initiated_by);
  end loop;

  select * into period_row from public.economic_periods where id=p_period_id for update;

  insert into public.economic_engine_runs (
    run_type,period_id,engine_version,status,initiated_by
  )
  values ('quarterly_close',p_period_id,'1.0.0','running',p_initiated_by)
  returning id into run_id;

  update public.economic_periods set status='closing' where id=p_period_id;
  perform economy_private.capture_period_inputs(p_period_id);

  select
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='product_tax'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='subsidy'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='household_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='productive_investment'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='government_spending'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='export'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='import'),0)
  into
    gross_output,intermediate,product_taxes,subsidies,
    consumption,investment,government_spending,exports,imports
  from economy_private.period_input_events(p_period_id) e
  where e.occurred_at_rp>=period_row.starts_at_rp
    and e.occurred_at_rp<period_row.ends_at_rp;

  gdp_production := gross_output-intermediate+product_taxes-subsidies;
  gdp_expenditure := consumption+investment+government_spending+exports-imports;
  if gdp_production<=0 and gdp_expenditure>0 then
    gdp_production := gdp_expenditure;
  end if;
  discrepancy := case
    when greatest(abs(gdp_production),abs(gdp_expenditure))=0 then 0
    else abs(gdp_production-gdp_expenditure)
      / greatest(abs(gdp_production),abs(gdp_expenditure))
  end;

  select avg(i.nominal_value) into deflator from public.economic_indicators i join public.economic_periods p on p.id=i.period_id where i.indicator_code='cpi_index' and p.period_type='month' and p.starts_at_rp>=period_row.starts_at_rp and p.ends_at_rp<=period_row.ends_at_rp;
  deflator:=coalesce(deflator,(select cpi_index from public.economic_state where id=true));
  select brl_per_unit into fx_snapshot from public.country_rp_exchange_rates where country_code='BR' and currency_code='USD';
  fx_snapshot:=coalesce(fx_snapshot,(select exchange_rate from public.economic_state where id=true));
  real_gdp := gdp_production/greatest(deflator/100,.000001);

  select i.real_value into previous_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.ends_at_rp<=period_row.starts_at_rp and p.status='closed'
    and exists(select 1 from economy_private.period_input_manifests m where m.period_id=p.id)
  order by p.ends_at_rp desc limit 1;

  select i.real_value into year_ago_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.rp_year=period_row.rp_year-1
    and p.rp_quarter=period_row.rp_quarter and p.status='closed'
    and exists(select 1 from economy_private.period_input_manifests m where m.period_id=p.id)
  limit 1;

  growth_quarter := case when coalesce(previous_real_gdp,0)=0 then null
    else (real_gdp/previous_real_gdp-1)*100 end;
  growth_year := case when coalesce(year_ago_real_gdp,0)=0 then null
    else (real_gdp/year_ago_real_gdp-1)*100 end;

  perform economy_private.upsert_indicator(
    p_period_id,'gdp_nominal',gdp_production,real_gdp,growth_quarter,'BRL',
    jsonb_build_object(
      'production_method',gdp_production,
      'expenditure_method',gdp_expenditure,
      'statistical_discrepancy_ratio',discrepancy,'fx_brl_per_usd_snapshot',fx_snapshot,'gdp_nominal_usd',gdp_production/fx_snapshot,'reference_period','quarter'
    )
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_real',gdp_production,real_gdp,growth_quarter,'BRL',
    jsonb_build_object('deflator',deflator)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_growth_quarterly',growth_quarter,growth_quarter,growth_quarter,'percent',
    jsonb_build_object('previous_real_gdp',previous_real_gdp,'comparable_history',previous_real_gdp is not null,'revision_is_not_growth',true)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_growth_year_over_year',growth_year,growth_year,growth_year,'percent',
    jsonb_build_object('year_ago_real_gdp',year_ago_real_gdp)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_per_capita',gdp_production/population,real_gdp/population,growth_quarter,'BRL_per_capita',
    jsonb_build_object('population',population)
  );
  perform economy_private.upsert_indicator(p_period_id,'gross_output',gross_output,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'intermediate_consumption',intermediate,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'household_consumption',consumption,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'productive_investment',investment,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'government_spending',government_spending,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'exports',exports,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'imports',imports,null,null,'BRL','{}'::jsonb);

  insert into public.economic_sector_snapshots (
    period_id,sector_id,gross_output,intermediate_consumption,value_added,
    real_value_added,employment,average_wage,wage_mass,investment,
    price_index,capacity_utilization,productivity_index,confidence_index,growth_rate,metadata
  )
  select
    p_period_id,
    es.id,
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0)
      - coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    (
      coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0)
      - coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0)
    )/greatest(deflator/100,.000001),
    coalesce((
      select avg(lms.employed)*es.gdp_weight
      from public.labor_market_snapshots lms
      join public.economic_periods mp on mp.id=lms.period_id
      where mp.starts_at_rp>=period_row.starts_at_rp and mp.ends_at_rp<=period_row.ends_at_rp
    ),population*.4*es.gdp_weight),
    coalesce(economy_private.latest_indicator('average_wage',period_row.ends_at_rp),3000),
    coalesce((
      select avg(lms.wage_mass)*es.gdp_weight
      from public.labor_market_snapshots lms
      join public.economic_periods mp on mp.id=lms.period_id
      where mp.starts_at_rp>=period_row.starts_at_rp and mp.ends_at_rp<=period_row.ends_at_rp
    ),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='productive_investment'),0),
    deflator,
    economy_private.clamp(
      60+(growth_quarter*2)+economy_private.active_shock_impact('capacity_percent',es.id),
      20,115
    ),
    es.base_productivity*100,
    economy_private.clamp(
      (select business_confidence from public.economic_state where id=true)
        + economy_private.active_shock_impact('business_confidence',es.id),
      0,100
    ),
    growth_quarter,
    jsonb_build_object('sector_code',es.code,'gdp_weight',es.gdp_weight)
  from public.economic_sectors es
  left join economy_private.period_input_events(p_period_id) e
    on e.sector_id=es.id
   and e.occurred_at_rp>=period_row.starts_at_rp
   and e.occurred_at_rp<period_row.ends_at_rp
  where es.is_active
  group by es.id;

  select coalesce(sum(gr.amount),0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from economy_private.period_input_events(p_period_id) e
      where e.source_table='transactions'
        and e.economic_classification in ('product_tax','income_tax')
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0)
  into revenue
  from economy_private.period_input_revenues(p_period_id) gr
  where gr.occurred_at_rp>=period_row.starts_at_rp
    and gr.occurred_at_rp<period_row.ends_at_rp;

  select coalesce(sum(ge.amount) filter (where ge.expenditure_type<>'debt_interest'),0),
         coalesce(sum(ge.amount) filter (where ge.expenditure_type='social_assistance'),0)
  into expenditure_primary,transfers
  from economy_private.period_input_expenditures(p_period_id) ge
  where ge.occurred_at_rp>=period_row.starts_at_rp
    and ge.occurred_at_rp<period_row.ends_at_rp;

  expenditure_primary := coalesce(expenditure_primary,0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from economy_private.period_input_events(p_period_id) e
      where e.source_table='transactions'
        and e.economic_classification='social_transfer'
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0);

  fiscal_snapshot:=economy_private.national_fiscal_quarter(p_period_id);
  fiscal_dividends:=coalesce((select sum(amount) from economy_private.period_input_revenues(p_period_id) where revenue_type='state_dividend'
   and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0);
  fiscal_current:=expenditure_primary-transfers; fiscal_investment:=0;
  fiscal_tax:=revenue-fiscal_dividends;
  fiscal_metadata:=jsonb_build_object('model','legacy_transition','cash_is_separate',true);
  if fiscal_snapshot->>'status'='complete' then
   revenue:=(fiscal_snapshot->>'national_tax')::numeric+(fiscal_snapshot->>'operational_revenue')::numeric;
   expenditure_primary:=(fiscal_snapshot->>'government_consumption')::numeric
    +(fiscal_snapshot->>'operational_primary_expense')::numeric+(fiscal_snapshot->>'simulated_transfers')::numeric;
   transfers:=(fiscal_snapshot->>'simulated_transfers')::numeric;
   fiscal_current:=expenditure_primary-transfers;
   fiscal_tax:=revenue-fiscal_dividends;
   fiscal_metadata:=fiscal_snapshot||jsonb_build_object('model','national_fiscal_v2','cash_is_separate',true,
    'national_estimate_is_not_treasury_cash',true);
  end if;
  select public_debt into old_debt from public.economic_state where id=true;
  interest_cost := old_debt
    * (select current_selic from public.economic_state where id=true)
    / 100 / 4;
  primary_result := revenue-expenditure_primary;
  nominal_result := primary_result-interest_cost;
  select f.financial_assets into financial_assets from economy_private.national_financial_position f where id=true for update;
  debt_flow:=economy_private.national_debt_rollforward(old_debt,financial_assets,
   (select current_selic from public.economic_state where id=true),revenue,expenditure_primary);
  new_debt:=(debt_flow->>'closing_debt')::numeric;
  update economy_private.national_financial_position set financial_assets=(debt_flow->>'closing_assets')::numeric where id=true;
  fiscal_metadata:=fiscal_metadata||jsonb_build_object('debt_rollforward',debt_flow);
  debt_ratio := new_debt/greatest(gdp_production*4,1)*100;
  v_fiscal_confidence := economy_private.clamp(
    78-debt_ratio*.45+growth_quarter*1.5
      + case when primary_result>=0 then 5 else -8 end,
    0,100
  );
  fiscal_risk := case
    when debt_ratio>=100 or v_fiscal_confidence<20 then 'critical'
    when debt_ratio>=80 or v_fiscal_confidence<35 then 'high'
    when debt_ratio>=60 or v_fiscal_confidence<50 then 'moderate'
    else 'low'
  end;

  insert into public.fiscal_periods (
    period_id,tax_revenue,state_enterprise_revenue,other_revenue,
    current_expenditure,public_investment,social_transfers,subsidies,
    debt_interest,primary_result,nominal_result,gross_debt,net_debt,
    debt_to_gdp,average_interest_rate,average_maturity_rp_months,
    debt_service,treasury_reserves,fiscal_confidence,fiscal_risk,metadata
  )
  values (
    p_period_id,fiscal_tax,
    coalesce((select sum(amount) from economy_private.period_input_revenues(p_period_id)
      where revenue_type='state_dividend'
        and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0),
    0,fiscal_current,fiscal_investment,transfers,0,
    interest_cost,primary_result,nominal_result,new_debt,new_debt,
    debt_ratio,(select current_selic from public.economic_state where id=true),
    24,interest_cost,
    coalesce((select treasury_balance from public.government_finances where id=1),0),
    v_fiscal_confidence,fiscal_risk,
    fiscal_metadata
  )
  on conflict (period_id) do update set
    tax_revenue=excluded.tax_revenue,
    state_enterprise_revenue=excluded.state_enterprise_revenue,
    other_revenue=excluded.other_revenue,
    current_expenditure=excluded.current_expenditure,
    public_investment=excluded.public_investment,
    social_transfers=excluded.social_transfers,
    subsidies=excluded.subsidies,
    debt_interest=excluded.debt_interest,
    primary_result=excluded.primary_result,
    nominal_result=excluded.nominal_result,
    gross_debt=excluded.gross_debt,
    net_debt=excluded.net_debt,
    debt_to_gdp=excluded.debt_to_gdp,
    average_interest_rate=excluded.average_interest_rate,
    debt_service=excluded.debt_service,
    treasury_reserves=excluded.treasury_reserves,
    fiscal_confidence=excluded.fiscal_confidence,
    fiscal_risk=excluded.fiscal_risk,
    metadata=excluded.metadata;

  update public.economic_state
  set
    public_debt=new_debt,
    fiscal_confidence=v_fiscal_confidence,
    updated_at=now()
  where id=true;

  -- The macroeconomic public debt is held in economic_state.public_debt.
  -- It must NOT overwrite the separate government bank loan balance.

  perform economy_private.upsert_indicator(p_period_id,'primary_fiscal_result',primary_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'nominal_fiscal_result',nominal_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'public_debt',new_debt,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'debt_to_gdp',debt_ratio,debt_ratio,null,'percent','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'fiscal_confidence',v_fiscal_confidence,v_fiscal_confidence,null,'index',jsonb_build_object('risk',fiscal_risk));
  perform economy_private.upsert_indicator(
    p_period_id,'government_approval_economic_effect',
    economy_private.clamp(growth_quarter*1.6-(coalesce(economy_private.latest_indicator('inflation_annual'),0)-3)*1.2-(coalesce(economy_private.latest_indicator('unemployment_rate'),8.5)-8.5),-20,20),
    null,null,'points',
    jsonb_build_object('informational_only',true)
  );

  cycle := economy_private.detect_cycle(p_period_id);

  if discrepancy>tolerance then
    perform economy_private.create_alert(
      'gdp_reconciliation_error','critical','Inconsistência nas óticas do PIB',
      format('A diferença entre produção e despesa foi de %s%%.',to_char(discrepancy*100,'FM999990.00')),
      p_period_id,null,null,
      jsonb_build_object('production',gdp_production,'expenditure',gdp_expenditure,'tolerance',tolerance)
    );
  end if;

  if debt_ratio>economy_private.calibration_numeric('debt_limit_ratio',.9)*100 then
    perform economy_private.create_alert(
      'debt_limit_exceeded','critical','Dívida pública acima do limite',
      format('A dívida atingiu %s%% do PIB.',to_char(debt_ratio,'FM999990.00')),
      p_period_id
    );
  end if;

  select encode(
    extensions.digest(coalesce(string_agg(e.id::text||':'||e.economic_amount::text,'|' order by e.id),'empty'),'sha256'),
    'hex'
  ) into event_hash
  from economy_private.period_input_events(p_period_id) e
  where e.occurred_at_rp>=period_row.starts_at_rp and e.occurred_at_rp<period_row.ends_at_rp;

  result := jsonb_build_object(
    'period_id',p_period_id,
    'gdp_nominal',round(gdp_production,2),
    'gdp_real',round(real_gdp,2),
    'gdp_production',round(gdp_production,2),
    'gdp_expenditure',round(gdp_expenditure,2),
    'discrepancy_ratio',round(discrepancy,8),
    'growth_quarterly',round(growth_quarter,6),
    'growth_year_over_year',growth_year,
    'cycle',cycle,
    'primary_result',round(primary_result,2),
    'public_debt',round(new_debt,2),
    'debt_to_gdp',round(debt_ratio,6)
  );

  update public.economic_periods
  set status='closed',closed_at=now(),close_hash=event_hash,engine_version='1.0.0'
  where id=p_period_id;

  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,input_hash=event_hash,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;

  update public.economic_state
  set last_quarterly_close_at=now(),updated_at=now()
  where id=true;

  perform economy_private.publish_bulletin(p_period_id,'quarterly');
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    if p_period_id is not null then
      update public.economic_periods set status='failed' where id=p_period_id and status<>'closed';
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.close_year(p_period_id uuid, p_force boolean DEFAULT false, p_initiated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  readiness jsonb;
  period_row public.economic_periods%rowtype;
  quarter_row public.economic_periods%rowtype;
  run_id uuid;
  nominal_gdp numeric;
  real_gdp numeric;
  previous_real_gdp numeric;
  growth numeric;
  inflation numeric;
  unemployment numeric;
  primary_result numeric;
  nominal_result numeric;
  debt numeric;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:year:'||p_period_id::text));
  readiness := economy_private.period_close_readiness(p_period_id);
  if readiness->>'status' <> 'ready' then return readiness; end if;
  select * into period_row from public.economic_periods where id=p_period_id for update;

  if not found or period_row.period_type<>'year' then raise exception 'Período anual inválido.'; end if;
  if period_row.status='closed' then return jsonb_build_object('status','already_closed','period_id',p_period_id); end if;
  if not p_force and now()<period_row.ends_at then return jsonb_build_object('status','not_due','period_id',p_period_id); end if;

  for quarter_row in
    select * from public.economic_periods p
    where p.period_type='quarter'
      and p.rp_year=period_row.rp_year
      and p.status<>'closed'
    order by p.rp_quarter
  loop
    perform economy_private.close_quarter(quarter_row.id,true,p_initiated_by);
  end loop;

  insert into public.economic_engine_runs(run_type,period_id,engine_version,status,initiated_by)
  values ('annual_close',p_period_id,'1.0.0','running',p_initiated_by)
  returning id into run_id;
  update public.economic_periods set status='closing' where id=p_period_id;
  perform economy_private.capture_period_inputs(p_period_id);

  select
    coalesce(sum(i.nominal_value),0),
    coalesce(sum(i.real_value),0)
  into nominal_gdp,real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where p.period_type='quarter' and p.rp_year=period_row.rp_year
    and i.indicator_code='gdp_real';

  select i.real_value into previous_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where p.period_type='year' and p.rp_year=period_row.rp_year-1
    and i.indicator_code='gdp_real'
  limit 1;
  growth := case when coalesce(previous_real_gdp,0)=0 then null else (real_gdp/previous_real_gdp-1)*100 end;

  select avg(i.nominal_value) into unemployment
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where p.period_type='month' and p.rp_year=period_row.rp_year and i.indicator_code='unemployment_rate';

  select i.nominal_value into inflation
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where p.period_type='month' and p.rp_year=period_row.rp_year and i.indicator_code='inflation_annual'
  order by p.rp_month desc limit 1;

  select
    coalesce(sum(fp.primary_result),0),
    coalesce(sum(fp.nominal_result),0),
    (array_agg(fp.gross_debt ORDER BY p.ends_at_rp DESC))[1]
  into primary_result,nominal_result,debt
  from public.fiscal_periods fp
  join public.economic_periods p on p.id=fp.period_id
  where p.period_type='quarter' and p.rp_year=period_row.rp_year;

  perform economy_private.upsert_indicator(p_period_id,'gdp_nominal',nominal_gdp,real_gdp,growth,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'gdp_real',nominal_gdp,real_gdp,growth,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'gdp_growth_annual',growth,growth,growth,'percent','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'inflation_annual',inflation,inflation,inflation,'percent','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'unemployment_average',unemployment,unemployment,null,'percent','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'primary_fiscal_result',primary_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'nominal_fiscal_result',nominal_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'public_debt',debt,null,null,'BRL','{}'::jsonb);

  result := jsonb_build_object(
    'period_id',p_period_id,'rp_year',period_row.rp_year,
    'gdp_nominal',nominal_gdp,'gdp_real',real_gdp,'growth',growth,
    'inflation',inflation,'unemployment',unemployment,
    'primary_result',primary_result,'nominal_result',nominal_result,'public_debt',debt
  );

  update public.economic_periods
  set status='closed',closed_at=now(),
      close_hash=encode(extensions.digest(result::text,'sha256'),'hex'),engine_version='1.0.0'
  where id=p_period_id;
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  update public.economic_state set last_annual_close_at=now(),updated_at=now() where id=true;
  perform economy_private.publish_bulletin(p_period_id,'annual');
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    if p_period_id is not null then
      update public.economic_periods set status='failed' where id=p_period_id and status<>'closed';
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.run_operational_engine()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  currency_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
  perform economy_private.queue_missing_period_events();
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  perform private.process_regional_infrastructure();
  perform private.run_company_economy();
  perform private.process_residence_leases();
  perform private.refresh_stock_prices();
  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  currency_result:=public.recalculate_currency_market('BR','operational:'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24'),true);
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    result:=economy_private.close_month(period_row.id,true,null);
    if result ? 'period_id' and not result ? 'status' then closed_months:=closed_months+1;end if;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    result:=economy_private.close_quarter(period_row.id,true,null);
    if result ? 'period_id' and not result ? 'status' then closed_quarters:=closed_quarters+1;end if;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    result:=economy_private.close_year(period_row.id,true,null);
    if result ? 'period_id' and not result ? 'status' then closed_years:=closed_years+1;end if;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,'currency',currency_result,
    'closed_months',closed_months,
    'closed_quarters',closed_quarters,
    'closed_years',closed_years
  );
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION public.process_automatic_stabilizers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare unemployment numeric:=coalesce(economy_private.latest_indicator('unemployment_rate'),8.5); threshold numeric:=economy_private.calibration_numeric('automatic_stabilizer_unemployment_threshold',10); transfer_amount numeric; event_source_id text; created_expenditure uuid;
begin
  if auth.uid() is not null and not public.economic_has_role(array['Admin']) then raise exception 'Execução manual restrita ao Admin.' using errcode='42501'; end if;
  if unemployment<=threshold then return jsonb_build_object('status','not_required','unemployment_rate',unemployment); end if;
  transfer_amount:=least((unemployment-threshold)*economy_private.calibration_numeric('baseline_population',2000000)*25,economy_private.calibration_numeric('automatic_stabilizer_monthly_cap',100000000));
  event_source_id:='unemployment:'||to_char(public.rp_now() AT TIME ZONE 'UTC','YYYY-MM');
  insert into public.government_expenditures(expenditure_type,ministry,source_table,source_id,amount,productive_share,occurred_at_rp,metadata)
  values('social_assistance','Assistência Social','automatic_stabilizers',event_source_id,transfer_amount,0,public.rp_now(),jsonb_build_object('unemployment_rate',unemployment,'threshold',threshold,'accounting_scope','national_simulation','bank_disbursement',false,'financing','national_fiscal_balance'))
  on conflict(source_table,source_id,expenditure_type) do nothing returning id into created_expenditure;
  if created_expenditure is null then return jsonb_build_object('status','already_processed','source_id',event_source_id); end if;
  return jsonb_build_object('status','processed','amount',transfer_amount,'expenditure_id',created_expenditure);
end; $function$;

COMMIT;
