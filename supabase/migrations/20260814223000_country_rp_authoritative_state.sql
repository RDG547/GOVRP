-- O estado nacional passa a ser autoritativo depois que o país entra no RP.
-- Os dados reais são copiados uma única vez como fotografia inicial; depois disso,
-- o motor e os eventos dos jogadores alteram os valores persistidos do RP.

alter table public.country_rp_states
  add column if not exists economic_engine_cursor jsonb not null default '{}'::jsonb,
  add column if not exists reference_snapshot_at timestamptz;

-- Fotografia de partida do Brasil em 14/08/2026. Os indicadores anuais mais
-- recentes são de 2025 (Banco Mundial) e o câmbio é da data da fotografia.
-- O backfill só alcança a instalação inicial, sem eventos nacionais de jogadores.
with engine_snapshot as (
  select jsonb_strip_nulls(jsonb_build_object(
    'gdp', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'gdp_nominal'
      order by created_at desc
      limit 1
    ),
    'growth', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code in ('gdp_growth_year_over_year', 'gdp_growth_quarterly')
      order by (indicator_code = 'gdp_growth_year_over_year') desc, created_at desc
      limit 1
    ),
    'inflation', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'inflation_annual'
      order by created_at desc
      limit 1
    ),
    'unemployment', (
      select coalesce(real_value, nominal_value)
      from public.economic_indicators
      where indicator_code = 'unemployment_rate'
      order by created_at desc
      limit 1
    ),
    'exchangeUsd', (select exchange_rate from public.economic_state where id = true)
  )) as snapshot
), real_snapshot as (
  select jsonb_build_object(
    'gdp', 2279920092492.13,
    'gdpCurrency', 'USD',
    'growth', 2.2857464902475,
    'inflation', 5.01675279604836,
    'unemployment', 5.97,
    'exchangeUsd', 5.1762,
    'exchangeEur', 5.98729946,
    'currency', 'BRL',
    'referenceYear', 2025,
    'referenceSources', jsonb_build_array('Banco Mundial', 'Frankfurter')
  ) as snapshot
)
update public.country_rp_states state
set economic_baseline = real_snapshot.snapshot,
    economic_current = real_snapshot.snapshot,
    economic_engine_cursor = engine_snapshot.snapshot,
    demographic_current = jsonb_build_object(
      'population', 212812405,
      'area', 8510420,
      'referenceYear', 2025,
      'referenceSources', jsonb_build_array('Banco Mundial')
    ),
    political_current = state.political_current || jsonb_build_object(
      'leader', 'Luiz Inácio Lula da Silva',
      'office', 'Presidente da República',
      'party', 'Partido dos Trabalhadores (PT)',
      'ideology', 'Esquerda',
      'regime', 'Democracia eleitoral',
      'governmentForm', 'República federativa presidencialista',
      'source', 'Fotografia real de início do RP'
    ),
    economy_influence = 0,
    politics_influence = 0,
    society_influence = 0,
    reference_snapshot_at = '2026-08-14T00:00:00-03:00'::timestamptz,
    last_event_type = 'rp_reference_snapshot',
    last_event_summary = 'O Brasil iniciou o RP a partir de uma fotografia dos dados reais vigentes.'
from engine_snapshot, real_snapshot
where state.country_code = 'BR'
  and not exists (
    select 1
    from public.country_rp_events event
    where event.country_code = state.country_code
      and event.actor_id is not null
  );

create or replace function public.sync_brazil_rp_economic_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.country_rp_states state
  set economic_current = state.economic_current || jsonb_build_object(
        'exchangeUsd', case
          when nullif(state.economic_current->>'exchangeUsd', '')::numeric is null
            then new.exchange_rate
          when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric is null
            or nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric = 0
            then nullif(state.economic_current->>'exchangeUsd', '')::numeric
          else nullif(state.economic_current->>'exchangeUsd', '')::numeric
            * new.exchange_rate
            / nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
        end,
        'exchangeEur', case
          when nullif(state.economic_current->>'exchangeEur', '')::numeric is null then null
          when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric is null
            or nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric = 0
            then nullif(state.economic_current->>'exchangeEur', '')::numeric
          else nullif(state.economic_current->>'exchangeEur', '')::numeric
            * new.exchange_rate
            / nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
        end,
        'currency', coalesce(state.economic_current->>'currency', 'BRL'),
        'playerShare', new.player_share,
        'activityLevel', new.player_activity_level
      ),
      economic_engine_cursor = state.economic_engine_cursor || jsonb_build_object(
        'exchangeUsd', new.exchange_rate,
        'playerShare', new.player_share,
        'activityLevel', new.player_activity_level
      ),
      last_event_type = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate
          then 'economic_engine_update'
        else state.last_event_type
      end,
      last_event_summary = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate
          then 'O câmbio nacional foi alterado pelo motor econômico do RP.'
        else state.last_event_summary
      end
  where state.country_code = 'BR'
    and state.is_playable;

  return new;
end;
$$;

create or replace function public.sync_brazil_rp_indicator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  field_value numeric;
begin
  field_name := case new.indicator_code
    when 'gdp_nominal' then 'gdp'
    when 'gdp_growth_year_over_year' then 'growth'
    when 'inflation_annual' then 'inflation'
    when 'unemployment_rate' then 'unemployment'
    else null
  end;

  if field_name is null then
    return new;
  end if;

  field_value := coalesce(new.real_value, new.nominal_value);
  if field_value is null then
    return new;
  end if;

  update public.country_rp_states state
  set economic_current = state.economic_current || jsonb_build_object(
        field_name,
        case
          when nullif(state.economic_current->>field_name, '')::numeric is null
            then field_value
          when nullif(state.economic_engine_cursor->>field_name, '')::numeric is null
            then nullif(state.economic_current->>field_name, '')::numeric
          when field_name = 'gdp'
            and nullif(state.economic_engine_cursor->>field_name, '')::numeric <> 0
            then nullif(state.economic_current->>field_name, '')::numeric
              * field_value
              / nullif(state.economic_engine_cursor->>field_name, '')::numeric
          when field_name <> 'gdp'
            then nullif(state.economic_current->>field_name, '')::numeric
              + field_value
              - nullif(state.economic_engine_cursor->>field_name, '')::numeric
          else nullif(state.economic_current->>field_name, '')::numeric
        end
      ),
      economic_engine_cursor = state.economic_engine_cursor || jsonb_build_object(field_name, field_value),
      economy_influence = 1,
      last_event_type = 'economic_indicator_update',
      last_event_summary = 'Um indicador nacional foi recalculado pelas ações do RP.'
  where state.country_code = 'BR'
    and state.is_playable;

  return new;
end;
$$;

-- Ativa uma nova nação copiando os dados reais apenas no instante inicial.
-- Depois da ativação, somente eventos e motores do RP alteram o estado corrente.
create or replace function public.start_country_rp(
  p_country_code text,
  p_country_name text,
  p_economic_snapshot jsonb,
  p_political_snapshot jsonb,
  p_demographic_snapshot jsonb,
  p_engine_cursor jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  normalized_code text := upper(trim(p_country_code));
  current_state public.country_rp_states%rowtype;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role not in ('Admin', 'Presidente') then
    raise exception 'Apenas a Presidência ou a administração pode iniciar um país no RP.';
  end if;

  if p_economic_snapshot is null
    or jsonb_typeof(p_economic_snapshot) <> 'object'
    or p_political_snapshot is null
    or jsonb_typeof(p_political_snapshot) <> 'object'
    or p_demographic_snapshot is null
    or jsonb_typeof(p_demographic_snapshot) <> 'object'
    or p_engine_cursor is null
    or jsonb_typeof(p_engine_cursor) <> 'object' then
    raise exception 'As fotografias iniciais precisam ser objetos JSON.';
  end if;

  select * into current_state
  from public.country_rp_states
  where country_code = normalized_code
  for update;

  if current_state.is_playable then
    raise exception 'Este país já iniciou o RP e não pode ser reinicializado.';
  end if;

  insert into public.country_rp_states (
    country_code,
    country_name,
    is_playable,
    economic_baseline,
    economic_current,
    political_current,
    demographic_current,
    economic_engine_cursor,
    reference_snapshot_at,
    started_at,
    updated_by,
    last_event_type,
    last_event_summary
  ) values (
    normalized_code,
    trim(p_country_name),
    true,
    p_economic_snapshot,
    p_economic_snapshot,
    p_political_snapshot,
    p_demographic_snapshot,
    p_engine_cursor,
    now(),
    now(),
    auth.uid(),
    'country_rp_started',
    format('%s iniciou o RP a partir dos dados reais vigentes.', trim(p_country_name))
  )
  on conflict (country_code) do update
  set country_name = excluded.country_name,
      is_playable = true,
      economic_baseline = excluded.economic_baseline,
      economic_current = excluded.economic_current,
      political_current = excluded.political_current,
      demographic_current = excluded.demographic_current,
      economic_engine_cursor = excluded.economic_engine_cursor,
      reference_snapshot_at = excluded.reference_snapshot_at,
      started_at = excluded.started_at,
      updated_by = excluded.updated_by,
      last_event_type = excluded.last_event_type,
      last_event_summary = excluded.last_event_summary
  returning * into current_state;

  insert into public.country_rp_events (
    country_code, domain, event_type, summary, changes, influence_delta, actor_id
  ) values (
    normalized_code,
    'politics',
    'country_rp_started',
    format('%s iniciou o RP a partir dos dados reais vigentes.', trim(p_country_name)),
    jsonb_build_object(
      'economy', p_economic_snapshot,
      'politics', p_political_snapshot,
      'demographics', p_demographic_snapshot
    ),
    0,
    auth.uid()
  );

  return to_jsonb(current_state);
end;
$$;

grant execute on function public.start_country_rp(text, text, jsonb, jsonb, jsonb, jsonb)
to authenticated, service_role;
