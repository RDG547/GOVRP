-- GOVRP — Sistema integrado de Segurança e Justiça
-- Fundação: relógio RP, ocorrências, investigação, processo, custódia,
-- execução penal, auditoria, RLS e operações sensíveis via RPC.

create extension if not exists pgcrypto with schema extensions;

do $$ begin
  create type public.justice_case_status as enum (
    'draft',
    'investigation',
    'delegate_review',
    'sent_to_prosecutor',
    'awaiting_charge',
    'charge_filed',
    'judicial_review',
    'initial_defense',
    'instruction',
    'hearing_scheduled',
    'awaiting_sentence',
    'convicted',
    'acquitted',
    'archived',
    'appeal',
    'final',
    'execution',
    'served'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.justice_request_status as enum (
    'pending', 'approved', 'denied', 'cancelled', 'expired'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.justice_warrant_status as enum (
    'requested', 'issued', 'executed', 'expired', 'revoked', 'denied'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.justice_custody_status as enum (
    'awaiting_intake', 'provisional', 'serving', 'released', 'transferred'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.justice_evidence_status as enum (
    'draft', 'collected', 'sealed', 'admitted', 'rejected', 'archived'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.rp_time_settings (
  id boolean primary key default true check (id),
  rp_year_real_seconds bigint not null default 604800 check (rp_year_real_seconds > 0),
  rp_days_per_year integer not null default 365 check (rp_days_per_year between 1 and 1000),
  rp_epoch_real_at timestamptz not null default now(),
  rp_epoch_game_at timestamptz not null default '2026-01-01 00:00:00+00',
  speed_multiplier numeric(10,4) not null default 1 check (speed_multiplier > 0),
  is_paused boolean not null default false,
  paused_real_at timestamptz,
  paused_rp_at timestamptz,
  penal_time_multiplier numeric(10,4) not null default 1 check (penal_time_multiplier > 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.rp_time_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.penal_time_brackets (
  id smallint generated always as identity primary key,
  minimum_years numeric(8,2) not null check (minimum_years >= 0),
  maximum_years numeric(8,2),
  minimum_real_seconds integer not null check (minimum_real_seconds > 0),
  maximum_real_seconds integer not null check (maximum_real_seconds >= minimum_real_seconds),
  label text not null,
  sort_order smallint not null unique,
  is_active boolean not null default true,
  check (maximum_years is null or maximum_years > minimum_years)
);

insert into public.penal_time_brackets
  (minimum_years, maximum_years, minimum_real_seconds, maximum_real_seconds, label, sort_order)
values
  (0, 1, 600, 1200, 'Até 1 ano RP', 1),
  (1, 3, 1200, 2700, '1 a 3 anos RP', 2),
  (3, 6, 2700, 5400, '3 a 6 anos RP', 3),
  (6, 10, 5400, 10800, '6 a 10 anos RP', 4),
  (10, 20, 10800, 21600, '10 a 20 anos RP', 5),
  (20, null, 21600, 43200, 'Acima de 20 anos RP', 6)
on conflict (sort_order) do update set
  minimum_years = excluded.minimum_years,
  maximum_years = excluded.maximum_years,
  minimum_real_seconds = excluded.minimum_real_seconds,
  maximum_real_seconds = excluded.maximum_real_seconds,
  label = excluded.label;

create table if not exists public.justice_number_counters (
  number_type text not null,
  rp_year integer not null,
  current_value bigint not null default 0,
  primary key (number_type, rp_year)
);

alter table public.police_occurrences
  add column if not exists protocol_number text,
  add column if not exists occurrence_type text,
  add column if not exists description text,
  add column if not exists occurred_at timestamptz,
  add column if not exists reported_by uuid references public.profiles(id) on delete set null,
  add column if not exists anonymous boolean,
  add column if not exists assigned_officer_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_delegate_id uuid references public.profiles(id) on delete set null,
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add column if not exists confidentiality_level text not null default 'restricted'
    check (confidentiality_level in ('public', 'restricted', 'confidential', 'secret')),
  add column if not exists triage_notes text,
  add column if not exists department text;

update public.police_occurrences set
  occurrence_type = coalesce(occurrence_type, type),
  description = coalesce(description, details),
  occurred_at = coalesce(occurred_at, created_at),
  reported_by = coalesce(reported_by, user_id),
  anonymous = coalesce(anonymous, is_anonymous)
where occurrence_type is null
   or description is null
   or occurred_at is null
   or anonymous is null;

create unique index if not exists police_occurrences_protocol_number_key
  on public.police_occurrences(protocol_number)
  where protocol_number is not null;
create index if not exists police_occurrences_status_priority_idx
  on public.police_occurrences(status, priority, created_at desc);
create index if not exists police_occurrences_reported_by_idx
  on public.police_occurrences(reported_by);

create table if not exists public.criminal_investigations (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.police_occurrences(id) on delete restrict,
  investigation_number text not null unique,
  lead_officer_id uuid references public.profiles(id) on delete set null,
  delegate_id uuid references public.profiles(id) on delete set null,
  summary text not null,
  status text not null default 'open'
    check (status in (
      'open', 'in_progress', 'delegate_review', 'complement_requested',
      'sent_to_prosecutor', 'archived', 'closed'
    )),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  conclusion text,
  recommended_action text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists criminal_investigations_work_queue_idx
  on public.criminal_investigations(status, delegate_id, lead_officer_id, updated_at);

create table if not exists public.investigation_parties (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.criminal_investigations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  party_type text not null
    check (party_type in ('suspect', 'victim', 'witness', 'reporter', 'officer', 'expert')),
  notes text,
  is_confidential boolean not null default false,
  added_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (investigation_id, profile_id, party_type)
);

create index if not exists investigation_parties_profile_idx
  on public.investigation_parties(profile_id, party_type);

create table if not exists public.investigation_events (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.criminal_investigations(id) on delete restrict,
  event_type text not null,
  title text not null,
  description text,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  rp_occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.criminal_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  investigation_id uuid not null unique references public.criminal_investigations(id) on delete restrict,
  prosecutor_id uuid references public.profiles(id) on delete set null,
  judge_id uuid references public.profiles(id) on delete set null,
  court_level smallint not null default 1 check (court_level in (1, 2)),
  status public.justice_case_status not null default 'draft',
  confidentiality_level text not null default 'restricted'
    check (confidentiality_level in ('public', 'restricted', 'confidential', 'secret')),
  title text not null,
  summary text,
  filed_at timestamptz,
  closed_at timestamptz,
  final_decision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists criminal_cases_judge_queue_idx
  on public.criminal_cases(judge_id, status, court_level, updated_at);

create table if not exists public.case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  party_type text not null
    check (party_type in (
      'defendant', 'victim', 'prosecutor', 'lawyer', 'public_defender',
      'judge', 'assistant_prosecutor'
    )),
  lawyer_id uuid references public.profiles(id) on delete set null,
  representation_status text not null default 'pending'
    check (representation_status in ('pending', 'active', 'declined', 'ended')),
  created_at timestamptz not null default now(),
  unique (case_id, profile_id, party_type)
);

create index if not exists case_parties_profile_idx
  on public.case_parties(profile_id, party_type);
create index if not exists case_parties_lawyer_idx
  on public.case_parties(lawyer_id)
  where lawyer_id is not null;

create table if not exists public.penal_code (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  category text not null,
  severity text not null check (severity in ('light', 'medium', 'serious', 'heinous')),
  minimum_sentence_units numeric(8,2) not null check (minimum_sentence_units >= 0),
  maximum_sentence_units numeric(8,2) not null check (maximum_sentence_units >= minimum_sentence_units),
  base_fine numeric(14,2) not null default 0 check (base_fine >= 0),
  bail_allowed boolean not null default false,
  attempt_allowed boolean not null default true,
  requires_victim boolean not null default false,
  suggested_regime text not null default 'open'
    check (suggested_regime in ('open', 'semi_open', 'closed', 'maximum_security')),
  prescription_rp_days integer,
  security_level text not null default 'low'
    check (security_level in ('low', 'medium', 'high', 'maximum')),
  special_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.case_charges (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  defendant_id uuid not null references public.profiles(id) on delete restrict,
  penal_code_id uuid not null references public.penal_code(id) on delete restrict,
  charge_description text not null,
  status text not null default 'filed'
    check (status in ('suggested', 'filed', 'admitted', 'dismissed', 'convicted', 'acquitted')),
  aggravating_factors jsonb not null default '[]'::jsonb,
  mitigating_factors jsonb not null default '[]'::jsonb,
  requested_sentence numeric(8,2),
  attempted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.case_evidence (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid references public.criminal_investigations(id) on delete restrict,
  criminal_case_id uuid references public.criminal_cases(id) on delete restrict,
  parent_evidence_id uuid references public.case_evidence(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  evidence_type text not null,
  title text not null,
  description text,
  file_url text,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  collected_at timestamptz not null default now(),
  sealed_at timestamptz,
  evidence_hash text,
  status public.justice_evidence_status not null default 'draft',
  confidentiality_level text not null default 'restricted'
    check (confidentiality_level in ('public', 'restricted', 'confidential', 'secret')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (investigation_id is not null or criminal_case_id is not null),
  unique (parent_evidence_id, version)
);

create table if not exists public.evidence_custody_events (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.case_evidence(id) on delete restrict,
  event_type text not null
    check (event_type in ('created', 'accessed', 'transferred', 'sealed', 'presented', 'corrected')),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  transferred_to uuid references public.profiles(id) on delete set null,
  justification text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.judicial_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null
    check (request_type in (
      'arrest_warrant', 'search_warrant', 'rp_confidentiality_break',
      'preventive_detention', 'temporary_detention', 'provisional_release',
      'bail', 'evidence_production', 'prison_transfer'
    )),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  case_id uuid references public.criminal_cases(id) on delete restrict,
  investigation_id uuid references public.criminal_investigations(id) on delete restrict,
  target_profile_id uuid references public.profiles(id) on delete restrict,
  justification text not null,
  status public.justice_request_status not null default 'pending',
  decided_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  decided_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (case_id is not null or investigation_id is not null)
);

create index if not exists judicial_requests_urgent_queue_idx
  on public.judicial_requests(status, request_type, created_at);

create table if not exists public.warrants (
  id uuid primary key default gen_random_uuid(),
  warrant_number text not null unique,
  warrant_type text not null
    check (warrant_type in ('arrest', 'search', 'seizure', 'transfer')),
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  case_id uuid references public.criminal_cases(id) on delete restrict,
  investigation_id uuid references public.criminal_investigations(id) on delete restrict,
  request_id uuid unique references public.judicial_requests(id) on delete restrict,
  issued_by uuid not null references public.profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status public.justice_warrant_status not null default 'issued',
  executed_by uuid references public.profiles(id) on delete set null,
  executed_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create index if not exists warrants_active_target_idx
  on public.warrants(target_profile_id, expires_at)
  where status = 'issued';

create table if not exists public.arrests (
  id uuid primary key default gen_random_uuid(),
  arrest_number text not null unique,
  arrest_type text not null check (arrest_type in ('flagrante', 'warrant', 'preventive', 'temporary')),
  suspect_id uuid not null references public.profiles(id) on delete restrict,
  officer_id uuid not null references public.profiles(id) on delete restrict,
  warrant_id uuid references public.warrants(id) on delete restrict,
  investigation_id uuid references public.criminal_investigations(id) on delete restrict,
  case_id uuid references public.criminal_cases(id) on delete restrict,
  alleged_crime text not null,
  description text not null,
  location text not null,
  arrested_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'converted', 'bail', 'released', 'cancelled')),
  release_reason text,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (arrest_type = 'warrant' and warrant_id is not null)
    or arrest_type <> 'warrant'
  )
);

create table if not exists public.hearings (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  hearing_type text not null,
  scheduled_at timestamptz not null,
  rp_scheduled_at timestamptz,
  duration integer not null default 60 check (duration between 5 and 480),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'open', 'completed', 'cancelled', 'postponed')),
  meeting_location text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  minutes text,
  opened_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.hearing_participants (
  id uuid primary key default gen_random_uuid(),
  hearing_id uuid not null references public.hearings(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  participant_role text not null,
  summoned_at timestamptz,
  presence_status text not null default 'summoned'
    check (presence_status in ('summoned', 'confirmed', 'present', 'absent', 'excused')),
  statement text,
  created_at timestamptz not null default now(),
  unique (hearing_id, profile_id)
);

create table if not exists public.case_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  document_type text not null
    check (document_type in (
      'charge', 'defense', 'petition', 'expert_report', 'decision',
      'sentence', 'appeal', 'hearing_minutes', 'release_order'
    )),
  title text not null,
  body text,
  file_url text,
  version integer not null default 1 check (version > 0),
  parent_document_id uuid references public.case_documents(id) on delete restrict,
  author_id uuid not null references public.profiles(id) on delete restrict,
  visibility text not null default 'parties'
    check (visibility in ('public', 'parties', 'court', 'secret')),
  signature_hash text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (parent_document_id, version)
);

create table if not exists public.judicial_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  request_id uuid references public.judicial_requests(id) on delete restrict,
  decision_type text not null,
  judge_id uuid not null references public.profiles(id) on delete restrict,
  summary text not null,
  legal_reasoning text not null,
  result text not null,
  issued_at timestamptz not null default now(),
  is_final boolean not null default false
);

create table if not exists public.sentences (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  decision_id uuid not null unique references public.judicial_decisions(id) on delete restrict,
  defendant_id uuid not null references public.profiles(id) on delete restrict,
  judge_id uuid not null references public.profiles(id) on delete restrict,
  sentence_type text not null
    check (sentence_type in ('custodial', 'fine', 'community_service', 'mixed')),
  base_sentence_units numeric(8,2) not null check (base_sentence_units >= 0),
  final_sentence_units numeric(8,2) not null check (final_sentence_units >= 0),
  real_duration_seconds integer not null check (real_duration_seconds > 0),
  fine_amount numeric(14,2) not null default 0 check (fine_amount >= 0),
  prison_regime text not null
    check (prison_regime in ('open', 'semi_open', 'closed', 'maximum_security')),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'appealable'
    check (status in ('appealable', 'appealed', 'final', 'serving', 'served', 'cancelled')),
  provisional_time_credit_seconds integer not null default 0 check (provisional_time_credit_seconds >= 0),
  issued_at timestamptz not null default now(),
  unique (case_id, defendant_id)
);

alter table public.criminal_records
  add column if not exists case_id uuid references public.criminal_cases(id) on delete restrict,
  add column if not exists sentence_id uuid references public.sentences(id) on delete restrict,
  add column if not exists record_status text not null default 'legacy'
    check (record_status in ('legacy', 'conviction', 'expired', 'annulled')),
  add column if not exists effects_expire_at timestamptz;

create table if not exists public.prison_facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  security_level text not null
    check (security_level in ('low', 'medium', 'high', 'maximum')),
  capacity integer not null check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.prison_wings (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.prison_facilities(id) on delete restrict,
  name text not null,
  security_level text not null
    check (security_level in ('low', 'medium', 'high', 'maximum')),
  capacity integer not null check (capacity > 0),
  is_active boolean not null default true,
  unique (facility_id, name)
);

create table if not exists public.prison_cells (
  id uuid primary key default gen_random_uuid(),
  wing_id uuid not null references public.prison_wings(id) on delete restrict,
  code text not null,
  capacity integer not null default 2 check (capacity > 0),
  is_active boolean not null default true,
  unique (wing_id, code)
);

create table if not exists public.prison_terms (
  id uuid primary key default gen_random_uuid(),
  sentence_id uuid unique references public.sentences(id) on delete restrict,
  arrest_id uuid unique references public.arrests(id) on delete restrict,
  inmate_id uuid not null references public.profiles(id) on delete restrict,
  facility_id uuid not null references public.prison_facilities(id) on delete restrict,
  cell_id uuid references public.prison_cells(id) on delete restrict,
  admitted_at timestamptz not null default now(),
  expected_release_at timestamptz not null,
  actual_release_at timestamptz,
  custody_status public.justice_custody_status not null,
  security_level text not null
    check (security_level in ('low', 'medium', 'high', 'maximum')),
  original_duration_seconds integer not null check (original_duration_seconds > 0),
  sentence_credit_seconds integer not null default 0 check (sentence_credit_seconds >= 0),
  remaining_units numeric(8,2),
  behavior_points integer not null default 0,
  release_reason text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(sentence_id, arrest_id) = 1)
);

create unique index if not exists prison_terms_one_active_per_inmate
  on public.prison_terms(inmate_id)
  where custody_status in ('awaiting_intake', 'provisional', 'serving');

create table if not exists public.prison_events (
  id uuid primary key default gen_random_uuid(),
  prison_term_id uuid not null references public.prison_terms(id) on delete restrict,
  event_type text not null,
  title text not null,
  description text,
  behavior_points integer not null default 0,
  sentence_credit_seconds integer not null default 0,
  registered_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.prison_activities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  activity_type text not null
    check (activity_type in ('work', 'education', 'yard', 'health', 'legal', 'social')),
  duration_seconds integer not null check (duration_seconds between 30 and 86400),
  behavior_points integer not null default 0,
  sentence_credit_seconds integer not null default 0 check (sentence_credit_seconds >= 0),
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  icon text,
  is_active boolean not null default true
);

insert into public.prison_activities
  (code, name, description, activity_type, duration_seconds, behavior_points, sentence_credit_seconds, cooldown_seconds, icon)
values
  ('kitchen_shift', 'Turno na cozinha', 'Ajude a preparar as refeições da unidade.', 'work', 600, 8, 120, 1800, 'ChefHat'),
  ('library_course', 'Curso na biblioteca', 'Conclua uma atividade educacional de cidadania.', 'education', 900, 10, 180, 2700, 'BookOpen'),
  ('yard_time', 'Pátio', 'Participe do horário de convivência da ala.', 'yard', 300, 3, 0, 900, 'Sun'),
  ('legal_assistance', 'Atendimento jurídico', 'Envie uma solicitação ao advogado ou defensor.', 'legal', 60, 0, 0, 300, 'Scale'),
  ('infirmary', 'Enfermaria', 'Solicite atendimento na enfermaria da unidade.', 'health', 60, 0, 0, 600, 'HeartPulse')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  duration_seconds = excluded.duration_seconds,
  behavior_points = excluded.behavior_points,
  sentence_credit_seconds = excluded.sentence_credit_seconds,
  cooldown_seconds = excluded.cooldown_seconds,
  is_active = true;

create table if not exists public.prison_activity_runs (
  id uuid primary key default gen_random_uuid(),
  prison_term_id uuid not null references public.prison_terms(id) on delete restrict,
  activity_id uuid not null references public.prison_activities(id) on delete restrict,
  inmate_id uuid not null references public.profiles(id) on delete restrict,
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'cancelled')),
  result jsonb not null default '{}'::jsonb
);

create unique index if not exists prison_activity_one_running_per_inmate
  on public.prison_activity_runs(inmate_id)
  where status = 'in_progress';

create table if not exists public.prison_visits (
  id uuid primary key default gen_random_uuid(),
  prison_term_id uuid not null references public.prison_terms(id) on delete restrict,
  inmate_id uuid not null references public.profiles(id) on delete restrict,
  visitor_id uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  scheduled_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'completed', 'cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  unique (prison_term_id, visitor_id, requested_at)
);

create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.criminal_cases(id) on delete restrict,
  decision_id uuid not null references public.judicial_decisions(id) on delete restrict,
  filed_by uuid not null references public.profiles(id) on delete restrict,
  appeal_type text not null,
  arguments text not null,
  status text not null default 'filed'
    check (status in ('filed', 'under_review', 'granted', 'partially_granted', 'denied', 'cancelled')),
  reviewing_judge_id uuid references public.profiles(id) on delete set null,
  decision text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.justice_deadlines (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.criminal_cases(id) on delete restrict,
  investigation_id uuid references public.criminal_investigations(id) on delete restrict,
  deadline_type text not null,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  rp_due_at timestamptz not null,
  real_due_at timestamptz not null,
  status text not null default 'open'
    check (status in ('open', 'completed', 'expired', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (case_id is not null or investigation_id is not null)
);

create table if not exists public.justice_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_state jsonb,
  new_state jsonb,
  justification text not null,
  request_id uuid not null default gen_random_uuid(),
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists justice_audit_entity_idx
  on public.justice_audit_log(entity_type, entity_id, created_at desc);
create index if not exists justice_audit_actor_idx
  on public.justice_audit_log(actor_id, created_at desc);

create or replace function public.rp_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when s.is_paused and s.paused_rp_at is not null then s.paused_rp_at
    else s.rp_epoch_game_at
      + make_interval(secs =>
          extract(epoch from (clock_timestamp() - s.rp_epoch_real_at))
          * ((s.rp_days_per_year::numeric * 86400) / s.rp_year_real_seconds)
          * s.speed_multiplier
        )
  end
  from public.rp_time_settings s
  where s.id = true
$$;

create or replace function public.rp_duration_to_real_seconds(
  p_amount numeric,
  p_unit text
)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select greatest(
    1,
    round(
      (
        case lower(p_unit)
          when 'hour' then p_amount * 3600
          when 'day' then p_amount * 86400
          when 'week' then p_amount * 604800
          when 'month' then p_amount * ((s.rp_days_per_year::numeric / 12) * 86400)
          when 'year' then p_amount * (s.rp_days_per_year::numeric * 86400)
          else p_amount
        end
      ) / (
        ((s.rp_days_per_year::numeric * 86400) / s.rp_year_real_seconds)
        * s.speed_multiplier
      )
    )
  )::bigint
  from public.rp_time_settings s
  where s.id = true
$$;

create or replace function public.rp_date_to_real_date(p_rp_date timestamptz)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select s.rp_epoch_real_at
    + make_interval(secs =>
        extract(epoch from (p_rp_date - s.rp_epoch_game_at))
        / (
          ((s.rp_days_per_year::numeric * 86400) / s.rp_year_real_seconds)
          * s.speed_multiplier
        )
      )
  from public.rp_time_settings s
  where s.id = true
$$;

create or replace function public.calculate_sentence_duration(
  p_sentence_years numeric,
  p_modifier numeric default 1
)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_bracket public.penal_time_brackets%rowtype;
  v_ratio numeric;
  v_seconds numeric;
  v_global_multiplier numeric;
begin
  if p_sentence_years < 0 or p_modifier <= 0 then
    raise exception 'INVALID_SENTENCE_DURATION';
  end if;

  select * into v_bracket
  from public.penal_time_brackets b
  where b.is_active
    and p_sentence_years >= b.minimum_years
    and (b.maximum_years is null or p_sentence_years <= b.maximum_years)
  order by b.sort_order
  limit 1;

  if not found then
    raise exception 'PENAL_TIME_BRACKET_NOT_CONFIGURED';
  end if;

  if v_bracket.maximum_years is null then
    v_seconds := v_bracket.minimum_real_seconds
      + least(1, greatest(0, (p_sentence_years - v_bracket.minimum_years) / 20))
        * (v_bracket.maximum_real_seconds - v_bracket.minimum_real_seconds);
  else
    v_ratio := (p_sentence_years - v_bracket.minimum_years)
      / nullif(v_bracket.maximum_years - v_bracket.minimum_years, 0);
    v_seconds := v_bracket.minimum_real_seconds
      + greatest(0, least(1, v_ratio))
        * (v_bracket.maximum_real_seconds - v_bracket.minimum_real_seconds);
  end if;

  select penal_time_multiplier into v_global_multiplier
  from public.rp_time_settings where id = true;

  return greatest(60, round(v_seconds * p_modifier * v_global_multiplier))::integer;
end;
$$;

create or replace function public.set_rp_clock_state(
  p_action text,
  p_speed_multiplier numeric default null,
  p_justification text default null
)
returns public.rp_time_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.rp_time_settings%rowtype;
  v_new public.rp_time_settings%rowtype;
  v_rp_now timestamptz;
begin
  if not public.justice_has_role(array['Admin']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_justification, ''))) < 15 then raise exception 'JUSTIFICATION_TOO_SHORT'; end if;

  select * into v_old from public.rp_time_settings where id = true for update;
  v_rp_now := public.rp_now();

  if p_action = 'pause' then
    if v_old.is_paused then raise exception 'RP_CLOCK_ALREADY_PAUSED'; end if;
    update public.rp_time_settings
    set is_paused = true, paused_real_at = now(), paused_rp_at = v_rp_now,
        updated_by = (select auth.uid())
    where id = true returning * into v_new;
  elsif p_action = 'resume' then
    if not v_old.is_paused then raise exception 'RP_CLOCK_NOT_PAUSED'; end if;
    update public.rp_time_settings
    set is_paused = false, rp_epoch_real_at = now(),
        rp_epoch_game_at = coalesce(paused_rp_at, v_rp_now),
        paused_real_at = null, paused_rp_at = null,
        updated_by = (select auth.uid())
    where id = true returning * into v_new;
  elsif p_action = 'speed' then
    if p_speed_multiplier is null or p_speed_multiplier <= 0 or p_speed_multiplier > 20 then
      raise exception 'INVALID_RP_CLOCK_SPEED';
    end if;
    update public.rp_time_settings
    set rp_epoch_real_at = now(), rp_epoch_game_at = v_rp_now,
        speed_multiplier = p_speed_multiplier,
        paused_rp_at = case when is_paused then v_rp_now else null end,
        updated_by = (select auth.uid())
    where id = true returning * into v_new;
  else
    raise exception 'INVALID_RP_CLOCK_ACTION';
  end if;

  perform public.justice_write_audit(
    'rp_clock.' || p_action, 'rp_time_settings', null,
    to_jsonb(v_old), to_jsonb(v_new), p_justification
  );
  return v_new;
end;
$$;

create or replace function public.justice_has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and (
        lower(p.role) = any (
          select lower(unnest(p_roles))
        )
        or exists (
          select 1
          from unnest(coalesce(p.titles, array[]::text[])) t
          where lower(t) = any (
            select lower(unnest(p_roles))
          )
        )
      )
  )
$$;

create or replace function public.justice_can_access_investigation(p_investigation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.justice_has_role(array[
      'Admin', 'Policial', 'Police', 'Delegado', 'Promotor'
    ])
    or exists (
      select 1
      from public.investigation_parties ip
      where ip.investigation_id = p_investigation_id
        and ip.profile_id = (select auth.uid())
        and not ip.is_confidential
    )
    or exists (
      select 1
      from public.criminal_investigations ci
      join public.police_occurrences po on po.id = ci.occurrence_id
      where ci.id = p_investigation_id
        and po.reported_by = (select auth.uid())
        and not coalesce(po.anonymous, po.is_anonymous, false)
    )
    or exists (
      select 1
      from public.criminal_cases cc
      left join public.case_parties cp on cp.case_id = cc.id
      left join public.appeals a on a.case_id = cc.id
      where cc.investigation_id = p_investigation_id
        and (
          cc.prosecutor_id = (select auth.uid())
          or cc.judge_id = (select auth.uid())
          or cp.profile_id = (select auth.uid())
          or cp.lawyer_id = (select auth.uid())
          or a.reviewing_judge_id = (select auth.uid())
        )
    )
$$;

create or replace function public.justice_can_access_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.justice_has_role(array['Admin'])
    or exists (
      select 1 from public.case_parties cp
      where cp.case_id = p_case_id
        and (
          cp.profile_id = (select auth.uid())
          or cp.lawyer_id = (select auth.uid())
        )
    )
    or exists (
      select 1
      from public.criminal_cases cc
      join public.criminal_investigations ci on ci.id = cc.investigation_id
      where cc.id = p_case_id
        and (
          cc.prosecutor_id = (select auth.uid())
          or cc.judge_id = (select auth.uid())
          or ci.lead_officer_id = (select auth.uid())
          or ci.delegate_id = (select auth.uid())
        )
    )
    or exists (
      select 1
      from public.appeals a
      where a.case_id = p_case_id
        and a.reviewing_judge_id = (select auth.uid())
    )
    or (
      public.justice_has_role(array['Agente Penitenciário', 'Diretor Penitenciário'])
      and exists (
        select 1
        from public.sentences s
        join public.prison_terms pt on pt.sentence_id = s.id
        where s.case_id = p_case_id
          and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
      )
    )
$$;

create or replace function public.justice_shares_active_facility(p_facility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.prison_terms pt
    where pt.inmate_id = (select auth.uid())
      and pt.facility_id = p_facility_id
      and pt.custody_status in ('provisional', 'serving')
  )
$$;

create or replace function public.justice_next_number(p_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer;
  v_value bigint;
begin
  v_year := extract(year from public.rp_now())::integer;

  insert into public.justice_number_counters(number_type, rp_year, current_value)
  values (upper(p_type), v_year, 1)
  on conflict (number_type, rp_year)
  do update set current_value = public.justice_number_counters.current_value + 1
  returning current_value into v_value;

  return upper(p_type) || '-' || v_year || '-' || lpad(v_value::text, 6, '0');
end;
$$;

create or replace function public.justice_write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_previous_state jsonb,
  p_new_state jsonb,
  p_justification text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if nullif(trim(p_justification), '') is null then
    raise exception 'AUDIT_JUSTIFICATION_REQUIRED';
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = (select auth.uid());

  insert into public.justice_audit_log(
    actor_id, actor_role, action, entity_type, entity_id,
    previous_state, new_state, justification
  )
  values (
    (select auth.uid()), v_role, p_action, p_entity_type, p_entity_id,
    p_previous_state, p_new_state, p_justification
  );
end;
$$;

create or replace function public.justice_notify(
  p_user_id uuid,
  p_type text,
  p_content text,
  p_link text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications(user_id, sender_id, type, content, link, metadata)
  values (p_user_id, (select auth.uid()), p_type, p_content, p_link, p_metadata);
end;
$$;

create or replace function public.justice_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.justice_block_immutable_rows()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'JUSTICE_IMMUTABLE_RECORD';
end;
$$;

create or replace function public.justice_protect_sealed_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EVIDENCE_CANNOT_BE_DELETED';
  end if;
  if old.status = 'sealed' then
    raise exception 'SEALED_EVIDENCE_CANNOT_BE_CHANGED_CREATE_NEW_VERSION';
  end if;
  return new;
end;
$$;

create or replace function public.justice_protect_profile_authority()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'service_role', 'supabase_admin')
     or public.justice_has_role(array['Admin']) then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.titles is distinct from old.titles
     or new.manual_role_override is distinct from old.manual_role_override
     or new.role_assigned_at is distinct from old.role_assigned_at
     or new.role_assigned_by is distinct from old.role_assigned_by
     or new.is_imprisoned is distinct from old.is_imprisoned
     or new.release_date is distinct from old.release_date
     or new.criminal_status is distinct from old.criminal_status then
    raise exception 'PROFILE_AUTHORITY_FIELDS_REQUIRE_ADMIN_OR_SERVER_ACTION';
  end if;

  return new;
end;
$$;

drop trigger if exists justice_protect_profile_authority_trigger on public.profiles;
create trigger justice_protect_profile_authority_trigger
before update of
  role, titles, manual_role_override, role_assigned_at, role_assigned_by,
  is_imprisoned, release_date, criminal_status
on public.profiles
for each row execute function public.justice_protect_profile_authority();

drop trigger if exists justice_investigation_updated_at on public.criminal_investigations;
create trigger justice_investigation_updated_at
before update on public.criminal_investigations
for each row execute function public.justice_touch_updated_at();

drop trigger if exists justice_cases_updated_at on public.criminal_cases;
create trigger justice_cases_updated_at
before update on public.criminal_cases
for each row execute function public.justice_touch_updated_at();

drop trigger if exists justice_penal_code_updated_at on public.penal_code;
create trigger justice_penal_code_updated_at
before update on public.penal_code
for each row execute function public.justice_touch_updated_at();

drop trigger if exists justice_sealed_evidence_guard on public.case_evidence;
create trigger justice_sealed_evidence_guard
before update or delete on public.case_evidence
for each row execute function public.justice_protect_sealed_evidence();

drop trigger if exists justice_audit_immutable on public.justice_audit_log;
create trigger justice_audit_immutable
before update or delete on public.justice_audit_log
for each row execute function public.justice_block_immutable_rows();

create or replace function public.create_police_occurrence(
  p_title text,
  p_description text,
  p_occurrence_type text,
  p_location text default null,
  p_occurred_at timestamptz default now(),
  p_anonymous boolean default false,
  p_priority text default 'normal'
)
returns public.police_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.police_occurrences%rowtype;
begin
  if v_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if length(trim(coalesce(p_title, ''))) < 5 then raise exception 'TITLE_TOO_SHORT'; end if;
  if length(trim(coalesce(p_description, ''))) < 20 then raise exception 'DESCRIPTION_TOO_SHORT'; end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then raise exception 'INVALID_PRIORITY'; end if;

  insert into public.police_occurrences(
    protocol_number, title, description, details, occurrence_type, type,
    location, occurred_at, reported_by, user_id, anonymous, is_anonymous,
    priority, status, confidentiality_level
  )
  values (
    public.justice_next_number('BO'), trim(p_title), trim(p_description), trim(p_description),
    trim(p_occurrence_type), trim(p_occurrence_type), nullif(trim(p_location), ''),
    coalesce(p_occurred_at, now()),
    case when p_anonymous then null else v_user_id end,
    case when p_anonymous then null else v_user_id end,
    p_anonymous, p_anonymous, p_priority, 'Pendente', 'restricted'
  )
  returning * into v_row;

  perform public.justice_write_audit(
    'occurrence.created', 'police_occurrence', v_row.id, null,
    to_jsonb(v_row) - 'user_id' - 'reported_by',
    'Ocorrência registrada pelo cidadão'
  );

  perform public.justice_notify(
    v_user_id, 'justice_occurrence_created',
    'Ocorrência ' || v_row.protocol_number || ' recebida.',
    '/services/justice?view=citizen',
    jsonb_build_object('occurrence_id', v_row.id, 'protocol_number', v_row.protocol_number)
  );

  return v_row;
end;
$$;

create or replace function public.triage_police_occurrence(
  p_occurrence_id uuid,
  p_action text,
  p_notes text
)
returns public.police_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.police_occurrences%rowtype;
  v_new public.police_occurrences%rowtype;
  v_status text;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if nullif(trim(p_notes), '') is null then raise exception 'TRIAGE_JUSTIFICATION_REQUIRED'; end if;

  select * into v_old from public.police_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'OCCURRENCE_NOT_FOUND'; end if;

  v_status := case p_action
    when 'accept' then 'Em triagem'
    when 'more_info' then 'Aguardando informações'
    when 'duplicate' then 'Duplicada'
    when 'transfer' then 'Encaminhada'
    when 'archive' then 'Arquivada'
    when 'investigate' then 'Em investigação'
    else null
  end;
  if v_status is null then raise exception 'INVALID_TRIAGE_ACTION'; end if;

  update public.police_occurrences
  set status = v_status,
      triage_notes = trim(p_notes),
      assigned_officer_id = coalesce(assigned_officer_id, (select auth.uid()))
  where id = p_occurrence_id
  returning * into v_new;

  perform public.justice_write_audit(
    'occurrence.triaged', 'police_occurrence', p_occurrence_id,
    to_jsonb(v_old), to_jsonb(v_new), p_notes
  );

  if coalesce(v_new.reported_by, v_new.user_id) is not null then
    perform public.justice_notify(
      coalesce(v_new.reported_by, v_new.user_id),
      'justice_occurrence_updated',
      'A ocorrência ' || coalesce(v_new.protocol_number, v_new.id::text) || ' foi atualizada.',
      '/services/justice?view=citizen',
      jsonb_build_object('occurrence_id', v_new.id, 'status', v_new.status)
    );
  end if;

  return v_new;
end;
$$;

create or replace function public.open_criminal_investigation(
  p_occurrence_id uuid,
  p_summary text,
  p_lead_officer_id uuid default null
)
returns public.criminal_investigations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.criminal_investigations%rowtype;
  v_occurrence public.police_occurrences%rowtype;
  v_lead uuid := coalesce(p_lead_officer_id, (select auth.uid()));
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if p_lead_officer_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'ONLY_DELEGATE_CAN_ASSIGN_ANOTHER_OFFICER';
  end if;
  if length(trim(coalesce(p_summary, ''))) < 20 then raise exception 'SUMMARY_TOO_SHORT'; end if;

  select * into v_occurrence from public.police_occurrences
  where id = p_occurrence_id for update;
  if not found then raise exception 'OCCURRENCE_NOT_FOUND'; end if;

  if exists (
    select 1 from public.criminal_investigations
    where occurrence_id = p_occurrence_id and status <> 'archived'
  ) then raise exception 'INVESTIGATION_ALREADY_EXISTS'; end if;

  insert into public.criminal_investigations(
    occurrence_id, investigation_number, lead_officer_id, delegate_id,
    summary, status, created_by
  )
  values (
    p_occurrence_id, public.justice_next_number('INQ'), v_lead,
    case when public.justice_has_role(array['Delegado']) then (select auth.uid()) else null end,
    trim(p_summary), 'in_progress', (select auth.uid())
  )
  returning * into v_row;

  update public.police_occurrences
  set status = 'Em investigação',
      assigned_officer_id = v_lead
  where id = p_occurrence_id;

  insert into public.investigation_events(
    investigation_id, event_type, title, description, actor_id, rp_occurred_at
  )
  values (
    v_row.id, 'investigation_opened', 'Investigação aberta',
    trim(p_summary), (select auth.uid()), public.rp_now()
  );

  perform public.justice_write_audit(
    'investigation.opened', 'criminal_investigation', v_row.id,
    null, to_jsonb(v_row), trim(p_summary)
  );

  return v_row;
end;
$$;

create or replace function public.add_investigation_party(
  p_investigation_id uuid,
  p_profile_id uuid,
  p_party_type text,
  p_notes text default null,
  p_is_confidential boolean default false
)
returns public.investigation_parties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.investigation_parties%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado', 'Promotor']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if not exists (
    select 1 from public.criminal_investigations
    where id = p_investigation_id and status not in ('archived', 'closed')
  ) then raise exception 'INVESTIGATION_NOT_OPEN'; end if;

  insert into public.investigation_parties(
    investigation_id, profile_id, party_type, notes, is_confidential, added_by
  )
  values (
    p_investigation_id, p_profile_id, p_party_type, nullif(trim(p_notes), ''),
    p_is_confidential, (select auth.uid())
  )
  returning * into v_row;

  insert into public.investigation_events(
    investigation_id, event_type, title, description, actor_id, rp_occurred_at,
    metadata
  )
  values (
    p_investigation_id, 'party_added', 'Participante adicionado à investigação',
    p_party_type, (select auth.uid()), public.rp_now(),
    jsonb_build_object('profile_id', p_profile_id, 'party_type', p_party_type)
  );

  perform public.justice_write_audit(
    'investigation.party_added', 'criminal_investigation', p_investigation_id,
    null, to_jsonb(v_row), coalesce(p_notes, 'Participante adicionado')
  );

  if p_party_type in ('suspect', 'victim', 'witness') and not p_is_confidential then
    perform public.justice_notify(
      p_profile_id, 'justice_investigation_party',
      'Você foi incluído em uma investigação como ' || p_party_type || '.',
      '/services/justice?view=citizen',
      jsonb_build_object('investigation_id', p_investigation_id, 'party_type', p_party_type)
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.add_case_evidence(
  p_investigation_id uuid,
  p_case_id uuid,
  p_evidence_type text,
  p_title text,
  p_description text,
  p_file_url text default null,
  p_confidentiality_level text default 'restricted'
)
returns public.case_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.case_evidence%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_investigation_id is null and p_case_id is null then raise exception 'EVIDENCE_CONTEXT_REQUIRED'; end if;
  if p_investigation_id is not null
     and not public.justice_can_access_investigation(p_investigation_id) then
    raise exception 'INVESTIGATION_ACCESS_DENIED';
  end if;
  if p_case_id is not null and not public.justice_can_access_case(p_case_id) then
    raise exception 'CASE_ACCESS_DENIED';
  end if;
  if length(trim(coalesce(p_title, ''))) < 5 then raise exception 'EVIDENCE_TITLE_TOO_SHORT'; end if;
  if length(trim(coalesce(p_description, ''))) < 10 and p_file_url is null then
    raise exception 'EVIDENCE_CONTENT_REQUIRED';
  end if;

  insert into public.case_evidence(
    investigation_id, criminal_case_id, evidence_type, title, description,
    file_url, submitted_by, status, confidentiality_level
  )
  values (
    p_investigation_id, p_case_id, trim(p_evidence_type), trim(p_title),
    nullif(trim(p_description), ''), nullif(trim(p_file_url), ''),
    (select auth.uid()), 'collected', p_confidentiality_level
  )
  returning * into v_row;

  insert into public.evidence_custody_events(
    evidence_id, event_type, actor_id, justification
  )
  values (
    v_row.id, 'created', (select auth.uid()), 'Prova adicionada ao procedimento'
  );

  perform public.justice_write_audit(
    'evidence.created', 'case_evidence', v_row.id,
    null, to_jsonb(v_row), 'Prova adicionada ao procedimento'
  );
  return v_row;
end;
$$;

create or replace function public.seal_case_evidence(
  p_evidence_id uuid,
  p_justification text
)
returns public.case_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.case_evidence%rowtype;
  v_new public.case_evidence%rowtype;
  v_hash text;
begin
  if not public.justice_has_role(array[
    'Admin', 'Policial', 'Police', 'Delegado', 'Promotor', 'Juiz', 'Perito'
  ]) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if nullif(trim(p_justification), '') is null then raise exception 'JUSTIFICATION_REQUIRED'; end if;

  select * into v_old from public.case_evidence where id = p_evidence_id for update;
  if not found then raise exception 'EVIDENCE_NOT_FOUND'; end if;
  if v_old.status = 'sealed' then raise exception 'EVIDENCE_ALREADY_SEALED'; end if;

  v_hash := encode(
    extensions.digest(
      coalesce(v_old.file_url, '') || '|' || coalesce(v_old.description, '')
      || '|' || v_old.id::text || '|' || v_old.version::text,
      'sha256'
    ),
    'hex'
  );

  update public.case_evidence
  set status = 'sealed', sealed_at = now(), evidence_hash = v_hash
  where id = p_evidence_id
  returning * into v_new;

  insert into public.evidence_custody_events(
    evidence_id, event_type, actor_id, justification
  )
  values (p_evidence_id, 'sealed', (select auth.uid()), trim(p_justification));

  perform public.justice_write_audit(
    'evidence.sealed', 'case_evidence', p_evidence_id,
    to_jsonb(v_old), to_jsonb(v_new), p_justification
  );

  return v_new;
end;
$$;

create or replace function public.request_judicial_warrant(
  p_investigation_id uuid,
  p_target_profile_id uuid,
  p_warrant_type text,
  p_justification text,
  p_duration_rp_days numeric default 7
)
returns public.judicial_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.judicial_requests%rowtype;
  v_real_seconds bigint;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado', 'Promotor']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if p_warrant_type not in ('arrest_warrant', 'search_warrant') then
    raise exception 'INVALID_WARRANT_TYPE';
  end if;
  if length(trim(coalesce(p_justification, ''))) < 20 then
    raise exception 'JUSTIFICATION_TOO_SHORT';
  end if;
  if not exists (
    select 1 from public.criminal_investigations
    where id = p_investigation_id and status not in ('archived', 'closed')
  ) then raise exception 'INVESTIGATION_NOT_OPEN'; end if;

  v_real_seconds := public.rp_duration_to_real_seconds(p_duration_rp_days, 'day');

  insert into public.judicial_requests(
    request_type, requested_by, investigation_id, target_profile_id,
    justification, expires_at
  )
  values (
    p_warrant_type, (select auth.uid()), p_investigation_id, p_target_profile_id,
    trim(p_justification), now() + make_interval(secs => v_real_seconds)
  )
  returning * into v_row;

  perform public.justice_write_audit(
    'judicial_request.created', 'judicial_request', v_row.id,
    null, to_jsonb(v_row), p_justification
  );

  return v_row;
end;
$$;

create or replace function public.decide_judicial_request(
  p_request_id uuid,
  p_approved boolean,
  p_decision_reason text,
  p_warrant_duration_rp_days numeric default 7
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.judicial_requests%rowtype;
  v_request public.judicial_requests%rowtype;
  v_warrant public.warrants%rowtype;
  v_warrant_type text;
  v_seconds bigint;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if length(trim(coalesce(p_decision_reason, ''))) < 20 then
    raise exception 'DECISION_REASON_TOO_SHORT';
  end if;

  select * into v_old from public.judicial_requests
  where id = p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_old.status <> 'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;
  if v_old.requested_by = (select auth.uid()) then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;
  if v_old.expires_at is not null and v_old.expires_at <= now() then
    update public.judicial_requests set status = 'expired' where id = p_request_id;
    raise exception 'REQUEST_EXPIRED';
  end if;

  update public.judicial_requests
  set status = case when p_approved then 'approved' else 'denied' end,
      decided_by = (select auth.uid()),
      decision_reason = trim(p_decision_reason),
      decided_at = now()
  where id = p_request_id
  returning * into v_request;

  if p_approved and v_request.request_type in ('arrest_warrant', 'search_warrant') then
    v_warrant_type := case
      when v_request.request_type = 'arrest_warrant' then 'arrest'
      else 'search'
    end;
    v_seconds := public.rp_duration_to_real_seconds(p_warrant_duration_rp_days, 'day');

    insert into public.warrants(
      warrant_number, warrant_type, target_profile_id, case_id, investigation_id,
      request_id, issued_by, expires_at, status
    )
    values (
      public.justice_next_number('MAN'), v_warrant_type, v_request.target_profile_id,
      v_request.case_id, v_request.investigation_id, v_request.id,
      (select auth.uid()), now() + make_interval(secs => v_seconds), 'issued'
    )
    returning * into v_warrant;

    perform public.justice_notify(
      v_request.requested_by, 'justice_warrant_issued',
      'O pedido judicial foi aprovado e o mandado ' || v_warrant.warrant_number || ' foi emitido.',
      '/services/justice?view=authority',
      jsonb_build_object('request_id', v_request.id, 'warrant_id', v_warrant.id)
    );
  else
    perform public.justice_notify(
      v_request.requested_by,
      case when p_approved then 'justice_request_approved' else 'justice_request_denied' end,
      case when p_approved then 'Seu pedido judicial foi aprovado.' else 'Seu pedido judicial foi negado.' end,
      '/services/justice?view=authority',
      jsonb_build_object('request_id', v_request.id)
    );
  end if;

  perform public.justice_write_audit(
    'judicial_request.decided', 'judicial_request', v_request.id,
    to_jsonb(v_old), to_jsonb(v_request), p_decision_reason
  );

  return jsonb_build_object('request', to_jsonb(v_request), 'warrant', to_jsonb(v_warrant));
end;
$$;

create or replace function public.justice_assign_case_judge(p_case_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_judge_id uuid;
begin
  select p.id into v_judge_id
  from public.profiles p
  where (
      lower(p.role) = 'juiz'
      or exists (
        select 1 from unnest(coalesce(p.titles, array[]::text[])) t
        where lower(t) = 'juiz'
      )
    )
    and not exists (
      select 1 from public.case_parties cp
      where cp.case_id = p_case_id and (cp.profile_id = p.id or cp.lawyer_id = p.id)
    )
    and not exists (
      select 1
      from public.criminal_cases cc
      join public.criminal_investigations ci on ci.id = cc.investigation_id
      left join public.investigation_parties ip on ip.investigation_id = ci.id
      where cc.id = p_case_id
        and (
          ci.lead_officer_id = p.id or ci.delegate_id = p.id
          or cc.prosecutor_id = p.id or ip.profile_id = p.id
        )
    )
  order by (
    select count(*) from public.criminal_cases workload
    where workload.judge_id = p.id
      and workload.status not in ('acquitted', 'archived', 'served')
  ), p.id
  limit 1;

  if v_judge_id is null then raise exception 'NO_ELIGIBLE_JUDGE'; end if;

  update public.criminal_cases
  set judge_id = v_judge_id, status = 'judicial_review'
  where id = p_case_id;

  insert into public.case_parties(case_id, profile_id, party_type, representation_status)
  values (p_case_id, v_judge_id, 'judge', 'active')
  on conflict (case_id, profile_id, party_type) do nothing;

  perform public.justice_notify(
    v_judge_id, 'justice_case_assigned',
    'Um novo processo foi distribuído para sua análise.',
    '/services/justice?view=authority',
    jsonb_build_object('case_id', p_case_id)
  );

  return v_judge_id;
end;
$$;

create or replace function public.submit_investigation_to_prosecutor(
  p_investigation_id uuid,
  p_conclusion text,
  p_recommended_action text
)
returns public.criminal_investigations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if length(trim(coalesce(p_conclusion, ''))) < 40 then raise exception 'CONCLUSION_TOO_SHORT'; end if;
  if not exists (
    select 1 from public.investigation_parties
    where investigation_id = p_investigation_id and party_type = 'suspect'
  ) then raise exception 'INVESTIGATION_REQUIRES_SUSPECT'; end if;
  if not exists (
    select 1 from public.case_evidence
    where investigation_id = p_investigation_id and status = 'sealed'
  ) then raise exception 'INVESTIGATION_REQUIRES_SEALED_EVIDENCE'; end if;

  select * into v_old from public.criminal_investigations
  where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;

  update public.criminal_investigations
  set status = 'sent_to_prosecutor', conclusion = trim(p_conclusion),
      recommended_action = trim(p_recommended_action)
  where id = p_investigation_id
  returning * into v_new;

  perform public.justice_write_audit(
    'investigation.sent_to_prosecutor', 'criminal_investigation', p_investigation_id,
    to_jsonb(v_old), to_jsonb(v_new), p_conclusion
  );

  return v_new;
end;
$$;

create or replace function public.file_criminal_charges(
  p_investigation_id uuid,
  p_defendant_id uuid,
  p_title text,
  p_facts text,
  p_charges jsonb
)
returns public.criminal_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.criminal_cases%rowtype;
  v_charge jsonb;
  v_penal public.penal_code%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Promotor']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if length(trim(coalesce(p_facts, ''))) < 40 then raise exception 'FACTS_TOO_SHORT'; end if;
  if jsonb_typeof(p_charges) <> 'array' or jsonb_array_length(p_charges) = 0 then
    raise exception 'AT_LEAST_ONE_CHARGE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.criminal_investigations
    where id = p_investigation_id and status = 'sent_to_prosecutor'
  ) then raise exception 'INVESTIGATION_NOT_READY_FOR_CHARGES'; end if;
  if not exists (
    select 1 from public.investigation_parties
    where investigation_id = p_investigation_id
      and profile_id = p_defendant_id and party_type = 'suspect'
  ) then raise exception 'DEFENDANT_NOT_INVESTIGATION_SUSPECT'; end if;

  insert into public.criminal_cases(
    case_number, investigation_id, prosecutor_id, status, title, summary, filed_at
  )
  values (
    public.justice_next_number('GOV'), p_investigation_id, (select auth.uid()),
    'charge_filed', trim(p_title), trim(p_facts), now()
  )
  returning * into v_case;

  insert into public.case_parties(case_id, profile_id, party_type, representation_status)
  values
    (v_case.id, p_defendant_id, 'defendant', 'pending'),
    (v_case.id, (select auth.uid()), 'prosecutor', 'active');

  for v_charge in select * from jsonb_array_elements(p_charges)
  loop
    select * into v_penal from public.penal_code
    where id = (v_charge->>'penal_code_id')::uuid and is_active;
    if not found then raise exception 'INVALID_PENAL_CODE'; end if;

    insert into public.case_charges(
      case_id, defendant_id, penal_code_id, charge_description,
      aggravating_factors, mitigating_factors, requested_sentence, attempted
    )
    values (
      v_case.id, p_defendant_id, v_penal.id,
      coalesce(nullif(trim(v_charge->>'description'), ''), v_penal.name),
      coalesce(v_charge->'aggravating_factors', '[]'::jsonb),
      coalesce(v_charge->'mitigating_factors', '[]'::jsonb),
      nullif(v_charge->>'requested_sentence', '')::numeric,
      coalesce((v_charge->>'attempted')::boolean, false)
    );
  end loop;

  perform public.justice_assign_case_judge(v_case.id);
  select * into v_case from public.criminal_cases where id = v_case.id;

  perform public.justice_notify(
    p_defendant_id, 'justice_charges_filed',
    'Foi apresentada denúncia no processo ' || v_case.case_number || '.',
    '/services/justice?view=citizen',
    jsonb_build_object('case_id', v_case.id, 'case_number', v_case.case_number)
  );

  perform public.justice_write_audit(
    'case.charges_filed', 'criminal_case', v_case.id,
    null, to_jsonb(v_case), p_facts
  );

  return v_case;
end;
$$;

create or replace function public.schedule_case_hearing(
  p_case_id uuid,
  p_hearing_type text,
  p_rp_scheduled_at timestamptz,
  p_duration_minutes integer,
  p_meeting_location text
)
returns public.hearings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.criminal_cases%rowtype;
  v_hearing public.hearings%rowtype;
  v_real_at timestamptz;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  select * into v_case from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.judge_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_SCHEDULE';
  end if;

  v_real_at := public.rp_date_to_real_date(p_rp_scheduled_at);
  if v_real_at <= now() then raise exception 'HEARING_MUST_BE_IN_FUTURE'; end if;

  insert into public.hearings(
    case_id, hearing_type, scheduled_at, rp_scheduled_at, duration,
    meeting_location, created_by
  )
  values (
    p_case_id, p_hearing_type, v_real_at, p_rp_scheduled_at,
    p_duration_minutes, p_meeting_location, (select auth.uid())
  )
  returning * into v_hearing;

  update public.criminal_cases set status = 'hearing_scheduled' where id = p_case_id;

  insert into public.hearing_participants(
    hearing_id, profile_id, participant_role, summoned_at
  )
  select v_hearing.id, cp.profile_id, cp.party_type, now()
  from public.case_parties cp
  where cp.case_id = p_case_id
  on conflict (hearing_id, profile_id) do nothing;

  perform public.justice_write_audit(
    'hearing.scheduled', 'hearing', v_hearing.id,
    null, to_jsonb(v_hearing), 'Audiência marcada no calendário oficial do RP'
  );

  return v_hearing;
end;
$$;

create or replace function public.issue_criminal_sentence(
  p_case_id uuid,
  p_defendant_id uuid,
  p_result text,
  p_legal_reasoning text,
  p_final_sentence_units numeric,
  p_fine_amount numeric default 0,
  p_prison_regime text default 'closed',
  p_special_justification text default null
)
returns public.sentences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.criminal_cases%rowtype;
  v_decision public.judicial_decisions%rowtype;
  v_sentence public.sentences%rowtype;
  v_min numeric;
  v_max numeric;
  v_base numeric;
  v_seconds integer;
  v_outside_limits boolean;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_result not in ('conviction', 'partial_conviction') then raise exception 'INVALID_SENTENCE_RESULT'; end if;
  if length(trim(coalesce(p_legal_reasoning, ''))) < 80 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;

  select * into v_case from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.judge_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_SENTENCE';
  end if;
  if exists (
    select 1 from public.case_parties cp
    where cp.case_id = p_case_id and cp.profile_id = (select auth.uid())
      and cp.party_type <> 'judge'
  ) then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;

  select
    sum(pc.minimum_sentence_units),
    sum(pc.maximum_sentence_units),
    sum((pc.minimum_sentence_units + pc.maximum_sentence_units) / 2)
  into v_min, v_max, v_base
  from public.case_charges cc
  join public.penal_code pc on pc.id = cc.penal_code_id
  where cc.case_id = p_case_id and cc.defendant_id = p_defendant_id
    and cc.status in ('filed', 'admitted');

  if v_min is null then raise exception 'NO_ADMITTED_CHARGES'; end if;
  v_outside_limits := p_final_sentence_units < v_min or p_final_sentence_units > v_max;
  if v_outside_limits and length(trim(coalesce(p_special_justification, ''))) < 40 then
    raise exception 'OUTSIDE_LIMITS_REQUIRES_SPECIAL_JUSTIFICATION';
  end if;

  v_seconds := public.calculate_sentence_duration(p_final_sentence_units, 1);

  insert into public.judicial_decisions(
    case_id, decision_type, judge_id, summary, legal_reasoning, result, is_final
  )
  values (
    p_case_id, 'sentence', (select auth.uid()),
    'Sentença condenatória', trim(p_legal_reasoning), p_result, false
  )
  returning * into v_decision;

  insert into public.sentences(
    case_id, decision_id, defendant_id, judge_id, sentence_type,
    base_sentence_units, final_sentence_units, real_duration_seconds,
    fine_amount, prison_regime
  )
  values (
    p_case_id, v_decision.id, p_defendant_id, (select auth.uid()),
    case when p_fine_amount > 0 then 'mixed' else 'custodial' end,
    v_base, p_final_sentence_units, v_seconds,
    greatest(0, p_fine_amount), p_prison_regime
  )
  returning * into v_sentence;

  update public.case_charges
  set status = 'convicted'
  where case_id = p_case_id and defendant_id = p_defendant_id
    and status in ('filed', 'admitted');

  update public.criminal_cases
  set status = 'convicted', final_decision = 'Condenação ainda sujeita a recurso'
  where id = p_case_id;

  insert into public.justice_deadlines(
    case_id, deadline_type, responsible_profile_id, rp_due_at, real_due_at
  )
  values (
    p_case_id, 'appeal',
    p_defendant_id,
    public.rp_now() + interval '5 days',
    now() + make_interval(secs => public.rp_duration_to_real_seconds(5, 'day'))
  );

  perform public.justice_notify(
    p_defendant_id, 'justice_sentence_issued',
    'Sentença emitida no processo ' || v_case.case_number || '. O prazo de recurso está aberto.',
    '/services/justice?view=citizen',
    jsonb_build_object('case_id', p_case_id, 'sentence_id', v_sentence.id)
  );

  perform public.justice_write_audit(
    'sentence.issued', 'sentence', v_sentence.id,
    null, to_jsonb(v_sentence),
    coalesce(p_special_justification, p_legal_reasoning)
  );

  return v_sentence;
end;
$$;

create or replace function public.issue_acquittal(
  p_case_id uuid,
  p_defendant_id uuid,
  p_legal_reasoning text
)
returns public.judicial_decisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.criminal_cases%rowtype;
  v_decision public.judicial_decisions%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_legal_reasoning, ''))) < 80 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;
  select * into v_case from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.judge_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_DECIDE';
  end if;

  insert into public.judicial_decisions(
    case_id, decision_type, judge_id, summary, legal_reasoning, result, is_final
  )
  values (
    p_case_id, 'sentence', (select auth.uid()), 'Sentença absolutória',
    trim(p_legal_reasoning), 'acquittal', false
  )
  returning * into v_decision;

  update public.case_charges set status = 'acquitted'
  where case_id = p_case_id and defendant_id = p_defendant_id;
  update public.criminal_cases
  set status = 'acquitted', final_decision = 'Absolvição ainda sujeita a recurso'
  where id = p_case_id;

  perform public.justice_notify(
    p_defendant_id, 'justice_acquittal',
    'Você foi absolvido no processo ' || v_case.case_number || '.',
    '/services/justice?view=citizen',
    jsonb_build_object('case_id', p_case_id)
  );
  perform public.justice_write_audit(
    'case.acquitted', 'criminal_case', p_case_id,
    to_jsonb(v_case), jsonb_build_object('status', 'acquitted'), p_legal_reasoning
  );
  return v_decision;
end;
$$;

create or replace function public.file_case_appeal(
  p_case_id uuid,
  p_decision_id uuid,
  p_appeal_type text,
  p_arguments text
)
returns public.appeals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appeal public.appeals%rowtype;
  v_reviewing_judge uuid;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not public.justice_can_access_case(p_case_id) then raise exception 'CASE_ACCESS_DENIED'; end if;
  if length(trim(coalesce(p_arguments, ''))) < 40 then raise exception 'APPEAL_ARGUMENTS_TOO_SHORT'; end if;
  if not exists (
    select 1 from public.justice_deadlines
    where case_id = p_case_id and deadline_type = 'appeal'
      and status = 'open' and real_due_at > now()
  ) then raise exception 'APPEAL_DEADLINE_EXPIRED'; end if;

  select p.id into v_reviewing_judge
  from public.profiles p
  join public.criminal_cases cc on cc.id = p_case_id
  where lower(p.role) = 'juiz' and p.id is distinct from cc.judge_id
    and not exists (
      select 1 from public.case_parties cp
      where cp.case_id = p_case_id and (cp.profile_id = p.id or cp.lawyer_id = p.id)
    )
  order by (
    select count(*) from public.appeals a
    where a.reviewing_judge_id = p.id and a.status in ('filed', 'under_review')
  ), p.id
  limit 1;
  if v_reviewing_judge is null then raise exception 'NO_ELIGIBLE_APPEAL_JUDGE'; end if;

  insert into public.appeals(
    case_id, decision_id, filed_by, appeal_type, arguments, reviewing_judge_id
  )
  values (
    p_case_id, p_decision_id, (select auth.uid()),
    p_appeal_type, trim(p_arguments), v_reviewing_judge
  )
  returning * into v_appeal;

  update public.criminal_cases set status = 'appeal', court_level = 2 where id = p_case_id;
  update public.sentences set status = 'appealed' where case_id = p_case_id;
  update public.justice_deadlines
  set status = 'completed', completed_at = now()
  where case_id = p_case_id and deadline_type = 'appeal' and status = 'open';

  perform public.justice_notify(
    v_reviewing_judge, 'justice_appeal_assigned',
    'Um recurso foi distribuído para sua análise.',
    '/services/justice?view=authority',
    jsonb_build_object('appeal_id', v_appeal.id, 'case_id', p_case_id)
  );
  perform public.justice_write_audit(
    'appeal.filed', 'appeal', v_appeal.id,
    null, to_jsonb(v_appeal), p_arguments
  );
  return v_appeal;
end;
$$;

create or replace function public.justice_admit_sentence(p_sentence_id uuid)
returns public.prison_terms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sentence public.sentences%rowtype;
  v_facility public.prison_facilities%rowtype;
  v_cell_id uuid;
  v_security text;
  v_term public.prison_terms%rowtype;
  v_seconds integer;
begin
  select * into v_sentence from public.sentences where id = p_sentence_id for update;
  if not found then raise exception 'SENTENCE_NOT_FOUND'; end if;
  if v_sentence.status not in ('final', 'serving') then raise exception 'SENTENCE_NOT_FINAL'; end if;
  if exists (
    select 1 from public.prison_terms
    where inmate_id = v_sentence.defendant_id
      and custody_status in ('awaiting_intake', 'provisional', 'serving')
  ) then raise exception 'INMATE_ALREADY_IN_CUSTODY'; end if;

  v_security := case v_sentence.prison_regime
    when 'maximum_security' then 'maximum'
    when 'closed' then 'high'
    when 'semi_open' then 'medium'
    else 'low'
  end;
  v_seconds := greatest(
    60,
    v_sentence.real_duration_seconds - v_sentence.provisional_time_credit_seconds
  );

  select * into v_facility
  from public.prison_facilities f
  where f.is_active
    and f.security_level = v_security
    and (
      select count(*) from public.prison_terms pt
      where pt.facility_id = f.id
        and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
    ) < f.capacity
  order by f.name
  limit 1;

  if not found then
    select * into v_facility
    from public.prison_facilities f
    where f.is_active
      and (
        select count(*) from public.prison_terms pt
        where pt.facility_id = f.id
          and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
      ) < f.capacity
    order by case f.security_level
      when 'maximum' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc
    limit 1;
  end if;
  if not found then raise exception 'NO_PRISON_CAPACITY'; end if;

  select c.id into v_cell_id
  from public.prison_cells c
  join public.prison_wings w on w.id = c.wing_id
  where w.facility_id = v_facility.id and c.is_active and w.is_active
    and (
      select count(*) from public.prison_terms pt
      where pt.cell_id = c.id
        and pt.custody_status in ('awaiting_intake', 'provisional', 'serving')
    ) < c.capacity
  order by c.code
  limit 1;

  insert into public.prison_terms(
    sentence_id, inmate_id, facility_id, cell_id, expected_release_at,
    custody_status, security_level, original_duration_seconds, remaining_units
  )
  values (
    v_sentence.id, v_sentence.defendant_id, v_facility.id, v_cell_id,
    now() + make_interval(secs => v_seconds), 'serving', v_security,
    v_seconds, v_sentence.final_sentence_units
  )
  returning * into v_term;

  update public.sentences
  set status = 'serving', starts_at = now(),
      ends_at = v_term.expected_release_at
  where id = v_sentence.id;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, registered_by
  )
  values (
    v_term.id, 'admission', 'Entrada na unidade',
    'Custódia iniciada por sentença definitiva.', (select auth.uid())
  );

  perform public.justice_notify(
    v_sentence.defendant_id, 'justice_prison_admission',
    'Sua custódia foi iniciada. A área prisional está disponível.',
    '/services/prison',
    jsonb_build_object('prison_term_id', v_term.id)
  );
  return v_term;
end;
$$;

create or replace function public.execute_arrest_warrant(
  p_warrant_id uuid,
  p_location text,
  p_description text
)
returns public.arrests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_warrant public.warrants%rowtype;
  v_arrest public.arrests%rowtype;
  v_facility public.prison_facilities%rowtype;
  v_term_seconds bigint;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  select * into v_warrant from public.warrants where id = p_warrant_id for update;
  if not found then raise exception 'WARRANT_NOT_FOUND'; end if;
  if v_warrant.status <> 'issued' then raise exception 'WARRANT_NOT_ACTIVE'; end if;
  if v_warrant.expires_at <= now() then
    update public.warrants set status = 'expired' where id = p_warrant_id;
    raise exception 'WARRANT_EXPIRED';
  end if;

  insert into public.arrests(
    arrest_number, arrest_type, suspect_id, officer_id, warrant_id,
    investigation_id, case_id, alleged_crime, description, location,
    expires_at
  )
  values (
    public.justice_next_number('PRI'), 'warrant', v_warrant.target_profile_id,
    (select auth.uid()), v_warrant.id, v_warrant.investigation_id, v_warrant.case_id,
    'Prisão autorizada por mandado ' || v_warrant.warrant_number,
    trim(p_description), trim(p_location), v_warrant.expires_at
  )
  returning * into v_arrest;

  update public.warrants
  set status = 'executed', executed_by = (select auth.uid()), executed_at = now()
  where id = p_warrant_id;

  select * into v_facility from public.prison_facilities
  where is_active order by case security_level
    when 'high' then 1 when 'maximum' then 2 else 3 end
  limit 1;
  if not found then raise exception 'NO_PRISON_FACILITY'; end if;

  v_term_seconds := greatest(600, extract(epoch from (v_warrant.expires_at - now()))::bigint);
  insert into public.prison_terms(
    arrest_id, inmate_id, facility_id, expected_release_at,
    custody_status, security_level, original_duration_seconds
  )
  values (
    v_arrest.id, v_arrest.suspect_id, v_facility.id, v_warrant.expires_at,
    'provisional', v_facility.security_level, v_term_seconds
  );

  perform public.justice_notify(
    v_arrest.suspect_id, 'justice_arrest_executed',
    'Você foi preso em cumprimento ao mandado ' || v_warrant.warrant_number || '.',
    '/services/prison',
    jsonb_build_object('arrest_id', v_arrest.id, 'warrant_id', v_warrant.id)
  );
  perform public.justice_write_audit(
    'warrant.executed', 'warrant', v_warrant.id,
    to_jsonb(v_warrant), jsonb_build_object('status', 'executed', 'arrest_id', v_arrest.id),
    p_description
  );
  return v_arrest;
end;
$$;

create or replace function public.register_flagrante_arrest(
  p_suspect_id uuid,
  p_penal_code_id uuid,
  p_description text,
  p_evidence_description text,
  p_location text,
  p_witness_ids uuid[] default array[]::uuid[],
  p_duration_rp_days numeric default 2
)
returns public.arrests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_penal public.penal_code%rowtype;
  v_occurrence public.police_occurrences%rowtype;
  v_investigation public.criminal_investigations%rowtype;
  v_evidence public.case_evidence%rowtype;
  v_arrest public.arrests%rowtype;
  v_facility public.prison_facilities%rowtype;
  v_witness uuid;
  v_seconds bigint;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if p_suspect_id = (select auth.uid()) then raise exception 'OFFICER_CANNOT_ARREST_SELF'; end if;
  if length(trim(coalesce(p_description, ''))) < 40 then raise exception 'FLAGRANTE_DESCRIPTION_TOO_SHORT'; end if;
  if length(trim(coalesce(p_evidence_description, ''))) < 20 then raise exception 'INITIAL_EVIDENCE_REQUIRED'; end if;

  select * into v_penal from public.penal_code where id = p_penal_code_id and is_active;
  if not found then raise exception 'INVALID_PENAL_CODE'; end if;
  v_seconds := public.rp_duration_to_real_seconds(p_duration_rp_days, 'day');

  insert into public.police_occurrences(
    protocol_number, title, description, details, occurrence_type, type,
    location, occurred_at, reported_by, user_id, anonymous, is_anonymous,
    assigned_officer_id, priority, status, confidentiality_level
  )
  values (
    public.justice_next_number('BO'), 'Prisão em flagrante — ' || v_penal.name,
    trim(p_description), trim(p_description), 'flagrante', 'Prisão em flagrante',
    trim(p_location), now(), (select auth.uid()), (select auth.uid()), false, false,
    (select auth.uid()), 'urgent', 'Em investigação', 'confidential'
  )
  returning * into v_occurrence;

  insert into public.criminal_investigations(
    occurrence_id, investigation_number, lead_officer_id, delegate_id,
    summary, status, created_by
  )
  values (
    v_occurrence.id, public.justice_next_number('INQ'), (select auth.uid()),
    case when public.justice_has_role(array['Delegado']) then (select auth.uid()) else null end,
    'Investigação originada por prisão em flagrante: ' || trim(p_description),
    'in_progress', (select auth.uid())
  )
  returning * into v_investigation;

  insert into public.investigation_parties(
    investigation_id, profile_id, party_type, notes, added_by
  )
  values (
    v_investigation.id, p_suspect_id, 'suspect', v_penal.name, (select auth.uid())
  );

  foreach v_witness in array coalesce(p_witness_ids, array[]::uuid[])
  loop
    insert into public.investigation_parties(
      investigation_id, profile_id, party_type, notes, added_by
    )
    values (
      v_investigation.id, v_witness, 'witness',
      'Testemunha indicada no flagrante', (select auth.uid())
    )
    on conflict (investigation_id, profile_id, party_type) do nothing;
  end loop;

  insert into public.case_evidence(
    investigation_id, evidence_type, title, description, submitted_by,
    status, confidentiality_level
  )
  values (
    v_investigation.id, 'initial_flare_evidence', 'Prova inicial do flagrante',
    trim(p_evidence_description), (select auth.uid()), 'collected', 'confidential'
  )
  returning * into v_evidence;

  update public.case_evidence
  set status = 'sealed',
      sealed_at = now(),
      evidence_hash = encode(
        extensions.digest(
          coalesce(v_evidence.description, '') || '|' || v_evidence.id::text,
          'sha256'
        ),
        'hex'
      )
  where id = v_evidence.id
  returning * into v_evidence;

  insert into public.evidence_custody_events(
    evidence_id, event_type, actor_id, justification
  )
  values (
    v_evidence.id, 'sealed', (select auth.uid()),
    'Lacre automático da prova inicial do flagrante'
  );

  insert into public.arrests(
    arrest_number, arrest_type, suspect_id, officer_id, investigation_id,
    alleged_crime, description, location, expires_at
  )
  values (
    public.justice_next_number('PRI'), 'flagrante', p_suspect_id,
    (select auth.uid()), v_investigation.id, v_penal.name,
    trim(p_description), trim(p_location), now() + make_interval(secs => v_seconds)
  )
  returning * into v_arrest;

  select * into v_facility from public.prison_facilities
  where is_active
  order by abs(
    (case security_level when 'low' then 1 when 'medium' then 2 when 'high' then 3 else 4 end)
    - (case v_penal.security_level when 'low' then 1 when 'medium' then 2 when 'high' then 3 else 4 end)
  ), name
  limit 1;
  if not found then raise exception 'NO_PRISON_FACILITY'; end if;

  insert into public.prison_terms(
    arrest_id, inmate_id, facility_id, expected_release_at, custody_status,
    security_level, original_duration_seconds
  )
  values (
    v_arrest.id, p_suspect_id, v_facility.id,
    now() + make_interval(secs => v_seconds), 'provisional',
    v_penal.security_level, v_seconds
  );

  perform public.justice_notify(
    p_suspect_id, 'justice_flare_arrest',
    'Você foi preso em flagrante por ' || v_penal.name || '. A custódia possui prazo automático.',
    '/services/prison',
    jsonb_build_object('arrest_id', v_arrest.id, 'investigation_id', v_investigation.id)
  );
  perform public.justice_write_audit(
    'arrest.flare_registered', 'arrest', v_arrest.id,
    null, to_jsonb(v_arrest), p_description
  );
  return v_arrest;
end;
$$;

-- Nome de compatibilidade com a primeira especificação do projeto.
create or replace function public.register_flare_arrest(
  p_suspect_id uuid,
  p_penal_code_id uuid,
  p_description text,
  p_evidence_description text,
  p_location text,
  p_witness_ids uuid[] default array[]::uuid[],
  p_duration_rp_days numeric default 2
)
returns public.arrests
language sql
security definer
set search_path = ''
as $$
  select public.register_flagrante_arrest(
    p_suspect_id, p_penal_code_id, p_description, p_evidence_description,
    p_location, p_witness_ids, p_duration_rp_days
  )
$$;

create or replace function public.start_prison_activity(p_activity_id uuid)
returns public.prison_activity_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.prison_terms%rowtype;
  v_activity public.prison_activities%rowtype;
  v_run public.prison_activity_runs%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;

  select * into v_term from public.prison_terms
  where inmate_id = (select auth.uid())
    and custody_status in ('provisional', 'serving')
  order by admitted_at desc limit 1;
  if not found then raise exception 'ACTIVE_CUSTODY_NOT_FOUND'; end if;

  select * into v_activity from public.prison_activities
  where id = p_activity_id and is_active;
  if not found then raise exception 'ACTIVITY_NOT_AVAILABLE'; end if;
  if exists (
    select 1 from public.prison_activity_runs
    where inmate_id = (select auth.uid()) and status = 'in_progress'
  ) then raise exception 'ANOTHER_ACTIVITY_IS_RUNNING'; end if;
  if exists (
    select 1 from public.prison_activity_runs r
    where r.inmate_id = (select auth.uid())
      and r.activity_id = p_activity_id
      and r.started_at > now() - make_interval(secs => v_activity.cooldown_seconds)
  ) then raise exception 'ACTIVITY_COOLDOWN_ACTIVE'; end if;

  insert into public.prison_activity_runs(
    prison_term_id, activity_id, inmate_id, completes_at
  )
  values (
    v_term.id, v_activity.id, (select auth.uid()),
    now() + make_interval(secs => v_activity.duration_seconds)
  )
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function public.complete_prison_activity(p_run_id uuid)
returns public.prison_activity_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.prison_activity_runs%rowtype;
  v_activity public.prison_activities%rowtype;
  v_term public.prison_terms%rowtype;
  v_credit integer;
  v_max_credit integer;
begin
  select * into v_run from public.prison_activity_runs
  where id = p_run_id and inmate_id = (select auth.uid()) for update;
  if not found then raise exception 'ACTIVITY_RUN_NOT_FOUND'; end if;
  if v_run.status <> 'in_progress' then raise exception 'ACTIVITY_ALREADY_FINISHED'; end if;
  if v_run.completes_at > now() then raise exception 'ACTIVITY_NOT_FINISHED_YET'; end if;

  select * into v_activity from public.prison_activities where id = v_run.activity_id;
  select * into v_term from public.prison_terms where id = v_run.prison_term_id for update;

  v_max_credit := floor(v_term.original_duration_seconds * 0.10)::integer;
  v_credit := least(
    v_activity.sentence_credit_seconds,
    greatest(0, v_max_credit - v_term.sentence_credit_seconds)
  );

  update public.prison_activity_runs
  set status = 'completed', completed_at = now(),
      result = jsonb_build_object(
        'behavior_points', v_activity.behavior_points,
        'sentence_credit_seconds', v_credit
      )
  where id = p_run_id
  returning * into v_run;

  update public.prison_terms
  set behavior_points = behavior_points + v_activity.behavior_points,
      sentence_credit_seconds = sentence_credit_seconds + v_credit,
      expected_release_at = greatest(now(), expected_release_at - make_interval(secs => v_credit))
  where id = v_term.id;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, behavior_points,
    sentence_credit_seconds, registered_by, approved_by
  )
  values (
    v_term.id, v_activity.activity_type, v_activity.name,
    'Atividade concluída pelo detento.', v_activity.behavior_points,
    v_credit, (select auth.uid()), (select auth.uid())
  );

  perform public.justice_write_audit(
    'prison.activity_completed', 'prison_term', v_term.id,
    to_jsonb(v_term),
    jsonb_build_object('activity_run_id', v_run.id, 'sentence_credit_seconds', v_credit),
    'Atividade prisional concluída e benefício calculado automaticamente'
  );
  return v_run;
end;
$$;

create or replace function public.register_prison_event(
  p_prison_term_id uuid,
  p_event_type text,
  p_title text,
  p_description text,
  p_behavior_points integer default 0
)
returns public.prison_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.prison_events%rowtype;
begin
  if not public.justice_has_role(array[
    'Admin', 'Agente Penitenciário', 'Diretor Penitenciário'
  ]) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_description, ''))) < 15 then raise exception 'EVENT_DESCRIPTION_TOO_SHORT'; end if;
  if not exists (
    select 1 from public.prison_terms
    where id = p_prison_term_id
      and custody_status in ('awaiting_intake', 'provisional', 'serving')
  ) then raise exception 'ACTIVE_CUSTODY_NOT_FOUND'; end if;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, behavior_points,
    sentence_credit_seconds, registered_by
  )
  values (
    p_prison_term_id, trim(p_event_type), trim(p_title), trim(p_description),
    greatest(-50, least(50, p_behavior_points)), 0, (select auth.uid())
  )
  returning * into v_event;

  update public.prison_terms
  set behavior_points = behavior_points + v_event.behavior_points
  where id = p_prison_term_id;

  perform public.justice_write_audit(
    'prison.event_registered', 'prison_term', p_prison_term_id,
    null, to_jsonb(v_event), p_description
  );
  return v_event;
end;
$$;

create or replace function public.grant_sentence_credit(
  p_prison_term_id uuid,
  p_credit_seconds integer,
  p_justification text
)
returns public.prison_terms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.prison_terms%rowtype;
  v_new public.prison_terms%rowtype;
  v_max_credit integer;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_credit_seconds <= 0 then raise exception 'INVALID_SENTENCE_CREDIT'; end if;
  if length(trim(coalesce(p_justification, ''))) < 30 then raise exception 'JUSTIFICATION_TOO_SHORT'; end if;

  select * into v_old from public.prison_terms where id = p_prison_term_id for update;
  if not found then raise exception 'PRISON_TERM_NOT_FOUND'; end if;
  if v_old.custody_status <> 'serving' then raise exception 'SENTENCE_NOT_SERVING'; end if;
  v_max_credit := floor(v_old.original_duration_seconds * 0.25)::integer;
  if v_old.sentence_credit_seconds + p_credit_seconds > v_max_credit then
    raise exception 'SENTENCE_CREDIT_LIMIT_EXCEEDED';
  end if;

  update public.prison_terms
  set sentence_credit_seconds = sentence_credit_seconds + p_credit_seconds,
      expected_release_at = greatest(now(), expected_release_at - make_interval(secs => p_credit_seconds))
  where id = p_prison_term_id
  returning * into v_new;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, sentence_credit_seconds,
    registered_by, approved_by
  )
  values (
    p_prison_term_id, 'sentence_credit', 'Redução judicial de pena',
    trim(p_justification), p_credit_seconds, (select auth.uid()), (select auth.uid())
  );
  perform public.justice_write_audit(
    'sentence.credit_granted', 'prison_term', p_prison_term_id,
    to_jsonb(v_old), to_jsonb(v_new), p_justification
  );
  return v_new;
end;
$$;

create or replace function public.request_prison_visit(
  p_prison_term_id uuid
)
returns public.prison_visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term public.prison_terms%rowtype;
  v_visit public.prison_visits%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  select * into v_term from public.prison_terms
  where id = p_prison_term_id
    and custody_status in ('provisional', 'serving');
  if not found then raise exception 'ACTIVE_CUSTODY_NOT_FOUND'; end if;
  if v_term.inmate_id = (select auth.uid()) then raise exception 'INMATE_CANNOT_VISIT_SELF'; end if;
  if exists (
    select 1 from public.prison_visits
    where prison_term_id = p_prison_term_id
      and visitor_id = (select auth.uid())
      and status in ('pending', 'approved')
  ) then raise exception 'VISIT_REQUEST_ALREADY_EXISTS'; end if;

  insert into public.prison_visits(
    prison_term_id, inmate_id, visitor_id
  )
  values (p_prison_term_id, v_term.inmate_id, (select auth.uid()))
  returning * into v_visit;

  perform public.justice_notify(
    v_term.inmate_id, 'justice_prison_visit_requested',
    'Uma nova visita foi solicitada.',
    '/services/prison',
    jsonb_build_object('visit_id', v_visit.id)
  );
  return v_visit;
end;
$$;

create or replace function public.release_prisoner(
  p_prison_term_id uuid,
  p_release_reason text,
  p_judicial_decision_id uuid default null
)
returns public.prison_terms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.prison_terms%rowtype;
  v_new public.prison_terms%rowtype;
begin
  if not public.justice_has_role(array[
    'Admin', 'Juiz', 'Agente Penitenciário', 'Diretor Penitenciário'
  ]) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_release_reason, ''))) < 15 then raise exception 'RELEASE_REASON_TOO_SHORT'; end if;

  select * into v_old from public.prison_terms where id = p_prison_term_id for update;
  if not found then raise exception 'PRISON_TERM_NOT_FOUND'; end if;
  if v_old.custody_status not in ('provisional', 'serving', 'awaiting_intake') then
    raise exception 'CUSTODY_NOT_ACTIVE';
  end if;
  if v_old.expected_release_at > now()
     and p_judicial_decision_id is null
     and not public.justice_has_role(array['Admin', 'Juiz']) then
    raise exception 'EARLY_RELEASE_REQUIRES_JUDICIAL_ORDER';
  end if;
  if p_judicial_decision_id is not null and not exists (
    select 1 from public.judicial_decisions
    where id = p_judicial_decision_id
      and result in ('release', 'acquittal', 'appeal_granted', 'bail')
  ) then raise exception 'INVALID_RELEASE_ORDER'; end if;

  update public.prison_terms
  set custody_status = 'released', actual_release_at = now(),
      release_reason = trim(p_release_reason)
  where id = p_prison_term_id
  returning * into v_new;

  if v_new.sentence_id is not null then
    update public.sentences set status = 'served', ends_at = now()
    where id = v_new.sentence_id;
  end if;
  if v_new.arrest_id is not null then
    update public.arrests set status = 'released', released_at = now(),
      release_reason = trim(p_release_reason)
    where id = v_new.arrest_id;
  end if;

  insert into public.prison_events(
    prison_term_id, event_type, title, description, registered_by, approved_by
  )
  values (
    p_prison_term_id, 'release', 'Soltura',
    trim(p_release_reason), (select auth.uid()), (select auth.uid())
  );

  perform public.justice_notify(
    v_new.inmate_id, 'justice_release_order',
    'Seu alvará de soltura foi cumprido.',
    '/services/justice?view=citizen',
    jsonb_build_object('prison_term_id', v_new.id)
  );
  perform public.justice_write_audit(
    'prison.released', 'prison_term', v_new.id,
    to_jsonb(v_old), to_jsonb(v_new), p_release_reason
  );
  return v_new;
end;
$$;

create or replace function public.close_completed_sentences()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deadline record;
  v_sentence public.sentences%rowtype;
  v_term record;
  v_finalized integer := 0;
  v_released integer := 0;
  v_expired_warrants integer := 0;
begin
  update public.warrants
  set status = 'expired'
  where status = 'issued' and expires_at <= now();
  get diagnostics v_expired_warrants = row_count;

  for v_deadline in
    select * from public.justice_deadlines
    where status = 'open' and real_due_at <= now()
    order by real_due_at
    for update skip locked
  loop
    if v_deadline.deadline_type = 'appeal'
       and not exists (
         select 1 from public.appeals
         where case_id = v_deadline.case_id
           and status in ('filed', 'under_review')
       ) then
      update public.justice_deadlines
      set status = 'expired' where id = v_deadline.id;
      update public.criminal_cases
      set status = 'final' where id = v_deadline.case_id;
      update public.judicial_decisions
      set is_final = true where case_id = v_deadline.case_id and decision_type = 'sentence';

      for v_sentence in
        update public.sentences
        set status = 'final'
        where case_id = v_deadline.case_id and status = 'appealable'
        returning *
      loop
        insert into public.criminal_records(
          user_id, crime, sentence_details, sentence_start_date, sentence_end_date,
          is_active, judge_id, case_id, sentence_id, record_status
        )
        select
          v_sentence.defendant_id,
          string_agg(pc.name, ', ' order by pc.code),
          'Condenação no processo ' || cc.case_number || ' a '
            || v_sentence.final_sentence_units || ' ano(s) RP.',
          now(), now() + make_interval(secs => v_sentence.real_duration_seconds),
          true, v_sentence.judge_id, cc.id, v_sentence.id, 'conviction'
        from public.criminal_cases cc
        join public.case_charges ch on ch.case_id = cc.id
          and ch.defendant_id = v_sentence.defendant_id and ch.status = 'convicted'
        join public.penal_code pc on pc.id = ch.penal_code_id
        where cc.id = v_sentence.case_id
        group by cc.id, cc.case_number
        on conflict do nothing;

        perform public.justice_admit_sentence(v_sentence.id);
        v_finalized := v_finalized + 1;
      end loop;
    end if;
  end loop;

  for v_term in
    select * from public.prison_terms
    where custody_status in ('provisional', 'serving')
      and expected_release_at <= now()
    order by expected_release_at
    for update skip locked
  loop
    update public.prison_terms
    set custody_status = 'released', actual_release_at = now(),
        release_reason = 'Prazo de custódia integralmente cumprido'
    where id = v_term.id;

    if v_term.sentence_id is not null then
      update public.sentences set status = 'served', ends_at = now()
      where id = v_term.sentence_id;
    end if;
    if v_term.arrest_id is not null then
      update public.arrests
      set status = 'released', released_at = now(),
          release_reason = 'Prazo de custódia integralmente cumprido'
      where id = v_term.arrest_id;
    end if;

    insert into public.prison_events(
      prison_term_id, event_type, title, description
    )
    values (
      v_term.id, 'release', 'Soltura automática',
      'Prazo de custódia integralmente cumprido'
    );

    perform public.justice_notify(
      v_term.inmate_id, 'justice_release_order',
      'Seu prazo de custódia terminou e a soltura foi executada automaticamente.',
      '/services/justice?view=citizen',
      jsonb_build_object('prison_term_id', v_term.id)
    );
    perform public.justice_write_audit(
      'prison.auto_released', 'prison_term', v_term.id,
      to_jsonb(v_term), jsonb_build_object('custody_status', 'released'),
      'Prazo de custódia integralmente cumprido'
    );
    v_released := v_released + 1;
  end loop;

  return jsonb_build_object(
    'finalized_sentences', v_finalized,
    'released_prisoners', v_released,
    'expired_warrants', v_expired_warrants
  );
end;
$$;

create or replace function public.check_and_update_prisoner_status()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.close_completed_sentences();
end;
$$;

create or replace function public.sync_legacy_prison_profile_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active public.prison_terms%rowtype;
begin
  select * into v_active
  from public.prison_terms
  where inmate_id = new.inmate_id
    and custody_status in ('awaiting_intake', 'provisional', 'serving')
  order by admitted_at desc limit 1;

  update public.profiles
  set
    is_imprisoned = found,
    release_date = case when found then v_active.expected_release_at else null end,
    criminal_status = case
      when found and v_active.custody_status = 'provisional' then 'Preso Provisório'
      when found then 'Condenado'
      when exists (
        select 1 from public.criminal_records cr
        where cr.user_id = new.inmate_id
          and cr.record_status = 'conviction'
      ) then 'Cidadão com antecedentes'
      else 'Cidadão de Bem'
    end
  where id = new.inmate_id;
  return new;
end;
$$;

drop trigger if exists sync_legacy_prison_profile_state_trigger on public.prison_terms;
create trigger sync_legacy_prison_profile_state_trigger
after insert or update of custody_status, expected_release_at on public.prison_terms
for each row execute function public.sync_legacy_prison_profile_state();

insert into public.prison_facilities(name, description, security_level, capacity)
values
  ('Centro de Custódia Federal', 'Unidade de custódia provisória e segurança alta.', 'high', 120),
  ('Unidade de Ressocialização', 'Unidade para regimes aberto e semiaberto.', 'medium', 160),
  ('Complexo de Segurança Máxima', 'Unidade para custodiados de risco máximo.', 'maximum', 60)
on conflict (name) do update set is_active = true;

insert into public.prison_wings(facility_id, name, security_level, capacity)
select f.id, 'Ala A', f.security_level, f.capacity
from public.prison_facilities f
on conflict (facility_id, name) do update set is_active = true;

insert into public.prison_cells(wing_id, code, capacity)
select w.id, 'CEL-' || lpad(series::text, 3, '0'), 4
from public.prison_wings w
cross join generate_series(1, 20) series
on conflict (wing_id, code) do update set is_active = true;

insert into public.penal_code(
  code, name, description, category, severity,
  minimum_sentence_units, maximum_sentence_units, base_fine,
  bail_allowed, attempt_allowed, requires_victim, suggested_regime,
  prescription_rp_days, security_level
)
values
  ('PES-001', 'Agressão', 'Ofender a integridade física de outra pessoa.', 'Crimes contra a pessoa', 'medium', 1, 3, 500, true, true, true, 'semi_open', 365, 'medium'),
  ('PES-002', 'Homicídio', 'Causar intencionalmente a morte de outra pessoa no RP.', 'Crimes contra a pessoa', 'heinous', 8, 20, 5000, false, true, true, 'maximum_security', 3650, 'maximum'),
  ('PAT-001', 'Furto', 'Subtrair bem alheio sem violência.', 'Crimes contra o patrimônio', 'light', 0.5, 2, 350, true, true, true, 'open', 365, 'low'),
  ('PAT-002', 'Roubo', 'Subtrair bem alheio mediante violência ou ameaça.', 'Crimes contra o patrimônio', 'serious', 3, 8, 1500, true, true, true, 'closed', 730, 'high'),
  ('ADM-001', 'Corrupção', 'Solicitar, receber ou oferecer vantagem indevida ligada à função pública.', 'Crimes contra a administração pública', 'serious', 4, 12, 10000, false, true, false, 'closed', 1825, 'high'),
  ('ELE-001', 'Fraude eleitoral', 'Manipular indevidamente votação ou processo eleitoral do RP.', 'Crimes eleitorais', 'serious', 2, 6, 5000, true, true, false, 'closed', 730, 'medium'),
  ('ECO-001', 'Lavagem de dinheiro', 'Ocultar a origem de recursos obtidos em atividades ilícitas do RP.', 'Crimes econômicos', 'serious', 3, 10, 15000, false, true, false, 'closed', 1825, 'high'),
  ('SEG-001', 'Atentado contra a segurança nacional', 'Praticar ato grave contra as instituições ou segurança da nação no RP.', 'Crimes contra a segurança nacional do RP', 'heinous', 10, 25, 25000, false, true, false, 'maximum_security', 3650, 'maximum')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  severity = excluded.severity,
  minimum_sentence_units = excluded.minimum_sentence_units,
  maximum_sentence_units = excluded.maximum_sentence_units,
  base_fine = excluded.base_fine,
  bail_allowed = excluded.bail_allowed,
  attempt_allowed = excluded.attempt_allowed,
  suggested_regime = excluded.suggested_regime,
  security_level = excluded.security_level,
  is_active = true;

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'govrp-justice-due-events'
  ) then
    perform cron.schedule(
      'govrp-justice-due-events',
      '* * * * *',
      'select public.close_completed_sentences();'
    );
  end if;
end;
$$;

-- RLS: leitura contextual; toda escrita sensível ocorre pelas RPCs acima.
alter table public.rp_time_settings enable row level security;
alter table public.penal_time_brackets enable row level security;
alter table public.justice_number_counters enable row level security;
alter table public.criminal_investigations enable row level security;
alter table public.investigation_parties enable row level security;
alter table public.investigation_events enable row level security;
alter table public.criminal_cases enable row level security;
alter table public.case_parties enable row level security;
alter table public.penal_code enable row level security;
alter table public.case_charges enable row level security;
alter table public.case_evidence enable row level security;
alter table public.evidence_custody_events enable row level security;
alter table public.judicial_requests enable row level security;
alter table public.warrants enable row level security;
alter table public.arrests enable row level security;
alter table public.hearings enable row level security;
alter table public.hearing_participants enable row level security;
alter table public.case_documents enable row level security;
alter table public.judicial_decisions enable row level security;
alter table public.sentences enable row level security;
alter table public.prison_facilities enable row level security;
alter table public.prison_wings enable row level security;
alter table public.prison_cells enable row level security;
alter table public.prison_terms enable row level security;
alter table public.prison_events enable row level security;
alter table public.prison_activities enable row level security;
alter table public.prison_activity_runs enable row level security;
alter table public.prison_visits enable row level security;
alter table public.appeals enable row level security;
alter table public.justice_deadlines enable row level security;
alter table public.justice_audit_log enable row level security;

create policy "Authenticated users read RP clock"
on public.rp_time_settings for select to authenticated using (true);
create policy "Authenticated users read penal time brackets"
on public.penal_time_brackets for select to authenticated using (true);
create policy "Authenticated users read active penal code"
on public.penal_code for select to authenticated using (is_active or public.justice_has_role(array['Admin', 'Juiz', 'Promotor']));

drop policy if exists "Justice authorities read occurrences" on public.police_occurrences;
create policy "Justice authorities read occurrences"
on public.police_occurrences for select to authenticated
using (
  public.justice_has_role(array[
    'Admin', 'Policial', 'Police', 'Delegado', 'Promotor', 'Juiz'
  ])
);

drop policy if exists "Public can view criminal records" on public.criminal_records;
drop policy if exists "Citizens and authorities read criminal records" on public.criminal_records;
create policy "Citizens and authorities read criminal records"
on public.criminal_records for select to authenticated
using (
  user_id = (select auth.uid())
  or public.justice_has_role(array[
    'Admin', 'Policial', 'Police', 'Delegado', 'Promotor', 'Juiz',
    'Advogado', 'Defensor Público', 'Agente Penitenciário', 'Diretor Penitenciário'
  ])
);

create policy "Contextual investigation access"
on public.criminal_investigations for select to authenticated
using (public.justice_can_access_investigation(id));
create policy "Contextual investigation parties access"
on public.investigation_parties for select to authenticated
using (public.justice_can_access_investigation(investigation_id));
create policy "Contextual investigation events access"
on public.investigation_events for select to authenticated
using (public.justice_can_access_investigation(investigation_id));

create policy "Contextual case access"
on public.criminal_cases for select to authenticated
using (public.justice_can_access_case(id));
create policy "Contextual case parties access"
on public.case_parties for select to authenticated
using (public.justice_can_access_case(case_id));
create policy "Contextual charges access"
on public.case_charges for select to authenticated
using (public.justice_can_access_case(case_id));
create policy "Contextual case evidence access"
on public.case_evidence for select to authenticated
using (
  (criminal_case_id is not null and public.justice_can_access_case(criminal_case_id))
  or (investigation_id is not null and public.justice_can_access_investigation(investigation_id))
);
create policy "Contextual custody evidence events access"
on public.evidence_custody_events for select to authenticated
using (
  exists (
    select 1 from public.case_evidence e
    where e.id = evidence_id
      and (
        (e.criminal_case_id is not null and public.justice_can_access_case(e.criminal_case_id))
        or (e.investigation_id is not null and public.justice_can_access_investigation(e.investigation_id))
      )
  )
);

create policy "Judicial request participants access"
on public.judicial_requests for select to authenticated
using (
  requested_by = (select auth.uid())
  or target_profile_id = (select auth.uid())
  or decided_by = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Juiz', 'Promotor', 'Delegado', 'Policial', 'Police'])
);
create policy "Warrant authority or target access"
on public.warrants for select to authenticated
using (
  target_profile_id = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Juiz', 'Promotor', 'Delegado', 'Policial', 'Police'])
);
create policy "Arrest participant access"
on public.arrests for select to authenticated
using (
  suspect_id = (select auth.uid())
  or officer_id = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Juiz', 'Promotor', 'Delegado', 'Policial', 'Police', 'Agente Penitenciário', 'Diretor Penitenciário'])
);

create policy "Contextual hearing access"
on public.hearings for select to authenticated
using (public.justice_can_access_case(case_id));
create policy "Hearing participant access"
on public.hearing_participants for select to authenticated
using (
  profile_id = (select auth.uid())
  or exists (
    select 1 from public.hearings h
    where h.id = hearing_id and public.justice_can_access_case(h.case_id)
  )
);
create policy "Contextual case documents access"
on public.case_documents for select to authenticated
using (
  visibility = 'public'
  or public.justice_can_access_case(case_id)
);
create policy "Contextual decisions access"
on public.judicial_decisions for select to authenticated
using (public.justice_can_access_case(case_id));
create policy "Contextual sentences access"
on public.sentences for select to authenticated
using (
  defendant_id = (select auth.uid())
  or public.justice_can_access_case(case_id)
);
create policy "Contextual appeals access"
on public.appeals for select to authenticated
using (public.justice_can_access_case(case_id));
create policy "Contextual deadlines access"
on public.justice_deadlines for select to authenticated
using (
  responsible_profile_id = (select auth.uid())
  or (case_id is not null and public.justice_can_access_case(case_id))
  or (investigation_id is not null and public.justice_can_access_investigation(investigation_id))
);

create policy "Authenticated users read prison facilities"
on public.prison_facilities for select to authenticated using (is_active);
create policy "Authenticated users read prison wings"
on public.prison_wings for select to authenticated using (is_active);
create policy "Authenticated users read prison cells"
on public.prison_cells for select to authenticated
using (public.justice_has_role(array['Admin', 'Agente Penitenciário', 'Diretor Penitenciário']));
create policy "Inmate or prison staff read prison terms"
on public.prison_terms for select to authenticated
using (
  inmate_id = (select auth.uid())
  or (
    custody_status in ('provisional', 'serving')
    and public.justice_shares_active_facility(facility_id)
  )
  or public.justice_has_role(array['Admin', 'Juiz', 'Advogado', 'Defensor Público', 'Agente Penitenciário', 'Diretor Penitenciário'])
);
create policy "Inmate or prison staff read prison events"
on public.prison_events for select to authenticated
using (
  exists (
    select 1 from public.prison_terms pt
    where pt.id = prison_term_id
      and (
        pt.inmate_id = (select auth.uid())
        or public.justice_has_role(array['Admin', 'Juiz', 'Advogado', 'Defensor Público', 'Agente Penitenciário', 'Diretor Penitenciário'])
      )
  )
);
create policy "Authenticated users read prison activities"
on public.prison_activities for select to authenticated using (is_active);
create policy "Inmate reads own activity runs"
on public.prison_activity_runs for select to authenticated
using (
  inmate_id = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Agente Penitenciário', 'Diretor Penitenciário'])
);
create policy "Visit participants or staff read visits"
on public.prison_visits for select to authenticated
using (
  inmate_id = (select auth.uid())
  or visitor_id = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Agente Penitenciário', 'Diretor Penitenciário'])
);
create policy "Authorities read justice audit"
on public.justice_audit_log for select to authenticated
using (
  actor_id = (select auth.uid())
  or public.justice_has_role(array['Admin', 'Juiz', 'Promotor', 'Delegado'])
);

grant usage on type
  public.justice_case_status,
  public.justice_request_status,
  public.justice_warrant_status,
  public.justice_custody_status,
  public.justice_evidence_status
to authenticated;

grant select on
  public.rp_time_settings,
  public.penal_time_brackets,
  public.criminal_investigations,
  public.investigation_parties,
  public.investigation_events,
  public.criminal_cases,
  public.case_parties,
  public.penal_code,
  public.case_charges,
  public.case_evidence,
  public.evidence_custody_events,
  public.judicial_requests,
  public.warrants,
  public.arrests,
  public.hearings,
  public.hearing_participants,
  public.case_documents,
  public.judicial_decisions,
  public.sentences,
  public.prison_facilities,
  public.prison_wings,
  public.prison_cells,
  public.prison_terms,
  public.prison_events,
  public.prison_activities,
  public.prison_activity_runs,
  public.prison_visits,
  public.appeals,
  public.justice_deadlines,
  public.justice_audit_log
to authenticated;

revoke all on
  public.justice_number_counters,
  public.justice_audit_log
from anon, authenticated;
grant select on public.justice_audit_log to authenticated;

revoke execute on function public.rp_now() from public, anon, authenticated;
revoke execute on function public.rp_duration_to_real_seconds(numeric, text) from public, anon, authenticated;
revoke execute on function public.rp_date_to_real_date(timestamptz) from public, anon, authenticated;
revoke execute on function public.calculate_sentence_duration(numeric, numeric) from public, anon, authenticated;
revoke execute on function public.set_rp_clock_state(text, numeric, text) from public, anon, authenticated;
revoke execute on function public.justice_has_role(text[]) from public, anon, authenticated;
revoke execute on function public.justice_can_access_investigation(uuid) from public, anon, authenticated;
revoke execute on function public.justice_can_access_case(uuid) from public, anon, authenticated;
revoke execute on function public.justice_shares_active_facility(uuid) from public, anon, authenticated;
revoke execute on function public.justice_next_number(text) from public, anon, authenticated;
revoke execute on function public.justice_write_audit(text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.justice_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.justice_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.justice_block_immutable_rows() from public, anon, authenticated;
revoke execute on function public.justice_protect_sealed_evidence() from public, anon, authenticated;
revoke execute on function public.justice_protect_profile_authority() from public, anon, authenticated;
revoke execute on function public.justice_assign_case_judge(uuid) from public, anon, authenticated;
revoke execute on function public.justice_admit_sentence(uuid) from public, anon, authenticated;
revoke execute on function public.sync_legacy_prison_profile_state() from public, anon, authenticated;
revoke execute on function public.create_police_occurrence(text, text, text, text, timestamptz, boolean, text) from public, anon, authenticated;
revoke execute on function public.triage_police_occurrence(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.open_criminal_investigation(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.add_investigation_party(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.add_case_evidence(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.seal_case_evidence(uuid, text) from public, anon, authenticated;
revoke execute on function public.request_judicial_warrant(uuid, uuid, text, text, numeric) from public, anon, authenticated;
revoke execute on function public.decide_judicial_request(uuid, boolean, text, numeric) from public, anon, authenticated;
revoke execute on function public.submit_investigation_to_prosecutor(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.file_criminal_charges(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.schedule_case_hearing(uuid, text, timestamptz, integer, text) from public, anon, authenticated;
revoke execute on function public.issue_criminal_sentence(uuid, uuid, text, text, numeric, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.issue_acquittal(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.file_case_appeal(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.execute_arrest_warrant(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.register_flagrante_arrest(uuid, uuid, text, text, text, uuid[], numeric) from public, anon, authenticated;
revoke execute on function public.register_flare_arrest(uuid, uuid, text, text, text, uuid[], numeric) from public, anon, authenticated;
revoke execute on function public.start_prison_activity(uuid) from public, anon, authenticated;
revoke execute on function public.complete_prison_activity(uuid) from public, anon, authenticated;
revoke execute on function public.register_prison_event(uuid, text, text, text, integer) from public, anon, authenticated;
revoke execute on function public.grant_sentence_credit(uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.request_prison_visit(uuid) from public, anon, authenticated;
revoke execute on function public.release_prisoner(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.close_completed_sentences() from public, anon, authenticated;
revoke execute on function public.check_and_update_prisoner_status() from public, anon, authenticated;

grant execute on function public.rp_now() to authenticated;
grant execute on function public.rp_duration_to_real_seconds(numeric, text) to authenticated;
grant execute on function public.rp_date_to_real_date(timestamptz) to authenticated;
grant execute on function public.calculate_sentence_duration(numeric, numeric) to authenticated;
grant execute on function public.set_rp_clock_state(text, numeric, text) to authenticated;
grant execute on function public.justice_has_role(text[]) to authenticated;
grant execute on function public.justice_can_access_investigation(uuid) to authenticated;
grant execute on function public.justice_can_access_case(uuid) to authenticated;
grant execute on function public.justice_shares_active_facility(uuid) to authenticated;
grant execute on function public.create_police_occurrence(text, text, text, text, timestamptz, boolean, text) to authenticated;
grant execute on function public.triage_police_occurrence(uuid, text, text) to authenticated;
grant execute on function public.open_criminal_investigation(uuid, text, uuid) to authenticated;
grant execute on function public.add_investigation_party(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.add_case_evidence(uuid, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.seal_case_evidence(uuid, text) to authenticated;
grant execute on function public.request_judicial_warrant(uuid, uuid, text, text, numeric) to authenticated;
grant execute on function public.decide_judicial_request(uuid, boolean, text, numeric) to authenticated;
grant execute on function public.submit_investigation_to_prosecutor(uuid, text, text) to authenticated;
grant execute on function public.file_criminal_charges(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.schedule_case_hearing(uuid, text, timestamptz, integer, text) to authenticated;
grant execute on function public.issue_criminal_sentence(uuid, uuid, text, text, numeric, numeric, text, text) to authenticated;
grant execute on function public.issue_acquittal(uuid, uuid, text) to authenticated;
grant execute on function public.file_case_appeal(uuid, uuid, text, text) to authenticated;
grant execute on function public.execute_arrest_warrant(uuid, text, text) to authenticated;
grant execute on function public.register_flagrante_arrest(uuid, uuid, text, text, text, uuid[], numeric) to authenticated;
grant execute on function public.register_flare_arrest(uuid, uuid, text, text, text, uuid[], numeric) to authenticated;
grant execute on function public.start_prison_activity(uuid) to authenticated;
grant execute on function public.complete_prison_activity(uuid) to authenticated;
grant execute on function public.register_prison_event(uuid, text, text, text, integer) to authenticated;
grant execute on function public.grant_sentence_credit(uuid, integer, text) to authenticated;
grant execute on function public.request_prison_visit(uuid) to authenticated;
grant execute on function public.release_prisoner(uuid, text, uuid) to authenticated;
grant execute on function public.close_completed_sentences() to authenticated;
grant execute on function public.check_and_update_prisoner_status() to authenticated;

-- Postgres Changes é mantido no MVP porque o projeto ainda usa supabase-js 2.30.
-- A migração futura para Broadcast privado deve acompanhar a atualização do client.
alter publication supabase_realtime add table
  public.criminal_cases,
  public.judicial_requests,
  public.warrants,
  public.prison_terms,
  public.prison_activity_runs;
