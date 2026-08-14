-- Camada híbrida entre os dados reais de referência e o estado criado pelos jogadores.
-- O Brasil é a primeira nação jogável; outras podem ser ativadas sem alterar o cliente.

create table if not exists public.country_rp_states (
  country_code text primary key,
  country_name text not null,
  is_playable boolean not null default false,
  economic_baseline jsonb not null default '{}'::jsonb,
  economic_current jsonb not null default '{}'::jsonb,
  political_current jsonb not null default '{}'::jsonb,
  demographic_current jsonb not null default '{}'::jsonb,
  economy_influence numeric(6,5) not null default 0,
  politics_influence numeric(6,5) not null default 0,
  society_influence numeric(6,5) not null default 0,
  revision bigint not null default 0,
  last_event_type text,
  last_event_summary text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint country_rp_states_code_format check (country_code ~ '^[A-Z]{2,3}$'),
  constraint country_rp_states_influence_ranges check (
    economy_influence between 0 and 1
    and politics_influence between 0 and 1
    and society_influence between 0 and 1
  )
);

create table if not exists public.country_rp_events (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.country_rp_states(country_code) on delete cascade,
  domain text not null,
  event_type text not null,
  summary text not null,
  changes jsonb not null default '{}'::jsonb,
  influence_delta numeric(6,5) not null default 0,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint country_rp_events_domain check (domain in ('economy', 'politics', 'demographics')),
  constraint country_rp_events_changes_object check (jsonb_typeof(changes) = 'object')
);

create or replace function public.touch_country_rp_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists country_rp_states_touch on public.country_rp_states;
create trigger country_rp_states_touch
before update on public.country_rp_states
for each row execute function public.touch_country_rp_state();

with initial_economy as (
  select jsonb_strip_nulls(jsonb_build_object(
    'exchangeUsd', (select exchange_rate from public.economic_state where id = true),
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
      order by
        (indicator_code = 'gdp_growth_year_over_year') desc,
        created_at desc
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
    )
  )) as snapshot
)
insert into public.country_rp_states (
  country_code,
  country_name,
  is_playable,
  economic_baseline,
  economic_current
)
select 'BR', 'Brasil', true, snapshot, snapshot
from initial_economy
on conflict (country_code) do nothing;

create or replace function public.sync_brazil_rp_economic_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.country_rp_states
  set economic_current = economic_current || jsonb_build_object(
        'exchangeUsd', new.exchange_rate,
        'playerShare', new.player_share,
        'activityLevel', new.player_activity_level
      ),
      economic_baseline = case
        when economic_baseline ? 'exchangeUsd' then economic_baseline
        else economic_baseline || jsonb_build_object('exchangeUsd', new.exchange_rate)
      end,
      economy_influence = greatest(economy_influence, least(1, greatest(0, new.player_share))),
      last_event_type = 'economic_engine_update',
      last_event_summary = 'Motor econômico do Brasil atualizado em tempo real.'
  where country_code = 'BR';

  return new;
end;
$$;

drop trigger if exists economic_state_syncs_brazil_rp on public.economic_state;
create trigger economic_state_syncs_brazil_rp
after insert or update on public.economic_state
for each row execute function public.sync_brazil_rp_economic_state();

create or replace function public.sync_brazil_rp_indicator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_name text;
  field_value numeric;
  current_player_share numeric := 0;
begin
  field_name := case new.indicator_code
    when 'gdp_nominal' then 'gdp'
    when 'gdp_growth_year_over_year' then 'growth'
    when 'gdp_growth_quarterly' then 'growth'
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

  select coalesce(player_share, 0)
    into current_player_share
    from public.economic_state
   where id = true;

  update public.country_rp_states
  set economic_baseline = case
        when economic_baseline ? field_name then economic_baseline
        else economic_baseline || jsonb_build_object(field_name, field_value)
      end,
      economic_current = economic_current || jsonb_build_object(field_name, field_value),
      economy_influence = greatest(economy_influence, least(1, greatest(0, current_player_share))),
      last_event_type = 'economic_indicator_update',
      last_event_summary = 'Indicador econômico do Brasil recalculado pelo RP.'
  where country_code = 'BR';

  return new;
end;
$$;

drop trigger if exists economic_indicator_syncs_brazil_rp on public.economic_indicators;
create trigger economic_indicator_syncs_brazil_rp
after insert or update on public.economic_indicators
for each row execute function public.sync_brazil_rp_indicator();

create or replace function public.sync_brazil_rp_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('Sancionado', 'Promulgado') then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  update public.country_rp_states
  set political_current = political_current || jsonb_build_object(
        'lastInstitutionalAction', jsonb_build_object(
          'kind', 'law',
          'id', new.id,
          'title', new.title,
          'status', new.status,
          'occurredAt', now()
        )
      ),
      politics_influence = least(1, politics_influence + 0.02),
      last_event_type = 'law_enacted',
      last_event_summary = format('A norma "%s" passou a integrar a história do Brasil no RP.', new.title),
      updated_by = new.author_id
  where country_code = 'BR';

  insert into public.country_rp_events (
    country_code, domain, event_type, summary, changes, influence_delta, actor_id
  ) values (
    'BR',
    'politics',
    'law_enacted',
    format('A norma "%s" passou a integrar a história do Brasil no RP.', new.title),
    jsonb_build_object('billId', new.id, 'title', new.title, 'status', new.status),
    0.02,
    new.author_id
  );

  return new;
end;
$$;

drop trigger if exists enacted_bill_syncs_brazil_rp on public.bills;
create trigger enacted_bill_syncs_brazil_rp
after insert or update on public.bills
for each row execute function public.sync_brazil_rp_bill();

create or replace function public.sync_brazil_rp_decree()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_published then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.is_published then
    return new;
  end if;

  update public.country_rp_states
  set political_current = political_current || jsonb_build_object(
        'lastInstitutionalAction', jsonb_build_object(
          'kind', 'decree',
          'id', new.id,
          'title', new.title,
          'status', 'Publicado',
          'occurredAt', coalesce(new.published_at, now())
        )
      ),
      politics_influence = least(1, politics_influence + 0.01),
      last_event_type = 'decree_published',
      last_event_summary = format('O decreto "%s" entrou em vigor no Brasil do RP.', new.title),
      updated_by = new.author_id
  where country_code = 'BR';

  insert into public.country_rp_events (
    country_code, domain, event_type, summary, changes, influence_delta, actor_id
  ) values (
    'BR',
    'politics',
    'decree_published',
    format('O decreto "%s" entrou em vigor no Brasil do RP.', new.title),
    jsonb_build_object('decreeId', new.id, 'title', new.title, 'status', 'Publicado'),
    0.01,
    new.author_id
  );

  return new;
end;
$$;

drop trigger if exists published_decree_syncs_brazil_rp on public.decrees;
create trigger published_decree_syncs_brazil_rp
after insert or update on public.decrees
for each row execute function public.sync_brazil_rp_decree();

create or replace function public.apply_country_rp_event(
  p_country_code text,
  p_domain text,
  p_changes jsonb,
  p_event_type text,
  p_summary text,
  p_influence_delta numeric default 0.05
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  normalized_code text := upper(trim(p_country_code));
  updated_state public.country_rp_states%rowtype;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid();

  if actor_role not in ('Admin', 'Presidente') then
    raise exception 'Apenas a Presidência ou a administração pode alterar o estado nacional do RP.';
  end if;

  if p_domain not in ('economy', 'politics', 'demographics') then
    raise exception 'Domínio de alteração inválido.';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'As mudanças precisam ser um objeto JSON.';
  end if;

  update public.country_rp_states
  set economic_current = case when p_domain = 'economy'
        then economic_current || p_changes else economic_current end,
      political_current = case when p_domain = 'politics'
        then political_current || p_changes else political_current end,
      demographic_current = case when p_domain = 'demographics'
        then demographic_current || p_changes else demographic_current end,
      economy_influence = case when p_domain = 'economy'
        then least(1, greatest(0, economy_influence + p_influence_delta)) else economy_influence end,
      politics_influence = case when p_domain = 'politics'
        then least(1, greatest(0, politics_influence + p_influence_delta)) else politics_influence end,
      society_influence = case when p_domain = 'demographics'
        then least(1, greatest(0, society_influence + p_influence_delta)) else society_influence end,
      last_event_type = p_event_type,
      last_event_summary = p_summary,
      updated_by = auth.uid()
  where country_code = normalized_code
  returning * into updated_state;

  if updated_state.country_code is null then
    raise exception 'País não habilitado para o RP.';
  end if;

  insert into public.country_rp_events (
    country_code, domain, event_type, summary, changes, influence_delta, actor_id
  ) values (
    normalized_code, p_domain, p_event_type, p_summary, p_changes, p_influence_delta, auth.uid()
  );

  return to_jsonb(updated_state);
end;
$$;

alter table public.country_rp_states enable row level security;
alter table public.country_rp_events enable row level security;

drop policy if exists country_rp_states_public_read on public.country_rp_states;
create policy country_rp_states_public_read
on public.country_rp_states for select
to anon, authenticated
using (true);

drop policy if exists country_rp_states_government_manage on public.country_rp_states;
create policy country_rp_states_government_manage
on public.country_rp_states for all
to authenticated
using (public.get_user_role(auth.uid()) in ('Admin', 'Presidente'))
with check (public.get_user_role(auth.uid()) in ('Admin', 'Presidente'));

drop policy if exists country_rp_events_public_read on public.country_rp_events;
create policy country_rp_events_public_read
on public.country_rp_events for select
to anon, authenticated
using (true);

grant select on public.country_rp_states to anon, authenticated;
grant select on public.country_rp_events to anon, authenticated;
grant all on public.country_rp_states to service_role;
grant all on public.country_rp_events to service_role;
grant execute on function public.apply_country_rp_event(text, text, jsonb, text, text, numeric)
to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.country_rp_states;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.country_rp_events;
exception when duplicate_object then
  null;
end;
$$;
