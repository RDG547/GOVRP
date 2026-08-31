begin;

create or replace function public.rp_now()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
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
    ),
    clock_timestamp()
  )
$$;

create or replace function public.rp_duration_to_real_seconds(p_amount numeric, p_unit text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
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
    ),
    greatest(
      1,
      round(case lower(p_unit)
        when 'hour' then p_amount * 3600
        when 'day' then p_amount * 86400
        when 'week' then p_amount * 604800
        when 'month' then p_amount * ((365::numeric / 12) * 86400)
        when 'year' then p_amount * (365::numeric * 86400)
        else p_amount
      end)
    )::bigint
  )
$$;

create or replace function public.rp_date_to_real_date(p_rp_date timestamptz)
returns timestamptz
language sql
stable
set search_path=''
as $$
  select coalesce(
    (
      select s.rp_epoch_real_at
        + make_interval(secs => extract(epoch from (p_rp_date-s.rp_epoch_game_at)) /
          (((s.rp_days_per_year::numeric*86400)/s.rp_year_real_seconds)*s.speed_multiplier))
      from public.rp_time_settings s where s.id=true
    ),
    p_rp_date
  )
$$;

create or replace function public.real_date_to_rp_date(p_real_date timestamptz)
returns timestamptz
language sql
stable
set search_path=''
as $$
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
$$;

insert into public.penal_time_brackets(
  minimum_years, maximum_years, minimum_real_seconds, maximum_real_seconds,
  label, sort_order, is_active
)
select bracket.*
from (values
  (0::numeric, 1::numeric, 300, 600, 'Até 1 ano', 10::smallint, true),
  (1::numeric, 5::numeric, 600, 1800, 'De 1 a 5 anos', 20::smallint, true),
  (5::numeric, null::numeric, 1800, 7200, 'Acima de 5 anos', 30::smallint, true)
) as bracket(minimum_years,maximum_years,minimum_real_seconds,maximum_real_seconds,label,sort_order,is_active)
where not exists (select 1 from public.penal_time_brackets);

create or replace function public.calculate_sentence_duration(
  p_sentence_years numeric,
  p_modifier numeric default 1
)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_bracket public.penal_time_brackets%rowtype;
  v_ratio numeric;
  v_seconds numeric;
  v_global_multiplier numeric;
begin
  if p_sentence_years < 0 or p_modifier <= 0 then raise exception 'INVALID_SENTENCE_DURATION'; end if;

  select * into v_bracket
  from public.penal_time_brackets b
  where b.is_active
    and p_sentence_years >= b.minimum_years
    and (b.maximum_years is null or p_sentence_years <= b.maximum_years)
  order by b.sort_order
  limit 1;
  if not found then raise exception 'PENAL_TIME_BRACKET_NOT_CONFIGURED'; end if;

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

  select coalesce(s.penal_time_multiplier, 1) into v_global_multiplier
  from public.rp_time_settings s where s.id = true;
  v_global_multiplier := coalesce(v_global_multiplier, 1);
  return greatest(60, round(v_seconds * p_modifier * v_global_multiplier))::integer;
end;
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
  -- Ambientes novos podem ainda não ter o relógio RP configurado. A numeração
  -- oficial continua determinística usando o ano civil como fallback.
  v_year := extract(year from coalesce(public.rp_now(), clock_timestamp()))::integer;

  insert into public.justice_number_counters(number_type, rp_year, current_value)
  values (upper(p_type), v_year, 1)
  on conflict (number_type, rp_year)
  do update set current_value = public.justice_number_counters.current_value + 1
  returning current_value into v_value;

  return upper(p_type) || '-' || v_year || '-' || lpad(v_value::text, 6, '0');
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
  if p_lead_officer_id is not null
     and p_lead_officer_id is distinct from (select auth.uid())
     and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'ONLY_DELEGATE_CAN_ASSIGN_ANOTHER_OFFICER';
  end if;
  if length(trim(coalesce(p_summary, ''))) < 20 then raise exception 'SUMMARY_TOO_SHORT'; end if;

  select * into v_occurrence
  from public.police_occurrences
  where id = p_occurrence_id
  for update;
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
  set status = 'Em investigação', assigned_officer_id = v_lead
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

-- A single factual timeline connects police work, prosecution, trial, appeals
-- and sentence execution without replacing the existing justice tables.
create table if not exists public.case_timeline_events (
  id bigint generated always as identity primary key,
  case_id uuid references public.criminal_cases(id) on delete cascade,
  investigation_id uuid references public.criminal_investigations(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  status_from text,
  status_to text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text,
  source_table text not null,
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint case_timeline_subject_check check (case_id is not null or investigation_id is not null)
);

create index if not exists case_timeline_case_recent_idx
  on public.case_timeline_events (case_id, created_at, id);
create index if not exists case_timeline_investigation_recent_idx
  on public.case_timeline_events (investigation_id, created_at, id);

alter table public.case_timeline_events enable row level security;
drop policy if exists case_timeline_contextual_read on public.case_timeline_events;
create policy case_timeline_contextual_read
on public.case_timeline_events for select to authenticated
using (
  (case_id is not null and public.justice_can_access_case(case_id))
  or (investigation_id is not null and public.justice_can_access_investigation(investigation_id))
);

revoke all on public.case_timeline_events from public, anon, authenticated;
grant select on public.case_timeline_events to authenticated;
grant all on public.case_timeline_events to service_role;
grant usage, select on sequence public.case_timeline_events_id_seq to service_role;

create or replace function public.block_case_timeline_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CASE_TIMELINE_IS_IMMUTABLE';
end;
$$;

drop trigger if exists case_timeline_immutable on public.case_timeline_events;
create trigger case_timeline_immutable
before update or delete on public.case_timeline_events
for each row execute function public.block_case_timeline_mutation();

create or replace function public.append_case_timeline_event(
  p_case_id uuid,
  p_investigation_id uuid,
  p_event_type text,
  p_title text,
  p_description text,
  p_status_from text,
  p_status_to text,
  p_source_table text,
  p_source_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_actor uuid := auth.uid();
begin
  insert into public.case_timeline_events (
    case_id, investigation_id, event_type, title, description,
    status_from, status_to, actor_id, actor_role,
    source_table, source_id, metadata
  ) values (
    p_case_id, p_investigation_id, p_event_type, p_title,
    nullif(btrim(coalesce(p_description, '')), ''), p_status_from, p_status_to,
    v_actor, case when v_actor is null then null else public.get_user_role(v_actor) end,
    p_source_table, p_source_id, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.capture_justice_timeline_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_case_id uuid;
  v_investigation_id uuid;
  v_source_id uuid := (v_new->>'id')::uuid;
  v_event_type text;
  v_title text;
  v_description text;
  v_status_from text := case when v_old is null then null else v_old->>'status' end;
  v_status_to text := v_new->>'status';
begin
  if tg_table_name = 'criminal_cases' then
    v_case_id := v_source_id;
    v_investigation_id := (v_new->>'investigation_id')::uuid;
    v_event_type := case when tg_op = 'INSERT' then 'case_created' else 'case_status_changed' end;
    v_title := case when tg_op = 'INSERT' then 'Processo criado' else 'Situação do processo alterada' end;
    v_description := coalesce(v_new->>'final_decision', v_new->>'summary');
  elsif tg_table_name = 'criminal_investigations' then
    v_investigation_id := v_source_id;
    select case_row.id into v_case_id
    from public.criminal_cases case_row
    where case_row.investigation_id = v_investigation_id;
    v_event_type := case when tg_op = 'INSERT' then 'investigation_opened' else 'investigation_status_changed' end;
    v_title := case when tg_op = 'INSERT' then 'Investigação aberta' else 'Investigação movimentada' end;
    v_description := coalesce(v_new->>'conclusion', v_new->>'summary');
  elsif tg_table_name = 'case_documents' then
    v_case_id := (v_new->>'case_id')::uuid;
    select investigation_id into v_investigation_id from public.criminal_cases where id = v_case_id;
    v_event_type := 'document_filed';
    v_title := coalesce(v_new->>'title', 'Documento protocolado');
    v_description := 'Documento processual: ' || coalesce(v_new->>'document_type', 'documento');
  elsif tg_table_name = 'judicial_decisions' then
    v_case_id := (v_new->>'case_id')::uuid;
    select investigation_id into v_investigation_id from public.criminal_cases where id = v_case_id;
    v_event_type := 'judicial_decision';
    v_title := coalesce(v_new->>'summary', 'Decisão judicial');
    v_description := v_new->>'result';
  elsif tg_table_name = 'hearings' then
    v_case_id := (v_new->>'case_id')::uuid;
    select investigation_id into v_investigation_id from public.criminal_cases where id = v_case_id;
    v_event_type := case when tg_op = 'INSERT' then 'hearing_scheduled' else 'hearing_updated' end;
    v_title := case when tg_op = 'INSERT' then 'Audiência agendada' else 'Audiência atualizada' end;
    v_description := coalesce(v_new->>'minutes', v_new->>'meeting_location');
  elsif tg_table_name = 'sentences' then
    v_case_id := (v_new->>'case_id')::uuid;
    select investigation_id into v_investigation_id from public.criminal_cases where id = v_case_id;
    v_event_type := case when tg_op = 'INSERT' then 'sentence_issued' else 'sentence_updated' end;
    v_title := case when tg_op = 'INSERT' then 'Sentença emitida' else 'Execução da sentença atualizada' end;
    v_description := 'Pena: ' || coalesce(v_new->>'final_sentence_units', '0') || ' unidade(s) RP';
  elsif tg_table_name = 'appeals' then
    v_case_id := (v_new->>'case_id')::uuid;
    select investigation_id into v_investigation_id from public.criminal_cases where id = v_case_id;
    v_event_type := case when tg_op = 'INSERT' then 'appeal_filed' else 'appeal_decided' end;
    v_title := case when tg_op = 'INSERT' then 'Recurso protocolado' else 'Recurso decidido' end;
    v_description := coalesce(v_new->>'decision', v_new->>'arguments');
  elsif tg_table_name = 'warrants' then
    v_case_id := nullif(v_new->>'case_id', '')::uuid;
    v_investigation_id := nullif(v_new->>'investigation_id', '')::uuid;
    v_event_type := case when tg_op = 'INSERT' then 'warrant_issued' else 'warrant_updated' end;
    v_title := case when tg_op = 'INSERT' then 'Mandado expedido' else 'Mandado atualizado' end;
    v_description := coalesce(v_new->>'warrant_number', v_new->>'warrant_type');
  else
    return new;
  end if;

  if tg_op = 'UPDATE' and v_status_from is not distinct from v_status_to
     and tg_table_name not in ('hearings', 'appeals', 'sentences', 'warrants') then
    return new;
  end if;

  perform public.append_case_timeline_event(
    v_case_id, v_investigation_id, v_event_type, v_title, v_description,
    v_status_from, v_status_to, tg_table_name, v_source_id,
    jsonb_build_object('operation', tg_op)
  );
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'criminal_cases', 'criminal_investigations', 'case_documents',
    'judicial_decisions', 'hearings', 'sentences', 'appeals', 'warrants'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', v_table || '_timeline', v_table);
    execute format(
      'create trigger %I after insert or update on public.%I for each row execute function public.capture_justice_timeline_change()',
      v_table || '_timeline', v_table
    );
  end loop;
end;
$$;

create or replace function public.record_investigation_evidence(
  p_investigation_id uuid,
  p_evidence_type text,
  p_title text,
  p_description text,
  p_file_url text default null,
  p_evidence_hash text default null,
  p_seal boolean default false
)
returns public.case_evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_investigation public.criminal_investigations%rowtype;
  v_evidence public.case_evidence%rowtype;
  v_status public.justice_evidence_status;
begin
  if not public.justice_has_role(array['Admin', 'Policial', 'Police', 'Delegado']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 5 then raise exception 'EVIDENCE_TITLE_TOO_SHORT'; end if;
  if length(btrim(coalesce(p_description, ''))) < 10 then raise exception 'EVIDENCE_DESCRIPTION_TOO_SHORT'; end if;

  select * into v_investigation from public.criminal_investigations
  where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_investigation.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_NOT_EDITABLE';
  end if;
  if v_investigation.lead_officer_id is distinct from v_actor
     and v_investigation.delegate_id is distinct from v_actor
     and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'INVESTIGATION_NOT_ASSIGNED';
  end if;
  if p_seal and not public.justice_has_role(array['Admin', 'Delegado']) then
    raise exception 'ONLY_DELEGATE_CAN_SEAL_EVIDENCE';
  end if;

  v_status := case when p_seal then 'sealed'::public.justice_evidence_status else 'collected'::public.justice_evidence_status end;
  insert into public.case_evidence (
    investigation_id, evidence_type, title, description, file_url,
    submitted_by, sealed_at, evidence_hash, status, metadata
  ) values (
    p_investigation_id, btrim(p_evidence_type), btrim(p_title), btrim(p_description),
    nullif(btrim(coalesce(p_file_url, '')), ''), v_actor,
    case when p_seal then clock_timestamp() else null end,
    nullif(btrim(coalesce(p_evidence_hash, '')), ''), v_status,
    jsonb_build_object('recorded_authoritatively', true)
  ) returning * into v_evidence;

  update public.criminal_investigations
  set status = case when status = 'open' then 'in_progress' else status end,
      updated_at = clock_timestamp()
  where id = p_investigation_id;

  insert into public.investigation_events (
    investigation_id, event_type, title, description, actor_id, metadata
  ) values (
    p_investigation_id, case when p_seal then 'evidence_sealed' else 'evidence_collected' end,
    btrim(p_title), btrim(p_description), v_actor,
    jsonb_build_object('evidence_id', v_evidence.id, 'status', v_status)
  );

  perform public.justice_write_audit(
    'investigation.evidence_recorded', 'case_evidence', v_evidence.id,
    null, to_jsonb(v_evidence), p_description
  );
  return v_evidence;
end;
$$;

create or replace function public.resolve_investigation(
  p_investigation_id uuid,
  p_outcome text,
  p_conclusion text,
  p_recommended_action text default null
)
returns public.criminal_investigations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Delegado']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('indict', 'no_indictment') then raise exception 'INVALID_INVESTIGATION_OUTCOME'; end if;
  if length(btrim(coalesce(p_conclusion, ''))) < 40 then raise exception 'CONCLUSION_TOO_SHORT'; end if;

  select * into v_old from public.criminal_investigations where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_old.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_ALREADY_RESOLVED';
  end if;

  if p_outcome = 'indict' then
    if not exists (
      select 1 from public.investigation_parties
      where investigation_id = p_investigation_id and party_type = 'suspect'
    ) then raise exception 'INVESTIGATION_REQUIRES_SUSPECT'; end if;
    if not exists (
      select 1 from public.case_evidence
      where investigation_id = p_investigation_id and status = 'sealed'
    ) then raise exception 'INVESTIGATION_REQUIRES_SEALED_EVIDENCE'; end if;
  end if;

  update public.criminal_investigations
  set status = case when p_outcome = 'indict' then 'sent_to_prosecutor' else 'archived' end,
      conclusion = btrim(p_conclusion),
      recommended_action = case when p_outcome = 'indict'
        then coalesce(nullif(btrim(coalesce(p_recommended_action, '')), ''), 'criminal_charge')
        else 'no_indictment' end,
      closed_at = case when p_outcome = 'no_indictment' then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where id = p_investigation_id
  returning * into v_new;

  update public.police_occurrences
  set status = case when p_outcome = 'indict' then 'Concluída' else 'Arquivada' end,
      updated_at = clock_timestamp()
  where id = v_old.occurrence_id;

  insert into public.investigation_events (
    investigation_id, event_type, title, description, actor_id, metadata
  ) values (
    p_investigation_id,
    case when p_outcome = 'indict' then 'indictment' else 'no_indictment' end,
    case when p_outcome = 'indict' then 'Relatório final com indiciamento' else 'Investigação arquivada sem indiciamento' end,
    btrim(p_conclusion), v_actor,
    jsonb_build_object('outcome', p_outcome, 'recommended_action', v_new.recommended_action)
  );

  perform public.justice_write_audit(
    'investigation.' || p_outcome, 'criminal_investigation', p_investigation_id,
    to_jsonb(v_old), to_jsonb(v_new), p_conclusion
  );
  return v_new;
end;
$$;

create or replace function public.request_investigation_complement(
  p_investigation_id uuid,
  p_reason text
)
returns public.criminal_investigations
language plpgsql
security definer
set search_path = ''
as $$
declare v_old public.criminal_investigations%rowtype; v_new public.criminal_investigations%rowtype;
begin
  if not public.justice_has_role(array['Admin', 'Promotor']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then raise exception 'REASON_TOO_SHORT'; end if;
  select * into v_old from public.criminal_investigations where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_old.status <> 'sent_to_prosecutor' then raise exception 'INVESTIGATION_NOT_WITH_PROSECUTOR'; end if;
  update public.criminal_investigations
  set status = 'complement_requested', updated_at = clock_timestamp()
  where id = p_investigation_id returning * into v_new;
  insert into public.investigation_events(investigation_id,event_type,title,description,actor_id)
  values(p_investigation_id,'complement_requested','Ministério Público solicita diligências',btrim(p_reason),auth.uid());
  perform public.justice_write_audit('investigation.complement_requested','criminal_investigation',p_investigation_id,to_jsonb(v_old),to_jsonb(v_new),p_reason);
  return v_new;
end;
$$;

create or replace function public.decide_charge_admission(
  p_case_id uuid,
  p_admitted boolean,
  p_reason text
)
returns public.criminal_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_cases%rowtype;
  v_new public.criminal_cases%rowtype;
  v_defendant uuid;
begin
  if not public.justice_has_role(array['Admin', 'Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 40 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;
  select * into v_old from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_old.status <> 'judicial_review' then raise exception 'CASE_NOT_AWAITING_ADMISSION'; end if;
  if v_old.judge_id is distinct from v_actor and not public.justice_has_role(array['Admin']) then
    raise exception 'ONLY_ASSIGNED_JUDGE_CAN_DECIDE';
  end if;
  select profile_id into v_defendant from public.case_parties
  where case_id = p_case_id and party_type = 'defendant' order by created_at limit 1;

  insert into public.judicial_decisions(
    case_id, decision_type, judge_id, summary, legal_reasoning, result, is_final
  ) values (
    p_case_id, 'charge_admission', v_actor,
    case when p_admitted then 'Denúncia recebida' else 'Denúncia rejeitada' end,
    btrim(p_reason), case when p_admitted then 'admitted' else 'rejected' end, not p_admitted
  );

  update public.case_charges set status = case when p_admitted then 'admitted' else 'dismissed' end
  where case_id = p_case_id and status = 'filed';
  update public.criminal_cases
  set status = case
        when p_admitted then 'initial_defense'::public.justice_case_status
        else 'archived'::public.justice_case_status
      end,
      final_decision = case when p_admitted then null else 'Denúncia rejeitada' end,
      closed_at = case when p_admitted then null else clock_timestamp() end,
      updated_at = clock_timestamp()
  where id = p_case_id returning * into v_new;

  if p_admitted and v_defendant is not null then
    insert into public.justice_deadlines(case_id,deadline_type,responsible_profile_id,rp_due_at,real_due_at)
    values(p_case_id,'initial_defense',v_defendant,public.rp_now()+interval '5 days',clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(5,'day')));
  end if;
  perform public.justice_write_audit('case.charge_admission','criminal_case',p_case_id,to_jsonb(v_old),to_jsonb(v_new),p_reason);
  return v_new;
end;
$$;

create or replace function public.submit_case_document(
  p_case_id uuid,
  p_document_type text,
  p_title text,
  p_body text,
  p_file_url text default null,
  p_visibility text default 'parties'
)
returns public.case_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.criminal_cases%rowtype;
  v_document public.case_documents%rowtype;
  v_is_party boolean;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_document_type not in ('defense','petition','expert_report','appeal') then raise exception 'DOCUMENT_TYPE_NOT_ALLOWED'; end if;
  if p_visibility not in ('public','parties','court','secret') then raise exception 'INVALID_VISIBILITY'; end if;
  if length(btrim(coalesce(p_title, ''))) < 5 or length(btrim(coalesce(p_body, ''))) < 20 then
    raise exception 'DOCUMENT_CONTENT_TOO_SHORT';
  end if;
  select * into v_case from public.criminal_cases where id = p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  select exists(
    select 1 from public.case_parties party
    where party.case_id = p_case_id and (party.profile_id = v_actor or party.lawyer_id = v_actor)
  ) into v_is_party;
  if not v_is_party and not public.justice_has_role(array['Admin','Juiz']) then raise exception 'CASE_ACCESS_DENIED'; end if;
  if p_document_type = 'defense'
     and v_case.status not in ('initial_defense','instruction','hearing_scheduled') then
    raise exception 'DEFENSE_NOT_OPEN';
  end if;

  insert into public.case_documents(case_id,document_type,title,body,file_url,author_id,visibility,signed_at)
  values(p_case_id,p_document_type,btrim(p_title),btrim(p_body),nullif(btrim(coalesce(p_file_url,'')),''),v_actor,p_visibility,clock_timestamp())
  returning * into v_document;
  if p_document_type = 'defense' and v_case.status = 'initial_defense' then
    update public.criminal_cases set status='instruction',updated_at=clock_timestamp() where id=p_case_id;
    update public.justice_deadlines set status='completed'
    where case_id=p_case_id and deadline_type='initial_defense' and status='open';
  end if;
  perform public.justice_write_audit('case.document_filed','case_document',v_document.id,null,to_jsonb(v_document),p_body);
  return v_document;
end;
$$;

create or replace function public.schedule_case_hearing(
  p_case_id uuid,
  p_hearing_type text,
  p_rp_scheduled_at timestamptz,
  p_duration_minutes integer default 60,
  p_meeting_location text default null
)
returns public.hearings
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_case public.criminal_cases%rowtype; v_hearing public.hearings%rowtype;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_rp_scheduled_at <= clock_timestamp() then raise exception 'HEARING_MUST_BE_FUTURE'; end if;
  select * into v_case from public.criminal_cases where id=p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.judge_id is distinct from v_actor and not public.justice_has_role(array['Admin']) then raise exception 'ONLY_ASSIGNED_JUDGE_CAN_SCHEDULE'; end if;
  if v_case.status not in ('initial_defense','instruction') then raise exception 'CASE_NOT_READY_FOR_HEARING'; end if;
  insert into public.hearings(case_id,hearing_type,scheduled_at,rp_scheduled_at,duration,meeting_location,created_by)
  values(p_case_id,btrim(p_hearing_type),p_rp_scheduled_at,p_rp_scheduled_at,p_duration_minutes,nullif(btrim(coalesce(p_meeting_location,'')),''),v_actor)
  returning * into v_hearing;
  insert into public.hearing_participants(hearing_id,profile_id,participant_role,summoned_at)
  select v_hearing.id,party.profile_id,party.party_type,clock_timestamp()
  from public.case_parties party where party.case_id=p_case_id
  on conflict(hearing_id,profile_id) do nothing;
  update public.criminal_cases set status='hearing_scheduled',updated_at=clock_timestamp() where id=p_case_id;
  perform public.justice_write_audit('hearing.scheduled','hearing',v_hearing.id,null,to_jsonb(v_hearing),'Audiência agendada');
  return v_hearing;
end;
$$;

create or replace function public.complete_case_hearing(p_hearing_id uuid,p_minutes text)
returns public.hearings
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_hearing public.hearings%rowtype; v_case public.criminal_cases%rowtype;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_minutes,''))) < 40 then raise exception 'HEARING_MINUTES_TOO_SHORT'; end if;
  select * into v_hearing from public.hearings where id=p_hearing_id for update;
  if not found then raise exception 'HEARING_NOT_FOUND'; end if;
  if v_hearing.status not in ('scheduled','open') then raise exception 'HEARING_NOT_ACTIVE'; end if;
  select * into v_case from public.criminal_cases where id=v_hearing.case_id for update;
  if v_case.judge_id is distinct from v_actor and not public.justice_has_role(array['Admin']) then raise exception 'ONLY_ASSIGNED_JUDGE_CAN_COMPLETE'; end if;
  update public.hearings set status='completed',minutes=btrim(p_minutes),opened_at=coalesce(opened_at,clock_timestamp()),completed_at=clock_timestamp()
  where id=p_hearing_id returning * into v_hearing;
  insert into public.case_documents(case_id,document_type,title,body,author_id,visibility,signed_at)
  values(v_hearing.case_id,'hearing_minutes','Ata de audiência',btrim(p_minutes),v_actor,'parties',clock_timestamp());
  update public.criminal_cases set status='awaiting_sentence',updated_at=clock_timestamp() where id=v_hearing.case_id;
  perform public.justice_write_audit('hearing.completed','hearing',v_hearing.id,null,to_jsonb(v_hearing),p_minutes);
  return v_hearing;
end;
$$;

create or replace function public.issue_case_acquittal(p_case_id uuid,p_legal_reasoning text)
returns public.judicial_decisions
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_case public.criminal_cases%rowtype; v_decision public.judicial_decisions%rowtype; v_prosecutor uuid;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_legal_reasoning,''))) < 80 then raise exception 'LEGAL_REASONING_TOO_SHORT'; end if;
  select * into v_case from public.criminal_cases where id=p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.judge_id is distinct from v_actor and not public.justice_has_role(array['Admin']) then raise exception 'ONLY_ASSIGNED_JUDGE_CAN_SENTENCE'; end if;
  if v_case.status not in ('instruction','hearing_scheduled','awaiting_sentence') then raise exception 'CASE_NOT_READY_FOR_SENTENCE'; end if;
  insert into public.judicial_decisions(case_id,decision_type,judge_id,summary,legal_reasoning,result,is_final)
  values(p_case_id,'sentence',v_actor,'Sentença absolutória',btrim(p_legal_reasoning),'acquittal',false)
  returning * into v_decision;
  update public.case_charges set status='acquitted' where case_id=p_case_id and status in('filed','admitted');
  update public.criminal_cases set status='acquitted',final_decision='Absolvição ainda sujeita a recurso',updated_at=clock_timestamp() where id=p_case_id;
  v_prosecutor:=v_case.prosecutor_id;
  if v_prosecutor is not null then
    insert into public.justice_deadlines(case_id,deadline_type,responsible_profile_id,rp_due_at,real_due_at)
    values(p_case_id,'appeal',v_prosecutor,public.rp_now()+interval '5 days',clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(5,'day')));
  end if;
  perform public.justice_write_audit('sentence.acquittal','judicial_decision',v_decision.id,null,to_jsonb(v_decision),p_legal_reasoning);
  return v_decision;
end;
$$;

create or replace function public.file_case_appeal(p_case_id uuid,p_appeal_type text,p_arguments text)
returns public.appeals
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_case public.criminal_cases%rowtype; v_decision uuid; v_appeal public.appeals%rowtype;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if length(btrim(coalesce(p_arguments,''))) < 40 then raise exception 'APPEAL_ARGUMENTS_TOO_SHORT'; end if;
  select * into v_case from public.criminal_cases where id=p_case_id for update;
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.status not in ('convicted','acquitted') then raise exception 'CASE_NOT_APPEALABLE'; end if;
  if not exists(select 1 from public.justice_deadlines where case_id=p_case_id and deadline_type='appeal' and status='open' and real_due_at>clock_timestamp()) then raise exception 'APPEAL_DEADLINE_CLOSED'; end if;
  if not exists(select 1 from public.case_parties party where party.case_id=p_case_id and (party.profile_id=v_actor or party.lawyer_id=v_actor))
     and not public.justice_has_role(array['Admin']) then raise exception 'CASE_ACCESS_DENIED'; end if;
  select id into v_decision from public.judicial_decisions where case_id=p_case_id and decision_type='sentence' order by issued_at desc limit 1;
  if v_decision is null then raise exception 'SENTENCE_DECISION_NOT_FOUND'; end if;
  insert into public.appeals(case_id,decision_id,filed_by,appeal_type,arguments)
  values(p_case_id,v_decision,v_actor,btrim(p_appeal_type),btrim(p_arguments)) returning * into v_appeal;
  update public.criminal_cases set status='appeal',updated_at=clock_timestamp() where id=p_case_id;
  update public.sentences set status='appealed' where case_id=p_case_id and status='appealable';
  update public.justice_deadlines set status='completed' where case_id=p_case_id and deadline_type='appeal' and status='open';
  perform public.justice_write_audit('appeal.filed','appeal',v_appeal.id,null,to_jsonb(v_appeal),p_arguments);
  return v_appeal;
end;
$$;

create or replace function public.decide_case_appeal(p_appeal_id uuid,p_outcome text,p_decision text)
returns public.appeals
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_appeal public.appeals%rowtype; v_original_judge uuid; v_case_status public.justice_case_status; v_sentence public.sentences%rowtype;
begin
  if not public.justice_has_role(array['Admin','Juiz']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('granted','partially_granted','denied') then raise exception 'INVALID_APPEAL_OUTCOME'; end if;
  if length(btrim(coalesce(p_decision,''))) < 60 then raise exception 'APPEAL_DECISION_TOO_SHORT'; end if;
  select * into v_appeal from public.appeals where id=p_appeal_id for update;
  if not found then raise exception 'APPEAL_NOT_FOUND'; end if;
  if v_appeal.status not in('filed','under_review') then raise exception 'APPEAL_ALREADY_DECIDED'; end if;
  select judge_id into v_original_judge from public.judicial_decisions where id=v_appeal.decision_id;
  if v_original_judge=v_actor and not public.justice_has_role(array['Admin']) then raise exception 'APPEAL_REQUIRES_DIFFERENT_JUDGE'; end if;
  v_case_status:=case when p_outcome='granted' then 'instruction'::public.justice_case_status else 'final'::public.justice_case_status end;
  update public.appeals set status=p_outcome,reviewing_judge_id=v_actor,decision=btrim(p_decision),decided_at=clock_timestamp()
  where id=p_appeal_id returning * into v_appeal;
  insert into public.judicial_decisions(case_id,decision_type,judge_id,summary,legal_reasoning,result,is_final)
  values(v_appeal.case_id,'appeal',v_actor,'Julgamento de recurso',btrim(p_decision),p_outcome,p_outcome<>'granted');
  if p_outcome in ('denied','partially_granted') then
    for v_sentence in
      update public.sentences set status='final'
      where case_id=v_appeal.case_id and status='appealed'
      returning *
    loop
      perform public.justice_admit_sentence(v_sentence.id);
      v_case_status := 'execution';
    end loop;
  end if;
  update public.criminal_cases
  set status=v_case_status,
      final_decision=btrim(p_decision),
      closed_at=case when v_case_status='final' then clock_timestamp() else null end,
      updated_at=clock_timestamp()
  where id=v_appeal.case_id;
  perform public.justice_write_audit('appeal.decided','appeal',v_appeal.id,null,to_jsonb(v_appeal),p_decision);
  return v_appeal;
end;
$$;

create or replace function public.release_prison_term(p_prison_term_id uuid,p_reason text)
returns public.prison_terms
language plpgsql
security definer
set search_path = ''
as $$
declare v_term public.prison_terms%rowtype; v_case_id uuid;
begin
  if not public.justice_has_role(array['Admin','Juiz','Diretor Penitenciário']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(btrim(coalesce(p_reason,''))) < 20 then raise exception 'RELEASE_REASON_TOO_SHORT'; end if;
  select * into v_term from public.prison_terms where id=p_prison_term_id for update;
  if not found then raise exception 'PRISON_TERM_NOT_FOUND'; end if;
  if v_term.custody_status not in('awaiting_intake','provisional','serving') then raise exception 'INMATE_NOT_IN_CUSTODY'; end if;
  update public.prison_terms set custody_status='released',actual_release_at=clock_timestamp(),release_reason=btrim(p_reason) where id=p_prison_term_id returning * into v_term;
  if v_term.sentence_id is not null then
    update public.sentences set status='served',ends_at=clock_timestamp() where id=v_term.sentence_id;
    select case_id into v_case_id from public.sentences where id=v_term.sentence_id;
    update public.criminal_cases set status='served',closed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_case_id;
  end if;
  if v_term.arrest_id is not null then update public.arrests set status='released',released_at=clock_timestamp(),release_reason=btrim(p_reason) where id=v_term.arrest_id; end if;
  update public.profiles set is_imprisoned=false,release_date=null,updated_at=clock_timestamp() where id=v_term.inmate_id;
  insert into public.prison_events(prison_term_id,event_type,title,description) values(v_term.id,'release','Libertação autorizada',btrim(p_reason));
  perform public.justice_notify(v_term.inmate_id,'justice_release_order','Sua liberação foi autorizada.','/services/justice?view=citizen',jsonb_build_object('prison_term_id',v_term.id));
  perform public.justice_write_audit('prison.released','prison_term',v_term.id,null,to_jsonb(v_term),p_reason);
  return v_term;
end;
$$;

revoke all on function public.append_case_timeline_event(uuid,uuid,text,text,text,text,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.append_case_timeline_event(uuid,uuid,text,text,text,text,text,text,uuid,jsonb) to service_role;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.record_investigation_evidence(uuid,text,text,text,text,text,boolean)'::regprocedure,
    'public.resolve_investigation(uuid,text,text,text)'::regprocedure,
    'public.request_investigation_complement(uuid,text)'::regprocedure,
    'public.decide_charge_admission(uuid,boolean,text)'::regprocedure,
    'public.submit_case_document(uuid,text,text,text,text,text)'::regprocedure,
    'public.schedule_case_hearing(uuid,text,timestamptz,integer,text)'::regprocedure,
    'public.complete_case_hearing(uuid,text)'::regprocedure,
    'public.issue_case_acquittal(uuid,text)'::regprocedure,
    'public.file_case_appeal(uuid,text,text)'::regprocedure,
    'public.decide_case_appeal(uuid,text,text)'::regprocedure,
    'public.release_prison_term(uuid,text)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_signature);
    execute format('grant execute on function %s to authenticated, service_role', v_signature);
  end loop;
end;
$$;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='case_timeline_events') then
    alter publication supabase_realtime add table public.case_timeline_events;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
