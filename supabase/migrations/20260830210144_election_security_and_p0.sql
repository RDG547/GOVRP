begin;

-- P0: the original trigger bodies supplied recorded_at without listing the
-- column. Recreate them with an explicit, stable column list.
create or replace function public.record_bill_popularity_impact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric := 0;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_delta := case lower(coalesce(new.status, ''))
    when 'approved' then 1
    when 'aprovado' then 1
    when 'sanctioned' then 1.5
    when 'sancionado' then 1.5
    when 'rejected' then -0.5
    when 'rejeitado' then -0.5
    when 'vetoed' then -0.8
    when 'vetado' then -0.8
    else 0
  end;

  insert into public.national_indicator_points (
    country_code,
    indicator_code,
    value,
    unit,
    domain,
    source_type,
    source_table,
    source_id,
    recorded_at,
    metadata
  )
  select
    'BR',
    'congress_approval',
    least(100, greatest(0, 50 + coalesce(sum(event.applied_delta), 0))),
    '%',
    'politics',
    'player_action',
    'bills',
    new.id::text,
    clock_timestamp(),
    jsonb_build_object('status', new.status)
  from public.government_popularity_events event;

  if v_delta <> 0 then
    perform public.apply_government_impact(
      'politics',
      'bill_' || lower(coalesce(new.status, 'updated')),
      'Projeto legislativo "' || new.title || '": ' || new.status || '.',
      v_delta,
      0,
      'bills',
      new.id::text,
      jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;

create or replace function public.record_public_safety_indicators()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric;
  v_resolved numeric;
  v_resolution_rate numeric;
  v_impact numeric := 0;
begin
  select
    count(*),
    count(*) filter (where status in ('Concluída', 'Arquivada'))
  into v_total, v_resolved
  from public.police_occurrences;

  v_resolution_rate := case
    when v_total = 0 then 0
    else round(v_resolved * 100 / v_total, 4)
  end;

  insert into public.national_indicator_points (
    country_code,
    indicator_code,
    value,
    unit,
    domain,
    source_type,
    source_table,
    source_id,
    recorded_at,
    metadata
  )
  values
    (
      'BR', 'reported_crime_occurrences', v_total, 'ocorrências', 'security',
      'rp_simulation', 'police_occurrences', new.id::text, clock_timestamp(),
      jsonb_build_object('status', new.status)
    ),
    (
      'BR', 'police_resolution_rate', v_resolution_rate, '%', 'security',
      'rp_simulation', 'police_occurrences', new.id::text || ':resolution', clock_timestamp(),
      jsonb_build_object('resolved', v_resolved, 'total', v_total)
    );

  if tg_op = 'INSERT' and new.priority in ('high', 'urgent') then
    v_impact := case when new.priority = 'urgent' then -1 else -0.4 end;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'Concluída' then
    v_impact := 0.7;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'Arquivada' then
    v_impact := 0.1;
  end if;

  if v_impact <> 0 then
    perform public.apply_government_impact(
      'security',
      'public_safety_update',
      'Atualização da segurança pública: ' || new.status || '.',
      0,
      v_impact,
      'police_occurrences',
      new.id::text,
      jsonb_build_object('priority', new.priority, 'resolutionRate', v_resolution_rate)
    );
  end if;

  return new;
end;
$$;

-- Votes created before this hardening are preserved as legacy records. New
-- votes are marked by the authoritative RPC and direct writes are disabled.
alter table public.votes
  add column if not exists is_valid boolean not null default true,
  add column if not exists validation_source text not null default 'legacy',
  add column if not exists validated_at timestamptz,
  add column if not exists integrity_metadata jsonb not null default '{}'::jsonb;

update public.votes
set validated_at = coalesce(validated_at, voted_at),
    validation_source = coalesce(nullif(validation_source, ''), 'legacy')
where validated_at is null
   or validation_source is null
   or validation_source = '';

create table if not exists public.election_settlements (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null unique references public.elections(id) on delete restrict,
  status text not null,
  office_role text,
  total_valid_votes bigint not null default 0,
  result_revision integer not null default 1,
  result jsonb not null default '[]'::jsonb,
  processed_by uuid references public.profiles(id) on delete set null,
  processed_at timestamptz not null default clock_timestamp(),
  metadata jsonb not null default '{}'::jsonb,
  constraint election_settlements_status_check
    check (status in ('settled', 'no_votes', 'tied', 'unsupported', 'cancelled')),
  constraint election_settlements_revision_check check (result_revision > 0)
);

create table if not exists public.election_office_assignments (
  id uuid primary key default gen_random_uuid(),
  election_id uuid not null references public.elections(id) on delete restrict,
  candidate_id uuid references public.candidates(id) on delete set null,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  office_role text not null,
  votes_received bigint not null default 0,
  term_starts_at timestamptz not null,
  term_ends_at timestamptz not null,
  status text not null default 'active',
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (election_id, profile_id, office_role),
  constraint election_office_assignments_status_check check (status in ('active', 'expired', 'revoked')),
  constraint election_office_assignments_term_check check (term_ends_at > term_starts_at),
  constraint election_office_assignments_votes_check check (votes_received >= 0)
);

create table if not exists public.election_audit_log (
  id bigint generated always as identity primary key,
  election_id uuid references public.elections(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists election_office_assignments_active_idx
  on public.election_office_assignments (office_role, status, term_ends_at desc);
create index if not exists election_audit_log_election_idx
  on public.election_audit_log (election_id, created_at desc);
create index if not exists votes_valid_results_idx
  on public.votes (election_id, candidate_id) where is_valid;

alter table public.election_settlements enable row level security;
alter table public.election_office_assignments enable row level security;
alter table public.election_audit_log enable row level security;

drop policy if exists election_settlements_public_read on public.election_settlements;
create policy election_settlements_public_read
on public.election_settlements for select to anon, authenticated
using (true);

drop policy if exists election_office_assignments_public_read on public.election_office_assignments;
create policy election_office_assignments_public_read
on public.election_office_assignments for select to anon, authenticated
using (true);

drop policy if exists election_audit_admin_read on public.election_audit_log;
create policy election_audit_admin_read
on public.election_audit_log for select to authenticated
using (public.is_admin(auth.uid()));

create or replace function public.block_election_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ELECTION_AUDIT_IS_IMMUTABLE';
end;
$$;

drop trigger if exists election_audit_immutable on public.election_audit_log;
create trigger election_audit_immutable
before update or delete on public.election_audit_log
for each row execute function public.block_election_audit_mutation();

revoke all on public.election_settlements, public.election_office_assignments, public.election_audit_log
  from public, anon, authenticated;
grant select on public.election_settlements, public.election_office_assignments to anon, authenticated;
grant select on public.election_audit_log to authenticated;
grant all on public.election_settlements, public.election_office_assignments, public.election_audit_log to service_role;
grant usage, select on sequence public.election_audit_log_id_seq to service_role;

-- A citizen may only request a pending candidacy through this function.
create or replace function public.submit_candidacy(
  p_election_id uuid,
  p_party_id uuid,
  p_vice_candidate_id uuid,
  p_political_name text,
  p_bio text,
  p_proposals text,
  p_campaign_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requester uuid := auth.uid();
  v_election record;
  v_requires_vice boolean;
  v_candidate_id uuid;
begin
  if v_requester is null then
    raise exception 'AUTHENTICATION_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_political_name, '')), '') is null
     or char_length(btrim(p_political_name)) > 80 then
    raise exception 'POLITICAL_NAME_INVALID';
  end if;

  select e.*, et.name as type_name, coalesce(et.requires_vice_candidate, false) as requires_vice
    into v_election
  from public.elections e
  left join public.election_types et on et.id = e.election_type_id
  where e.id = p_election_id
  for update of e;

  if not found then raise exception 'ELECTION_NOT_FOUND'; end if;
  if lower(coalesce(v_election.status, '')) <> 'candidacy'
     or clock_timestamp() < v_election.candidacy_start_date
     or clock_timestamp() > v_election.candidacy_end_date then
    raise exception 'CANDIDACY_WINDOW_CLOSED';
  end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_requester
      and profile.deleted_at is null
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'CITIZEN_NOT_ELIGIBLE';
  end if;

  if p_party_id is not null and not exists (
    select 1 from public.party_members member
    where member.party_id = p_party_id and member.user_id = v_requester
  ) then
    raise exception 'PARTY_MEMBERSHIP_REQUIRED';
  end if;

  v_requires_vice := v_election.requires_vice
    or lower(coalesce(v_election.type_name, '')) = 'presidente'
    or lower(coalesce(v_election.name, '')) like '%presidencial%';

  if v_requires_vice and p_vice_candidate_id is null then
    raise exception 'VICE_CANDIDATE_REQUIRED';
  end if;
  if p_vice_candidate_id = v_requester then raise exception 'SELF_VICE_NOT_ALLOWED'; end if;
  if p_vice_candidate_id is not null and not exists (
    select 1 from public.profiles profile
    where profile.id = p_vice_candidate_id
      and profile.deleted_at is null
      and profile.role not in ('Admin', 'Presidente')
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'VICE_CANDIDATE_NOT_ELIGIBLE';
  end if;

  if exists (
    select 1
    from public.candidates candidate
    join public.elections election on election.id = candidate.election_id
    where candidate.status in ('Pendente', 'Pending', 'Approved')
      and (candidate.user_id = v_requester or candidate.vice_candidate_id = v_requester)
      and (lower(coalesce(election.status, '')) in ('scheduled', 'candidacy', 'voting')
        or election.voting_end_date > clock_timestamp())
  ) then
    raise exception 'ACTIVE_CANDIDACY_EXISTS';
  end if;

  if p_vice_candidate_id is not null and exists (
    select 1 from public.candidates candidate
    where candidate.election_id = p_election_id
      and candidate.status in ('Pendente', 'Pending', 'Approved')
      and p_vice_candidate_id in (candidate.user_id, candidate.vice_candidate_id)
  ) then
    raise exception 'VICE_ALREADY_RUNNING';
  end if;

  insert into public.candidates (
    election_id, user_id, party_id, vice_candidate_id, political_name,
    bio, proposals, campaign_photo_url, status
  ) values (
    p_election_id, v_requester, p_party_id, p_vice_candidate_id,
    btrim(p_political_name), nullif(btrim(coalesce(p_bio, '')), ''),
    nullif(btrim(coalesce(p_proposals, '')), ''),
    nullif(btrim(coalesce(p_campaign_photo_url, '')), ''), 'Pendente'
  ) returning id into v_candidate_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id, after_state
  ) values (
    p_election_id, v_requester, public.get_user_role(v_requester), 'candidacy_requested',
    'candidate', v_candidate_id::text,
    jsonb_build_object('status', 'Pendente', 'party_id', p_party_id, 'vice_candidate_id', p_vice_candidate_id)
  );

  return jsonb_build_object(
    'success', true,
    'candidate_id', v_candidate_id,
    'status', 'Pendente',
    'message', 'Candidatura enviada para análise.'
  );
exception
  when unique_violation then
    raise exception 'CANDIDACY_ALREADY_EXISTS';
end;
$$;

create or replace function public.approve_candidacy(p_candidate_id uuid, p_feedback text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_candidate record;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.is_admin(v_actor) then raise exception 'ADMIN_REQUIRED'; end if;

  select candidate.*, election.status as election_status,
         election.candidacy_start_date, election.candidacy_end_date
  into v_candidate
  from public.candidates candidate
  join public.elections election on election.id = candidate.election_id
  where candidate.id = p_candidate_id
  for update of candidate, election;

  if not found then raise exception 'CANDIDACY_NOT_FOUND'; end if;
  if v_candidate.status not in ('Pendente', 'Pending') then raise exception 'CANDIDACY_ALREADY_PROCESSED'; end if;
  if lower(coalesce(v_candidate.election_status, '')) <> 'candidacy'
     or clock_timestamp() not between v_candidate.candidacy_start_date and v_candidate.candidacy_end_date then
    raise exception 'CANDIDACY_WINDOW_CLOSED';
  end if;

  update public.candidates
  set status = 'Approved', admin_feedback = nullif(btrim(coalesce(p_feedback, '')), '')
  where id = p_candidate_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) values (
    v_candidate.election_id, v_actor, 'Admin', 'candidacy_approved', 'candidate', p_candidate_id::text,
    jsonb_build_object('status', v_candidate.status), jsonb_build_object('status', 'Approved'),
    jsonb_build_object('feedback', nullif(btrim(coalesce(p_feedback, '')), ''))
  );

  insert into public.notifications (user_id, sender_id, type, content, link, metadata)
  values (
    v_candidate.user_id, v_actor, 'candidacy_approved',
    'Sua candidatura foi aprovada.', '/services/elections',
    jsonb_build_object('candidate_id', p_candidate_id, 'election_id', v_candidate.election_id)
  );

  return json_build_object('success', true, 'message', 'Candidatura aprovada com sucesso.');
end;
$$;

create or replace function public.reject_candidacy(p_candidate_id uuid, p_feedback text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_candidate public.candidates%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.is_admin(v_actor) then raise exception 'ADMIN_REQUIRED'; end if;

  select * into v_candidate from public.candidates where id = p_candidate_id for update;
  if not found then raise exception 'CANDIDACY_NOT_FOUND'; end if;
  if v_candidate.status not in ('Pendente', 'Pending') then raise exception 'CANDIDACY_ALREADY_PROCESSED'; end if;

  update public.candidates
  set status = 'Rejected', admin_feedback = nullif(btrim(coalesce(p_feedback, '')), '')
  where id = p_candidate_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id,
    before_state, after_state, metadata
  ) values (
    v_candidate.election_id, v_actor, 'Admin', 'candidacy_rejected', 'candidate', p_candidate_id::text,
    jsonb_build_object('status', v_candidate.status), jsonb_build_object('status', 'Rejected'),
    jsonb_build_object('feedback', nullif(btrim(coalesce(p_feedback, '')), ''))
  );

  insert into public.notifications (user_id, sender_id, type, content, link, metadata)
  values (
    v_candidate.user_id, v_actor, 'candidacy_rejected',
    'Sua candidatura foi rejeitada.', '/services/elections',
    jsonb_build_object('candidate_id', p_candidate_id, 'election_id', v_candidate.election_id)
  );

  return json_build_object('success', true, 'message', 'Candidatura rejeitada.');
end;
$$;

create or replace function public.cast_vote(p_election_id uuid, p_candidate_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_voter uuid := auth.uid();
  v_election public.elections%rowtype;
  v_candidate public.candidates%rowtype;
  v_vote_id uuid;
begin
  if v_voter is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  if not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter
      and profile.deleted_at is null
      and (profile.onboarding_completed or profile.role <> 'Usuário')
  ) then
    raise exception 'VOTER_NOT_ELIGIBLE';
  end if;

  if not exists (
    select 1 from public.documents document
    where document.user_id = v_voter
      and document.type = 'Título de Eleitor'
      and document.is_valid
      and (document.expires_at is null or document.expires_at >= clock_timestamp())
  ) and not exists (
    select 1 from public.profiles profile
    where profile.id = v_voter and nullif(btrim(profile.titulo_eleitor), '') is not null
  ) then
    raise exception 'VOTER_REGISTRATION_REQUIRED';
  end if;

  select * into v_election
  from public.elections
  where id = p_election_id
  for share;

  if not found then raise exception 'ELECTION_NOT_FOUND'; end if;
  if lower(coalesce(v_election.status, '')) <> 'voting'
     or clock_timestamp() < v_election.voting_start_date
     or clock_timestamp() > v_election.voting_end_date then
    raise exception 'ELECTION_NOT_OPEN';
  end if;

  select * into v_candidate
  from public.candidates
  where id = p_candidate_id
    and election_id = p_election_id
    and status = 'Approved';

  if not found then raise exception 'APPROVED_CANDIDATE_REQUIRED'; end if;

  insert into public.votes (
    election_id, voter_id, candidate_id, is_valid, validation_source,
    validated_at, integrity_metadata
  ) values (
    p_election_id, v_voter, p_candidate_id, true, 'cast_vote',
    clock_timestamp(), jsonb_build_object('authenticated_voter', true)
  ) returning id into v_vote_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id, after_state
  ) values (
    p_election_id, v_voter, public.get_user_role(v_voter), 'vote_cast', 'vote', v_vote_id::text,
    jsonb_build_object('candidate_id', p_candidate_id, 'validation_source', 'cast_vote')
  );

  return json_build_object('success', true, 'message', 'Voto computado com sucesso!');
exception
  when unique_violation then
    raise exception 'VOTE_ALREADY_CAST';
end;
$$;

create or replace function public.get_election_results(p_election_id uuid)
returns table (
  candidate_id uuid,
  political_name text,
  campaign_photo_url text,
  party_name text,
  party_logo_url text,
  vote_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    candidate.id,
    candidate.political_name,
    candidate.campaign_photo_url,
    party.name,
    party.logo_url,
    count(vote.id) filter (where vote.is_valid)
  from public.candidates candidate
  left join public.votes vote
    on vote.candidate_id = candidate.id
   and vote.election_id = candidate.election_id
   and vote.is_valid
  left join public.political_parties party on party.id = candidate.party_id
  where candidate.election_id = p_election_id
    and candidate.status = 'Approved'
  group by candidate.id, party.name, party.logo_url
  order by count(vote.id) filter (where vote.is_valid) desc, candidate.created_at, candidate.id;
$$;

create or replace function public.settle_election_offices(p_election_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_election record;
  v_existing public.election_settlements%rowtype;
  v_office text;
  v_total bigint := 0;
  v_top_votes bigint := 0;
  v_top_count integer := 0;
  v_status text := 'settled';
  v_term_start timestamptz;
  v_term_end timestamptz;
  v_results jsonb := '[]'::jsonb;
  v_winners jsonb := '[]'::jsonb;
  v_winner record;
  v_old record;
  v_house_id uuid;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.is_admin(v_actor) then raise exception 'ADMIN_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('election-settlement:' || p_election_id::text, 0));

  select settlement.* into v_existing
  from public.election_settlements settlement
  where settlement.election_id = p_election_id;

  if found then
    return jsonb_build_object(
      'success', true, 'idempotent', true, 'status', v_existing.status,
      'election_id', p_election_id, 'result_revision', v_existing.result_revision,
      'winners', v_existing.result
    );
  end if;

  select election.*, election_type.name as office_role,
         election_type.voting_system, election_type.requires_vice_candidate
  into v_election
  from public.elections election
  left join public.election_types election_type on election_type.id = election.election_type_id
  where election.id = p_election_id
  for update of election;

  if not found then raise exception 'ELECTION_NOT_FOUND'; end if;
  if lower(coalesce(v_election.status, '')) in ('cancelled', 'canceled', 'cancelada') then
    raise exception 'ELECTION_CANCELLED';
  end if;
  if clock_timestamp() <= v_election.voting_end_date then raise exception 'ELECTION_NOT_FINISHED'; end if;

  v_office := v_election.office_role;
  v_term_start := v_election.voting_end_date;
  v_term_end := v_election.voting_end_date + interval '1 month';

  select coalesce(sum(result.vote_count), 0), coalesce(max(result.vote_count), 0)
  into v_total, v_top_votes
  from public.get_election_results(p_election_id) result;

  select coalesce(jsonb_agg(to_jsonb(result) order by result.vote_count desc, result.candidate_id), '[]'::jsonb)
  into v_results
  from public.get_election_results(p_election_id) result;

  if v_office not in ('Presidente', 'Deputado', 'Senador') then
    v_status := 'unsupported';
  elsif v_total = 0 then
    v_status := 'no_votes';
  elsif v_office = 'Presidente' or lower(coalesce(v_election.voting_system, '')) = 'majoritarian' then
    select count(*) into v_top_count
    from public.get_election_results(p_election_id) result
    where result.vote_count = v_top_votes;
    if v_top_count <> 1 then v_status := 'tied'; end if;
  end if;

  if v_status = 'settled' then
    for v_winner in
      select result.*, candidate.user_id, candidate.vice_candidate_id
      from public.get_election_results(p_election_id) result
      join public.candidates candidate on candidate.id = result.candidate_id
      where result.vote_count > 0
        and (
          (v_office in ('Deputado', 'Senador'))
          or result.vote_count = v_top_votes
        )
      order by result.vote_count desc, result.candidate_id
    loop
      v_winners := v_winners || jsonb_build_array(jsonb_build_object(
        'candidate_id', v_winner.candidate_id,
        'profile_id', v_winner.user_id,
        'office_role', v_office,
        'votes', v_winner.vote_count
      ));

      insert into public.election_office_assignments (
        election_id, candidate_id, profile_id, office_role, votes_received,
        term_starts_at, term_ends_at, assigned_by, metadata
      ) values (
        p_election_id, v_winner.candidate_id, v_winner.user_id, v_office,
        v_winner.vote_count, v_term_start, v_term_end, v_actor,
        jsonb_build_object('result_revision', 1)
      );

      update public.profiles
      set role = v_office,
          titles = array(select distinct unnest(coalesce(titles, '{}'::text[]) || array[v_office])),
          manual_role_override = false,
          role_assigned_at = clock_timestamp(),
          role_assigned_by = v_actor,
          updated_at = clock_timestamp()
      where id = v_winner.user_id
        and role <> 'Admin'
        and (role in ('Usuário', 'Cidadão', 'Presidente', 'Vice-Presidente', 'Deputado', 'Senador') or role is null);

      insert into public.notifications (user_id, sender_id, type, content, link, metadata)
      values (
        v_winner.user_id, v_actor, 'office_awarded',
        'Seu mandato de ' || v_office || ' foi oficializado.',
        case when v_office in ('Deputado', 'Senador') then '/services/parliament' else '/dashboard' end,
        jsonb_build_object(
          'office_role', v_office, 'election_id', p_election_id,
          'term_start_at', v_term_start, 'term_end_at', v_term_end,
          'votes', v_winner.vote_count, 'popup_pending', true
        )
      );

      if v_office in ('Deputado', 'Senador') then
        select house.id into v_house_id
        from public.parliament_houses house
        where lower(house.name) like case when v_office = 'Deputado' then '%câmara%' else '%senado%' end
        order by house.id limit 1;
        if v_house_id is not null then
          insert into public.parliament_members (
            user_id, house_id, party_id, term_start_date, term_end_date
          ) values (
            v_winner.user_id, v_house_id,
            (select candidate.party_id from public.candidates candidate where candidate.id = v_winner.candidate_id),
            v_term_start::date, v_term_end::date
          )
          on conflict (user_id, house_id) do update
            set party_id = excluded.party_id,
                term_start_date = excluded.term_start_date,
                term_end_date = excluded.term_end_date;
        end if;
      end if;

      if v_office = 'Presidente' and v_winner.vice_candidate_id is not null then
        v_winners := v_winners || jsonb_build_array(jsonb_build_object(
          'candidate_id', v_winner.candidate_id,
          'profile_id', v_winner.vice_candidate_id,
          'office_role', 'Vice-Presidente',
          'votes', v_winner.vote_count
        ));
        insert into public.election_office_assignments (
          election_id, candidate_id, profile_id, office_role, votes_received,
          term_starts_at, term_ends_at, assigned_by, metadata
        ) values (
          p_election_id, v_winner.candidate_id, v_winner.vice_candidate_id,
          'Vice-Presidente', v_winner.vote_count, v_term_start, v_term_end,
          v_actor, jsonb_build_object('result_revision', 1, 'ticket', true)
        );
        update public.profiles
        set role = 'Vice-Presidente',
            titles = array(select distinct unnest(coalesce(titles, '{}'::text[]) || array['Vice-Presidente'])),
            manual_role_override = false,
            role_assigned_at = clock_timestamp(),
            role_assigned_by = v_actor,
            updated_at = clock_timestamp()
        where id = v_winner.vice_candidate_id
          and role <> 'Admin'
          and (role in ('Usuário', 'Cidadão', 'Presidente', 'Vice-Presidente', 'Deputado', 'Senador') or role is null);
      end if;
    end loop;

    for v_old in
      select assignment.*
      from public.election_office_assignments assignment
      where assignment.election_id <> p_election_id
        and assignment.status = 'active'
        and assignment.office_role in (
          case when v_office = 'Presidente' then 'Presidente' else v_office end,
          case when v_office = 'Presidente' then 'Vice-Presidente' else v_office end
        )
        and not exists (
          select 1 from jsonb_array_elements(v_winners) winner
          where winner->>'profile_id' = assignment.profile_id::text
            and winner->>'office_role' = assignment.office_role
        )
    loop
      update public.election_office_assignments
      set status = 'expired', ended_at = clock_timestamp()
      where id = v_old.id;
      update public.profiles
      set role = 'Cidadão',
          titles = array_remove(coalesce(titles, '{}'::text[]), v_old.office_role),
          manual_role_override = false,
          role_assigned_at = null,
          role_assigned_by = null,
          updated_at = clock_timestamp()
      where id = v_old.profile_id
        and role = v_old.office_role
        and not manual_role_override;
    end loop;
  end if;

  insert into public.election_settlements (
    election_id, status, office_role, total_valid_votes, result_revision,
    result, processed_by, metadata
  ) values (
    p_election_id, v_status, v_office, v_total, 1, v_winners, v_actor,
    jsonb_build_object('full_result', v_results, 'engine_version', '2.0.0')
  );

  update public.elections set status = 'Finished' where id = p_election_id;

  insert into public.election_audit_log (
    election_id, actor_id, actor_role, action, entity_type, entity_id,
    after_state, metadata
  ) values (
    p_election_id, v_actor, 'Admin', 'election_settled', 'election', p_election_id::text,
    jsonb_build_object('status', v_status, 'office_role', v_office, 'winners', v_winners),
    jsonb_build_object('total_valid_votes', v_total, 'result_revision', 1, 'full_result', v_results)
  );

  return jsonb_build_object(
    'success', true, 'idempotent', false, 'status', v_status,
    'election_id', p_election_id, 'result_revision', 1,
    'total_valid_votes', v_total, 'winners', v_winners
  );
end;
$$;

-- Candidate owners retain read access but no longer have a blanket ALL policy.
drop policy if exists "Users can manage their own candidacy" on public.candidates;
drop policy if exists candidates_owner_read on public.candidates;
create policy candidates_owner_read
on public.candidates for select to authenticated
using (user_id = auth.uid() or vice_candidate_id = auth.uid());

drop policy if exists "Users can cast their own vote" on public.votes;

revoke insert, update, delete on public.votes from public, anon, authenticated;
revoke insert, update, delete on public.candidates from public, anon;
-- Authenticated DML is retained for Admin policies; ordinary users have no
-- matching write policy and therefore cannot bypass the RPCs.
grant insert, update, delete on public.candidates to authenticated;

revoke all on function public.submit_candidacy(uuid,uuid,uuid,text,text,text,text) from public, anon;
grant execute on function public.submit_candidacy(uuid,uuid,uuid,text,text,text,text) to authenticated, service_role;
revoke all on function public.approve_candidacy(uuid,text) from public, anon;
grant execute on function public.approve_candidacy(uuid,text) to authenticated, service_role;
revoke all on function public.reject_candidacy(uuid,text) from public, anon;
grant execute on function public.reject_candidacy(uuid,text) to authenticated, service_role;
revoke all on function public.cast_vote(uuid,uuid) from public, anon;
grant execute on function public.cast_vote(uuid,uuid) to authenticated, service_role;
revoke all on function public.settle_election_offices(uuid) from public, anon;
grant execute on function public.settle_election_offices(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
