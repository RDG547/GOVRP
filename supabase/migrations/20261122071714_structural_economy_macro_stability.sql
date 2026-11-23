BEGIN;
-- One national population denominator, without rewriting demographic records.
CREATE OR REPLACE FUNCTION economy_private.national_population()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT greatest(1,coalesce(nullif((SELECT sum(population_count) FROM public.country_population_segments WHERE country_code='BR'),0),
 nullif((SELECT sum(population) FROM public.economic_regions WHERE country_code='BR'),0),
 economy_private.calibration_numeric('baseline_population',2000000)))
$$;
REVOKE ALL ON FUNCTION economy_private.national_population() FROM PUBLIC,anon,authenticated;

CREATE TABLE economy_private.price_simulation_clock(
 basket_item_id uuid PRIMARY KEY REFERENCES public.price_basket_items(id),
 last_rp_at timestamptz NOT NULL, last_run_id uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE economy_private.price_simulation_clock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.price_simulation_clock FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.process_operational_prices(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.price_basket_items%rowtype; state public.economic_state%rowtype;
 stamp economy_private.price_simulation_clock%rowtype; rp_at timestamptz:=public.rp_now();
 period_id uuid; observation_period_id uuid; observation_at timestamptz; elapsed numeric; monthly_rate numeric; next_price numeric; count_rows integer:=0;
 month_seconds numeric:=365.2425*86400/12;
BEGIN
 IF p_run_id IS NULL THEN RAISE EXCEPTION 'Execução econômica obrigatória.';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:economy:prices'));
 SELECT * INTO state FROM public.economic_state WHERE id=true;
 period_id:=economy_private.period_for('month',rp_at);
 FOR item IN SELECT * FROM public.price_basket_items WHERE is_active ORDER BY id FOR UPDATE LOOP
  IF EXISTS(SELECT 1 FROM public.price_observations WHERE source_table='economic_engine_runs'
    AND source_id=p_run_id::text||':'||item.code AND basket_item_id=item.id) THEN CONTINUE;END IF;
  INSERT INTO economy_private.price_simulation_clock(basket_item_id,last_rp_at)
  VALUES(item.id,rp_at) ON CONFLICT DO NOTHING;
  SELECT * INTO stamp FROM economy_private.price_simulation_clock WHERE basket_item_id=item.id FOR UPDATE;
  elapsed:=least(1,greatest(0,extract(epoch FROM rp_at-stamp.last_rp_at)/month_seconds));
  monthly_rate:=greatest(-.15,least(.15,
   power(greatest(.01,1+state.inflation_target/100),1::numeric/12)-1
   +(state.consumer_confidence-50)/100*.015
   +(10-state.current_selic)/100*.01
   +(economy_private.active_policy_impact('inflation_points')
    +economy_private.active_shock_impact('inflation_points',item.sector_id))/100/12));
  next_price:=round(greatest(.01,item.current_price*power(1+monthly_rate,elapsed)),4);
  observation_at:=stamp.last_rp_at+make_interval(secs=>(elapsed*month_seconds)::double precision);
  observation_period_id:=economy_private.period_for('month',observation_at);
  INSERT INTO public.price_observations(basket_item_id,sector_id,source_table,source_id,price,is_simulated,
    observed_at_real,observed_at_rp,period_id,metadata)
  VALUES(item.id,item.sector_id,'economic_engine_runs',p_run_id::text||':'||item.code,next_price,true,
    now(),observation_at,observation_period_id,
    jsonb_build_object('method','elapsed_rp_time_v2','elapsed_rp_months',elapsed,'monthly_rate',monthly_rate,
     'backlog_rp_months',greatest(0,extract(epoch FROM rp_at-stamp.last_rp_at)/month_seconds-elapsed)))
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
   UPDATE public.price_basket_items SET current_price=next_price,updated_at=now() WHERE id=item.id;
   UPDATE economy_private.price_simulation_clock SET last_rp_at=stamp.last_rp_at+make_interval(secs=>(elapsed*month_seconds)::double precision),last_run_id=p_run_id,updated_at=now() WHERE basket_item_id=item.id;
   count_rows:=count_rows+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('observations',count_rows,'period_id',period_id,'method','elapsed_rp_time_v2');
END $$;
REVOKE ALL ON FUNCTION economy_private.process_operational_prices(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.calculate_cpi(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  cpi_value numeric;
  previous_cpi numeric;
  year_ago_cpi numeric;
  monthly_inflation numeric;
  annual_inflation numeric;
begin
  select * into period_row
  from public.economic_periods
  where id = p_month_period_id
    and period_type = 'month';

  with latest_prices as (
    select distinct on (po.basket_item_id)
      po.basket_item_id,
      po.price
    from public.price_observations po
    where po.observed_at_rp < period_row.ends_at_rp AND po.is_simulated
    order by po.basket_item_id, po.observed_at_rp desc,po.id desc
  )
  select sum(
    pbi.weight
    * (
      coalesce(lp.price, pbi.base_price)
      / greatest(pbi.base_price, .000001)
    )
    * 100
  ) / nullif(sum(pbi.weight),0)
  into cpi_value
  from public.price_basket_items pbi
  left join latest_prices lp on lp.basket_item_id = pbi.id
  where pbi.is_active;

  select i.nominal_value into previous_cpi
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = 'cpi_index'
    and p.period_type = 'month'
    and p.ends_at_rp <= period_row.starts_at_rp
  order by p.ends_at_rp desc
  limit 1;

  select i.nominal_value into year_ago_cpi
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = 'cpi_index'
    and p.period_type = 'month'
    and p.rp_year = period_row.rp_year - 1
    and p.rp_month = period_row.rp_month
  limit 1;

  IF cpi_value IS NULL OR cpi_value<=0 THEN RAISE EXCEPTION 'Cesta de preços sem ponderação válida.';END IF;
  previous_cpi := coalesce(previous_cpi, 100);
  monthly_inflation := case
    when previous_cpi = 0 then 0
    else ((cpi_value / previous_cpi) - 1) * 100
  end;
  annual_inflation := case
    when coalesce(year_ago_cpi, 0) = 0 then
      NULL
    else ((cpi_value / year_ago_cpi) - 1) * 100
  end;

  perform economy_private.upsert_indicator(
    p_month_period_id, 'cpi_index', cpi_value, cpi_value, monthly_inflation,
    'index', jsonb_build_object('base', 100)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'inflation_monthly', monthly_inflation, monthly_inflation, monthly_inflation,
    'percent', jsonb_build_object('cpi_current', cpi_value, 'cpi_previous', previous_cpi)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'inflation_annual', annual_inflation, annual_inflation, annual_inflation,
    'percent', jsonb_build_object('history_available', year_ago_cpi is not null,'annualized_when_history_missing',false,'price_basis','comparable_simulated_basket')
  );

  update public.economic_state
  set cpi_index = cpi_value,
      gdp_deflator = cpi_value,
      updated_at = now()
  where id = true;

  return jsonb_build_object(
    'cpi', round(cpi_value, 6),
    'monthly_inflation', round(monthly_inflation, 6),
    'annual_inflation', round(annual_inflation, 6)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.calculate_labor_market(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  state_row public.economic_state%rowtype;
  population numeric := economy_private.national_population();
  baseline_unemployment numeric := economy_private.calibration_numeric('baseline_unemployment_rate', 8.5);
  baseline_wage numeric := economy_private.calibration_numeric('baseline_average_wage', 3000);
  player_labor_force numeric;
  player_unemployed numeric;
  player_unemployment numeric;
  working_age numeric;
  labor_force numeric;
  unemployment_rate numeric;
  employed numeric;
  unemployed numeric;
  private_jobs numeric;
  public_jobs numeric;
  hires_count numeric;
  dismissals_count numeric;
  average_wage numeric;
  real_wage numeric;
  wage_mass numeric;
  participation numeric;
  growth_effect numeric;
  shock_effect numeric;
  policy_effect numeric;
begin
  select * into period_row from public.economic_periods where id=p_month_period_id;
  select * into state_row from public.economic_state where id=true;
  perform economy_private.refresh_citizen_labor_statuses();

  select
    count(*) filter (
      where labor_status in (
        'private_employee','public_employee','entrepreneur','self_employed','unemployed'
      )
    ),
    count(*) filter (
      where labor_status='unemployed' and actively_seeking
    )
  into player_labor_force, player_unemployed
  from public.citizen_economic_statuses;

  player_unemployment := case
    when coalesce(player_labor_force, 0)=0 then baseline_unemployment
    else (player_unemployed / player_labor_force) * 100
  end;

  growth_effect := coalesce(economy_private.latest_indicator('gdp_growth_quarterly'), 0) * -.18;
  shock_effect := -economy_private.active_shock_impact('employment_percent');
  policy_effect := -economy_private.active_policy_impact('employment_percent');
  unemployment_rate := economy_private.clamp(
    baseline_unemployment
      + growth_effect
      + shock_effect
      + policy_effect
      + least(state_row.player_share,coalesce(player_labor_force,0)/greatest(100+coalesce(player_labor_force,0),1)) * (player_unemployment - baseline_unemployment),
    1,
    40
  );

  -- Small online samples cannot instantly move half the national labor force.
  unemployment_rate:=greatest(1,least(40,coalesce((SELECT s.unemployment_rate FROM public.labor_market_snapshots s
   JOIN public.economic_periods p ON p.id=s.period_id WHERE p.period_type='month' AND p.ends_at_rp<=period_row.starts_at_rp
   ORDER BY p.ends_at_rp DESC LIMIT 1),baseline_unemployment)
   +greatest(-2,least(2,(unemployment_rate-coalesce((SELECT s.unemployment_rate FROM public.labor_market_snapshots s
   JOIN public.economic_periods p ON p.id=s.period_id WHERE p.period_type='month' AND p.ends_at_rp<=period_row.starts_at_rp
   ORDER BY p.ends_at_rp DESC LIMIT 1),baseline_unemployment))*.25))));
  working_age := population * .66;
  participation := economy_private.clamp(
    62 + (state_row.consumer_confidence - 50) * .08,
    45,
    78
  );
  labor_force := working_age * participation / 100;
  unemployed := labor_force * unemployment_rate / 100;
  employed := labor_force - unemployed;
  public_jobs := employed * .18;
  private_jobs := employed - public_jobs;

  select
    coalesce(sum(coalesce(e.quantity, 1) * greatest(e.macro_weight, .1))
      filter (where e.event_type='employee_hired'), 0),
    coalesce(sum(coalesce(e.quantity, 1) * greatest(e.macro_weight, .1))
      filter (where e.event_type='employee_dismissed'), 0)
  into hires_count, dismissals_count
  from public.economic_events e
  where e.occurred_at_rp >= period_row.starts_at_rp
    and e.occurred_at_rp < period_row.ends_at_rp;

  hires_count := hires_count
    * economy_private.calibration_numeric('player_representativity_factor', 1000);
  dismissals_count := dismissals_count
    * economy_private.calibration_numeric('player_representativity_factor', 1000);
  average_wage := baseline_wage
    * (state_row.cpi_index / 100)
    * (1 + greatest(coalesce(economy_private.latest_indicator('gdp_growth_quarterly'), 0), -10) / 250);
  real_wage := average_wage / greatest(state_row.cpi_index / 100, .000001);
  wage_mass := average_wage * employed;

  insert into public.labor_market_snapshots (
    period_id,
    working_age_population,
    labor_force,
    employed,
    unemployed,
    outside_labor_force,
    private_employment,
    public_employment,
    open_vacancies,
    hires,
    dismissals,
    participation_rate,
    unemployment_rate,
    average_wage,
    real_average_wage,
    wage_mass,
    productivity_per_worker,
    metadata
  )
  values (
    p_month_period_id,
    working_age,
    labor_force,
    employed,
    unemployed,
    working_age-labor_force,
    private_jobs,
    public_jobs,
    greatest((hires_count-dismissals_count)*1.25, population*.003),
    hires_count,
    dismissals_count,
    participation,
    unemployment_rate,
    average_wage,
    real_wage,
    wage_mass,
    coalesce(economy_private.latest_indicator('gdp_real'), state_row.base_monthly_gdp*3)
      / greatest(employed, 1),
    jsonb_build_object(
      'player_labor_force', player_labor_force,
      'player_unemployed', player_unemployed,
      'player_unemployment_rate', player_unemployment,
      'simulated_share', state_row.simulated_share
    )
  )
  on conflict (period_id) do update set
    working_age_population=excluded.working_age_population,
    labor_force=excluded.labor_force,
    employed=excluded.employed,
    unemployed=excluded.unemployed,
    outside_labor_force=excluded.outside_labor_force,
    private_employment=excluded.private_employment,
    public_employment=excluded.public_employment,
    open_vacancies=excluded.open_vacancies,
    hires=excluded.hires,
    dismissals=excluded.dismissals,
    participation_rate=excluded.participation_rate,
    unemployment_rate=excluded.unemployment_rate,
    average_wage=excluded.average_wage,
    real_average_wage=excluded.real_average_wage,
    wage_mass=excluded.wage_mass,
    productivity_per_worker=excluded.productivity_per_worker,
    metadata=excluded.metadata;

  perform economy_private.upsert_indicator(
    p_month_period_id, 'unemployment_rate', unemployment_rate, unemployment_rate,
    null, 'percent', jsonb_build_object('labor_force', labor_force)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'labor_participation_rate', participation, participation,
    null, 'percent', '{}'::jsonb
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'employment_total', employed, employed,
    hires_count-dismissals_count, 'people', jsonb_build_object(
      'private', private_jobs, 'public', public_jobs
    )
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'average_wage', average_wage, real_wage,
    null, 'BRL', jsonb_build_object('wage_mass', wage_mass)
  );

  return jsonb_build_object(
    'unemployment_rate', round(unemployment_rate, 4),
    'participation_rate', round(participation, 4),
    'employment', round(employed, 0),
    'average_wage', round(average_wage, 2)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.detect_cycle(p_quarter_period_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  current_growth numeric;
  previous_growth numeric;
  two_quarter_growth numeric;
  annual_inflation numeric;
  unemployment numeric;
  previous_cycle text;
  earlier_growth numeric; oldest_growth numeric;
  detected text;
  min_decline numeric := economy_private.calibration_numeric('recession_minimum_decline',.005)*100;
begin
  select * into period_row from public.economic_periods where id=p_quarter_period_id;
  select real_value into current_growth
    from public.economic_indicators where period_id=p_quarter_period_id and indicator_code='gdp_growth_quarterly';
  select i.real_value into previous_growth
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_growth_quarterly'
    and p.period_type='quarter'
    and p.ends_at_rp=period_row.starts_at_rp and p.status='closed'
  order by p.ends_at_rp desc limit 1;
  annual_inflation := economy_private.latest_indicator('inflation_annual',period_row.ends_at_rp);
  unemployment := economy_private.latest_indicator('unemployment_rate',period_row.ends_at_rp);
  select i.metadata->>'cycle' into previous_cycle from public.economic_indicators i
   join public.economic_periods p on p.id=i.period_id
   where i.indicator_code='economic_cycle_code' and p.period_type='quarter' and p.status='closed'
    and p.ends_at_rp=period_row.starts_at_rp;
  select i.real_value into earlier_growth from public.economic_indicators i
   join public.economic_periods p on p.id=i.period_id
   where i.indicator_code='gdp_growth_quarterly' and p.period_type='quarter' and p.status='closed'
    and p.ends_at_rp=((period_row.starts_at_rp AT TIME ZONE 'UTC')-interval '3 months') AT TIME ZONE 'UTC';
  select i.real_value into oldest_growth from public.economic_indicators i
   join public.economic_periods p on p.id=i.period_id
   where i.indicator_code='gdp_growth_quarterly' and p.period_type='quarter' and p.status='closed'
    and p.ends_at_rp=((period_row.starts_at_rp AT TIME ZONE 'UTC')-interval '6 months') AT TIME ZONE 'UTC';
  two_quarter_growth := coalesce(current_growth,0)+coalesce(previous_growth,0);

  detected := case
    when coalesce(current_growth,0)<0 and coalesce(previous_growth,0)<0
      and coalesce(annual_inflation,0)>(select inflation_target+2 from public.economic_state where id=true)
      and coalesce(unemployment,0)>10 then 'stagflation'
    when current_growth<0 and previous_growth<0 and two_quarter_growth<=-3 then 'deep_recession'
    when coalesce(current_growth,0)<0
      and coalesce(previous_growth,0)<0
      and two_quarter_growth<=-min_decline then 'technical_recession'
    when coalesce(current_growth,0)<0 then 'slowdown'
    when current_growth>0 and previous_growth>0 and earlier_growth<0 and oldest_growth<0 then 'recovery'
    when previous_cycle in ('technical_recession','recession','deep_recession','stagflation') and current_growth>0 then 'slowdown'
    when coalesce(current_growth,0)>5
      and coalesce(annual_inflation,0)>(select inflation_target+1 from public.economic_state where id=true)
      then 'overheating'
    when coalesce(current_growth,0)>4 and coalesce(unemployment,100)<6 then 'boom'
    when coalesce(current_growth,0)>0
      and coalesce(previous_growth,current_growth)>=current_growth+1 then 'slowdown'
    when coalesce(current_growth,0)>.3 then 'expansion'
    else 'stable'
  end;

  update public.economic_state
  set economic_cycle=detected,updated_at=now()
  where id=true;

  perform economy_private.upsert_indicator(
    p_quarter_period_id,'economic_cycle_code',
    case detected
      when 'deep_recession' then -4
      when 'recession' then -3
      when 'technical_recession' then -2
      when 'stagflation' then -1
      when 'slowdown' then 0
      when 'stable' then 1
      when 'recovery' then 2
      when 'expansion' then 3
      when 'boom' then 4
      when 'overheating' then 5
    end,
    null,null,'code',jsonb_build_object('cycle',detected)
  );

  if detected in ('technical_recession','recession','deep_recession','stagflation') then
    perform economy_private.create_alert(
      'economic_cycle_'||detected,
      case when detected in ('deep_recession','stagflation') then 'critical' else 'warning' end,
      case detected
        when 'technical_recession' then 'Economia entrou em recessão técnica'
        when 'recession' then 'Economia em recessão'
        when 'deep_recession' then 'Recessão profunda detectada'
        else 'Estagflação detectada'
      end,
      'O ciclo foi identificado automaticamente a partir do PIB real, inflação, emprego e confiança.',
      p_quarter_period_id
    );
  elsif detected='recovery' then
    perform economy_private.create_alert(
      'economic_recovery','info','Economia entrou em recuperação',
      'O PIB real voltou a crescer e os indicadores antecedentes melhoraram.',
      p_quarter_period_id
    );
  end if;

  return detected;
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.generate_simulated_base(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  sector_row public.economic_sectors%rowtype;
  state_row public.economic_state%rowtype;
  sector_gdp numeric;
  output_shock numeric;
  policy_output numeric;
  midpoint_rp timestamptz;
  generated_count integer := 0;
  source_id text; previous_period public.economic_periods%rowtype; previous_index numeric; next_index numeric; target_index numeric;
  consumption_factor numeric; investment_factor numeric; government_factor numeric; exports_factor numeric; imports_factor numeric;
  demand_weights numeric; previous_weights numeric; growth_factor numeric; previous_base numeric; period_base numeric; drivers jsonb;
begin
  select * into period_row
  from public.economic_periods
  where id = p_month_period_id
    and period_type = 'month';

  if not found then
    raise exception 'Período mensal não encontrado.';
  end if;

  select * into state_row
  from public.economic_state
  where id = true;

  midpoint_rp := period_row.starts_at_rp
    + ((period_row.ends_at_rp - period_row.starts_at_rp) / 2);
  policy_output := economy_private.active_policy_impact('output_percent');
  select * into previous_period from public.economic_periods where period_type='month' and status='closed' and ends_at_rp<=period_row.starts_at_rp order by ends_at_rp desc limit 1;
  consumption_factor:=greatest(.4,least(1.5,1+economy_private.active_policy_impact('consumption_percent')/100-(state_row.current_selic-10)*.004+(state_row.consumer_confidence-50)*.002));
  investment_factor:=greatest(.25,least(1.6,1+economy_private.active_policy_impact('investment_percent')/100-(state_row.current_selic-10)*.007+(state_row.business_confidence-50)*.003));
  government_factor:=greatest(.7,least(1.3,1+economy_private.active_policy_impact('output_percent')/200+(state_row.fiscal_confidence-50)*.002));
  exports_factor:=greatest(.7,least(1.3,1+(state_row.exchange_rate/5-1)*.08));
  imports_factor:=greatest(.5,least(1.5,consumption_factor-(state_row.exchange_rate/5-1)*.08));
  target_index:=.62*consumption_factor+.18*investment_factor+.16*government_factor+.12*exports_factor-.08*imports_factor;
  previous_index:=coalesce((previous_period.metadata->'causal_economy'->>'demand_index')::numeric,1);
  next_index:=greatest(.5,least(1.5,previous_index+(target_index-previous_index)*.2));
  growth_factor:=greatest(.94,least(1.04,next_index/previous_index));
  previous_base:=coalesce((previous_period.metadata->'causal_economy'->>'real_monthly_base')::numeric,state_row.base_monthly_gdp);
  period_base:=previous_base*growth_factor;
  drivers:=jsonb_build_object('consumption',consumption_factor,'investment',investment_factor,'government',government_factor,'exports',exports_factor,'imports',imports_factor,'selic',state_row.current_selic,'consumer_confidence',state_row.consumer_confidence,'business_confidence',state_row.business_confidence,'fiscal_confidence',state_row.fiscal_confidence,'target_demand_index',target_index,'demand_index',next_index,'real_growth_factor',growth_factor,'real_monthly_base',period_base,'cpi_snapshot',state_row.cpi_index,'player_share',state_row.player_share,'simulated_share',state_row.simulated_share);
  update public.economic_periods set metadata=metadata||jsonb_build_object('causal_economy',drivers) where id=p_month_period_id;
  demand_weights:=greatest(.1,target_index);


  for sector_row in
    select * from public.economic_sectors where is_active order by code
  loop
    output_shock := economy_private.active_shock_impact('output_percent', sector_row.id);
    sector_gdp := period_base * state_row.cpi_index/100
      * state_row.simulated_share
      * sector_row.gdp_weight
      * greatest(0,1-coalesce((select count(*)::numeric from public.business_employees e join public.businesses b on b.id=e.business_id where b.control_kind='population' and e.fired_at is null and b.economic_sector_id=sector_row.id)/nullif((economy_private.national_population()*.6)*greatest(.01,sector_row.gdp_weight),0),0))
      * greatest(.85,least(1.15,1+output_shock/100));
    source_id := period_row.id::text || ':' || sector_row.code;

    perform economy_private.record_event(
      'simulated_gross_output',
      'gross_output',
      'economy_simulation',
      source_id,
      sector_gdp * 1.45,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'production', 'base_share', state_row.simulated_share),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_intermediate_consumption',
      'intermediate_consumption',
      'economy_simulation',
      source_id,
      sector_gdp * .45,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'production'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_household_consumption',
      'household_consumption',
      'economy_simulation',
      source_id,
      sector_gdp * .62 * consumption_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_productive_investment',
      'productive_investment',
      'economy_simulation',
      source_id,
      sector_gdp * .18 * investment_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_government_spending',
      'government_spending',
      'economy_simulation',
      source_id,
      sector_gdp * .16 * government_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_export',
      'export',
      'economy_simulation',
      source_id,
      sector_gdp * .12 * exports_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'external'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_import',
      'import',
      'economy_simulation',
      source_id,
      sector_gdp * .08 * imports_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'external'),
      'simulated:' || source_id
    );

    generated_count := generated_count + 7;
  end loop;

  return jsonb_build_object(
    'period_id', p_month_period_id,
    'events_expected', generated_count,
    'simulated_share', state_row.simulated_share, 'drivers', drivers
  );
end;
$function$;

COMMIT;
