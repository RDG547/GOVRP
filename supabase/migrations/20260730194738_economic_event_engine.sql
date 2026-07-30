begin;

create or replace function public.real_date_to_rp_date(p_real_date timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when s.is_paused
      and s.paused_real_at is not null
      and p_real_date >= s.paused_real_at
      and s.paused_rp_at is not null
      then s.paused_rp_at
    else s.rp_epoch_game_at
      + make_interval(secs =>
          extract(epoch from (p_real_date - s.rp_epoch_real_at))
          * ((s.rp_days_per_year::numeric * 86400) / s.rp_year_real_seconds)
          * s.speed_multiplier
        )
  end
  from public.rp_time_settings s
  where s.id = true
$$;

revoke all on function public.real_date_to_rp_date(timestamptz) from public;
grant execute on function public.real_date_to_rp_date(timestamptz) to anon, authenticated, service_role;

create or replace function economy_private.calibration_numeric(
  p_key text,
  p_fallback numeric
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when jsonb_typeof(c.value) = 'number' then (c.value #>> '{}')::numeric
        when jsonb_typeof(c.value) = 'string'
          and (c.value #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (c.value #>> '{}')::numeric
        else null
      end
      from public.economic_calibrations c
      where c.key = p_key
    ),
    p_fallback
  )
$$;

create or replace function economy_private.calibration_json(
  p_key text,
  p_fallback jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.value from public.economic_calibrations c where c.key = p_key),
    p_fallback
  )
$$;

create or replace function economy_private.clamp(
  p_value numeric,
  p_min numeric,
  p_max numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(p_min, least(p_max, p_value))
$$;

create or replace function economy_private.audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_old_data jsonb,
  p_new_data jsonb,
  p_justification text,
  p_actor uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_id bigint;
begin
  insert into public.economic_audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    justification,
    engine_version
  )
  values (
    coalesce(p_actor, auth.uid()),
    left(p_action, 160),
    left(p_entity_type, 120),
    left(p_entity_id, 240),
    p_old_data,
    p_new_data,
    nullif(left(coalesce(p_justification, ''), 2000), ''),
    '1.0.0'
  )
  returning id into audit_id;

  return audit_id;
end;
$$;

create or replace function economy_private.ensure_periods(
  p_rp_at timestamptz default public.rp_now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function economy_private.period_for(
  p_period_type text,
  p_rp_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_id uuid;
begin
  perform economy_private.ensure_periods(p_rp_at);

  select ep.id into period_id
  from public.economic_periods ep
  where ep.period_type = p_period_type
    and p_rp_at >= ep.starts_at_rp
    and p_rp_at < ep.ends_at_rp
  order by ep.starts_at_rp desc
  limit 1;

  return period_id;
end;
$$;

create or replace function economy_private.resolve_sector(
  p_business_id uuid default null,
  p_sector_code text default null,
  p_description text default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sector_id uuid;
  normalized text := lower(coalesce(p_description, ''));
  resolved_code text;
begin
  if p_business_id is not null then
    select coalesce(b.economic_sector_id, bt.economic_sector_id)
      into sector_id
    from public.businesses b
    left join public.business_types bt on bt.id = b.business_type_id
    where b.id = p_business_id;

    if sector_id is not null then
      return sector_id;
    end if;
  end if;

  resolved_code := coalesce(
    nullif(p_sector_code, ''),
    case
      when normalized like '%energia%' or normalized like '%eletric%' then 'energy'
      when normalized like '%água%' or normalized like '%agua%' then 'public_admin'
      when normalized like '%gás%' or normalized like '%gas%' or normalized like '%combust%' then 'oil_mining'
      when normalized like '%internet%' or normalized like '%telefon%' then 'telecom'
      when normalized like '%aluguel%' or normalized like '%moradia%' then 'real_estate'
      when normalized like '%educa%' or normalized like '%curso%' then 'education'
      when normalized like '%saúde%' or normalized like '%saude%' or normalized like '%terapia%' then 'health'
      when normalized like '%transporte%' or normalized like '%frete%' then 'transport'
      when normalized like '%banco%' or normalized like '%invest%' or normalized like '%cartão%' then 'finance'
      when normalized like '%constru%' or normalized like '%obra%' then 'construction'
      when normalized like '%tecnolog%' or normalized like '%software%' then 'technology'
      when normalized like '%consult%' or normalized like '%advoga%' then 'professional'
      when normalized like '%lazer%' or normalized like '%turismo%' then 'tourism'
      else 'commerce'
    end
  );

  select es.id into sector_id
  from public.economic_sectors es
  where es.code = resolved_code
    and es.is_active;

  if sector_id is null then
    select es.id into sector_id
    from public.economic_sectors es
    where es.code = 'other_services';
  end if;

  return sector_id;
end;
$$;

create or replace function economy_private.account_owner(p_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id
  from public.accounts a
  where a.id = p_account_id
$$;

create or replace function economy_private.profile_business(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.businesses b
  where b.owner_id = p_profile_id
    and b.status = 'active'
  order by b.created_at
  limit 1
$$;

create or replace function economy_private.record_event(
  p_event_type text,
  p_classification text,
  p_source_table text,
  p_source_id text,
  p_nominal_amount numeric default 0,
  p_actor_profile_id uuid default null,
  p_business_id uuid default null,
  p_government_entity_id uuid default null,
  p_sector_id uuid default null,
  p_quantity numeric default null,
  p_unit_price numeric default null,
  p_tax_amount numeric default 0,
  p_subsidy_amount numeric default 0,
  p_occurred_at_real timestamptz default now(),
  p_occurred_at_rp timestamptz default null,
  p_is_simulated boolean default false,
  p_macro_weight numeric default 1,
  p_metadata jsonb default '{}'::jsonb,
  p_economic_group_key text default null,
  p_reverses_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.record_economic_event(
  p_event_type text,
  p_economic_classification text,
  p_source_table text,
  p_source_id text,
  p_nominal_amount numeric,
  p_actor_profile_id uuid default null,
  p_business_id uuid default null,
  p_sector_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas a administração econômica pode registrar eventos manuais.'
      using errcode = '42501';
  end if;

  return economy_private.record_event(
    p_event_type,
    p_economic_classification,
    p_source_table,
    p_source_id,
    p_nominal_amount,
    coalesce(p_actor_profile_id, auth.uid()),
    p_business_id,
    null,
    p_sector_id,
    null,
    null,
    0,
    0,
    now(),
    public.rp_now(),
    false,
    1,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('manual', true)
  );
end;
$$;

create or replace function public.record_economic_correction(
  p_original_event_id uuid,
  p_justification text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.economic_events%rowtype;
  correction_id uuid;
begin
  if auth.uid() is null
     or not public.economic_has_role(array['Admin']) then
    raise exception 'Apenas a administração econômica pode corrigir eventos.'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_justification, ''))) < 12 then
    raise exception 'A correção exige justificativa detalhada.';
  end if;

  select * into original
  from public.economic_events
  where id = p_original_event_id;

  if not found then
    raise exception 'Evento econômico não encontrado.';
  end if;

  if exists (
    select 1
    from public.economic_events e
    where e.reverses_event_id = original.id
  ) then
    raise exception 'Este evento já possui correção.';
  end if;

  correction_id := economy_private.record_event(
    'correction_' || original.event_type,
    original.economic_classification,
    'economic_events',
    original.id::text || ':' || gen_random_uuid()::text,
    -original.nominal_amount,
    auth.uid(),
    original.business_id,
    original.government_entity_id,
    original.sector_id,
    original.quantity,
    original.unit_price,
    0,
    0,
    now(),
    public.rp_now(),
    original.is_simulated,
    original.macro_weight,
    jsonb_build_object(
      'correction_reason', p_justification,
      'original_event_id', original.id
    ),
    'correction:' || original.id::text,
    original.id
  );

  perform economy_private.audit(
    'economic_event_corrected',
    'economic_event',
    original.id::text,
    to_jsonb(original),
    jsonb_build_object('correction_event_id', correction_id),
    p_justification
  );

  return correction_id;
end;
$$;

create or replace function economy_private.classify_transaction(
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  transaction_type text;
  buyer_id uuid;
  seller_id uuid;
  seller_business_id uuid;
  sector_id uuid;
  tax_value numeric := 0;
  base_value numeric;
  group_key text;
  classification text;
  output_id uuid;
  expenditure_id uuid;
  tax_id uuid;
begin
  select * into transaction_row
  from public.transactions
  where id = p_transaction_id;

  if not found then
    raise exception 'Transação não encontrada.';
  end if;

  transaction_type := lower(coalesce(transaction_row.type, 'transfer'));
  buyer_id := economy_private.account_owner(transaction_row.from_account_id);
  seller_id := economy_private.account_owner(transaction_row.to_account_id);
  seller_business_id := economy_private.profile_business(seller_id);
  sector_id := economy_private.resolve_sector(
    seller_business_id,
    null,
    transaction_row.description
  );
  group_key := 'transaction:' || transaction_row.id::text;

  if coalesce(transaction_row.metadata->>'tax_amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    tax_value := greatest((transaction_row.metadata->>'tax_amount')::numeric, 0);
  end if;

  if coalesce(transaction_row.metadata->>'base_price', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    base_value := greatest((transaction_row.metadata->>'base_price')::numeric, 0);
  else
    base_value := greatest(transaction_row.amount - tax_value, 0);
  end if;

  if transaction_type in (
    'purchase',
    'purchase_card',
    'subscription_payment',
    'subscription_payment_card',
    'service_payment'
  ) then
    expenditure_id := economy_private.record_event(
      'household_consumption',
      'household_consumption',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      seller_business_id,
      null,
      sector_id,
      1,
      transaction_row.amount,
      tax_value,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'seller_profile_id', seller_id
        ),
      group_key
    );

    output_id := economy_private.record_event(
      'domestic_gross_output',
      'gross_output',
      'transactions',
      transaction_row.id::text,
      base_value,
      seller_id,
      seller_business_id,
      null,
      sector_id,
      1,
      base_value,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'transaction_type', transaction_type,
          'buyer_profile_id', buyer_id
        ),
      group_key
    );

    if tax_value > 0 then
      tax_id := economy_private.record_event(
        'product_tax',
        'product_tax',
        'transactions',
        transaction_row.id::text,
        tax_value,
        buyer_id,
        seller_business_id,
        null,
        sector_id,
        1,
        tax_value,
        tax_value,
        0,
        transaction_row.created_at,
        public.real_date_to_rp_date(transaction_row.created_at),
        false,
        1,
        coalesce(transaction_row.metadata, '{}'::jsonb),
        group_key
      );
    end if;

    classification := 'household_consumption';
  elsif transaction_type in ('daily_check_in_reward', 'citizen_income') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'social_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'social_transfer';
  elsif transaction_type = 'fine_payment' then
    expenditure_id := economy_private.record_event(
      'fine_payment',
      'not_in_gdp',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      buyer_id,
      null,
      null,
      economy_private.resolve_sector(null, 'public_admin', null),
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('reason', 'fine_is_transfer'),
      group_key
    );
    classification := 'not_in_gdp';
  elsif transaction_type in ('admin_credit', 'admin_debit') then
    expenditure_id := economy_private.record_event(
      transaction_type,
      'capital_transfer',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      null,
      null,
      null,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb),
      group_key
    );
    classification := 'capital_transfer';
  else
    expenditure_id := economy_private.record_event(
      transaction_type,
      'financial_operation',
      'transactions',
      transaction_row.id::text,
      transaction_row.amount,
      coalesce(buyer_id, seller_id),
      seller_business_id,
      null,
      sector_id,
      null,
      null,
      0,
      0,
      transaction_row.created_at,
      public.real_date_to_rp_date(transaction_row.created_at),
      false,
      1,
      coalesce(transaction_row.metadata, '{}'::jsonb)
        || jsonb_build_object('does_not_directly_change_gdp', true),
      group_key
    );
    classification := 'financial_operation';
  end if;

  return jsonb_build_object(
    'transaction_id', transaction_row.id,
    'classification', classification,
    'expenditure_event_id', expenditure_id,
    'output_event_id', output_id,
    'tax_event_id', tax_id
  );
end;
$$;

create or replace function public.classify_transaction_economic_effect(
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  select a.user_id into transaction_owner
  from public.transactions t
  join public.accounts a on a.id = t.from_account_id
  where t.id = p_transaction_id;

  if transaction_owner is distinct from auth.uid()
     and not public.economic_has_role(array['Admin']) then
    raise exception 'Sem permissão para classificar esta transação.'
      using errcode = '42501';
  end if;

  return economy_private.classify_transaction(p_transaction_id);
end;
$$;

create or replace function economy_private.on_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform economy_private.classify_transaction(new.id);
  return new;
exception
  when others then
    insert into public.economic_alerts (
      alert_code, severity, title, message, entity_type, entity_id, metadata
    )
    values (
      'transaction_classification_failed',
      'warning',
      'Falha ao classificar transação',
      'Uma transação bancária não entrou automaticamente no livro-razão econômico.',
      'transactions',
      new.id::text,
      jsonb_build_object('sqlstate', sqlstate, 'error', sqlerrm)
    )
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists transactions_economic_classification on public.transactions;
create trigger transactions_economic_classification
after insert on public.transactions
for each row execute function economy_private.on_transaction_insert();

create or replace function economy_private.on_business_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_row public.businesses%rowtype;
  classification text;
  event_type text;
begin
  select * into business_row
  from public.businesses
  where id = new.business_id;

  classification := case lower(new.type)
    when 'revenue' then 'gross_output'
    when 'expense' then 'intermediate_consumption'
    when 'monthly_cost' then 'intermediate_consumption'
    when 'tax' then 'income_tax'
    when 'registration' then 'capital_transfer'
    else 'not_in_gdp'
  end;

  event_type := case classification
    when 'gross_output' then 'business_gross_output'
    when 'intermediate_consumption' then 'business_intermediate_consumption'
    else 'business_' || lower(new.type)
  end;

  perform economy_private.record_event(
    event_type,
    classification,
    'business_transactions',
    new.id::text,
    new.amount,
    business_row.owner_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, new.description)
    ),
    null,
    null,
    case when classification = 'income_tax' then new.amount else 0 end,
    0,
    new.created_at,
    public.real_date_to_rp_date(new.created_at),
    false,
    1,
    jsonb_build_object('business_transaction_type', new.type),
    'business_transaction:' || new.id::text
  );

  return new;
end;
$$;

drop trigger if exists business_transactions_economic_classification on public.business_transactions;
create trigger business_transactions_economic_classification
after insert on public.business_transactions
for each row execute function economy_private.on_business_transaction_insert();

create or replace function economy_private.on_business_employee_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  business_row public.businesses%rowtype;
  is_hire boolean;
  event_name text;
begin
  is_hire := tg_op = 'INSERT';

  if tg_op = 'UPDATE'
     and old.fired_at is null
     and new.fired_at is not null then
    is_hire := false;
  elsif tg_op = 'UPDATE' then
    return new;
  end if;

  select * into business_row
  from public.businesses
  where id = new.business_id;

  event_name := case when is_hire then 'employee_hired' else 'employee_dismissed' end;

  perform economy_private.record_event(
    event_name,
    'not_in_gdp',
    'business_employees',
    new.id::text,
    0,
    new.profile_id,
    new.business_id,
    null,
    coalesce(
      business_row.economic_sector_id,
      economy_private.resolve_sector(new.business_id, null, null)
    ),
    1,
    null,
    0,
    0,
    coalesce(new.fired_at, new.hired_at, now()),
    public.real_date_to_rp_date(coalesce(new.fired_at, new.hired_at, now())),
    new.is_npc,
    case when new.is_npc then .25 else 1 end,
    jsonb_build_object(
      'employment_event', event_name,
      'salary', new.salary,
      'is_npc', new.is_npc
    ),
    'business_employee:' || new.id::text || ':' || event_name
  );

  if new.profile_id is not null then
    insert into public.citizen_economic_statuses (
      profile_id,
      labor_status,
      actively_seeking,
      last_economic_activity_at,
      updated_at
    )
    values (
      new.profile_id,
      case when is_hire then 'private_employee' else 'unemployed' end,
      not is_hire,
      now(),
      now()
    )
    on conflict (profile_id) do update set
      labor_status = excluded.labor_status,
      actively_seeking = excluded.actively_seeking,
      last_economic_activity_at = excluded.last_economic_activity_at,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists business_employees_economic_change on public.business_employees;
create trigger business_employees_economic_change
after insert or update of fired_at on public.business_employees
for each row execute function economy_private.on_business_employee_change();

create or replace function economy_private.on_salary_payment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform economy_private.record_event(
    'salary_payment',
    'compensation',
    'salary_payments',
    new.id::text,
    new.amount,
    new.user_id,
    null,
    null,
    economy_private.resolve_sector(
      null,
      case
        when lower(new.role) in ('presidente','ministro','juiz','policial','militar','senador','deputado') then 'public_admin'
        else 'other_services'
      end,
      new.title
    ),
    null,
    null,
    0,
    0,
    new.paid_at,
    public.real_date_to_rp_date(new.paid_at),
    false,
    1,
    jsonb_build_object(
      'role', new.role,
      'title', new.title,
      'not_counted_again_in_gdp', true
    ),
    'salary:' || new.id::text
  );

  return new;
end;
$$;

drop trigger if exists salary_payments_economic_classification on public.salary_payments;
create trigger salary_payments_economic_classification
after insert on public.salary_payments
for each row execute function economy_private.on_salary_payment_insert();

create or replace function economy_private.basket_item_for_service(
  p_service_type text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pbi.id
  from public.price_basket_items pbi
  where pbi.code = case
    when lower(coalesce(p_service_type,'')) like '%electric%' or lower(coalesce(p_service_type,'')) like '%energia%' then 'energy'
    when lower(coalesce(p_service_type,'')) like '%water%' or lower(coalesce(p_service_type,'')) like '%água%' or lower(coalesce(p_service_type,'')) like '%agua%' then 'water'
    when lower(coalesce(p_service_type,'')) like '%gas%' or lower(coalesce(p_service_type,'')) like '%gás%' then 'gas'
    when lower(coalesce(p_service_type,'')) like '%internet%' then 'internet'
    when lower(coalesce(p_service_type,'')) like '%phone%' or lower(coalesce(p_service_type,'')) like '%telefon%' then 'phone'
    when lower(coalesce(p_service_type,'')) like '%rent%' or lower(coalesce(p_service_type,'')) like '%aluguel%' then 'housing'
    when lower(coalesce(p_service_type,'')) like '%education%' or lower(coalesce(p_service_type,'')) like '%educa%' then 'education'
    when lower(coalesce(p_service_type,'')) like '%health%' or lower(coalesce(p_service_type,'')) like '%saúde%' then 'health'
    else 'other'
  end
  limit 1
$$;

create or replace function economy_private.on_user_service_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basket_id uuid;
  sector_id uuid;
  rp_at timestamptz;
begin
  basket_id := economy_private.basket_item_for_service(new.service_type);
  select pbi.sector_id into sector_id
  from public.price_basket_items pbi
  where pbi.id = basket_id;
  rp_at := public.real_date_to_rp_date(new.contracted_at);

  perform economy_private.record_event(
    'service_contract',
    'not_in_gdp',
    'user_services',
    new.id::text,
    new.price,
    new.user_id,
    null,
    null,
    sector_id,
    1,
    new.price,
    0,
    0,
    new.contracted_at,
    rp_at,
    false,
    1,
    jsonb_build_object(
      'service_type', new.service_type,
      'plan_name', new.plan_name,
      'contract_does_not_equal_payment', true
    ),
    'user_service:' || new.id::text
  );

  insert into public.price_observations (
    basket_item_id,
    sector_id,
    source_table,
    source_id,
    price,
    observed_at_real,
    observed_at_rp,
    period_id,
    metadata
  )
  values (
    basket_id,
    sector_id,
    'user_services',
    new.id::text,
    new.price,
    new.contracted_at,
    rp_at,
    economy_private.period_for('month', rp_at),
    jsonb_build_object('service_type', new.service_type, 'plan_name', new.plan_name)
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists user_services_economic_classification on public.user_services;
create trigger user_services_economic_classification
after insert on public.user_services
for each row execute function economy_private.on_user_service_insert();

create or replace function economy_private.resolve_product_basket_item(
  p_product public.products
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_product.price_basket_item_id,
    (
      select pbi.id
      from public.price_basket_items pbi
      where pbi.code = case
        when lower(coalesce(p_product.category,'')) like '%aliment%'
          or lower(coalesce(p_product.name,'')) like '%comida%' then 'food'
        when lower(coalesce(p_product.category,'')) like '%roup%'
          or lower(coalesce(p_product.category,'')) like '%vest%' then 'clothing'
        when lower(coalesce(p_product.category,'')) like '%saúde%'
          or lower(coalesce(p_product.category,'')) like '%saude%' then 'health'
        when lower(coalesce(p_product.category,'')) like '%educ%'
          or lower(coalesce(p_product.category,'')) like '%livro%' then 'education'
        when lower(coalesce(p_product.category,'')) like '%lazer%'
          or lower(coalesce(p_product.category,'')) like '%entreten%' then 'leisure'
        else 'other'
      end
      limit 1
    )
  )
$$;

create or replace function economy_private.on_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basket_id uuid;
  observed_price numeric;
  rp_at timestamptz := public.rp_now();
begin
  if tg_op = 'UPDATE'
     and new.price is not distinct from old.price
     and new.promotion_price is not distinct from old.promotion_price then
    return new;
  end if;

  basket_id := economy_private.resolve_product_basket_item(new);
  observed_price := case
    when new.promotion_price is not null
      and (new.promotion_expires_at is null or new.promotion_expires_at > now())
      then new.promotion_price
    else new.price
  end;

  insert into public.price_observations (
    basket_item_id,
    product_id,
    sector_id,
    source_table,
    source_id,
    price,
    observed_at_real,
    observed_at_rp,
    period_id,
    metadata
  )
  values (
    basket_id,
    new.id,
    coalesce(
      new.economic_sector_id,
      (select pbi.sector_id from public.price_basket_items pbi where pbi.id = basket_id)
    ),
    'products',
    new.id::text || ':' || extract(epoch from now())::bigint::text,
    observed_price,
    now(),
    rp_at,
    economy_private.period_for('month', rp_at),
    jsonb_build_object('category', new.category, 'product_type', new.product_type)
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists products_economic_price_observation on public.products;
create trigger products_economic_price_observation
after insert or update of price, promotion_price, promotion_expires_at on public.products
for each row execute function economy_private.on_product_price_change();

create or replace function economy_private.on_government_revenue_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  classification text;
begin
  classification := case
    when new.revenue_type in ('consumption_tax', 'tariff') then 'product_tax'
    when new.revenue_type in ('income_tax', 'corporate_tax', 'payroll_tax', 'property_tax') then 'income_tax'
    when new.revenue_type = 'privatization' then 'capital_transfer'
    else 'not_in_gdp'
  end;

  perform economy_private.record_event(
    'government_revenue_' || new.revenue_type,
    classification,
    'government_revenues',
    new.id::text,
    new.amount,
    new.actor_profile_id,
    new.business_id,
    null,
    null,
    null,
    null,
    case when classification = 'product_tax' then new.amount else 0 end,
    0,
    new.occurred_at_real,
    new.occurred_at_rp,
    false,
    1,
    new.metadata,
    'government_revenue:' || new.id::text
  );

  return new;
end;
$$;

drop trigger if exists government_revenues_economic_event on public.government_revenues;
create trigger government_revenues_economic_event
after insert on public.government_revenues
for each row execute function economy_private.on_government_revenue_insert();

create or replace function economy_private.on_government_expenditure_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  classification text;
  productive boolean;
begin
  productive := new.expenditure_type not in (
    'social_assistance', 'subsidy', 'debt_interest'
  );

  classification := case
    when new.expenditure_type = 'social_assistance' then 'social_transfer'
    when new.expenditure_type = 'subsidy' then 'subsidy'
    when new.expenditure_type = 'debt_interest' then 'financial_operation'
    when new.expenditure_type = 'public_salary' then 'compensation'
    else 'government_spending'
  end;

  perform economy_private.record_event(
    'government_expenditure_' || new.expenditure_type,
    classification,
    'government_expenditures',
    new.id::text,
    new.amount,
    new.beneficiary_profile_id,
    new.business_id,
    null,
    new.sector_id,
    null,
    null,
    0,
    case when classification = 'subsidy' then new.amount else 0 end,
    new.occurred_at_real,
    new.occurred_at_rp,
    false,
    1,
    new.metadata || jsonb_build_object('productive_share', new.productive_share),
    'government_expenditure:' || new.id::text
  );

  if productive then
    perform economy_private.record_event(
      'government_contracted_output',
      'gross_output',
      'government_expenditures',
      new.id::text,
      new.amount * greatest(new.productive_share, .25),
      new.beneficiary_profile_id,
      new.business_id,
      null,
      new.sector_id,
      null,
      null,
      0,
      0,
      new.occurred_at_real,
      new.occurred_at_rp,
      false,
      1,
      new.metadata,
      'government_expenditure:' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists government_expenditures_economic_event on public.government_expenditures;
create trigger government_expenditures_economic_event
after insert on public.government_expenditures
for each row execute function economy_private.on_government_expenditure_insert();

create or replace function economy_private.on_loan_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.status, '')) in ('aprovado', 'approved', 'ativo', 'active')
     and lower(coalesce(old.status, '')) not in ('aprovado', 'approved', 'ativo', 'active') then
    perform economy_private.record_event(
      'loan_approved',
      'financial_operation',
      'loan_applications',
      new.id::text,
      new.amount,
      new.user_id,
      null,
      null,
      economy_private.resolve_sector(null, 'finance', null),
      null,
      null,
      0,
      0,
      coalesce(new.reviewed_at, now()),
      public.real_date_to_rp_date(coalesce(new.reviewed_at, now())),
      false,
      1,
      jsonb_build_object(
        'interest_rate', new.interest_rate,
        'installments', new.installments,
        'does_not_directly_change_gdp', true
      ),
      'loan_application:' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists loan_applications_economic_classification on public.loan_applications;
create trigger loan_applications_economic_classification
after update of status on public.loan_applications
for each row execute function economy_private.on_loan_approved();

create or replace function public.update_citizen_economic_status(
  p_labor_status text,
  p_actively_seeking boolean,
  p_available_for_work boolean default true
)
returns public.citizen_economic_statuses
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.citizen_economic_statuses%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Autenticação obrigatória.' using errcode = '42501';
  end if;

  if p_labor_status not in (
    'private_employee',
    'public_employee',
    'entrepreneur',
    'self_employed',
    'unemployed',
    'outside_labor_force',
    'retired',
    'imprisoned',
    'temporarily_unable'
  ) then
    raise exception 'Situação de trabalho inválida.';
  end if;

  if p_labor_status = 'private_employee'
     and not exists (
       select 1
       from public.business_employees be
       where be.profile_id = auth.uid()
         and be.fired_at is null
     ) then
    raise exception 'Não existe vínculo privado ativo para este perfil.';
  end if;

  if p_labor_status = 'entrepreneur'
     and not exists (
       select 1
       from public.businesses b
       where b.owner_id = auth.uid()
         and b.status = 'active'
     ) then
    raise exception 'Não existe empresa ativa para este perfil.';
  end if;

  insert into public.citizen_economic_statuses (
    profile_id,
    labor_status,
    actively_seeking,
    available_for_work,
    last_economic_activity_at,
    updated_at
  )
  values (
    auth.uid(),
    p_labor_status,
    case when p_labor_status = 'unemployed' then p_actively_seeking else false end,
    p_available_for_work,
    now(),
    now()
  )
  on conflict (profile_id) do update set
    labor_status = excluded.labor_status,
    actively_seeking = excluded.actively_seeking,
    available_for_work = excluded.available_for_work,
    last_economic_activity_at = excluded.last_economic_activity_at,
    updated_at = now()
  returning * into result;

  perform economy_private.audit(
    'citizen_economic_status_updated',
    'citizen_economic_status',
    auth.uid()::text,
    null,
    to_jsonb(result),
    'Atualização realizada pelo próprio cidadão.'
  );

  return result;
end;
$$;

create or replace function economy_private.backfill_current_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_id uuid;
  processed integer := 0;
  current_period public.economic_periods%rowtype;
begin
  perform economy_private.ensure_periods(public.rp_now());

  select * into current_period
  from public.economic_periods ep
  where ep.period_type = 'month'
    and ep.status = 'open'
    and public.rp_now() >= ep.starts_at_rp
    and public.rp_now() < ep.ends_at_rp
  order by ep.starts_at_rp desc
  limit 1;

  for transaction_id in
    select t.id
    from public.transactions t
    where t.created_at >= greatest(
      current_period.starts_at,
      timestamptz '2026-07-30 00:00:00+00'
    )
      and not exists (
        select 1
        from public.economic_events e
        where e.source_table = 'transactions'
          and e.source_id = t.id::text
      )
    order by t.created_at
  loop
    perform economy_private.classify_transaction(transaction_id);
    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

revoke all on function public.record_economic_event(text,text,text,text,numeric,uuid,uuid,uuid,jsonb) from public, anon;
revoke all on function public.record_economic_correction(uuid,text) from public, anon;
revoke all on function public.classify_transaction_economic_effect(uuid) from public, anon;
revoke all on function public.update_citizen_economic_status(text,boolean,boolean) from public, anon;

grant execute on function public.record_economic_event(text,text,text,text,numeric,uuid,uuid,uuid,jsonb) to authenticated, service_role;
grant execute on function public.record_economic_correction(uuid,text) to authenticated, service_role;
grant execute on function public.classify_transaction_economic_effect(uuid) to authenticated, service_role;
grant execute on function public.update_citizen_economic_status(text,boolean,boolean) to authenticated, service_role;

select economy_private.ensure_periods(public.rp_now());
select economy_private.backfill_current_transactions();

commit;
