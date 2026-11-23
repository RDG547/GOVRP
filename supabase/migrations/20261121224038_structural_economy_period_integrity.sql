BEGIN;
-- Prospective change only. Existing periods, indicators, balances and RP clock
-- are not rewritten. Legacy invalid boundaries require an approved recovery.
CREATE OR REPLACE FUNCTION economy_private.period_bounds(p_type text,p_at timestamptz)
RETURNS TABLE(starts_at_rp timestamptz,ends_at_rp timestamptz)
LANGUAGE plpgsql IMMUTABLE SET search_path='' SET timezone='UTC' AS $$
BEGIN
 IF p_at IS NULL OR p_type NOT IN ('month','quarter','year') THEN
  RAISE EXCEPTION 'Período ou data inválidos.';
 END IF;
 RETURN QUERY SELECT date_trunc(p_type,p_at),date_trunc(p_type,p_at)+
  CASE p_type WHEN 'month' THEN interval '1 month' WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END;
END $$;

CREATE OR REPLACE FUNCTION economy_private.period_close_readiness(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.economic_periods%rowtype; canonical record; child_type text;
 expected_count integer; child_count integer; closed_count integer; valid_count integer;
BEGIN
 SELECT * INTO p FROM public.economic_periods WHERE id=p_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'Período econômico inexistente.';END IF;
 IF p.status='closed' THEN RETURN jsonb_build_object('status','already_closed','period_id',p_id);END IF;
 SELECT * INTO canonical FROM economy_private.period_bounds(p.period_type,
   make_timestamptz(p.rp_year,CASE p.period_type WHEN 'month' THEN p.rp_month WHEN 'quarter' THEN (p.rp_quarter-1)*3+1 ELSE 1 END,1,0,0,0,'UTC'));
 IF p.starts_at_rp IS DISTINCT FROM canonical.starts_at_rp OR p.ends_at_rp IS DISTINCT FROM canonical.ends_at_rp
  OR p.starts_at IS DISTINCT FROM public.rp_date_to_real_date(canonical.starts_at_rp)
  OR p.ends_at IS DISTINCT FROM public.rp_date_to_real_date(canonical.ends_at_rp) THEN
  RETURN jsonb_build_object('status','blocked_legacy_bounds','period_id',p_id,'requires_review',true);
 END IF;
 -- p_force may request a retry; it must never close a future period.
 IF statement_timestamp()<p.ends_at THEN RETURN jsonb_build_object('status','not_due','period_id',p_id);END IF;
 IF EXISTS(SELECT 1 FROM public.economic_periods x WHERE x.period_type=p.period_type
  AND x.starts_at_rp<p.starts_at_rp AND x.status<>'closed') THEN
  RETURN jsonb_build_object('status','blocked_previous_period','period_id',p_id);
 END IF;
 IF p.period_type IN ('quarter','year') THEN
  child_type:=CASE p.period_type WHEN 'quarter' THEN 'month' ELSE 'quarter' END;
  expected_count:=CASE p.period_type WHEN 'quarter' THEN 3 ELSE 4 END;
  SELECT count(*),count(*) FILTER(WHERE c.status='closed'),
   count(*) FILTER(WHERE c.starts_at_rp=b.starts_at_rp AND c.ends_at_rp=b.ends_at_rp)
  INTO child_count,closed_count,valid_count
  FROM public.economic_periods c
  CROSS JOIN LATERAL economy_private.period_bounds(child_type,c.starts_at_rp) b
  WHERE c.period_type=child_type AND c.starts_at_rp>=p.starts_at_rp AND c.starts_at_rp<p.ends_at_rp;
  IF child_count<>expected_count OR closed_count<>expected_count OR valid_count<>expected_count THEN
   RETURN jsonb_build_object('status','blocked_children','period_id',p_id,'expected',expected_count,
    'children',child_count,'closed_children',closed_count,'valid_children',valid_count);
  END IF;
 END IF;
 RETURN jsonb_build_object('status','ready','period_id',p_id);
END $$;

CREATE TABLE economy_private.period_revision_queue (
 event_id uuid NOT NULL REFERENCES public.economic_events(id),
 period_id uuid NOT NULL REFERENCES public.economic_periods(id),
 detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL DEFAULT 'late_event',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed')),
 PRIMARY KEY(event_id,period_id)
);
ALTER TABLE economy_private.period_revision_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.period_revision_queue FROM PUBLIC,anon,authenticated;
CREATE INDEX period_revision_queue_pending ON economy_private.period_revision_queue(period_id) WHERE status='pending';

CREATE OR REPLACE FUNCTION economy_private.track_period_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO economy_private.period_revision_queue(event_id,period_id)
 SELECT NEW.id,p.id FROM public.economic_periods p
 WHERE p.status='closed' AND NEW.occurred_at_rp>=p.starts_at_rp AND NEW.occurred_at_rp<p.ends_at_rp
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER economic_event_revision AFTER INSERT ON public.economic_events
 FOR EACH ROW EXECUTE FUNCTION economy_private.track_period_revision();

CREATE OR REPLACE FUNCTION economy_private.ensure_periods(p_rp_at timestamp with time zone DEFAULT rp_now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET timezone TO 'UTC'
AS $function$
declare
  month_start_rp timestamptz;
  month_end_rp timestamptz;
  quarter_start_rp timestamptz;
  quarter_end_rp timestamptz;
  year_start_rp timestamptz;
  year_end_rp timestamptz;
  rp_year_value integer;
  rp_month_value integer;
  rp_quarter_value integer;
begin
  if p_rp_at is null then
    raise exception 'Relógio RP indisponível.';
  end if;

  month_start_rp := date_trunc('month', p_rp_at);
  month_end_rp := month_start_rp + interval '1 month';
  rp_year_value := extract(year from p_rp_at)::integer;
  rp_month_value := extract(month from p_rp_at)::integer;
  rp_quarter_value := extract(quarter from p_rp_at)::integer;
  quarter_start_rp := make_timestamptz(
    rp_year_value,
    ((rp_quarter_value - 1) * 3) + 1,
    1, 0, 0, 0, 'UTC'
  );
  quarter_end_rp := quarter_start_rp + interval '3 months';
  year_start_rp := make_timestamptz(rp_year_value, 1, 1, 0, 0, 0, 'UTC');
  year_end_rp := year_start_rp + interval '1 year';

  insert into public.economic_periods (
    period_type, rp_year, rp_quarter, rp_month,
    starts_at, ends_at, starts_at_rp, ends_at_rp, status
  )
  values (
    'month', rp_year_value, null, rp_month_value,
    public.rp_date_to_real_date(month_start_rp),
    public.rp_date_to_real_date(month_end_rp),
    month_start_rp, month_end_rp, 'open'
  )
  on conflict do nothing;

  insert into public.economic_periods (
    period_type, rp_year, rp_quarter, rp_month,
    starts_at, ends_at, starts_at_rp, ends_at_rp, status
  )
  values (
    'quarter', rp_year_value, rp_quarter_value, null,
    public.rp_date_to_real_date(quarter_start_rp),
    public.rp_date_to_real_date(quarter_end_rp),
    quarter_start_rp, quarter_end_rp, 'open'
  )
  on conflict do nothing;

  insert into public.economic_periods (
    period_type, rp_year, rp_quarter, rp_month,
    starts_at, ends_at, starts_at_rp, ends_at_rp, status
  )
  values (
    'year', rp_year_value, null, null,
    public.rp_date_to_real_date(year_start_rp),
    public.rp_date_to_real_date(year_end_rp),
    year_start_rp, year_end_rp, 'open'
  )
  on conflict do nothing;

  return jsonb_build_object(
    'rp_year', rp_year_value,
    'rp_quarter', rp_quarter_value,
    'rp_month', rp_month_value
  );
end;
$function$;

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
  cpi_result := economy_private.calculate_cpi(p_period_id);
  labor_result := economy_private.calculate_labor_market(p_period_id);
  perform economy_private.calculate_citizen_snapshots(p_period_id);
  perform economy_private.calculate_business_snapshots(p_period_id);
  confidence_result := economy_private.update_confidence(p_period_id);

  select coalesce(sum(e.economic_amount),0) into consumer_spending
  from public.economic_events e
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
  from public.economic_events e
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
  population numeric := economy_private.calibration_numeric('baseline_population',2000000);
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
  from public.economic_events e
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
    and p.ends_at_rp<=period_row.starts_at_rp
  order by p.ends_at_rp desc limit 1;

  select i.real_value into year_ago_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.rp_year=period_row.rp_year-1
    and p.rp_quarter=period_row.rp_quarter
  limit 1;

  growth_quarter := case when coalesce(previous_real_gdp,0)=0 then 0
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
    jsonb_build_object('previous_real_gdp',previous_real_gdp)
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
  left join public.economic_events e
    on e.sector_id=es.id
   and e.occurred_at_rp>=period_row.starts_at_rp
   and e.occurred_at_rp<period_row.ends_at_rp
  where es.is_active
  group by es.id;

  select coalesce(sum(gr.amount),0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from public.economic_events e
      where e.source_table='transactions'
        and e.economic_classification in ('product_tax','income_tax')
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0)
  into revenue
  from public.government_revenues gr
  where gr.occurred_at_rp>=period_row.starts_at_rp
    and gr.occurred_at_rp<period_row.ends_at_rp;

  select coalesce(sum(ge.amount) filter (where ge.expenditure_type<>'debt_interest'),0),
         coalesce(sum(ge.amount) filter (where ge.expenditure_type='social_assistance'),0)
  into expenditure_primary,transfers
  from public.government_expenditures ge
  where ge.occurred_at_rp>=period_row.starts_at_rp
    and ge.occurred_at_rp<period_row.ends_at_rp;

  expenditure_primary := coalesce(expenditure_primary,0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from public.economic_events e
      where e.source_table='transactions'
        and e.economic_classification='social_transfer'
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0);

  select public_debt into old_debt from public.economic_state where id=true;
  interest_cost := old_debt
    * (select current_selic from public.economic_state where id=true)
    / 100 / 4;
  primary_result := revenue-expenditure_primary;
  nominal_result := primary_result-interest_cost;
  new_debt := greatest(0,old_debt-nominal_result);
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
    p_period_id,revenue,
    coalesce((select sum(amount) from public.government_revenues
      where revenue_type='state_dividend'
        and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0),
    0,expenditure_primary,investment,transfers,subsidies,
    interest_cost,primary_result,nominal_result,new_debt,new_debt,
    debt_ratio,(select current_selic from public.economic_state where id=true),
    24,interest_cost,
    coalesce((select treasury_balance from public.government_finances where id=1),0),
    v_fiscal_confidence,fiscal_risk,
    jsonb_build_object('revenue_source','government_revenues_plus_transaction_taxes')
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
  from public.economic_events e
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
  growth := case when coalesce(previous_real_gdp,0)=0 then 0 else (real_gdp/previous_real_gdp-1)*100 end;

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
    max(fp.gross_debt)
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

REVOKE ALL ON FUNCTION economy_private.period_close_readiness(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION economy_private.period_bounds(text,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION economy_private.track_period_revision() FROM PUBLIC,anon,authenticated;
COMMIT;
