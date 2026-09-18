begin;
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
$function$;

revoke all on function private.settle_election_offices(uuid) from public,anon,authenticated;
create or replace function public.settle_election_offices(p_election_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.is_admin(auth.uid()),false) then raise exception 'Somente Admin pode solicitar uma apuração manual.' using errcode='42501'; end if;
 return private.settle_election_offices(p_election_id);
end $$;
CREATE OR REPLACE FUNCTION public.acknowledge_role_change(p_notification_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 UPDATE public.notifications SET metadata=coalesce(metadata,'{}')||jsonb_build_object('popup_shown_at',clock_timestamp(),'popup_pending',false),is_read=true
 WHERE id=p_notification_id AND user_id=auth.uid() AND type in('role_changed','office_awarded','election_candidacy_open','election_voting_open','election_result_published','institutional_result') AND metadata->>'popup_shown_at' IS NULL;
 RETURN found;
END $function$;

insert into public.system_settings(key,value,description) values('electoral_notification_epoch',jsonb_build_object('started_at',clock_timestamp()),'Início da propagação automática das fases eleitorais; preserva eleições históricas.') on conflict(key) do nothing;
create unique index institutional_notification_once on public.notifications(user_id,(metadata->>'event_key')) where type in ('election_candidacy_open','election_voting_open','election_result_published') and metadata->>'event_key' is not null;
create function private.notify_electoral_phase() returns trigger language plpgsql security definer set search_path='' as $$
declare phase text; body text; details jsonb;
begin
 if new.status not in ('Candidacy','Voting') or (tg_op='UPDATE' and new.status=old.status) then return new; end if;
 phase:=case when new.status='Candidacy' then 'election_candidacy_open' else 'election_voting_open' end;
 body:=case when new.status='Candidacy' then 'Candidaturas abertas: ' else 'Votação aberta: ' end||new.name||'.';
 details:=jsonb_build_object('event_key',phase||':'||new.id,'election_id',new.id,'election_name',new.name,'candidacy_end_at',new.candidacy_end_date,'voting_start_at',new.voting_start_date,'voting_end_at',new.voting_end_date,'popup_pending',true);
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,phase,body,'/services/elections',details from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration') on conflict do nothing;
 return new;
end $$;
revoke all on function private.notify_electoral_phase() from public,anon,authenticated;
create trigger notify_electoral_phase after insert or update on public.elections for each row execute function private.notify_electoral_phase();
create function private.notify_electoral_result() returns trigger language plpgsql security definer set search_path='' as $$
declare election public.elections%rowtype; winners jsonb; body text;
begin
 select * into election from public.elections where id=new.election_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'avatar_url',p.avatar_url,'office_role',w->>'office_role','votes',w->'votes','party',case when party.id is null then null else jsonb_build_object('id',party.id,'name',party.name,'acronym',party.acronym,'logo_url',party.logo_url) end)),'[]') into winners
 from jsonb_array_elements(new.result) w join public.profiles p on p.id=(w->>'profile_id')::uuid
 left join public.candidates c on c.id=(w->>'candidate_id')::uuid left join public.political_parties party on party.id=c.party_id;
 body:='Resultado publicado: '||election.name||'. '||case new.status when 'settled' then 'Conheça os eleitos.' when 'tied' then 'Empate na apuração; não houve posse automática.' when 'no_votes' then 'Não houve votos válidos.' else 'Consulte a situação da apuração.' end;
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,'election_result_published',body,'/services/elections',jsonb_build_object('event_key','election_result_published:'||new.election_id,'election_id',new.election_id,'election_name',election.name,'status',new.status,'winners',winners,'finished_at',election.voting_end_date,'popup_pending',true)
 from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration') on conflict do nothing;
 return new;
end $$;
revoke all on function private.notify_electoral_result() from public,anon,authenticated;
create trigger notify_electoral_result after insert on public.election_settlements for each row execute function private.notify_electoral_result();

create function private.process_electoral_calendar() returns void language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function private.process_electoral_calendar() from public,anon,authenticated;
select cron.schedule('electoral-calendar-events','10 seconds','select private.process_electoral_calendar()');
notify pgrst,'reload schema';
commit;
