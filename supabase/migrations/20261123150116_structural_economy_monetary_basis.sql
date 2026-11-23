BEGIN;
-- Prospective only. Never rewrite historical events, bank balances or laws.
-- National simulated production remains separate from observed money flows.
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
  monetary_source boolean := p_source_table IN ('transactions','business_transactions',
    'government_revenues','government_expenditures','salary_payments','investment_operations');
begin
  if nullif(btrim(p_event_type), '') is null
     or nullif(btrim(p_source_table), '') is null
     or nullif(btrim(p_source_id), '') is null then
    raise exception 'Tipo, tabela e identificador de origem são obrigatórios.';
  end if;

  if actual_amount::text IN ('NaN','Infinity','-Infinity') OR abs(actual_amount) > 1000000000000000 then
    raise exception 'Valor econômico fora do limite permitido.';
  end if;

  period_id := economy_private.period_for('month', rp_at);
  event_cap := (annual_gdp / 4)
    * economy_private.calibration_numeric('max_event_share_quarter_gdp', .0025);

  if monetary_source then
    -- Observed monetary flows use the same unit for players and population.
    -- Explicit classification weights remain valid; no sample extrapolation.
    economic_value := actual_amount * bounded_weight;
  elsif p_is_simulated then
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
        'monetary_basis', case when monetary_source then 'observed_currency_v1' else 'national_simulation_or_sample' end,
        'representativity_factor', case when monetary_source OR p_is_simulated then 1 else representativity end,
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

CREATE OR REPLACE FUNCTION economy_private.on_business_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  business_row public.businesses%rowtype;
  classification text;
  event_type text;
  part record; is_daily boolean; common_weight numeric:=1;
begin
  select * into business_row
  from public.businesses
  where id = new.business_id;

  classification := case when new.metadata->>'kind'='payroll_accrual' then 'compensation' else case lower(new.type)
    when 'revenue' then 'gross_output'
    when 'expense' then 'intermediate_consumption'
    when 'monthly_cost' then 'intermediate_consumption'
    when 'tax' then 'income_tax'
    when 'registration' then 'capital_transfer'
    else 'not_in_gdp'
  end end;

  event_type := case classification
    when 'gross_output' then 'business_gross_output'
    when 'intermediate_consumption' then 'business_intermediate_consumption'
    else 'business_' || lower(new.type)
  end;

  is_daily:=new.metadata->>'kind' IN ('payroll_accrual','input_consumption','overhead');
  FOR part IN
   SELECT a.part_key,a.amount,a.real_at,a.rp_at,
    jsonb_build_object('accounting_basis','daily_accrual_rp_overlap','accounting_date',new.accounting_date,
      'recorded_at',new.created_at,'source_business_transaction_id',new.id,'real_start',a.real_start,
      'real_end',a.real_end,'rp_start',a.rp_start,'rp_end',a.rp_end) temporal_metadata
   FROM economy_private.daily_accrual_parts(new.accounting_date,new.amount) a WHERE is_daily
   UNION ALL SELECT NULL::text,abs(new.amount),new.created_at,public.real_date_to_rp_date(new.created_at),
    jsonb_build_object('accounting_basis','transaction_timestamp','accounting_date',new.accounting_date,'recorded_at',new.created_at)
   WHERE NOT coalesce(is_daily,false)
  LOOP
  perform economy_private.record_event(
    event_type,
    classification,
    'business_transactions',
    new.id::text||coalesce(':rp-month:'||part.part_key,''),
    part.amount,
    business_row.owner_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, new.description)
    ),
    null,
    null,
    case when classification = 'income_tax' then part.amount else 0 end,
    0,
    part.real_at,
    part.rp_at,
    coalesce((business_row.control_kind='population' OR new.metadata->>'is_simulated'='true' OR new.metadata->>'kind'='population_sale' OR EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=CASE WHEN new.metadata->>'transaction_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (new.metadata->>'transaction_id')::uuid END AND (tx.type='population_purchase' OR tx.metadata->>'is_simulated'='true'))),false),
    common_weight,
    coalesce(new.metadata,'{}')||jsonb_build_object('business_transaction_type', new.type)||part.temporal_metadata,
    'business_transaction:' || new.id::text||coalesce(':rp-month:'||part.part_key,'')
  );
  END LOOP;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION economy_private.record_event(text,text,text,text,numeric,uuid,uuid,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz,timestamptz,boolean,numeric,jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION economy_private.on_business_transaction_insert() FROM PUBLIC,anon,authenticated;
COMMIT;
