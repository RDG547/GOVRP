-- Existing event recording and confidence functions, checked against the live engine.
CREATE OR REPLACE FUNCTION public.real_date_to_rp_date(p_real_date timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select case
        when s.is_paused and s.paused_real_at is not null and p_real_date>=s.paused_real_at and s.paused_rp_at is not null
          then s.paused_rp_at
        else s.rp_epoch_game_at+make_interval(secs => extract(epoch from(p_real_date-s.rp_epoch_real_at))
          *((s.rp_days_per_year::numeric*86400)/s.rp_year_real_seconds)*s.speed_multiplier)
      end
      from public.rp_time_settings s where s.id=true
    ),
    p_real_date
  )
$function$;
CREATE OR REPLACE FUNCTION public.rp_date_to_real_date(p_rp_date timestamp with time zone)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    (
      select s.rp_epoch_real_at
        + make_interval(secs => extract(epoch from (p_rp_date-s.rp_epoch_game_at)) /
          (((s.rp_days_per_year::numeric*86400)/s.rp_year_real_seconds)*s.speed_multiplier))
      from public.rp_time_settings s where s.id=true
    ),
    p_rp_date
  )
$function$;
CREATE OR REPLACE FUNCTION economy_private.record_event(p_event_type text, p_classification text, p_source_table text, p_source_id text, p_nominal_amount numeric DEFAULT 0, p_actor_profile_id uuid DEFAULT NULL::uuid, p_business_id uuid DEFAULT NULL::uuid, p_government_entity_id uuid DEFAULT NULL::uuid, p_sector_id uuid DEFAULT NULL::uuid, p_quantity numeric DEFAULT NULL::numeric, p_unit_price numeric DEFAULT NULL::numeric, p_tax_amount numeric DEFAULT 0, p_subsidy_amount numeric DEFAULT 0, p_occurred_at_real timestamp with time zone DEFAULT now(), p_occurred_at_rp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_is_simulated boolean DEFAULT false, p_macro_weight numeric DEFAULT 1, p_metadata jsonb DEFAULT '{}'::jsonb, p_economic_group_key text DEFAULT NULL::text, p_reverses_event_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  event_id uuid;
  rp_at timestamptz := coalesce(
    p_occurred_at_rp,
    public.real_date_to_rp_date(coalesce(p_occurred_at_real, now())),
    public.rp_now()
  );
  period_id uuid;
  actual_amount numeric := coalesce(p_nominal_amount, 0);
  economic_value numeric;
  real_value numeric;
  representativity numeric := economy_private.calibration_numeric('player_representativity_factor', 1000);
  annual_gdp numeric := economy_private.calibration_numeric('baseline_annual_gdp', 10000000000);
  event_cap numeric;
  cpi numeric;
  bounded_weight numeric := economy_private.clamp(coalesce(p_macro_weight, 1), 0, 1);
  suspicious boolean := false;
begin
  if nullif(btrim(p_event_type), '') is null
     or nullif(btrim(p_source_table), '') is null
     or nullif(btrim(p_source_id), '') is null then
    raise exception 'Tipo, tabela e identificador de origem são obrigatórios.';
  end if;

  if abs(actual_amount) > 1000000000000000 then
    raise exception 'Valor econômico fora do limite permitido.';
  end if;

  period_id := economy_private.period_for('month', rp_at);
  event_cap := (annual_gdp / 4)
    * economy_private.calibration_numeric('max_event_share_quarter_gdp', .0025);

  if p_is_simulated then
    economic_value := actual_amount;
  else
    economic_value := sign(actual_amount)
      * least(abs(actual_amount) * representativity * bounded_weight, event_cap);
    suspicious := abs(actual_amount) * representativity > event_cap;
  end if;

  select es.cpi_index into cpi
  from public.economic_state es
  where es.id = true;

  real_value := economic_value / greatest(coalesce(cpi, 100) / 100, .000001);

  insert into public.economic_events (
    event_type,
    economic_classification,
    source_table,
    source_id,
    economic_group_key,
    actor_profile_id,
    business_id,
    government_entity_id,
    sector_id,
    nominal_amount,
    economic_amount,
    real_amount,
    quantity,
    unit_price,
    tax_amount,
    subsidy_amount,
    occurred_at_real,
    occurred_at_rp,
    economic_period_id,
    reverses_event_id,
    is_simulated,
    is_suspicious,
    macro_weight,
    metadata,
    engine_version
  )
  values (
    left(p_event_type, 120),
    p_classification,
    left(p_source_table, 120),
    left(p_source_id, 240),
    nullif(left(coalesce(p_economic_group_key, ''), 240), ''),
    p_actor_profile_id,
    p_business_id,
    p_government_entity_id,
    p_sector_id,
    actual_amount,
    economic_value,
    real_value,
    p_quantity,
    p_unit_price,
    greatest(coalesce(p_tax_amount, 0), 0),
    greatest(coalesce(p_subsidy_amount, 0), 0),
    coalesce(p_occurred_at_real, now()),
    rp_at,
    period_id,
    p_reverses_event_id,
    p_is_simulated,
    suspicious,
    bounded_weight,
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'representativity_factor', case when p_is_simulated then 1 else representativity end,
        'impact_capped', suspicious
      ),
    '1.0.0'
  )
  on conflict (source_table, source_id, event_type)
  do nothing
  returning id into event_id;

  if event_id is null then
    select e.id into event_id
    from public.economic_events e
    where e.source_table = left(p_source_table, 120)
      and e.source_id = left(p_source_id, 240)
      and e.event_type = left(p_event_type, 120);
  end if;

  return event_id;
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.update_confidence(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
