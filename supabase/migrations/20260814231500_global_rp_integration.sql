-- Integra o estado institucional e monetário do Brasil ao motor global do GOV.RP.
-- Jogadores e simulação passam a ter peso fixo e equivalente (50/50).

alter table public.country_rp_states
  add column if not exists player_share numeric(8,6) not null default 0.5,
  add column if not exists simulated_share numeric(8,6) not null default 0.5;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'country_rp_states_influence_mix'
      and conrelid = 'public.country_rp_states'::regclass
  ) then
    alter table public.country_rp_states
      add constraint country_rp_states_influence_mix check (
        player_share between 0 and 1
        and simulated_share between 0 and 1
        and abs(player_share + simulated_share - 1) < 0.000001
      );
  end if;
end;
$$;

update public.country_rp_states
set player_share = 0.5,
    simulated_share = 0.5,
    economic_current = economic_current || jsonb_build_object(
      'playerShare', 0.5,
      'simulatedShare', 0.5
    );

-- O PIB macroeconômico oficial é persistido e apresentado em dólares.
update public.country_rp_states state
set economic_current = jsonb_set(
      jsonb_set(
        state.economic_current,
        '{gdp}',
        to_jsonb(
          (state.economic_current->>'gdp')::numeric
          / (state.economic_current->>'exchangeUsd')::numeric
        ),
        true
      ),
      '{gdpCurrency}',
      to_jsonb('USD'::text),
      true
    )
where upper(coalesce(state.economic_current->>'gdpCurrency', 'USD')) = 'BRL'
  and nullif(state.economic_current->>'gdp', '') is not null
  and nullif(state.economic_current->>'exchangeUsd', '')::numeric > 0;

update public.country_rp_states state
set economic_baseline = jsonb_set(
      jsonb_set(
        state.economic_baseline,
        '{gdp}',
        to_jsonb(
          (state.economic_baseline->>'gdp')::numeric
          / (state.economic_baseline->>'exchangeUsd')::numeric
        ),
        true
      ),
      '{gdpCurrency}',
      to_jsonb('USD'::text),
      true
    )
where upper(coalesce(state.economic_baseline->>'gdpCurrency', 'USD')) = 'BRL'
  and nullif(state.economic_baseline->>'gdp', '') is not null
  and nullif(state.economic_baseline->>'exchangeUsd', '')::numeric > 0;

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
  activity_level text;
begin
  select count(distinct session.user_id) into active_players
  from public.user_activity_sessions session
  where session.last_seen_at >= now() - interval '7 days';

  select count(*) into transactions_count
  from public.transactions transaction_row
  where transaction_row.created_at >= now() - interval '7 days';

  select count(*) into active_businesses
  from public.businesses business
  where business.status = 'active'
    and business.updated_at >= now() - interval '14 days';

  select count(*) into employment_actions
  from public.economic_events event
  where event.event_type in ('employee_hired', 'employee_dismissed')
    and event.occurred_at_real >= now() - interval '7 days';

  score := coalesce(active_players, 0)
    + least(coalesce(transactions_count, 0), 300) * 0.18
    + coalesce(active_businesses, 0) * 4
    + coalesce(employment_actions, 0) * 2;

  thresholds := economy_private.calibration_json(
    'activity_thresholds',
    '{"very_low":15,"low":40,"medium":90,"high":180}'::jsonb
  );

  activity_level := case
    when score < coalesce((thresholds->>'very_low')::numeric, 15) then 'very_low'
    when score < coalesce((thresholds->>'low')::numeric, 40) then 'low'
    when score < coalesce((thresholds->>'medium')::numeric, 90) then 'medium'
    when score < coalesce((thresholds->>'high')::numeric, 180) then 'high'
    else 'very_high'
  end;

  update public.economic_state
  set player_activity_level = activity_level,
      simulated_share = 0.5,
      player_share = 0.5,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'activity_score', round(score, 4),
        'active_players', active_players,
        'recent_transactions', transactions_count,
        'active_businesses', active_businesses,
        'employment_actions', employment_actions,
        'influence_model', 'equal_player_simulation',
        'player_share', 0.5,
        'simulated_share', 0.5
      ),
      updated_at = now()
  where id = true;

  update public.country_rp_states
  set player_share = 0.5,
      simulated_share = 0.5
  where is_playable;

  return jsonb_build_object(
    'level', activity_level,
    'score', round(score, 4),
    'simulated_share', 0.5,
    'player_share', 0.5
  );
end;
$$;

-- A decisão de Selic representa a metade controlada pelos jogadores e afeta
-- imediatamente o câmbio; os indicadores do motor compõem a outra metade.
create or replace function public.apply_rp_selic_to_exchange()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selic_delta numeric;
  exchange_adjustment numeric;
begin
  if new.current_selic is not distinct from old.current_selic then
    return new;
  end if;

  selic_delta := new.current_selic - old.current_selic;
  exchange_adjustment := greatest(-0.12, least(0.12, selic_delta * 0.00375));
  new.exchange_rate := round(
    greatest(0.25, least(50, old.exchange_rate * (1 - exchange_adjustment))),
    6
  );
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'last_exchange_driver', 'selic_player_decision',
    'last_exchange_change_at', now(),
    'last_selic_delta', selic_delta
  );
  return new;
end;
$$;

drop trigger if exists economic_state_selic_updates_exchange on public.economic_state;
create trigger economic_state_selic_updates_exchange
before update of current_selic on public.economic_state
for each row execute function public.apply_rp_selic_to_exchange();

-- Selic, crédito e investimentos usam uma única fonte de verdade.
create or replace function public.sync_global_monetary_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  economic_policy jsonb := '{}'::jsonb;
  bank_policy jsonb := '{}'::jsonb;
  previous_monthly numeric;
  current_monthly numeric;
  loan_spread numeric;
  card_spread numeric;
  debt_spread numeric;
begin
  select coalesce(setting.value, '{}'::jsonb)
    into economic_policy
  from public.system_settings setting
  where setting.key = 'economic_policy';

  select coalesce(setting.value, '{}'::jsonb)
    into bank_policy
  from public.system_settings setting
  where setting.key = 'bank_policy';

  economic_policy := coalesce(economic_policy, '{}'::jsonb) || jsonb_build_object(
    'selic_rate', new.current_selic,
    'updated_at', now(),
    'updated_by', auth.uid()
  );

  previous_monthly := round(
    (power(1 + greatest(coalesce(old.current_selic, new.current_selic), 0) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );
  current_monthly := round(
    (power(1 + greatest(new.current_selic, 0) / 100, 1.0 / 12.0) - 1) * 100,
    2
  );

  loan_spread := coalesce(
    nullif(bank_policy->>'loan_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'loan_interest_rate', '')::numeric, 2.5) - previous_monthly)
  );
  card_spread := coalesce(
    nullif(bank_policy->>'credit_card_revolving_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'credit_card_revolving_rate', '')::numeric, 8.9) - previous_monthly)
  );
  debt_spread := coalesce(
    nullif(bank_policy->>'government_debt_interest_spread', '')::numeric,
    greatest(0, coalesce(nullif(bank_policy->>'government_debt_interest_rate', '')::numeric, 1.75) - previous_monthly)
  );

  bank_policy := coalesce(bank_policy, '{}'::jsonb) || jsonb_build_object(
    'loan_interest_spread', loan_spread,
    'credit_card_revolving_spread', card_spread,
    'government_debt_interest_spread', debt_spread,
    'loan_interest_rate', round(current_monthly + loan_spread, 2),
    'credit_card_revolving_rate', round(current_monthly + card_spread, 2),
    'government_debt_interest_rate', round(current_monthly + debt_spread, 2),
    'selic_reference', new.current_selic,
    'updated_at', now()
  );

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'economic_policy',
    economic_policy,
    'Política monetária nacional sincronizada com o motor econômico.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  insert into public.system_settings (key, value, description, updated_at)
  values (
    'bank_policy',
    bank_policy,
    'Política de juros e crédito sincronizada com a Selic nacional.',
    now()
  )
  on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = excluded.updated_at;

  update public.investment_options
  set annual_return_rate = round(greatest(
    0.005,
    (
      new.current_selic * case risk_level
        when 'low' then 0.90
        when 'high' then 1.20
        when 'very-high' then 1.35
        else 1.05
      end
      + case risk_level
        when 'low' then -0.40
        when 'high' then 2.20
        when 'very-high' then 4.50
        else 0.80
      end
    ) / 100
  ), 6);

  return new;
end;
$$;

drop trigger if exists economic_state_syncs_global_monetary_policy on public.economic_state;
create trigger economic_state_syncs_global_monetary_policy
after update of current_selic on public.economic_state
for each row execute function public.sync_global_monetary_policy();

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
        'gdpCurrency', 'USD',
        'selic', new.current_selic,
        'playerShare', new.player_share,
        'simulatedShare', new.simulated_share,
        'activityLevel', new.player_activity_level
      ),
      economic_engine_cursor = state.economic_engine_cursor || jsonb_build_object(
        'exchangeUsd', new.exchange_rate,
        'selic', new.current_selic,
        'playerShare', new.player_share,
        'simulatedShare', new.simulated_share,
        'activityLevel', new.player_activity_level
      ),
      player_share = new.player_share,
      simulated_share = new.simulated_share,
      last_event_type = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate then 'exchange_rate_updated'
        when nullif(state.economic_engine_cursor->>'selic', '')::numeric
          is distinct from new.current_selic then 'selic_updated'
        else state.last_event_type
      end,
      last_event_summary = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate
          then 'O câmbio nacional variou conforme a economia do RP.'
        when nullif(state.economic_engine_cursor->>'selic', '')::numeric
          is distinct from new.current_selic
          then 'A Selic nacional foi alterada e propagada por toda a plataforma.'
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
  state_row public.country_rp_states%rowtype;
  field_name text;
  field_value numeric;
  engine_previous numeric;
  indicator_delta numeric;
  exchange_factor numeric := 1;
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

  select * into state_row
  from public.country_rp_states
  where country_code = 'BR'
    and is_playable
  for update;

  if not found then
    return new;
  end if;

  engine_previous := nullif(state_row.economic_engine_cursor->>field_name, '')::numeric;
  indicator_delta := case
    when engine_previous is null then 0
    when field_name = 'gdp' and engine_previous <> 0
      then field_value / engine_previous - 1
    else field_value - engine_previous
  end;

  update public.country_rp_states state
  set economic_current = state.economic_current || jsonb_build_object(
        field_name,
        case
          when nullif(state.economic_current->>field_name, '')::numeric is null
            then field_value
          when engine_previous is null
            then nullif(state.economic_current->>field_name, '')::numeric
          when field_name = 'gdp' and engine_previous <> 0
            then nullif(state.economic_current->>field_name, '')::numeric
              * field_value / engine_previous
          when field_name <> 'gdp'
            then nullif(state.economic_current->>field_name, '')::numeric
              + field_value - engine_previous
          else nullif(state.economic_current->>field_name, '')::numeric
        end,
        'gdpCurrency', 'USD'
      ),
      economic_engine_cursor = state.economic_engine_cursor
        || jsonb_build_object(field_name, field_value),
      last_event_type = 'economic_indicator_update',
      last_event_summary = 'Um indicador nacional foi recalculado pela simulação do RP.'
  where state.country_code = 'BR';

  exchange_factor := case field_name
    when 'growth' then 1 - greatest(-10, least(10, indicator_delta)) * 0.0025
    when 'inflation' then 1 + greatest(-10, least(10, indicator_delta)) * 0.0030
    when 'unemployment' then 1 + greatest(-10, least(10, indicator_delta)) * 0.0015
    when 'gdp' then 1 - greatest(-0.25, least(0.25, indicator_delta)) * 0.02
    else 1
  end;

  if engine_previous is not null and exchange_factor is distinct from 1::numeric then
    update public.economic_state
    set exchange_rate = round(greatest(0.25, least(50, exchange_rate * exchange_factor)), 6),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_exchange_driver', field_name,
          'last_exchange_change_at', now(),
          'last_indicator_delta', indicator_delta
        ),
        updated_at = now()
    where id = true;
  end if;

  return new;
end;
$$;

-- A identificação do governo brasileiro deixa de usar nomes reais congelados
-- e passa a refletir exclusivamente os cargos e partidos existentes no GOV.RP.
create or replace function public.refresh_brazil_rp_political_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  president_id uuid;
  president_name text;
  party_name text;
  party_ideology text;
  political_snapshot jsonb;
begin
  select
    profile.id,
    coalesce(nullif(profile.full_name, ''), profile.username),
    case
      when party.id is null then 'Sem filiação partidária no GOV.RP'
      else party.name || case
        when nullif(party.acronym, '') is null then ''
        else format(' (%s)', party.acronym)
      end
    end,
    coalesce(
      nullif(party.ideology::text, ''),
      nullif(party.orientation::text, ''),
      'Não definida pelo partido no GOV.RP'
    )
  into president_id, president_name, party_name, party_ideology
  from public.profiles profile
  left join lateral (
    select candidate_party.*
    from public.political_parties candidate_party
    where candidate_party.id = profile.party_affiliation
       or exists (
         select 1
         from public.party_members membership
         where membership.user_id = profile.id
           and membership.party_id = candidate_party.id
       )
    order by
      (candidate_party.id = profile.party_affiliation) desc,
      candidate_party.is_active desc,
      candidate_party.created_at desc
    limit 1
  ) party on true
  where profile.role = 'Presidente'
  order by profile.role_assigned_at desc nulls last, profile.updated_at desc
  limit 1;

  political_snapshot := jsonb_build_object(
    'leader', coalesce(president_name, 'Cargo vago'),
    'leaderProfileId', president_id,
    'office', 'Presidência da República no GOV.RP',
    'party', coalesce(party_name, 'Não se aplica'),
    'ideology', coalesce(party_ideology, 'Não definida no GOV.RP'),
    'regime', 'Democracia representativa no GOV.RP',
    'governmentForm', 'República federativa presidencialista',
    'source', 'GOV.RP — governo em exercício',
    'playerInfluence', 0.5,
    'simulationInfluence', 0.5
  );

  update public.country_rp_states state
  set political_current = state.political_current || political_snapshot,
      last_event_type = 'government_state_updated',
      last_event_summary = 'O governo em exercício do Brasil foi sincronizado com o GOV.RP.'
  where state.country_code = 'BR'
    and state.is_playable
    and state.political_current is distinct from state.political_current || political_snapshot;

  return political_snapshot;
end;
$$;

create or replace function public.trigger_refresh_brazil_rp_political_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_brazil_rp_political_state();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_refresh_brazil_rp_politics on public.profiles;
create trigger profiles_refresh_brazil_rp_politics
after insert or update or delete on public.profiles
for each row execute function public.trigger_refresh_brazil_rp_political_state();

drop trigger if exists party_members_refresh_brazil_rp_politics on public.party_members;
create trigger party_members_refresh_brazil_rp_politics
after insert or update or delete on public.party_members
for each row execute function public.trigger_refresh_brazil_rp_political_state();

drop trigger if exists parties_refresh_brazil_rp_politics on public.political_parties;
create trigger parties_refresh_brazil_rp_politics
after insert or update or delete on public.political_parties
for each row execute function public.trigger_refresh_brazil_rp_political_state();

select public.refresh_brazil_rp_political_state();

-- Inicializa os pesos e propaga a Selic vigente para todos os consumidores.
update public.economic_state
set player_share = 0.5,
    simulated_share = 0.5,
    current_selic = current_selic,
    updated_at = now()
where id = true;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'system_settings',
    'government_finances',
    'investment_options',
    'ministers',
    'decrees',
    'bills',
    'profiles',
    'elections',
    'election_types',
    'candidates',
    'votes',
    'party_members',
    'political_parties',
    'credit_card_applications',
    'loan_applications',
    'accounts',
    'cards'
  ] loop
    begin
      execute format(
        'alter publication supabase_realtime add table public.%I',
        relation_name
      );
    exception when duplicate_object then
      null;
    end;
  end loop;
end;
$$;

grant execute on function public.refresh_brazil_rp_political_state()
to authenticated, service_role;
