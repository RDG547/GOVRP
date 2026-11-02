BEGIN;
ALTER TABLE public.elections ADD COLUMN IF NOT EXISTS seats_available smallint;
ALTER TABLE public.elections DROP CONSTRAINT IF EXISTS valid_parliament_seat_count;
ALTER TABLE public.elections ADD CONSTRAINT valid_parliament_seat_count CHECK (seats_available IS NULL OR seats_available BETWEEN 1 AND 513);

CREATE OR REPLACE FUNCTION public.admin_set_election_seats(p_election_id uuid,p_seats integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_election public.elections%rowtype; v_type text; v_max integer;
BEGIN
 PERFORM private.assert_electoral_management();
 SELECT * INTO v_election FROM public.elections WHERE id=p_election_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Eleição não encontrada.'; END IF;
 SELECT name INTO v_type FROM public.election_types WHERE id=v_election.election_type_id;
 IF v_type NOT IN ('Senador','Deputado') THEN RAISE EXCEPTION 'Quantidade de cadeiras disponível apenas para eleições parlamentares.'; END IF;
 v_max:=CASE WHEN v_type='Senador' THEN 81 ELSE 513 END;
 IF p_seats IS NULL OR p_seats NOT BETWEEN 1 AND v_max THEN RAISE EXCEPTION 'Escolha de 1 a % cadeiras.',v_max; END IF;
 IF v_election.archived_at IS NOT NULL OR clock_timestamp()>=v_election.voting_start_date
   OR EXISTS(SELECT 1 FROM public.votes WHERE election_id=p_election_id)
   OR EXISTS(SELECT 1 FROM public.election_settlements WHERE election_id=p_election_id)
 THEN RAISE EXCEPTION 'Não é permitido modificar cadeiras após o início da votação.' USING ERRCODE='55000'; END IF;
 UPDATE public.elections SET seats_available=p_seats WHERE id=p_election_id;
 PERFORM public.justice_write_audit('election.seats_changed','election',p_election_id,
   to_jsonb(v_election),jsonb_build_object('seats_available',p_seats),
   'Quantidade de cadeiras definida pelo Admin antes da votação.');
 RETURN jsonb_build_object('success',true,'seats_available',p_seats);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_election_seats(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_election_seats(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.manage_electoral_calendar(p_election_id uuid, p_data jsonb)
 RETURNS elections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 old_row public.elections%rowtype;
 result public.elections%rowtype;
 d public.elections%rowtype;
begin
 perform private.assert_electoral_management();
 if jsonb_typeof(p_data) is distinct from 'object'
  or p_data-array['name','description','election_type_id','candidacy_start_date','candidacy_end_date','voting_start_date','voting_end_date','seats_available']<>'{}' then
  raise exception 'Informe apenas os dados do calendário eleitoral.' using errcode='22023';
 end if;
 if length(btrim(coalesce(p_data->>'name','')))<5 then
  raise exception 'Informe um nome de eleição com pelo menos 5 caracteres.' using errcode='22023';
 end if;
 if nullif(p_data->>'election_type_id','') is null then
  raise exception 'Selecione o tipo de eleição.' using errcode='22023';
 end if;
 begin
  d.election_type_id:=(p_data->>'election_type_id')::uuid;
 exception when invalid_text_representation then
  raise exception 'Selecione um tipo de eleição válido.' using errcode='22023';
 end;
 if not exists(select 1 from public.election_types where id=d.election_type_id) then
  raise exception 'O tipo de eleição selecionado não está mais disponível. Selecione outro tipo.' using errcode='22023';
 end if;
 begin
  d:=jsonb_populate_record(null::public.elections,p_data);
 exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
  raise exception 'Informe datas e horários válidos para todas as etapas, no horário de Brasília.' using errcode='22023';
 end;
 d.name:=btrim(d.name);
 if exists(select 1 from public.election_types where id=d.election_type_id and name in ('Senador','Deputado')) then
   if d.seats_available is null or d.seats_available<1 or
     (select case when name='Senador' then d.seats_available>81 else d.seats_available>513 end from public.election_types where id=d.election_type_id)
   then raise exception 'Informe a quantidade de cadeiras (Senador: 1 a 81; Deputado: 1 a 513).' using errcode='22023'; end if;
 else d.seats_available:=null;
 end if;
 if d.candidacy_start_date is null or d.candidacy_end_date is null or d.voting_start_date is null or d.voting_end_date is null
  or not isfinite(d.candidacy_start_date) or not isfinite(d.candidacy_end_date)
  or not isfinite(d.voting_start_date) or not isfinite(d.voting_end_date) then
  raise exception 'Preencha as quatro datas e horários do calendário eleitoral.' using errcode='22023';
 end if;
 if d.candidacy_start_date<=clock_timestamp() then
  raise exception 'O início das candidaturas deve estar no futuro, no horário de Brasília.' using errcode='22023';
 end if;
 if d.candidacy_end_date<=d.candidacy_start_date then
  raise exception 'O fim das candidaturas deve ser posterior ao início das candidaturas.' using errcode='22023';
 end if;
 -- Adjacent phases are valid: candidacy closes exactly when voting opens.
 -- The existing phase trigger already treats the candidacy end as exclusive.
 if d.voting_start_date<d.candidacy_end_date then
  raise exception 'A votação deve começar no mesmo horário ou depois do fim das candidaturas.' using errcode='22023';
 end if;
 if d.voting_end_date<=d.voting_start_date then
  raise exception 'O fim da votação deve ser posterior ao início da votação.' using errcode='22023';
 end if;
 if p_election_id is not null then
  select * into old_row from public.elections where id=p_election_id for update;
  if not found or old_row.archived_at is not null then
   raise exception 'Esta eleição não está mais disponível para edição.' using errcode='22023';
  end if;
  if old_row.candidacy_start_date<=clock_timestamp()
   or exists(select 1 from public.candidates where election_id=p_election_id)
   or exists(select 1 from public.votes where election_id=p_election_id) then
   raise exception 'O calendário de uma eleição iniciada ou com candidaturas não pode ser alterado por esta ação.' using errcode='22023';
  end if;
  update public.elections set name=d.name,description=d.description,election_type_id=d.election_type_id,
   candidacy_start_date=d.candidacy_start_date,candidacy_end_date=d.candidacy_end_date,
   voting_start_date=d.voting_start_date,voting_end_date=d.voting_end_date,seats_available=d.seats_available
   where id=p_election_id returning * into result;
 else
  insert into public.elections(name,description,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,seats_available,status)
   values(d.name,d.description,d.election_type_id,d.candidacy_start_date,d.candidacy_end_date,d.voting_start_date,d.voting_end_date,d.seats_available,'Scheduled') returning * into result;
 end if;
 perform economy_private.audit('electoral_calendar_managed','elections',result.id::text,to_jsonb(old_row),to_jsonb(result),'Organização institucional do calendário eleitoral.',auth.uid());
 return result;
end; $function$
;

CREATE OR REPLACE FUNCTION private.settle_election_offices(p_election_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_term_end := coalesce(v_election.original_term_ends_at, v_election.voting_end_date + interval '1 month');

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
  elsif v_office = 'Presidente' or (v_office = 'Senador' and coalesce(v_election.seats_available,1)=1) then
    select count(*) into v_top_count
    from public.get_election_results(p_election_id) result
    where result.vote_count = v_top_votes;
    if v_top_count <> 1 then v_status := 'tied'; end if;
  end if;

  if v_election.extraordinary and (v_term_end<=clock_timestamp() or not exists(select 1 from public.government_terms where id=v_election.government_id and ended_at is null and is_interim)) then
    v_status:='unsupported';
  elsif v_election.election_mode='indirect' and v_total<v_election.quorum_min_votes then
    v_status:='no_votes';
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
      limit (case when v_office in ('Senador','Deputado') then coalesce(v_election.seats_available,2147483647) else 1 end)
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
        and deleted_at is null;

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
        order by case when house.id=case when v_office='Deputado' then 'a1b2c3d4-e5f6-7890-1234-567890abcdef'::uuid else 'fedcba09-8765-4321-0987-654321fedcba'::uuid end then 0 else 1 end,house.name,house.id limit 1;
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
          and deleted_at is null;
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
    jsonb_build_object('full_result', v_results, 'engine_version', '2.1.0','seats_available',v_election.seats_available)
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
$function$
;

COMMIT;