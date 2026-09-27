BEGIN;
ALTER TABLE public.elections
 ADD COLUMN extraordinary boolean NOT NULL DEFAULT false,
 ADD COLUMN election_mode text NOT NULL DEFAULT 'direct' CHECK(election_mode IN ('direct','indirect')),
 ADD COLUMN government_id uuid REFERENCES public.government_terms(id),
 ADD COLUMN original_term_ends_at timestamptz,
 ADD COLUMN electorate_ids uuid[] NOT NULL DEFAULT '{}',
 ADD COLUMN quorum_min_votes integer NOT NULL DEFAULT 0 CHECK(quorum_min_votes>=0);
CREATE INDEX elections_government_idx ON public.elections(government_id) WHERE extraordinary;

CREATE OR REPLACE FUNCTION public.can_vote_in_election(p_election_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.elections e WHERE e.id=p_election_id AND (
  e.election_mode='direct' OR (auth.uid()=ANY(e.electorate_ids) AND EXISTS(SELECT 1 FROM public.parliament_members m
    WHERE m.user_id=auth.uid() AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)))));
$$;
REVOKE ALL ON FUNCTION public.can_vote_in_election(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_vote_in_election(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.guard_indirect_vote() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.elections%rowtype;
BEGIN
 SELECT * INTO e FROM public.elections WHERE id=new.election_id;
 IF e.election_mode='indirect' AND (NOT new.voter_id=ANY(e.electorate_ids) OR NOT EXISTS(
  SELECT 1 FROM public.parliament_members m WHERE m.user_id=new.voter_id AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id))) THEN
  RAISE EXCEPTION 'Esta eleição indireta é exclusiva dos parlamentares elegíveis do Congresso.' USING errcode='42501';
 END IF;
 RETURN new;
END; $$;
REVOKE ALL ON FUNCTION private.guard_indirect_vote() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_indirect_vote BEFORE INSERT OR UPDATE OF election_id,voter_id ON public.votes FOR EACH ROW EXECUTE FUNCTION private.guard_indirect_vote();

CREATE OR REPLACE FUNCTION private.call_extraordinary_election(p_government_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g public.government_terms%rowtype; cfg jsonb; et uuid; eid uuid; electorate uuid[]; c_hours numeric; v_hours numeric; remaining_hours numeric; quorum_size integer:=0;
BEGIN
 SELECT * INTO g FROM public.government_terms WHERE id=p_government_id AND ended_at IS NULL FOR UPDATE;
 IF g.id IS NULL OR NOT g.is_interim OR g.term_ends_at<=clock_timestamp()+interval '2 minutes' THEN RAISE EXCEPTION 'Não há mandato interino com prazo disponível para convocar a eleição.'; END IF;
 IF g.extraordinary_election_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.election_settlements WHERE election_id=g.extraordinary_election_id) THEN RETURN g.extraordinary_election_id; END IF;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules';
 SELECT id INTO et FROM public.election_types WHERE name='Presidente' ORDER BY id LIMIT 1;
 IF et IS NULL THEN RAISE EXCEPTION 'Configure o tipo eleitoral Presidencial antes da convocação.'; END IF;
 IF g.extraordinary_mode='indirect' THEN
  SELECT coalesce(array_agg(DISTINCT m.user_id),'{}') INTO electorate FROM public.parliament_members m WHERE m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
  IF cardinality(electorate)=0 THEN RAISE EXCEPTION 'O Congresso ainda não possui parlamentares aptos para esta eleição indireta.'; END IF;
  quorum_size:=floor(cardinality(electorate)*coalesce((cfg->>'indirect_quorum_numerator')::numeric,1)/greatest(1,coalesce((cfg->>'indirect_quorum_denominator')::numeric,2)))+1;
 END IF;
 remaining_hours:=extract(epoch FROM g.term_ends_at-clock_timestamp())/3600;
 c_hours:=least(greatest(0.01,coalesce((cfg->>'candidacy_hours')::numeric,12)),remaining_hours*0.4);
 v_hours:=least(greatest(0.01,coalesce((cfg->>'voting_hours')::numeric,12)),remaining_hours*0.4);
 INSERT INTO public.elections(name,description,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,
  extraordinary,election_mode,government_id,original_term_ends_at,electorate_ids,quorum_min_votes)
 VALUES('Eleição Presidencial Extraordinária '||CASE WHEN g.extraordinary_mode='direct' THEN 'Direta' ELSE 'Indireta' END,
  'Eleição para completar o mandato original. '||CASE WHEN g.extraordinary_mode='direct' THEN 'Votação popular.' ELSE 'Votação exclusiva do Congresso. Quórum mínimo: '||quorum_size||' votos.' END,
  et,clock_timestamp(),clock_timestamp()+c_hours*interval '1 hour',clock_timestamp()+c_hours*interval '1 hour',clock_timestamp()+(c_hours+v_hours)*interval '1 hour',
  true,g.extraordinary_mode,g.id,g.term_ends_at,coalesce(electorate,'{}'),quorum_size) RETURNING id INTO eid;
 UPDATE public.government_terms SET extraordinary_election_id=eid WHERE id=g.id;
 INSERT INTO public.dou_entries(title,summary,content,type,source_id,legal_metadata)
 VALUES('Convocação de eleição presidencial extraordinária','Eleição '||g.extraordinary_mode||' para completar o mandato vigente.',
 'O vencedor exercerá a Presidência até '||g.term_ends_at::text||'.','Ato Executivo',eid,jsonb_build_object('government_id',g.id,'election_id',eid,'mode',g.extraordinary_mode,'quorum',quorum_size,'term_ends_at',g.term_ends_at));
 PERFORM public.justice_write_audit('executive.extraordinary_election','election',eid,NULL,jsonb_build_object('government_id',g.id,'mode',g.extraordinary_mode),'Convocação extraordinária.');
 RETURN eid;
END; $$;
REVOKE ALL ON FUNCTION private.call_extraordinary_election(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.call_extraordinary_election() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE g uuid;
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.get_user_role(auth.uid()),'') NOT IN ('Presidente','Admin') THEN RAISE EXCEPTION 'A convocação exige a chefia do Executivo.' USING errcode='42501'; END IF;
 SELECT id INTO g FROM public.government_terms WHERE ended_at IS NULL;
 RETURN private.call_extraordinary_election(g);
END; $$;
REVOKE ALL ON FUNCTION public.call_extraordinary_election() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.call_extraordinary_election() TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_executive_transition_rules(p_rules jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb; key text;
BEGIN
 IF NOT coalesce(public.is_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Somente Admin pode configurar os prazos institucionais.' USING errcode='42501'; END IF;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_transition_rules' FOR UPDATE;
 FOR key IN SELECT jsonb_object_keys(p_rules) LOOP
  IF key NOT IN ('direct_call_hours','indirect_call_hours','candidacy_hours','voting_hours','indirect_quorum_numerator','indirect_quorum_denominator','administrative_term_days') THEN RAISE EXCEPTION 'Parâmetro institucional desconhecido.'; END IF;
  IF (p_rules->>key)::numeric<=0 OR (p_rules->>key)::numeric>720 OR (p_rules->>key)::numeric<>trunc((p_rules->>key)::numeric) THEN RAISE EXCEPTION 'Informe valores inteiros entre 1 e 720.'; END IF;
 END LOOP;
 cfg:=cfg||p_rules;
 IF (cfg->>'indirect_quorum_numerator')::integer>=(cfg->>'indirect_quorum_denominator')::integer THEN RAISE EXCEPTION 'O quórum deve ser uma fração entre zero e um.'; END IF;
 UPDATE public.system_settings SET value=cfg,updated_at=clock_timestamp() WHERE key='executive_transition_rules';
 PERFORM public.justice_write_audit('executive.rules','system_settings',NULL,NULL,cfg,'Prazos de sucessão alterados.');
 RETURN cfg;
END; $$;
REVOKE ALL ON FUNCTION public.configure_executive_transition_rules(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_executive_transition_rules(jsonb) TO authenticated;

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
  elsif v_office = 'Presidente' or lower(coalesce(v_election.voting_system, '')) = 'majoritarian' then
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
$function$
;

CREATE OR REPLACE FUNCTION private.process_electoral_calendar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare election record; epoch timestamptz;
begin
 select (value->>'started_at')::timestamptz into epoch from public.system_settings where key='electoral_notification_epoch';
 for election in select e.id from public.elections e where lower(coalesce(e.status,'')) not in ('cancelled','canceled','cancelada') and e.voting_end_date>=epoch and e.status is distinct from case when now()<e.candidacy_start_date then 'Scheduled' when now()<e.candidacy_end_date then 'Candidacy' when now()<e.voting_start_date then 'Scheduled' when now()<e.voting_end_date then 'Voting' else 'Finished' end for update skip locked loop
  update public.elections set status=status where id=election.id;
 end loop;
 for election in select e.id from public.elections e where lower(coalesce(e.status,'')) not in ('cancelled','canceled','cancelada') and e.voting_end_date>=epoch and e.voting_end_date<clock_timestamp() and not exists(select 1 from public.election_settlements s where s.election_id=e.id) order by e.voting_end_date for update skip locked loop
  begin perform private.settle_election_offices(election.id); perform private.refresh_office_assignment_snapshot();
  exception when others then raise warning 'Falha na apuração da eleição %: % (%)',election.id,sqlerrm,sqlstate; end;
 end loop;
 for election in select g.id from public.government_terms g where g.ended_at is null and g.is_interim and g.term_ends_at>clock_timestamp()+interval '2 minutes'
 and (g.extraordinary_election_id is null and g.call_deadline<=clock_timestamp() or exists(select 1 from public.election_settlements s where s.election_id=g.extraordinary_election_id and s.status in ('no_votes','tied'))) for update skip locked loop
  begin perform private.call_extraordinary_election(election.id);
  exception when others then raise warning 'Convocação extraordinária pendente: % (%)',sqlerrm,sqlstate;end;
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.cast_vote(p_election_id uuid, p_candidate_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not public.can_vote_in_election(p_election_id) then raise exception 'Esta eleição indireta é exclusiva dos parlamentares elegíveis do Congresso.' using errcode='42501';end if;
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
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
