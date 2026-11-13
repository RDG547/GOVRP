begin;

-- Deterministic RP exchange basket. Values change with the national economic
-- state and every change is persisted for charts and daily variation.
create table if not exists public.country_rp_exchange_rates (
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  currency_code text not null,
  brl_per_unit numeric(18,8) not null,
  source text not null default 'country_rp_state',
  source_revision bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (country_code, currency_code),
  constraint country_rp_exchange_rates_currency_check check (currency_code in ('USD','EUR','GBP','JPY','CNY')),
  constraint country_rp_exchange_rates_positive_check check (brl_per_unit > 0)
);

create table if not exists public.country_rp_exchange_history (
  id bigint generated always as identity primary key,
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  currency_code text not null,
  brl_per_unit numeric(18,8) not null,
  source text not null,
  source_revision bigint not null default 0,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint country_rp_exchange_history_currency_check check (currency_code in ('USD','EUR','GBP','JPY','CNY')),
  constraint country_rp_exchange_history_positive_check check (brl_per_unit > 0)
);

create index if not exists country_rp_exchange_history_series_idx
  on public.country_rp_exchange_history (country_code, currency_code, recorded_at desc);

alter table public.country_rp_exchange_rates enable row level security;
alter table public.country_rp_exchange_history enable row level security;
drop policy if exists country_rp_exchange_rates_public_read on public.country_rp_exchange_rates;
create policy country_rp_exchange_rates_public_read on public.country_rp_exchange_rates for select to anon, authenticated using (true);
drop policy if exists country_rp_exchange_history_public_read on public.country_rp_exchange_history;
create policy country_rp_exchange_history_public_read on public.country_rp_exchange_history for select to anon, authenticated using (true);
revoke all on public.country_rp_exchange_rates, public.country_rp_exchange_history from public, anon, authenticated;
grant select on public.country_rp_exchange_rates, public.country_rp_exchange_history to anon, authenticated;
grant all on public.country_rp_exchange_rates, public.country_rp_exchange_history to service_role;

create or replace function public.upsert_country_rp_exchange_rate(
  p_country_code text,
  p_currency_code text,
  p_brl_per_unit numeric,
  p_source text,
  p_revision bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous numeric;
begin
  if p_brl_per_unit is null or p_brl_per_unit <= 0 then return; end if;
  select rate.brl_per_unit into v_previous
  from public.country_rp_exchange_rates rate
  where rate.country_code = p_country_code and rate.currency_code = p_currency_code;

  insert into public.country_rp_exchange_rates (
    country_code, currency_code, brl_per_unit, source, source_revision, updated_at
  ) values (
    p_country_code, p_currency_code, round(p_brl_per_unit, 8), p_source, coalesce(p_revision, 0), clock_timestamp()
  )
  on conflict (country_code, currency_code) do update set
    brl_per_unit = excluded.brl_per_unit,
    source = excluded.source,
    source_revision = excluded.source_revision,
    updated_at = excluded.updated_at;

  if v_previous is null or v_previous is distinct from round(p_brl_per_unit, 8) then
    insert into public.country_rp_exchange_history (
      country_code, currency_code, brl_per_unit, source, source_revision
    ) values (
      p_country_code, p_currency_code, round(p_brl_per_unit, 8), p_source, coalesce(p_revision, 0)
    );
  end if;
end;
$$;

revoke all on function public.upsert_country_rp_exchange_rate(text,text,numeric,text,bigint) from public, anon, authenticated;

create or replace function public.sync_country_rp_exchange_rates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usd numeric;
  v_eur numeric;
begin
  v_usd := nullif(new.economic_current->>'exchangeUsd', '')::numeric;
  if v_usd is null or v_usd <= 0 then return new; end if;
  v_eur := coalesce(nullif(new.economic_current->>'exchangeEur', '')::numeric, v_usd * 1.1567);

  perform public.upsert_country_rp_exchange_rate(new.country_code, 'USD', v_usd, 'country_rp_state', new.revision);
  perform public.upsert_country_rp_exchange_rate(new.country_code, 'EUR', v_eur, 'country_rp_state', new.revision);
  perform public.upsert_country_rp_exchange_rate(new.country_code, 'GBP', v_usd * 1.35, 'rp_currency_basket', new.revision);
  perform public.upsert_country_rp_exchange_rate(new.country_code, 'JPY', v_usd * 0.0067, 'rp_currency_basket', new.revision);
  perform public.upsert_country_rp_exchange_rate(new.country_code, 'CNY', v_usd * 0.139, 'rp_currency_basket', new.revision);
  return new;
end;
$$;

revoke all on function public.sync_country_rp_exchange_rates() from public, anon, authenticated;

drop trigger if exists country_rp_states_sync_exchange_rates on public.country_rp_states;
create trigger country_rp_states_sync_exchange_rates
after insert or update of economic_current on public.country_rp_states
for each row execute function public.sync_country_rp_exchange_rates();

do $$
declare
  state_row public.country_rp_states%rowtype;
begin
  for state_row in select * from public.country_rp_states loop
    if nullif(state_row.economic_current->>'exchangeUsd', '')::numeric > 0 then
      perform public.upsert_country_rp_exchange_rate(state_row.country_code, 'USD', (state_row.economic_current->>'exchangeUsd')::numeric, 'country_rp_state_initial', state_row.revision);
      perform public.upsert_country_rp_exchange_rate(state_row.country_code, 'EUR', coalesce(nullif(state_row.economic_current->>'exchangeEur', '')::numeric, (state_row.economic_current->>'exchangeUsd')::numeric * 1.1567), 'country_rp_state_initial', state_row.revision);
      perform public.upsert_country_rp_exchange_rate(state_row.country_code, 'GBP', (state_row.economic_current->>'exchangeUsd')::numeric * 1.35, 'rp_currency_basket_initial', state_row.revision);
      perform public.upsert_country_rp_exchange_rate(state_row.country_code, 'JPY', (state_row.economic_current->>'exchangeUsd')::numeric * 0.0067, 'rp_currency_basket_initial', state_row.revision);
      perform public.upsert_country_rp_exchange_rate(state_row.country_code, 'CNY', (state_row.economic_current->>'exchangeUsd')::numeric * 0.139, 'rp_currency_basket_initial', state_row.revision);
    end if;
  end loop;
end;
$$;

-- A operação bancária usa exatamente a mesma série oficial exibida na tela.
create or replace function public.execute_exchange(
  p_from_currency text,
  p_to_currency text,
  p_from_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_record public.accounts%rowtype;
  currency_balances_value jsonb := '{}'::jsonb;
  from_currency text := upper(trim(coalesce(p_from_currency, '')));
  to_currency text := upper(trim(coalesce(p_to_currency, '')));
  from_amount numeric := coalesce(p_from_amount, 0);
  country_code_value text := 'BR';
  rate_from numeric;
  rate_to numeric;
  from_balance numeric;
  to_balance numeric;
  bank_policy jsonb := '{}'::jsonb;
  fee_free boolean := true;
  fee_type text := 'percentage';
  fee_rate numeric := 0;
  fee_fixed_brl numeric := 0;
  fee_amount numeric := 0;
  net_amount numeric := 0;
  converted_amount numeric := 0;
  transaction_id uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('success', false, 'message', 'Usuário não autenticado.');
  end if;
  if from_currency = '' or to_currency = '' or from_currency = to_currency then
    return jsonb_build_object('success', false, 'message', 'Selecione moedas diferentes para realizar o câmbio.');
  end if;
  if from_amount <= 0 then
    return jsonb_build_object('success', false, 'message', 'Informe um valor positivo para converter.');
  end if;
  if from_currency not in ('BRL','USD','EUR','GBP','JPY','CNY')
     or to_currency not in ('BRL','USD','EUR','GBP','JPY','CNY') then
    return jsonb_build_object('success', false, 'message', 'Moeda não suportada.');
  end if;

  select coalesce(nullif(upper(profile.country_code), ''), 'BR')
  into country_code_value
  from public.profiles profile
  where profile.id = auth.uid() and profile.deleted_at is null;
  country_code_value := coalesce(country_code_value, 'BR');

  rate_from := case when from_currency = 'BRL' then 1 else null end;
  if rate_from is null then
    select 1 / rate.brl_per_unit into rate_from
    from public.country_rp_exchange_rates rate
    where rate.country_code in (country_code_value, 'BR') and rate.currency_code = from_currency
    order by (rate.country_code = country_code_value) desc
    limit 1;
  end if;

  rate_to := case when to_currency = 'BRL' then 1 else null end;
  if rate_to is null then
    select 1 / rate.brl_per_unit into rate_to
    from public.country_rp_exchange_rates rate
    where rate.country_code in (country_code_value, 'BR') and rate.currency_code = to_currency
    order by (rate.country_code = country_code_value) desc
    limit 1;
  end if;

  if rate_from is null or rate_to is null then
    return jsonb_build_object('success', false, 'message', 'A cotação oficial ainda não está disponível para estas moedas.');
  end if;

  select * into account_record
  from public.accounts account
  where account.user_id = auth.uid()
  order by account.id
  limit 1
  for update;
  if not found then
    return jsonb_build_object('success', false, 'message', 'Conta bancária não encontrada.');
  end if;

  currency_balances_value := coalesce(account_record.currency_balances, '{}'::jsonb);
  from_balance := case
    when from_currency = 'BRL' then coalesce(account_record.balance, 0)
    else coalesce(nullif(currency_balances_value->>from_currency, '')::numeric, 0)
  end;
  if from_balance < from_amount then
    return jsonb_build_object('success', false, 'message', 'Saldo insuficiente para realizar o câmbio.');
  end if;

  select coalesce(setting.value::jsonb, '{}'::jsonb) into bank_policy
  from public.system_settings setting
  where setting.key = 'bank_policy';
  bank_policy := coalesce(bank_policy, '{}'::jsonb);
  fee_free := coalesce((bank_policy->>'exchange_fee_free')::boolean, true);
  fee_type := coalesce(nullif(bank_policy->>'exchange_fee_type', ''), 'percentage');
  if bank_policy ? 'exchange_fee_rate'
     and (bank_policy->>'exchange_fee_rate') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    fee_rate := least(100, greatest(0, (bank_policy->>'exchange_fee_rate')::numeric));
  end if;
  if bank_policy ? 'exchange_fee_fixed_amount'
     and (bank_policy->>'exchange_fee_fixed_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then
    fee_fixed_brl := greatest(0, (bank_policy->>'exchange_fee_fixed_amount')::numeric);
  end if;

  if fee_free then
    fee_amount := 0;
  elsif fee_type = 'fixed' then
    fee_amount := case when from_currency = 'BRL' then fee_fixed_brl else fee_fixed_brl * rate_from end;
  else
    fee_amount := from_amount * fee_rate / 100;
  end if;
  fee_amount := least(from_amount, round(greatest(0, fee_amount), 4));
  net_amount := from_amount - fee_amount;
  converted_amount := round((net_amount / rate_from) * rate_to, 4);

  if from_currency = 'BRL' then
    account_record.balance := coalesce(account_record.balance, 0) - from_amount;
  else
    currency_balances_value := jsonb_set(
      currency_balances_value, array[from_currency], to_jsonb(round(from_balance - from_amount, 4)), true
    );
  end if;

  if to_currency = 'BRL' then
    account_record.balance := coalesce(account_record.balance, 0) + converted_amount;
  else
    to_balance := coalesce(nullif(currency_balances_value->>to_currency, '')::numeric, 0);
    currency_balances_value := jsonb_set(
      currency_balances_value, array[to_currency], to_jsonb(round(to_balance + converted_amount, 4)), true
    );
  end if;

  update public.accounts
  set balance = round(coalesce(account_record.balance, 0), 2),
      currency_balances = currency_balances_value,
      updated_at = clock_timestamp()
  where id = account_record.id;

  insert into public.transactions (
    from_account_id, to_account_id, amount, description, type, created_at, metadata
  ) values (
    account_record.id,
    account_record.id,
    round(from_amount / rate_from, 2),
    'Câmbio de ' || from_currency || ' para ' || to_currency,
    'exchange',
    clock_timestamp(),
    jsonb_build_object(
      'country_code', country_code_value,
      'from_currency', from_currency,
      'to_currency', to_currency,
      'from_amount', from_amount,
      'fee_amount', fee_amount,
      'net_amount', net_amount,
      'converted_amount', converted_amount,
      'rate_from', rate_from,
      'rate_to', rate_to,
      'quote_source', 'country_rp_exchange_rates'
    )
  ) returning id into transaction_id;

  return jsonb_build_object(
    'success', true,
    'message', 'Câmbio realizado com sucesso.',
    'transaction_id', transaction_id,
    'from_currency', from_currency,
    'to_currency', to_currency,
    'from_amount', from_amount,
    'fee_amount', fee_amount,
    'net_amount', net_amount,
    'converted_amount', converted_amount
  );
end;
$$;

revoke all on function public.execute_exchange(text,text,numeric) from public, anon;
grant execute on function public.execute_exchange(text,text,numeric) to authenticated, service_role;

-- Population segments provide stable cohorts that future policies and events
-- can affect without replacing the national demographic total.
create table if not exists public.country_population_segments (
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  segment_key text not null,
  name text not null,
  description text not null,
  population_share numeric(8,6) not null,
  population_count bigint not null default 0,
  welfare_index numeric(8,4) not null default 50,
  political_influence numeric(8,4) not null default 50,
  economic_participation numeric(8,4) not null default 50,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (country_code, segment_key),
  constraint country_population_segments_share_check check (population_share between 0 and 1),
  constraint country_population_segments_ranges_check check (
    welfare_index between 0 and 100 and political_influence between 0 and 100 and economic_participation between 0 and 100
  )
);

alter table public.country_population_segments enable row level security;
drop policy if exists country_population_segments_public_read on public.country_population_segments;
create policy country_population_segments_public_read on public.country_population_segments for select to anon, authenticated using (true);
revoke all on public.country_population_segments from public, anon, authenticated;
grant select on public.country_population_segments to anon, authenticated;
grant all on public.country_population_segments to service_role;

with segment_seed(segment_key, name, description, population_share, welfare_index, political_influence, economic_participation) as (
  values
    ('urban_workers', 'Trabalhadores urbanos', 'Cidadãos empregados nos centros urbanos.', 0.34::numeric, 55::numeric, 62::numeric, 82::numeric),
    ('rural_workers', 'Trabalhadores rurais', 'Cidadãos ligados à produção e às comunidades rurais.', 0.14, 49, 45, 74),
    ('entrepreneurs', 'Empreendedores', 'Proprietários e gestores de negócios produtivos.', 0.08, 66, 70, 91),
    ('public_servants', 'Servidores públicos', 'Profissionais das instituições e serviços do Estado.', 0.09, 61, 72, 79),
    ('students', 'Estudantes', 'População em formação acadêmica ou profissional.', 0.16, 58, 48, 28),
    ('retirees', 'Aposentados', 'Cidadãos fora da população economicamente ativa.', 0.11, 54, 58, 12),
    ('unemployed', 'Desempregados', 'Cidadãos em busca ativa de ocupação.', 0.08, 35, 40, 8)
)
insert into public.country_population_segments (
  country_code, segment_key, name, description, population_share, population_count,
  welfare_index, political_influence, economic_participation
)
select
  state.country_code,
  seed.segment_key,
  seed.name,
  seed.description,
  seed.population_share,
  round(coalesce(nullif(state.demographic_current->>'population', '')::numeric, 0) * seed.population_share)::bigint,
  seed.welfare_index,
  seed.political_influence,
  seed.economic_participation
from public.country_rp_states state
cross join segment_seed seed
where state.is_playable
on conflict (country_code, segment_key) do nothing;

create or replace function public.sync_country_population_segment_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_population numeric := coalesce(nullif(new.demographic_current->>'population', '')::numeric, 0);
begin
  update public.country_population_segments segment
  set population_count = round(v_population * segment.population_share)::bigint,
      updated_at = clock_timestamp()
  where segment.country_code = new.country_code;
  return new;
end;
$$;

revoke all on function public.sync_country_population_segment_counts() from public, anon, authenticated;
drop trigger if exists country_rp_states_sync_population_segments on public.country_rp_states;
create trigger country_rp_states_sync_population_segments
after update of demographic_current on public.country_rp_states
for each row execute function public.sync_country_population_segment_counts();

create table if not exists public.national_game_events (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  source_event_id uuid unique references public.country_rp_events(id) on delete set null,
  title text not null,
  description text not null,
  category text not null,
  severity text not null default 'information',
  status text not null default 'active',
  effects jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null default clock_timestamp(),
  ends_at timestamptz,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint national_game_events_category_check check (category in ('economy','politics','society','infrastructure','security','international')),
  constraint national_game_events_severity_check check (severity in ('information','attention','important','critical')),
  constraint national_game_events_status_check check (status in ('scheduled','active','resolved','cancelled'))
);

create index if not exists national_game_events_country_recent_idx
  on public.national_game_events (country_code, starts_at desc);
alter table public.national_game_events enable row level security;
drop policy if exists national_game_events_public_read on public.national_game_events;
create policy national_game_events_public_read on public.national_game_events for select to anon, authenticated using (true);
revoke all on public.national_game_events from public, anon, authenticated;
grant select on public.national_game_events to anon, authenticated;
grant all on public.national_game_events to service_role;

create or replace function public.promote_country_rp_event_to_gameplay()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.national_game_events (
    country_code, source_event_id, title, description, category, severity, effects, created_by, starts_at
  ) values (
    new.country_code,
    new.id,
    new.summary,
    new.summary,
    case new.domain when 'demographics' then 'society' else new.domain end,
    case
      when abs(new.influence_delta) >= 0.15 then 'critical'
      when abs(new.influence_delta) >= 0.08 then 'important'
      when abs(new.influence_delta) >= 0.03 then 'attention'
      else 'information'
    end,
    new.changes,
    new.actor_id,
    new.created_at
  ) on conflict (source_event_id) do nothing;
  return new;
end;
$$;

revoke all on function public.promote_country_rp_event_to_gameplay() from public, anon, authenticated;
drop trigger if exists country_rp_events_promote_gameplay on public.country_rp_events;
create trigger country_rp_events_promote_gameplay
after insert on public.country_rp_events
for each row execute function public.promote_country_rp_event_to_gameplay();

create table if not exists public.citizen_objective_definitions (
  id uuid primary key default gen_random_uuid(),
  objective_key text not null unique,
  aspiration text,
  title text not null,
  description text not null,
  category text not null,
  target_type text not null,
  target_value integer not null default 1,
  action_path text not null,
  reputation_reward integer not null default 5,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint citizen_objectives_target_check check (target_value > 0),
  constraint citizen_objectives_reward_check check (reputation_reward between 0 and 100)
);

create table if not exists public.citizen_objective_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  objective_id uuid not null references public.citizen_objective_definitions(id) on delete cascade,
  progress integer not null default 0,
  completed_at timestamptz,
  reward_claimed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, objective_id),
  constraint citizen_objective_progress_nonnegative check (progress >= 0)
);

alter table public.citizen_objective_definitions enable row level security;
alter table public.citizen_objective_progress enable row level security;
drop policy if exists citizen_objective_definitions_read on public.citizen_objective_definitions;
create policy citizen_objective_definitions_read on public.citizen_objective_definitions for select to authenticated using (is_active);
drop policy if exists citizen_objective_progress_owner_read on public.citizen_objective_progress;
create policy citizen_objective_progress_owner_read on public.citizen_objective_progress for select to authenticated using (user_id = auth.uid());
revoke all on public.citizen_objective_definitions, public.citizen_objective_progress from public, anon, authenticated;
grant select on public.citizen_objective_definitions, public.citizen_objective_progress to authenticated;
grant all on public.citizen_objective_definitions, public.citizen_objective_progress to service_role;

insert into public.citizen_objective_definitions (
  objective_key, aspiration, title, description, category, target_type, target_value, action_path, reputation_reward, sort_order
) values
  ('complete_citizenship', null, 'Concluir a cidadania', 'Finalize seus dados e documentos de cidadão.', 'Cidadania', 'onboarding', 1, '/registro-cidadania', 10, 10),
  ('first_social_post', null, 'Participar da conversa', 'Publique sua primeira mensagem na Rede X.', 'Comunidade', 'posts', 1, '/services/x/feed', 5, 20),
  ('first_bank_transfer', null, 'Movimentar a economia', 'Realize sua primeira movimentação pelo Banco Nacional.', 'Economia', 'transactions', 1, '/services/bank', 5, 30),
  ('first_public_vote', 'politics', 'Exercer o voto', 'Participe de uma votação pública ou parlamentar.', 'Política', 'votes', 1, '/services/elections', 8, 40),
  ('join_party', 'politics', 'Encontrar representação', 'Filie-se a um partido político.', 'Política', 'party_membership', 1, '/services/political-parties', 8, 50),
  ('open_business', 'entrepreneurship', 'Abrir um negócio', 'Registre seu primeiro empreendimento.', 'Empreendedorismo', 'businesses', 1, '/services/entrepreneur-portal', 10, 50),
  ('follow_justice', 'justice', 'Conhecer a Justiça', 'Acesse os serviços de Justiça e acompanhe seus direitos.', 'Justiça', 'page_justice', 1, '/services/justice', 5, 50),
  ('explore_services', 'civil_life', 'Explorar os serviços', 'Conheça pelo menos cinco áreas do GOV.RP.', 'Vida civil', 'services', 5, '/services', 10, 50)
on conflict (objective_key) do update set
  title = excluded.title,
  description = excluded.description,
  aspiration = excluded.aspiration,
  action_path = excluded.action_path,
  reputation_reward = excluded.reputation_reward,
  is_active = true;

create or replace function public.refresh_my_citizen_objectives()
returns table (
  objective_id uuid,
  objective_key text,
  title text,
  description text,
  category text,
  action_path text,
  target_value integer,
  progress integer,
  reputation_reward integer,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_aspiration text;
  objective record;
  v_progress integer;
  v_completed_at timestamptz;
begin
  if v_user_id is null then raise exception 'É necessário estar autenticado.'; end if;
  select profile.initial_aspiration into v_aspiration from public.profiles profile where profile.id = v_user_id and profile.deleted_at is null;
  if not found then raise exception 'Cidadão não encontrado.'; end if;

  for objective in
    select definition.* from public.citizen_objective_definitions definition
    where definition.is_active and (definition.aspiration is null or definition.aspiration = v_aspiration)
    order by definition.sort_order, definition.title
  loop
    v_progress := case objective.target_type
      when 'onboarding' then (select case when profile.onboarding_completed then 1 else 0 end from public.profiles profile where profile.id = v_user_id)
      when 'posts' then (select count(*)::integer from public.posts post where post.user_id = v_user_id and post.parent_post_id is null)
      when 'transactions' then (select count(*)::integer from public.transactions transaction_row join public.accounts account on account.id in (transaction_row.from_account_id, transaction_row.to_account_id) where account.user_id = v_user_id)
      when 'votes' then (
        (select count(*)::integer from public.plebiscite_votes vote where vote.voter_id = v_user_id) +
        (select count(*)::integer from public.bill_votes vote join public.parliament_members member on member.id = vote.member_id where member.user_id = v_user_id)
      )
      when 'party_membership' then (select count(*)::integer from public.party_members member where member.user_id = v_user_id)
      when 'businesses' then (select count(*)::integer from public.businesses business where business.owner_id = v_user_id)
      when 'page_justice' then (select count(*)::integer from public.user_page_views view_row where view_row.user_id = v_user_id and view_row.path like '/services/justice%')
      when 'services' then (select count(distinct view_row.service_key)::integer from public.user_page_views view_row where view_row.user_id = v_user_id and view_row.service_key is not null)
      else 0
    end;
    v_progress := least(objective.target_value, greatest(0, coalesce(v_progress, 0)));
    v_completed_at := case when v_progress >= objective.target_value then clock_timestamp() else null end;

    insert into public.citizen_objective_progress (user_id, objective_id, progress, completed_at, updated_at)
    values (v_user_id, objective.id, v_progress, v_completed_at, clock_timestamp())
    on conflict on constraint citizen_objective_progress_pkey do update set
      progress = greatest(public.citizen_objective_progress.progress, excluded.progress),
      completed_at = coalesce(public.citizen_objective_progress.completed_at, excluded.completed_at),
      updated_at = excluded.updated_at;

    update public.citizen_objective_progress progress_row
    set reward_claimed_at = clock_timestamp()
    where progress_row.user_id = v_user_id
      and progress_row.objective_id = objective.id
      and progress_row.completed_at is not null
      and progress_row.reward_claimed_at is null;

    if found and objective.reputation_reward > 0 then
      update public.profiles
      set reputation_points = coalesce(reputation_points, 0) + objective.reputation_reward,
          updated_at = clock_timestamp()
      where id = v_user_id;
    end if;
  end loop;

  return query
  select definition.id, definition.objective_key, definition.title, definition.description,
         definition.category, definition.action_path, definition.target_value,
         progress_row.progress, definition.reputation_reward, progress_row.completed_at
  from public.citizen_objective_definitions definition
  join public.citizen_objective_progress progress_row
    on progress_row.objective_id = definition.id and progress_row.user_id = v_user_id
  where definition.is_active and (definition.aspiration is null or definition.aspiration = v_aspiration)
  order by definition.sort_order, definition.title;
end;
$$;

revoke all on function public.refresh_my_citizen_objectives() from public, anon;
grant execute on function public.refresh_my_citizen_objectives() to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'country_rp_exchange_rates') then
      alter publication supabase_realtime add table public.country_rp_exchange_rates;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'national_game_events') then
      alter publication supabase_realtime add table public.national_game_events;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
