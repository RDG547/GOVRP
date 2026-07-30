begin;

create or replace function economy_private.upsert_indicator(
  p_period_id uuid,
  p_code text,
  p_nominal numeric,
  p_real numeric,
  p_variation numeric,
  p_unit text,
  p_metadata jsonb default '{}'::jsonb,
  p_status text default 'official'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  indicator_id uuid;
begin
  insert into public.economic_indicators (
    period_id,
    indicator_code,
    nominal_value,
    real_value,
    variation,
    unit,
    status,
    metadata,
    engine_version
  )
  values (
    p_period_id,
    p_code,
    p_nominal,
    p_real,
    p_variation,
    p_unit,
    p_status,
    coalesce(p_metadata, '{}'::jsonb),
    '1.0.0'
  )
  on conflict (period_id, indicator_code) do update set
    nominal_value = excluded.nominal_value,
    real_value = excluded.real_value,
    variation = excluded.variation,
    unit = excluded.unit,
    status = excluded.status,
    metadata = excluded.metadata,
    engine_version = excluded.engine_version
  returning id into indicator_id;

  return indicator_id;
end;
$$;

create or replace function economy_private.latest_indicator(
  p_code text,
  p_before_rp timestamptz default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(i.real_value, i.nominal_value)
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = p_code
    and p.status = 'closed'
    and (p_before_rp is null or p.ends_at_rp <= p_before_rp)
  order by p.ends_at_rp desc
  limit 1
$$;

create or replace function economy_private.create_alert(
  p_code text,
  p_severity text,
  p_title text,
  p_message text,
  p_period_id uuid default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_id uuid;
begin
  insert into public.economic_alerts (
    alert_code,
    severity,
    title,
    message,
    period_id,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_code,
    p_severity,
    p_title,
    p_message,
    p_period_id,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (alert_code, period_id, entity_type, entity_id) do update set
    severity = excluded.severity,
    title = excluded.title,
    message = excluded.message,
    status = 'active',
    resolved_at = null,
    metadata = excluded.metadata
  returning id into alert_id;

  return alert_id;
end;
$$;

create or replace function economy_private.update_activity_mix()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_players integer;
  transactions_count integer;
  active_businesses integer;
  employment_actions integer;
  score numeric;
  thresholds jsonb;
  shares jsonb;
  activity_level text;
  simulated numeric;
begin
  select count(distinct uas.user_id) into active_players
  from public.user_activity_sessions uas
  where uas.last_seen_at >= now() - interval '7 days';

  select count(*) into transactions_count
  from public.transactions t
  where t.created_at >= now() - interval '7 days';

  select count(*) into active_businesses
  from public.businesses b
  where b.status = 'active'
    and b.updated_at >= now() - interval '14 days';

  select count(*) into employment_actions
  from public.economic_events e
  where e.event_type in ('employee_hired', 'employee_dismissed')
    and e.occurred_at_real >= now() - interval '7 days';

  score := coalesce(active_players, 0)
    + least(coalesce(transactions_count, 0), 300) * .18
    + coalesce(active_businesses, 0) * 4
    + coalesce(employment_actions, 0) * 2;

  thresholds := economy_private.calibration_json(
    'activity_thresholds',
    '{"very_low":15,"low":40,"medium":90,"high":180}'::jsonb
  );
  shares := economy_private.calibration_json(
    'simulated_share_levels',
    '{"very_low":0.80,"low":0.70,"medium":0.50,"high":0.30,"very_high":0.15}'::jsonb
  );

  activity_level := case
    when score < coalesce((thresholds->>'very_low')::numeric, 15) then 'very_low'
    when score < coalesce((thresholds->>'low')::numeric, 40) then 'low'
    when score < coalesce((thresholds->>'medium')::numeric, 90) then 'medium'
    when score < coalesce((thresholds->>'high')::numeric, 180) then 'high'
    else 'very_high'
  end;

  simulated := coalesce((shares->>activity_level)::numeric, .8);

  update public.economic_state
  set
    player_activity_level = activity_level,
    simulated_share = simulated,
    player_share = 1 - simulated,
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'activity_score', round(score, 4),
        'active_players', active_players,
        'recent_transactions', transactions_count,
        'active_businesses', active_businesses,
        'employment_actions', employment_actions
      ),
    updated_at = now()
  where id = true;

  return jsonb_build_object(
    'level', activity_level,
    'score', round(score, 4),
    'simulated_share', simulated,
    'player_share', 1 - simulated
  );
end;
$$;

create or replace function economy_private.active_shock_impact(
  p_impact_code text,
  p_sector_id uuid default null
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case
      when coalesce(s.impacts->>p_impact_code, '') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (s.impacts->>p_impact_code)::numeric * s.intensity
      else 0
    end
  ), 0)
  from public.economic_shocks s
  where s.status = 'active'
    and public.rp_now() >= s.starts_at_rp
    and (s.ends_at_rp is null or public.rp_now() < s.ends_at_rp)
    and (
      p_sector_id is null
      or cardinality(s.affected_sector_ids) = 0
      or p_sector_id = any(s.affected_sector_ids)
    )
$$;

create or replace function economy_private.active_policy_impact(
  p_effect_code text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    pe.total_impact
    * case
        when public.rp_now() < pe.starts_at_rp then 0
        when public.rp_now() >= pe.ends_at_rp then 0
        when public.rp_now() <= pe.peaks_at_rp then
          extract(epoch from (public.rp_now() - pe.starts_at_rp))
          / greatest(extract(epoch from (pe.peaks_at_rp - pe.starts_at_rp)), 1)
        else
          extract(epoch from (pe.ends_at_rp - public.rp_now()))
          / greatest(extract(epoch from (pe.ends_at_rp - pe.peaks_at_rp)), 1)
      end
  ), 0)
  from public.economic_policy_effects pe
  join public.economic_policy_decisions pd on pd.id = pe.policy_decision_id
  where pe.effect_code = p_effect_code
    and pd.status in ('announced', 'effective')
$$;

create or replace function economy_private.refresh_policy_and_shock_statuses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  policies_effective integer;
  policies_expired integer;
  shocks_active integer;
  shocks_resolved integer;
begin
  update public.economic_policy_decisions
  set status = 'effective'
  where status = 'announced'
    and effective_at_rp <= public.rp_now();
  get diagnostics policies_effective = row_count;

  update public.economic_policy_decisions
  set status = 'expired'
  where status in ('announced', 'effective')
    and expires_at_rp is not null
    and expires_at_rp <= public.rp_now();
  get diagnostics policies_expired = row_count;

  update public.economic_shocks
  set status = 'active'
  where status = 'scheduled'
    and starts_at_rp <= public.rp_now();
  get diagnostics shocks_active = row_count;

  update public.economic_shocks
  set status = 'resolved'
  where status = 'active'
    and ends_at_rp is not null
    and ends_at_rp <= public.rp_now();
  get diagnostics shocks_resolved = row_count;

  return jsonb_build_object(
    'policies_effective', policies_effective,
    'policies_expired', policies_expired,
    'shocks_active', shocks_active,
    'shocks_resolved', shocks_resolved
  );
end;
$$;

create or replace function economy_private.generate_simulated_base(
  p_month_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  sector_row public.economic_sectors%rowtype;
  state_row public.economic_state%rowtype;
  sector_gdp numeric;
  output_shock numeric;
  policy_output numeric;
  midpoint_rp timestamptz;
  generated_count integer := 0;
  source_id text;
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

  for sector_row in
    select * from public.economic_sectors where is_active order by code
  loop
    output_shock := economy_private.active_shock_impact('output_percent', sector_row.id);
    sector_gdp := state_row.base_monthly_gdp
      * state_row.simulated_share
      * sector_row.gdp_weight
      * greatest(.55, 1 + ((output_shock + policy_output) / 100));
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
      sector_gdp * .62,
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
      sector_gdp * .18,
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
      sector_gdp * .16,
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
      sector_gdp * .12,
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
      sector_gdp * .08,
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
    'simulated_share', state_row.simulated_share
  );
end;
$$;

create or replace function economy_private.process_operational_prices(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_row public.price_basket_items%rowtype;
  state_row public.economic_state%rowtype;
  current_period_id uuid;
  target_hourly numeric;
  demand_pressure numeric;
  interest_pressure numeric;
  shock_pressure numeric;
  policy_pressure numeric;
  price_step numeric;
  next_price numeric;
  inserted_count integer := 0;
  rp_at timestamptz := public.rp_now();
begin
  select * into state_row from public.economic_state where id = true;
  current_period_id := economy_private.period_for('month', rp_at);
  target_hourly := (state_row.inflation_target / 100) / 12 / 14;
  demand_pressure := ((state_row.consumer_confidence - 50) / 100) * .0015;
  interest_pressure := ((10 - state_row.current_selic) / 100) * .001;
  policy_pressure := economy_private.active_policy_impact('inflation_points') / 100 / 12 / 14;

  for item_row in
    select * from public.price_basket_items where is_active order by code
  loop
    shock_pressure := economy_private.active_shock_impact('inflation_points', item_row.sector_id)
      / 100 / 12 / 14;
    price_step := economy_private.clamp(
      target_hourly + demand_pressure + interest_pressure + policy_pressure + shock_pressure,
      -.01,
      .015
    );
    next_price := greatest(.01, item_row.current_price * (1 + price_step));

    update public.price_basket_items
    set current_price = round(next_price, 4), updated_at = now()
    where id = item_row.id;

    insert into public.price_observations (
      basket_item_id,
      sector_id,
      source_table,
      source_id,
      price,
      is_simulated,
      observed_at_real,
      observed_at_rp,
      period_id,
      metadata
    )
    values (
      item_row.id,
      item_row.sector_id,
      'economic_engine_runs',
      p_run_id::text || ':' || item_row.code,
      round(next_price, 4),
      true,
      now(),
      rp_at,
      current_period_id,
      jsonb_build_object(
        'price_step', price_step,
        'target_component', target_hourly,
        'demand_component', demand_pressure,
        'interest_component', interest_pressure,
        'shock_component', shock_pressure,
        'policy_component', policy_pressure
      )
    )
    on conflict do nothing;

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'observations', inserted_count,
    'period_id', current_period_id
  );
end;
$$;

create or replace function economy_private.calculate_cpi(
  p_month_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    where po.observed_at_rp >= period_row.starts_at_rp
      and po.observed_at_rp < period_row.ends_at_rp
    order by po.basket_item_id, po.observed_at_rp desc
  )
  select sum(
    pbi.weight
    * (
      coalesce(lp.price, pbi.current_price)
      / greatest(pbi.base_price, .000001)
    )
    * 100
  )
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

  previous_cpi := coalesce(previous_cpi, 100);
  monthly_inflation := case
    when previous_cpi = 0 then 0
    else ((cpi_value / previous_cpi) - 1) * 100
  end;
  annual_inflation := case
    when coalesce(year_ago_cpi, 0) = 0 then
      (power(greatest(1 + monthly_inflation / 100, .01), 12) - 1) * 100
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
    'percent', jsonb_build_object('annualized_when_history_missing', year_ago_cpi is null)
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
$$;

create or replace function economy_private.refresh_citizen_labor_statuses()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer := 0;
begin
  insert into public.citizen_economic_statuses (
    profile_id, labor_status, actively_seeking, last_economic_activity_at
  )
  select
    p.id,
    case
      when p.is_imprisoned then 'imprisoned'
      when exists (
        select 1 from public.businesses b
        where b.owner_id = p.id and b.status = 'active'
      ) then 'entrepreneur'
      when exists (
        select 1 from public.business_employees be
        where be.profile_id = p.id and be.fired_at is null
      ) then 'private_employee'
      when lower(p.role) in (
        'presidente','vice-presidente','ministro','senador','deputado',
        'juiz','policial','militar','promotor','defensor público',
        'presidente do banco central'
      ) then 'public_employee'
      else 'outside_labor_force'
    end,
    false,
    coalesce(
      (select max(uas.last_seen_at) from public.user_activity_sessions uas where uas.user_id=p.id),
      p.updated_at
    )
  from public.profiles p
  on conflict (profile_id) do nothing;
  get diagnostics changed = row_count;

  update public.citizen_economic_statuses ces
  set
    labor_status = case
      when p.is_imprisoned then 'imprisoned'
      when exists (
        select 1 from public.businesses b
        where b.owner_id = p.id and b.status = 'active'
      ) then 'entrepreneur'
      when exists (
        select 1 from public.business_employees be
        where be.profile_id = p.id and be.fired_at is null
      ) then 'private_employee'
      when lower(p.role) in (
        'presidente','vice-presidente','ministro','senador','deputado',
        'juiz','policial','militar','promotor','defensor público',
        'presidente do banco central'
      ) then 'public_employee'
      else ces.labor_status
    end,
    actively_seeking = case
      when p.is_imprisoned
        or exists (select 1 from public.businesses b where b.owner_id=p.id and b.status='active')
        or exists (select 1 from public.business_employees be where be.profile_id=p.id and be.fired_at is null)
        then false
      else ces.actively_seeking
    end,
    updated_at = now()
  from public.profiles p
  where p.id = ces.profile_id;

  return changed;
end;
$$;

create or replace function economy_private.calculate_labor_market(
  p_month_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  state_row public.economic_state%rowtype;
  population numeric := economy_private.calibration_numeric('baseline_population', 2000000);
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
      + state_row.player_share * (player_unemployment - baseline_unemployment),
    1,
    40
  );

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
$$;

create or replace function economy_private.calculate_citizen_snapshots(
  p_month_period_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  state_row public.economic_state%rowtype;
  basket_cost numeric;
  inserted_count integer;
begin
  select * into period_row from public.economic_periods where id=p_month_period_id;
  select * into state_row from public.economic_state where id=true;
  select sum(pbi.current_price * pbi.weight) into basket_cost
  from public.price_basket_items pbi where pbi.is_active;

  insert into public.citizen_economic_snapshots (
    period_id,
    profile_id,
    labor_status,
    nominal_income,
    disposable_income,
    real_income,
    consumption,
    savings,
    debt,
    debt_service,
    basket_cost,
    purchasing_power_index,
    consumer_confidence,
    poverty_status,
    macro_weight,
    metadata
  )
  select
    p_month_period_id,
    p.id,
    coalesce(ces.labor_status, 'outside_labor_force'),
    valueset.nominal_income,
    valueset.disposable_income,
    valueset.disposable_income / greatest(state_row.cpi_index/100, .000001),
    valueset.consumption,
    coalesce(a.balance, 0),
    valueset.debt,
    valueset.debt_service,
    basket_cost,
    economy_private.clamp(
      (valueset.disposable_income / greatest(basket_cost, 1)) * 100,
      0,
      2000
    ),
    economy_private.clamp(
      state_row.consumer_confidence
        + case when valueset.disposable_income >= basket_cost then 4 else -8 end
        - least(valueset.debt_service / greatest(valueset.disposable_income, 1) * 10, 15),
      0,
      100
    ),
    case
      when valueset.disposable_income < basket_cost * .5 then 'extreme_poverty'
      when valueset.disposable_income < basket_cost then 'poverty'
      when valueset.disposable_income < basket_cost * 1.5 then 'vulnerable'
      when valueset.disposable_income < basket_cost * 5 then 'middle_income'
      else 'high_income'
    end,
    coalesce(ces.macro_weight, 1),
    jsonb_build_object(
      'cpi', state_row.cpi_index,
      'status_source', case when ces.profile_id is null then 'default' else 'economic_status' end
    )
  from public.profiles p
  left join public.citizen_economic_statuses ces on ces.profile_id=p.id
  left join public.accounts a on a.user_id=p.id
  cross join lateral (
    select
      coalesce((
        select sum(abs(e.nominal_amount))
        from public.economic_events e
        where e.actor_profile_id=p.id
          and e.economic_classification in ('compensation','social_transfer')
          and e.occurred_at_rp >= period_row.starts_at_rp
          and e.occurred_at_rp < period_row.ends_at_rp
      ),0) as nominal_income,
      greatest(
        coalesce((
          select sum(abs(e.nominal_amount))
          from public.economic_events e
          where e.actor_profile_id=p.id
            and e.economic_classification in ('compensation','social_transfer')
            and e.occurred_at_rp >= period_row.starts_at_rp
            and e.occurred_at_rp < period_row.ends_at_rp
        ),0)
        - coalesce((
          select sum(abs(e.nominal_amount))
          from public.economic_events e
          where e.actor_profile_id=p.id
            and e.economic_classification in ('income_tax')
            and e.occurred_at_rp >= period_row.starts_at_rp
            and e.occurred_at_rp < period_row.ends_at_rp
        ),0),
        0
      ) as disposable_income,
      coalesce((
        select sum(abs(e.nominal_amount))
        from public.economic_events e
        where e.actor_profile_id=p.id
          and e.economic_classification='household_consumption'
          and e.occurred_at_rp >= period_row.starts_at_rp
          and e.occurred_at_rp < period_row.ends_at_rp
      ),0) as consumption,
      coalesce((
        select sum(greatest(l.amount,0))
        from public.loans l
        where l.user_id=p.id
          and lower(l.status) not in ('pago','paid','perdoado','forgiven','cancelled')
      ),0)
      + coalesce((
        select sum(greatest(la.total_due,la.amount,0))
        from public.loan_applications la
        where la.user_id=p.id
          and lower(la.status) in ('aprovado','approved','ativo','active')
      ),0) as debt,
      coalesce((
        select sum(greatest(la.total_due,la.amount,0)/greatest(coalesce(la.installments,12),1))
        from public.loan_applications la
        where la.user_id=p.id
          and lower(la.status) in ('aprovado','approved','ativo','active')
      ),0) as debt_service
  ) valueset
  on conflict (period_id, profile_id) do update set
    labor_status=excluded.labor_status,
    nominal_income=excluded.nominal_income,
    disposable_income=excluded.disposable_income,
    real_income=excluded.real_income,
    consumption=excluded.consumption,
    savings=excluded.savings,
    debt=excluded.debt,
    debt_service=excluded.debt_service,
    basket_cost=excluded.basket_cost,
    purchasing_power_index=excluded.purchasing_power_index,
    consumer_confidence=excluded.consumer_confidence,
    poverty_status=excluded.poverty_status,
    macro_weight=excluded.macro_weight,
    metadata=excluded.metadata;

  get diagnostics inserted_count = row_count;

  perform economy_private.upsert_indicator(
    p_month_period_id,
    'purchasing_power_index',
    (select avg(ces.purchasing_power_index) from public.citizen_economic_snapshots ces where ces.period_id=p_month_period_id),
    (select avg(ces.purchasing_power_index) from public.citizen_economic_snapshots ces where ces.period_id=p_month_period_id),
    null,
    'index',
    jsonb_build_object('basket_cost', basket_cost)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id,
    'poverty_rate',
    (
      select count(*) filter (where ces.poverty_status in ('extreme_poverty','poverty'))::numeric
        / greatest(count(*),1) * 100
      from public.citizen_economic_snapshots ces
      where ces.period_id=p_month_period_id
    ),
    null,
    null,
    'percent',
    '{}'::jsonb
  );

  return inserted_count;
end;
$$;

create or replace function economy_private.calculate_business_snapshots(
  p_month_period_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  state_row public.economic_state%rowtype;
  inserted_count integer;
begin
  select * into period_row from public.economic_periods where id=p_month_period_id;
  select * into state_row from public.economic_state where id=true;

  insert into public.business_economic_snapshots (
    period_id,
    business_id,
    sector_id,
    gross_revenue,
    intermediate_costs,
    wage_costs,
    tax_costs,
    interest_costs,
    net_profit,
    investment,
    employment,
    capacity_utilization,
    productivity_index,
    demand_index,
    cost_inflation,
    confidence_index,
    default_risk,
    health_status,
    metadata
  )
  select
    p_month_period_id,
    b.id,
    coalesce(b.economic_sector_id, bt.economic_sector_id),
    vals.revenue,
    vals.intermediate_costs,
    vals.wage_costs,
    vals.tax_costs,
    vals.interest_costs,
    vals.revenue-vals.intermediate_costs-vals.wage_costs-vals.tax_costs-vals.interest_costs,
    vals.investment,
    vals.employment,
    economy_private.clamp(
      b.capacity_utilization
        + (state_row.business_confidence-50)*.08
        + economy_private.active_shock_impact('capacity_percent', coalesce(b.economic_sector_id,bt.economic_sector_id)),
      0,120
    ),
    greatest(b.productivity_index,1),
    economy_private.clamp(
      100 + (state_row.consumer_confidence-50)*.7
        + economy_private.active_policy_impact('consumption_percent'),
      20,180
    ),
    coalesce(economy_private.latest_indicator('inflation_monthly'),0),
    economy_private.clamp(
      state_row.business_confidence
        + case when vals.revenue-vals.intermediate_costs-vals.wage_costs >= 0 then 3 else -8 end,
      0,100
    ),
    economy_private.clamp(
      .12
        + greatest(0, state_row.current_selic-10)*.012
        + case when vals.revenue=0 then .25 else 0 end
        + case when vals.revenue-vals.intermediate_costs-vals.wage_costs < 0 then .2 else -.05 end,
      .01,.99
    ),
    case
      when vals.revenue=0 and b.status='active' then 'attention'
      when vals.revenue-vals.intermediate_costs-vals.wage_costs < -greatest(vals.revenue,1)*.5 then 'distressed'
      when vals.revenue-vals.intermediate_costs-vals.wage_costs < 0 then 'attention'
      when vals.revenue > 0 and vals.revenue-vals.intermediate_costs-vals.wage_costs > vals.revenue*.2 then 'strong'
      else 'stable'
    end,
    jsonb_build_object(
      'economic_cycle', state_row.economic_cycle,
      'selic', state_row.current_selic
    )
  from public.businesses b
  left join public.business_types bt on bt.id=b.business_type_id
  cross join lateral (
    select
      coalesce(sum(abs(e.nominal_amount)) filter (where e.economic_classification='gross_output'),0) revenue,
      coalesce(sum(abs(e.nominal_amount)) filter (where e.economic_classification='intermediate_consumption'),0) intermediate_costs,
      coalesce((
        select sum(be.salary)
        from public.business_employees be
        where be.business_id=b.id and be.fired_at is null
      ),0) wage_costs,
      coalesce(sum(abs(e.nominal_amount)) filter (where e.economic_classification in ('product_tax','income_tax')),0) tax_costs,
      coalesce(sum(abs(e.nominal_amount)) filter (where e.economic_classification='financial_operation' and e.event_type like '%interest%'),0) interest_costs,
      coalesce(sum(abs(e.nominal_amount)) filter (where e.economic_classification='productive_investment'),0) investment,
      coalesce((
        select count(*)
        from public.business_employees be
        where be.business_id=b.id and be.fired_at is null
      ),0) employment
    from public.economic_events e
    where e.business_id=b.id
      and e.occurred_at_rp >= period_row.starts_at_rp
      and e.occurred_at_rp < period_row.ends_at_rp
  ) vals
  where b.status in ('active','suspended')
  on conflict (period_id,business_id) do update set
    sector_id=excluded.sector_id,
    gross_revenue=excluded.gross_revenue,
    intermediate_costs=excluded.intermediate_costs,
    wage_costs=excluded.wage_costs,
    tax_costs=excluded.tax_costs,
    interest_costs=excluded.interest_costs,
    net_profit=excluded.net_profit,
    investment=excluded.investment,
    employment=excluded.employment,
    capacity_utilization=excluded.capacity_utilization,
    productivity_index=excluded.productivity_index,
    demand_index=excluded.demand_index,
    cost_inflation=excluded.cost_inflation,
    confidence_index=excluded.confidence_index,
    default_risk=excluded.default_risk,
    health_status=excluded.health_status,
    metadata=excluded.metadata;

  get diagnostics inserted_count = row_count;

  update public.businesses b
  set
    capacity_utilization=bes.capacity_utilization,
    productivity_index=bes.productivity_index,
    confidence_index=bes.confidence_index,
    updated_at=now()
  from public.business_economic_snapshots bes
  where bes.period_id=p_month_period_id
    and bes.business_id=b.id;

  perform economy_private.upsert_indicator(
    p_month_period_id, 'active_businesses',
    (select count(*) from public.businesses where status='active'),
    null, null, 'businesses', '{}'::jsonb
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'business_revenue_total',
    (select sum(gross_revenue) from public.business_economic_snapshots where period_id=p_month_period_id),
    null, null, 'BRL', '{}'::jsonb
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'business_profit_total',
    (select sum(net_profit) from public.business_economic_snapshots where period_id=p_month_period_id),
    null, null, 'BRL', '{}'::jsonb
  );

  return inserted_count;
end;
$$;

create or replace function economy_private.update_confidence(
  p_month_period_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.economic_state%rowtype;
  inflation numeric;
  unemployment numeric;
  growth numeric;
  smoothing numeric := economy_private.calibration_numeric('confidence_smoothing',.3);
  consumer_target numeric;
  business_target numeric;
  consumer_next numeric;
  business_next numeric;
  consumer_shock numeric;
  business_shock numeric;
begin
  select * into state_row from public.economic_state where id=true;
  select nominal_value into inflation
  from public.economic_indicators where period_id=p_month_period_id and indicator_code='inflation_annual';
  select nominal_value into unemployment
  from public.economic_indicators where period_id=p_month_period_id and indicator_code='unemployment_rate';
  growth := coalesce(economy_private.latest_indicator('gdp_growth_quarterly'),0);
  consumer_shock := economy_private.active_shock_impact('consumer_confidence');
  business_shock := economy_private.active_shock_impact('business_confidence');

  consumer_target := economy_private.clamp(
    55
      + growth*1.8
      - greatest(coalesce(inflation,0)-state_row.inflation_target,0)*2.2
      - greatest(coalesce(unemployment,8.5)-8.5,0)*1.5
      + economy_private.active_policy_impact('consumer_confidence')
      + consumer_shock,
    0,100
  );
  business_target := economy_private.clamp(
    55
      + growth*2.2
      - greatest(state_row.current_selic-10,0)*1.1
      - greatest(coalesce(inflation,0)-state_row.inflation_target,0)*1.4
      + economy_private.active_policy_impact('business_confidence')
      + business_shock,
    0,100
  );
  consumer_next := economy_private.clamp(
    state_row.consumer_confidence*(1-smoothing)+consumer_target*smoothing,
    0,100
  );
  business_next := economy_private.clamp(
    state_row.business_confidence*(1-smoothing)+business_target*smoothing,
    0,100
  );

  update public.economic_state
  set
    consumer_confidence=consumer_next,
    business_confidence=business_next,
    updated_at=now()
  where id=true;

  perform economy_private.upsert_indicator(
    p_month_period_id,'consumer_confidence',
    consumer_next,consumer_next,consumer_next-state_row.consumer_confidence,
    'index','{}'::jsonb
  );
  perform economy_private.upsert_indicator(
    p_month_period_id,'business_confidence',
    business_next,business_next,business_next-state_row.business_confidence,
    'index','{}'::jsonb
  );

  return jsonb_build_object(
    'consumer_confidence',round(consumer_next,4),
    'business_confidence',round(business_next,4)
  );
end;
$$;

create or replace function economy_private.publish_bulletin(
  p_period_id uuid,
  p_bulletin_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  title_value text;
  summary_value text;
  content_value text;
  bulletin_id uuid;
  gdp_growth numeric;
  inflation numeric;
  unemployment numeric;
  primary_result numeric;
begin
  select * into period_row from public.economic_periods where id=p_period_id;
  select coalesce(real_value,nominal_value) into gdp_growth
    from public.economic_indicators where period_id=p_period_id and indicator_code like 'gdp_growth%';
  select coalesce(real_value,nominal_value) into inflation
    from public.economic_indicators where period_id=p_period_id and indicator_code='inflation_annual';
  if inflation is null then
    inflation := economy_private.latest_indicator('inflation_annual',period_row.ends_at_rp);
  end if;
  select coalesce(real_value,nominal_value) into unemployment
    from public.economic_indicators where period_id=p_period_id and indicator_code='unemployment_rate';
  if unemployment is null then
    unemployment := economy_private.latest_indicator('unemployment_rate',period_row.ends_at_rp);
  end if;
  select fp.primary_result into primary_result
    from public.fiscal_periods fp where fp.period_id=p_period_id;

  title_value := case p_bulletin_type
    when 'monthly' then format('Boletim econômico — %s/%s',period_row.rp_month,period_row.rp_year)
    when 'quarterly' then format('PIB do %sº trimestre de %s',period_row.rp_quarter,period_row.rp_year)
    when 'annual' then format('Balanço econômico anual de %s',period_row.rp_year)
    else format('Boletim econômico de %s',period_row.rp_year)
  end;
  summary_value := format(
    'Inflação anual em %s%%, desemprego em %s%% e crescimento em %s%%.',
    to_char(coalesce(inflation,0),'FM999990.00'),
    to_char(coalesce(unemployment,0),'FM999990.00'),
    to_char(coalesce(gdp_growth,0),'FM999990.00')
  );
  content_value := format(
    'O fechamento oficial foi calculado a partir do livro-razão econômico. %s Resultado primário: R$ %s. Os números preservam a separação entre produção, transferências e operações financeiras.',
    summary_value,
    to_char(coalesce(primary_result,0),'FM999G999G999G990D00')
  );

  insert into public.economic_bulletins (
    period_id,bulletin_type,title,summary,content,highlights,status
  )
  values (
    p_period_id,
    p_bulletin_type,
    title_value,
    summary_value,
    content_value,
    jsonb_build_array(
      jsonb_build_object('label','Crescimento','value',coalesce(gdp_growth,0),'unit','%'),
      jsonb_build_object('label','Inflação','value',coalesce(inflation,0),'unit','%'),
      jsonb_build_object('label','Desemprego','value',coalesce(unemployment,0),'unit','%')
    ),
    'published'
  )
  on conflict (period_id,bulletin_type) do update set
    title=excluded.title,
    summary=excluded.summary,
    content=excluded.content,
    highlights=excluded.highlights,
    status='corrected',
    published_at=now()
  returning id into bulletin_id;

  return bulletin_id;
end;
$$;

create or replace function economy_private.close_month(
  p_period_id uuid,
  p_force boolean default false,
  p_initiated_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
$$;

create or replace function economy_private.detect_cycle(
  p_quarter_period_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_row public.economic_periods%rowtype;
  current_growth numeric;
  previous_growth numeric;
  two_quarter_growth numeric;
  annual_inflation numeric;
  unemployment numeric;
  previous_cycle text;
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
    and p.ends_at_rp<=period_row.starts_at_rp
  order by p.ends_at_rp desc limit 1;
  annual_inflation := economy_private.latest_indicator('inflation_annual',period_row.ends_at_rp);
  unemployment := economy_private.latest_indicator('unemployment_rate',period_row.ends_at_rp);
  select economic_cycle into previous_cycle from public.economic_state where id=true;
  two_quarter_growth := coalesce(current_growth,0)+coalesce(previous_growth,0);

  detected := case
    when coalesce(current_growth,0)<0
      and coalesce(annual_inflation,0)>(select inflation_target+2 from public.economic_state where id=true)
      and coalesce(unemployment,0)>10 then 'stagflation'
    when coalesce(current_growth,0)<=-3 then 'deep_recession'
    when coalesce(current_growth,0)<0
      and coalesce(previous_growth,0)<0
      and two_quarter_growth<=-min_decline then 'technical_recession'
    when coalesce(current_growth,0)<-1 then 'recession'
    when previous_cycle in ('technical_recession','recession','deep_recession','stagflation')
      and coalesce(current_growth,0)>0 then 'recovery'
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
$$;

create or replace function economy_private.close_quarter(
  p_period_id uuid,
  p_force boolean default false,
  p_initiated_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
  event_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:quarter:'||p_period_id::text));

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

  select cpi_index into deflator from public.economic_state where id=true;
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
      'statistical_discrepancy_ratio',discrepancy
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

  update public.government_finances
  set loans_balance=new_debt,updated_at=now()
  where id=1;

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
$$;

create or replace function economy_private.close_year(
  p_period_id uuid,
  p_force boolean default false,
  p_initiated_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
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
$$;

create or replace function economy_private.run_operational_engine()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_month(period_row.id,true,null);
    closed_months:=closed_months+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_quarter(period_row.id,true,null);
    closed_quarters:=closed_quarters+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_year(period_row.id,true,null);
    closed_years:=closed_years+1;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,
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
$$;

create or replace function public.open_economic_period()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem abrir períodos.' using errcode='42501';
  end if;
  return economy_private.ensure_periods(public.rp_now());
end;
$$;

create or replace function public.close_economic_month(
  p_period_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem fechar períodos.' using errcode='42501';
  end if;
  return economy_private.close_month(p_period_id,p_force,auth.uid());
end;
$$;

create or replace function public.close_economic_quarter(
  p_period_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem fechar períodos.' using errcode='42501';
  end if;
  return economy_private.close_quarter(p_period_id,p_force,auth.uid());
end;
$$;

create or replace function public.close_economic_year(
  p_period_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas administradores podem fechar períodos.' using errcode='42501';
  end if;
  return economy_private.close_year(p_period_id,p_force,auth.uid());
end;
$$;

create or replace function public.calculate_nominal_gdp(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.nominal_value
  from public.economic_indicators i
  where i.period_id=p_period_id and i.indicator_code='gdp_nominal'
$$;

create or replace function public.calculate_real_gdp(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.real_value
  from public.economic_indicators i
  where i.period_id=p_period_id and i.indicator_code='gdp_real'
$$;

create or replace function public.calculate_sector_gdp(p_period_id uuid)
returns table (
  sector_code text,
  sector_name text,
  nominal_value_added numeric,
  real_value_added numeric,
  growth_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select es.code,es.name,ss.value_added,ss.real_value_added,ss.growth_rate
  from public.economic_sector_snapshots ss
  join public.economic_sectors es on es.id=ss.sector_id
  where ss.period_id=p_period_id
  order by ss.value_added desc
$$;

create or replace function public.calculate_cpi(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select i.nominal_value
  from public.economic_indicators i
  where i.period_id=p_period_id and i.indicator_code='cpi_index'
$$;

create or replace function public.calculate_gdp_deflator(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (i.metadata->>'deflator')::numeric
      from public.economic_indicators i
      where i.period_id=p_period_id and i.indicator_code='gdp_real'),
    (select gdp_deflator from public.economic_state where id=true)
  )
$$;

revoke all on function public.open_economic_period() from public,anon;
revoke all on function public.close_economic_month(uuid,boolean) from public,anon;
revoke all on function public.close_economic_quarter(uuid,boolean) from public,anon;
revoke all on function public.close_economic_year(uuid,boolean) from public,anon;
revoke all on function public.calculate_nominal_gdp(uuid) from public;
revoke all on function public.calculate_real_gdp(uuid) from public;
revoke all on function public.calculate_sector_gdp(uuid) from public;
revoke all on function public.calculate_cpi(uuid) from public;
revoke all on function public.calculate_gdp_deflator(uuid) from public;

grant execute on function public.open_economic_period() to authenticated,service_role;
grant execute on function public.close_economic_month(uuid,boolean) to authenticated,service_role;
grant execute on function public.close_economic_quarter(uuid,boolean) to authenticated,service_role;
grant execute on function public.close_economic_year(uuid,boolean) to authenticated,service_role;
grant execute on function public.calculate_nominal_gdp(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_real_gdp(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_sector_gdp(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_cpi(uuid) to anon,authenticated,service_role;
grant execute on function public.calculate_gdp_deflator(uuid) to anon,authenticated,service_role;

select economy_private.run_operational_engine();

commit;
