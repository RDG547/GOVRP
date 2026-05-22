create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists manual_role_override boolean not null default false,
  add column if not exists role_assigned_at timestamptz,
  add column if not exists role_assigned_by uuid references public.profiles(id) on delete set null;

comment on column public.profiles.manual_role_override is
  'Protects admin-assigned roles from automatic election cleanup until a later election supersedes that office.';

create or replace function public.election_supersedes_manual_role(
  p_role text,
  p_role_assigned_at timestamptz
)
returns boolean
language sql
stable
as $$
  select coalesce(
    exists (
      select 1
      from public.system_settings settings
      cross join lateral jsonb_array_elements(coalesce(settings.value::jsonb->'settlements', '[]'::jsonb)) settlement
      where settings.key = 'election_office_sync'
        and p_role is not null
        and p_role_assigned_at is not null
        and nullif(settlement->>'term_start_at', '') is not null
        and (
          (settlement->>'office_role' = 'Presidente' and p_role in ('Presidente', 'Vice-Presidente'))
          or settlement->>'office_role' = p_role
        )
        and (settlement->>'term_start_at')::timestamptz > p_role_assigned_at
    ),
    false
  );
$$;

update public.profiles
set
  manual_role_override = true,
  role_assigned_at = coalesce(role_assigned_at, now())
where role is not null
  and role not in ('Usuario', 'Usuário', 'Cidadao', 'Cidadão')
  and manual_role_override = false
  and not exists (
    select 1
    from public.system_settings settings
    cross join lateral jsonb_array_elements(coalesce(settings.value::jsonb->'active_assignments', '[]'::jsonb)) assignment
    where settings.key = 'election_office_sync'
      and assignment->>'user_id' = public.profiles.id::text
      and assignment->>'office_role' = public.profiles.role
  );

create or replace function public.protect_manual_admin_role()
returns trigger
language plpgsql
as $$
begin
  if old.manual_role_override is true
     and old.role in ('Presidente', 'Vice-Presidente', 'Deputado', 'Senador', 'Ministro')
     and new.role in ('Usuario', 'Usuário', 'Cidadao', 'Cidadão')
     and coalesce(new.manual_role_override, old.manual_role_override) is true
     and public.election_supersedes_manual_role(old.role, old.role_assigned_at) is false then
    new.role := old.role;
    new.manual_role_override := true;
    new.role_assigned_at := old.role_assigned_at;
    new.role_assigned_by := old.role_assigned_by;
    return new;
  end if;

  if new.role is distinct from old.role
     and new.role is not null
     and new.role not in ('Usuario', 'Usuário', 'Cidadao', 'Cidadão')
     and coalesce(new.manual_role_override, false) is false
     and not exists (
       select 1
       from public.system_settings settings
       cross join lateral jsonb_array_elements(coalesce(settings.value::jsonb->'active_assignments', '[]'::jsonb)) assignment
       where settings.key = 'election_office_sync'
         and assignment->>'user_id' = new.id::text
         and assignment->>'office_role' = new.role
     ) then
    new.manual_role_override := true;
    new.role_assigned_at := now();
  end if;

  if new.role is not null
     and new.role not in ('Usuario', 'Usuário', 'Cidadao', 'Cidadão')
     and coalesce(new.manual_role_override, false) is true
     and new.role_assigned_at is null then
    new.role_assigned_at := now();
  end if;

  if new.role in ('Usuario', 'Usuário', 'Cidadao', 'Cidadão')
     and public.election_supersedes_manual_role(old.role, old.role_assigned_at) is true then
    new.manual_role_override := false;
    new.role_assigned_at := null;
    new.role_assigned_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_manual_admin_role_trigger on public.profiles;

create trigger protect_manual_admin_role_trigger
  before update of role, manual_role_override
  on public.profiles
  for each row
  execute function public.protect_manual_admin_role();

create table if not exists public.user_activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null constraint user_activity_sessions_user_id_fkey references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_seen_at timestamptz not null default now(),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  entry_path text,
  exit_path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_page_views (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null constraint user_page_views_session_id_fkey references public.user_activity_sessions(id) on delete cascade,
  user_id uuid not null constraint user_page_views_user_id_fkey references public.profiles(id) on delete cascade,
  path text not null,
  page_title text,
  service_key text,
  viewed_at timestamptz not null default now()
);

create index if not exists user_activity_sessions_user_started_idx
  on public.user_activity_sessions(user_id, started_at desc);

create index if not exists user_activity_sessions_started_idx
  on public.user_activity_sessions(started_at desc);

create index if not exists user_page_views_session_viewed_idx
  on public.user_page_views(session_id, viewed_at desc);

create index if not exists user_page_views_service_viewed_idx
  on public.user_page_views(service_key, viewed_at desc);

alter table public.user_activity_sessions enable row level security;
alter table public.user_page_views enable row level security;

drop policy if exists "Users can insert own activity sessions" on public.user_activity_sessions;
create policy "Users can insert own activity sessions"
  on public.user_activity_sessions
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own activity sessions" on public.user_activity_sessions;
create policy "Users can update own activity sessions"
  on public.user_activity_sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own activity sessions" on public.user_activity_sessions;
create policy "Users can read own activity sessions"
  on public.user_activity_sessions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can read activity sessions" on public.user_activity_sessions;
create policy "Admins can read activity sessions"
  on public.user_activity_sessions
  for select
  using (
    exists (
      select 1
      from public.profiles admin_profile
      where admin_profile.id = auth.uid()
        and admin_profile.role = 'Admin'
    )
  );

drop policy if exists "Users can insert own page views" on public.user_page_views;
create policy "Users can insert own page views"
  on public.user_page_views
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own page views" on public.user_page_views;
create policy "Users can read own page views"
  on public.user_page_views
  for select
  using (auth.uid() = user_id);

drop policy if exists "Admins can read page views" on public.user_page_views;
create policy "Admins can read page views"
  on public.user_page_views
  for select
  using (
    exists (
      select 1
      from public.profiles admin_profile
      where admin_profile.id = auth.uid()
        and admin_profile.role = 'Admin'
    )
  );

create or replace function public.enforce_required_vice_candidate()
returns trigger
language plpgsql
as $$
declare
  requires_vice boolean;
begin
  select
    coalesce(et.requires_vice_candidate, false)
    or lower(coalesce(et.name, '')) = 'presidente'
    or lower(coalesce(e.name, '')) like '%presidencial%'
    into requires_vice
  from public.elections e
  join public.election_types et on et.id = e.election_type_id
  where e.id = new.election_id;

  if coalesce(requires_vice, false) and new.vice_candidate_id is null then
    raise exception 'Candidaturas presidenciais exigem vice aceito antes do envio.';
  end if;

  if coalesce(requires_vice, false) and new.vice_candidate_id = new.user_id then
    raise exception 'O candidato nao pode ser o proprio vice.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_required_vice_candidate_trigger on public.candidates;

create trigger enforce_required_vice_candidate_trigger
  before insert or update of election_id, user_id, vice_candidate_id
  on public.candidates
  for each row
  execute function public.enforce_required_vice_candidate();
