BEGIN;
-- Official salaries remain in system_settings; government_rules is their
-- structured legal projection, consumed by the existing law-effect engine.
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition)
SELECT 'official_salary_'||md5(r->>'role'),CASE WHEN (r->>'valid_from')::timestamptz>clock_timestamp() THEN (r->>'previous_amount')::numeric ELSE (r->>'amount')::numeric END,'BRL','Remuneração semanal: '||(r->>'role'),'policy',true,jsonb_build_object('operation','official_salary','role',r->>'role','audience','all')
FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')r WHERE s.key='official_salaries' ON CONFLICT(rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION private.apply_salary_legal_effect(p_effect_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.law_effects%rowtype;r public.government_rules%rowtype;b public.bills%rowtype;cfg jsonb;previous jsonb;entry jsonb;idx int;effective timestamptz;BEGIN
 SELECT * INTO e FROM public.law_effects WHERE id=p_effect_id FOR UPDATE;
 IF e.status NOT IN('draft','scheduled') THEN RETURN;END IF;
 PERFORM private.validate_legal_measure('policy',e.effect_data,e.source_kind);
 SELECT * INTO b FROM public.bills WHERE id=e.source_id;
 IF e.source_kind<>'bill' OR b.status NOT IN('Sancionado','Promulgado') OR NOT coalesce((b.institutional_data->>'requires_bicameral')::boolean,false) THEN RAISE EXCEPTION 'O reajuste exige lei sancionada após tramitação nas duas Casas.';END IF;
 IF (SELECT count(*) FROM (SELECT DISTINCT ON(v.house_id)v.house_id,v.status,v.result FROM public.parliament_votings v WHERE v.related_id=b.id AND v.type='bill' AND v.house_id IN('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') ORDER BY v.house_id,v.created_at DESC,v.id DESC) votes WHERE votes.status='closed' AND coalesce((votes.result->>'approved')::boolean,false))<>2 THEN RAISE EXCEPTION 'Esta matéria exige aprovação legislativa na Câmara e no Senado.';END IF;
 effective:=coalesce(e.valid_from,clock_timestamp());
 IF effective>clock_timestamp() THEN UPDATE public.law_effects SET status='scheduled' WHERE id=e.id;RETURN;END IF;
 effective:=greatest(effective,clock_timestamp());
 SELECT value INTO cfg FROM public.system_settings WHERE key='official_salaries' FOR UPDATE;
 SELECT value,ordinality::int-1 INTO previous,idx FROM jsonb_array_elements(cfg->'roles') WITH ORDINALITY WHERE value->>'role'=e.effect_data->'definition'->>'role';
 IF previous IS NULL THEN RAISE EXCEPTION 'O cargo remunerado não existe mais no catálogo oficial.';END IF;
 SELECT * INTO r FROM public.government_rules WHERE rule_key=e.effect_key FOR UPDATE;
 entry:=previous||jsonb_build_object('previous_amount',CASE WHEN (previous->>'valid_from')::timestamptz>clock_timestamp() THEN (previous->>'previous_amount')::numeric ELSE (previous->>'amount')::numeric END,'amount',e.effect_value,'valid_from',effective,'version',coalesce((previous->>'version')::int,0)+1,'legal_source_id',b.id,'effect_id',e.id,'updated_at',clock_timestamp());
 UPDATE public.system_settings SET value=jsonb_set(cfg,ARRAY['roles',idx::text],entry),updated_at=clock_timestamp() WHERE key='official_salaries';
 UPDATE public.government_rules SET numeric_value=e.effect_value,is_active=true,valid_from=effective,valid_until=NULL,source_kind='bill',source_id=b.id,active_effect_id=e.id,version=version+1,updated_at=clock_timestamp() WHERE rule_key=e.effect_key;
 UPDATE public.law_effects SET previous_snapshot=to_jsonb(r)||jsonb_build_object('salary_entry',previous),status='active',activated_at=clock_timestamp(),valid_from=effective,updated_at=clock_timestamp() WHERE id=e.id;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) VALUES('legal_effect_activated','government','law_effects',e.id,e.configured_by,jsonb_build_object('ruleKey',e.effect_key,'kind','salary','role',entry->>'role','previousValue',entry->'previous_amount','newValue',e.effect_value,'sourceId',b.id,'validFrom',effective),'legal-effect:'||e.id);
 PERFORM economy_private.audit('official_salary_changed_by_law','system_settings',entry->>'role',previous,entry,'Remuneração vigente após aprovação bicameral e sanção.',e.configured_by);
END $$;
REVOKE ALL ON FUNCTION private.apply_salary_legal_effect(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.propose_official_salary(p_role text,p_amount numeric,p_expected_version int,p_justification text,p_valid_from timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cfg jsonb;old jsonb;b public.bills%rowtype;e public.law_effects%rowtype;holders int;current_amount numeric;data jsonb;BEGIN
 IF auth.uid() IS NULL OR (public.get_authority_role(auth.uid()) IS DISTINCT FROM 'Presidente' AND NOT public.has_full_admin_access()) THEN RAISE EXCEPTION 'A proposta de remuneração exige autoridade presidencial.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(coalesce(p_justification,'')))<40 OR length(p_justification)>10000 THEN RAISE EXCEPTION 'Apresente justificativa entre 40 e 10.000 caracteres.';END IF;
 SELECT value INTO cfg FROM public.system_settings WHERE key='official_salaries' FOR SHARE;
 SELECT r INTO old FROM jsonb_array_elements(cfg->'roles')r WHERE r->>'role'=p_role;
 IF old IS NULL OR p_expected_version IS DISTINCT FROM (old->>'version')::int THEN RAISE EXCEPTION 'O catálogo de remunerações foi alterado. Confira a versão atual antes de propor.';END IF;
 IF p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount<0 OR p_amount>1000000 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Informe um valor de zero a um milhão, com até duas casas decimais.';END IF;
 current_amount:=CASE WHEN (old->>'valid_from')::timestamptz>clock_timestamp() THEN (old->>'previous_amount')::numeric ELSE (old->>'amount')::numeric END;
 IF p_valid_from IS NOT NULL AND NOT isfinite(p_valid_from) THEN RAISE EXCEPTION 'Informe uma data de vigência válida.';END IF;
 IF p_amount=current_amount THEN RAISE EXCEPTION 'O valor proposto já é a remuneração vigente.';END IF;
 SELECT count(*) INTO holders FROM public.profiles WHERE public.canonical_official_role(role)=p_role AND deleted_at IS NULL AND onboarding_completed;
 b:=public.propose_parliament_bill('Remuneração semanal de '||p_role,'Altera a remuneração semanal de '||p_role||' de R$ '||current_amount||' para R$ '||p_amount||'.',
 'Art. 1º A remuneração semanal do cargo de '||p_role||' passa a ser de R$ '||p_amount||'.'||E'\nArt. 2º O reajuste aplica-se aos pagamentos realizados após a vigência, preservados os pagamentos anteriores.'||E'\nJustificativa: '||btrim(p_justification),'PL','a1b2c3d4-e5f6-7890-1234-567890abcdef');
 data:=jsonb_build_object('kind','policy','action','change','name','Remuneração semanal: '||p_role,'rule_key','official_salary_'||md5(p_role),'value',p_amount,'explanation',btrim(p_justification),'valid_from',p_valid_from,'definition',jsonb_build_object('operation','official_salary','role',p_role,'audience','all'));
 e:=public.configure_structured_law_effect('bill',b.id,data);
 UPDATE public.bills SET institutional_data=coalesce(institutional_data,'{}')||jsonb_build_object('salary_previous_amount',current_amount,'salary_impact_snapshot',jsonb_build_object('holders',holders,'weekly_difference',(p_amount-current_amount)*holders),'salary_expected_version',p_expected_version) WHERE id=b.id;
 RETURN jsonb_build_object('bill_id',b.id,'effect_id',e.id,'previous_amount',current_amount,'amount',p_amount,'current_holders',holders,'weekly_difference',(p_amount-current_amount)*holders,'status','Em tramitação');
END $$;
REVOKE ALL ON FUNCTION public.propose_official_salary(text,numeric,int,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_official_salary(text,numeric,int,text,timestamptz) TO authenticated;
ALTER TABLE public.election_office_assignments DROP CONSTRAINT election_office_assignments_status_check;
ALTER TABLE public.election_office_assignments DROP CONSTRAINT IF EXISTS election_office_assignments_status_check;
ALTER TABLE public.election_office_assignments ADD CONSTRAINT election_office_assignments_status_check CHECK(status IN('pending','active','expired','revoked'));
CREATE INDEX IF NOT EXISTS election_inauguration_due ON public.election_office_assignments(term_starts_at,election_id) WHERE status='pending';

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
  v_term_start := v_election.voting_end_date + interval '24 hours';
  v_term_end := coalesce(v_election.original_term_ends_at, v_term_start + interval '1 month');

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

  if v_election.extraordinary and (v_term_end<=greatest(clock_timestamp(),v_term_start) or not exists(select 1 from public.government_terms where id=v_election.government_id and ended_at is null and is_interim)) then
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
        term_starts_at, term_ends_at, assigned_by, status, metadata
      ) values (
        p_election_id, v_winner.candidate_id, v_winner.user_id, v_office,
        v_winner.vote_count, v_term_start, v_term_end, v_actor, 'pending',
        jsonb_build_object('result_revision', 1,'inauguration_delay_hours',24)
      );

      if v_office = 'Presidente' and v_winner.vice_candidate_id is not null then
        v_winners := v_winners || jsonb_build_array(jsonb_build_object(
          'candidate_id', v_winner.candidate_id,
          'profile_id', v_winner.vice_candidate_id,
          'office_role', 'Vice-Presidente',
          'votes', v_winner.vote_count
        ));
        insert into public.election_office_assignments (
          election_id, candidate_id, profile_id, office_role, votes_received,
          term_starts_at, term_ends_at, assigned_by, status, metadata
        ) values (
          p_election_id, v_winner.candidate_id, v_winner.vice_candidate_id,
          'Vice-Presidente', v_winner.vote_count, v_term_start, v_term_end,
          v_actor, 'pending', jsonb_build_object('result_revision', 1, 'ticket', true,'inauguration_delay_hours',24)
        );
      end if;
    end loop;


  end if;

  insert into public.election_settlements (
    election_id, status, office_role, total_valid_votes, result_revision,
    result, processed_by, metadata
  ) values (
    p_election_id, v_status, v_office, v_total, 1, v_winners, v_actor,
    jsonb_build_object('full_result', v_results, 'engine_version', '2.2.0','inauguration_at',v_term_start,'inauguration_delay_hours',24,'seats_available',v_election.seats_available)
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

CREATE OR REPLACE FUNCTION private.activate_due_elected_offices() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;a public.election_office_assignments%rowtype;old public.election_office_assignments%rowtype;house uuid;BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('govrp:elected-inauguration')) THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 FOR e IN SELECT election_id,min(term_starts_at) start_at FROM public.election_office_assignments WHERE status='pending' AND term_starts_at<=clock_timestamp() GROUP BY election_id ORDER BY min(term_starts_at),election_id LOOP
  -- A newer official mandate supersedes a delayed obsolete result.
  IF EXISTS(SELECT 1 FROM public.election_office_assignments pending JOIN public.election_office_assignments current_term ON current_term.office_role=pending.office_role AND current_term.status='active' AND current_term.term_starts_at>pending.term_starts_at WHERE pending.election_id=e.election_id AND pending.status='pending') THEN
   UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Resultado superado por mandato posterior') WHERE election_id=e.election_id AND status='pending';CONTINUE;
  END IF;
  FOR a IN SELECT * FROM public.election_office_assignments WHERE election_id=e.election_id AND status='pending' ORDER BY CASE office_role WHEN 'Presidente' THEN 0 WHEN 'Vice-Presidente' THEN 1 ELSE 2 END,id FOR UPDATE LOOP
   IF a.term_ends_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=a.profile_id AND deleted_at IS NULL AND role<>'Admin') THEN
    UPDATE public.election_office_assignments SET status='revoked',ended_at=clock_timestamp(),metadata=metadata||jsonb_build_object('reason','Prazo ou elegibilidade encerrados antes da posse') WHERE id=a.id;CONTINUE;
   END IF;
   UPDATE public.election_office_assignments SET status='active',assigned_at=clock_timestamp(),metadata=metadata||jsonb_build_object('inaugurated_at',clock_timestamp()) WHERE id=a.id;
   PERFORM set_config('govrp.role_change_reason','Posse eleitoral 24 horas após a apuração oficial',true);
   UPDATE public.profiles SET role=a.office_role,titles=array(SELECT DISTINCT unnest(coalesce(titles,'{}')||ARRAY[a.office_role])),manual_role_override=false,role_assigned_at=clock_timestamp(),role_assigned_by=a.assigned_by,updated_at=clock_timestamp() WHERE id=a.profile_id;
   IF a.office_role IN('Deputado','Senador') THEN
    house:=CASE WHEN a.office_role='Deputado' THEN 'a1b2c3d4-e5f6-7890-1234-567890abcdef'::uuid ELSE 'fedcba09-8765-4321-0987-654321fedcba'::uuid END;
    INSERT INTO public.parliament_members(user_id,house_id,party_id,term_start_date,term_end_date)
    VALUES(a.profile_id,house,(SELECT party_id FROM public.candidates WHERE id=a.candidate_id),a.term_starts_at::date,a.term_ends_at::date)
    ON CONFLICT(user_id,house_id) DO UPDATE SET party_id=excluded.party_id,term_start_date=excluded.term_start_date,term_end_date=excluded.term_end_date;
   END IF;
   INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(a.profile_id,'office_awarded','Sua posse como '||a.office_role||' foi oficializada.','/dashboard',jsonb_build_object('assignment_id',a.id,'election_id',a.election_id,'office_role',a.office_role,'term_start_at',a.term_starts_at,'term_end_at',a.term_ends_at));
   INSERT INTO public.election_audit_log(election_id,actor_id,actor_role,action,entity_type,entity_id,after_state,metadata)
   VALUES(a.election_id,a.assigned_by,'Sistema','elected_inauguration','assignment',a.id::text,jsonb_build_object('office_role',a.office_role,'profile_id',a.profile_id),jsonb_build_object('scheduled_at',a.term_starts_at,'effective_at',clock_timestamp()));
  END LOOP;
  -- Outgoing members retain their office until the actual inauguration.
  FOR old IN SELECT previous.* FROM public.election_office_assignments previous WHERE previous.status='active' AND previous.election_id<>e.election_id
   AND previous.office_role IN(SELECT office_role FROM public.election_office_assignments WHERE election_id=e.election_id AND status='active')
   AND NOT EXISTS(SELECT 1 FROM public.election_office_assignments current_term WHERE current_term.election_id=e.election_id AND current_term.status='active' AND current_term.profile_id=previous.profile_id AND current_term.office_role=previous.office_role) FOR UPDATE LOOP
   UPDATE public.election_office_assignments SET status='expired',ended_at=clock_timestamp() WHERE id=old.id;
   UPDATE public.profiles SET role='Cidadão',titles=array_remove(coalesce(titles,'{}'),old.office_role),role_assigned_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=old.profile_id AND role=old.office_role AND NOT manual_role_override;
  END LOOP;
 END LOOP;
 PERFORM private.refresh_office_assignment_snapshot();
END $$;
REVOKE ALL ON FUNCTION private.activate_due_elected_offices() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.process_electoral_calendar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare election record; epoch timestamptz;
begin
 perform private.activate_due_elected_offices();
 perform private.maintain_institutional_calendar();
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
end $function$;

CREATE OR REPLACE FUNCTION public.reconcile_current_electoral_offices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.election_office_assignments%rowtype;
begin
 perform private.activate_due_elected_offices();
 if auth.uid() is null then raise exception 'Entre para sincronizar os mandatos.' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
 perform private.maintain_government_term();
 for a in select * from public.election_office_assignments where status='active' and term_ends_at<=clock_timestamp() for update loop
  update public.election_office_assignments set status='expired',ended_at=clock_timestamp() where id=a.id;
  perform set_config('govrp.role_change_reason','Encerramento do mandato eleitoral '||a.id,true);
  update public.profiles p set role='Cidadão',titles=array_remove(coalesce(titles,'{}'),a.office_role),role_assigned_at=clock_timestamp()
  where p.id=a.profile_id and p.role=a.office_role and not p.manual_role_override
   and not exists(select 1 from public.election_office_assignments current_office where current_office.profile_id=p.id and current_office.office_role=p.role and current_office.status='active' and current_office.term_ends_at>clock_timestamp())
   and not exists(select 1 from public.government_terms g where g.head_id=p.id and g.ended_at is null and g.term_ends_at>clock_timestamp());
 end loop;
 perform private.refresh_office_assignment_snapshot();
end $function$;

CREATE OR REPLACE FUNCTION public.get_election_result_bundle(p_notification_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n public.notifications%rowtype;e public.elections%rowtype;sections jsonb;ids jsonb;
begin
 select * into n from public.notifications where id=p_notification_id and user_id=auth.uid() and type='election_result_published';
 if n.id is null then raise exception 'Resultado não disponível para esta conta.' using errcode='42501';end if;
 select * into e from public.elections where id::text=n.metadata->>'election_id';
 select coalesce(jsonb_agg(jsonb_build_object('id',el.id,'name',el.name,'office',coalesce(st.office_role,t.name),'status',st.status,'participation',public.get_election_participation(el.id),'inauguration_at',coalesce((st.metadata->>'inauguration_at')::timestamptz,(SELECT min(term_starts_at) FROM public.election_office_assignments WHERE election_id=el.id)),
  'winners',coalesce((select jsonb_agg(coalesce(case when w->>'office_role'='Vice-Presidente' then c.vice_identity_snapshot else c.identity_snapshot end,'{}')||jsonb_build_object('ticket_id',c.id,'office_role',w->>'office_role','profile_id',w->>'profile_id','votes',w->'votes','percentage',case when st.total_valid_votes>0 then round((w->>'votes')::numeric/st.total_valid_votes*100,2) else 0 end,'electoral_number',c.electoral_number)) from jsonb_array_elements(st.result) w join public.candidates c on c.id=(w->>'candidate_id')::uuid),'[]'::jsonb)) order by case when coalesce(st.office_role,t.name)='Presidente' then 0 when coalesce(st.office_role,t.name)='Senador' then 1 else 2 end),'[]'::jsonb) into sections
 from public.elections el join public.election_types t on t.id=el.election_type_id left join public.election_settlements st on st.election_id=el.id
 where (el.id=e.id or (st.election_id is not null and el.voting_start_date=e.voting_start_date and el.voting_end_date=e.voting_end_date and el.extraordinary=e.extraordinary));
 select coalesce(jsonb_agg(no.id),'[]'::jsonb) into ids from public.notifications no where no.user_id=auth.uid() and no.type='election_result_published' and (no.id=n.id or no.metadata->>'election_id'=n.metadata->>'election_id' or no.metadata->>'election_id' in(select s->>'id' from jsonb_array_elements(sections)s));
 return jsonb_build_object('sections',sections,'notification_ids',ids,'server_now',clock_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION private.notify_electoral_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.elections%rowtype; winners jsonb;
begin
 select * into e from public.elections where id=new.election_id;
 select coalesce(jsonb_agg(coalesce(case when w->>'office_role'='Vice-Presidente' then c.vice_identity_snapshot else c.identity_snapshot end,'{}')||jsonb_build_object('office_role',w->>'office_role','votes',w->'votes','electoral_number',c.electoral_number,'percentage',case when new.total_valid_votes>0 then round((w->>'votes')::numeric/new.total_valid_votes*100,2) else 0 end)),'[]') into winners
 from jsonb_array_elements(new.result) w join public.candidates c on c.id=(w->>'candidate_id')::uuid;
 insert into public.notifications(user_id,type,content,link,metadata)
 select id,'election_result_published','Resultado publicado: '||e.name||'. Conheça a apuração no Portal Eleitoral.','/services/elections',jsonb_build_object('event_key','election_result_published:'||new.election_id,'election_id',new.election_id,'election_name',e.name,'status',new.status,'winners',winners,'finished_at',e.voting_end_date,'inauguration_at',new.metadata->>'inauguration_at','popup_pending',true)
 from public.profiles where deleted_at is null and (onboarding_completed or onboarding_mode='legacy_migration') on conflict do nothing;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.validate_legal_measure(p_kind text, p_data jsonb, p_source_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE d jsonb:=p_data->'definition'; n numeric; starts timestamptz; ends timestamptz; item text;
BEGIN
 IF p_kind='policy' AND d->>'operation'='official_salary' THEN
  IF p_source_kind<>'bill' THEN RAISE EXCEPTION 'Esta matéria exige aprovação legislativa nas duas Casas.';END IF;
  IF p_data->>'action'<>'change' OR p_data->>'rule_key' IS DISTINCT FROM 'official_salary_'||md5(d->>'role') THEN RAISE EXCEPTION 'Selecione um cargo do catálogo de remunerações.';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.system_settings cfg CROSS JOIN LATERAL jsonb_array_elements(cfg.value->'roles')r WHERE cfg.key='official_salaries' AND r->>'role'=d->>'role') THEN RAISE EXCEPTION 'Cargo remunerado não encontrado.';END IF;
  n:=(p_data->>'value')::numeric;
  IF n IS NULL OR n::text IN('NaN','Infinity','-Infinity') OR n<0 OR n>1000000 OR n<>round(n,2) OR nullif(p_data->>'valid_until','') IS NOT NULL THEN RAISE EXCEPTION 'Informe remuneração entre zero e um milhão, com até duas casas decimais, sem expiração automática.';END IF;
  RETURN;
 END IF;

 IF p_kind NOT IN('sanction','regulation','project') THEN
  PERFORM private.validate_legal_measure_base(p_kind,p_data,p_source_kind);
 ELSE
  IF p_source_kind<>'bill' THEN RAISE EXCEPTION 'Esta matéria exige aprovação legislativa.'; END IF;
  IF p_data->>'action' IS NULL OR p_data->>'action' NOT IN('create','change','revoke') THEN RAISE EXCEPTION 'Selecione criar, alterar ou revogar.'; END IF;
  n:=(p_data->>'value')::numeric;
  IF n IS NULL OR n<0 OR n::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe um valor válido para a medida.'; END IF;
  starts:=coalesce(nullif(p_data->>'valid_from','')::timestamptz,clock_timestamp()); ends:=nullif(p_data->>'valid_until','')::timestamptz;
  IF ends IS NOT NULL AND ends<=starts THEN RAISE EXCEPTION 'O término deve ser posterior ao início da vigência.'; END IF;
  IF p_kind='sanction' THEN
   IF coalesce(d->>'sanction_kind','') NOT IN('fine_fixed','fine_percentage','warning','regularization','business_suspension') OR coalesce(d->>'audience','') NOT IN('all','citizen','business','party') THEN RAISE EXCEPTION 'Selecione sanção e público suportados.'; END IF;
   IF length(trim(coalesce(d->>'infraction','')))<10 OR length(trim(coalesce(d->>'conditions','')))<10 THEN RAISE EXCEPTION 'Descreva a infração e as condições que o juiz deverá verificar.'; END IF;
   IF d->>'sanction_kind' IN('fine_fixed','fine_percentage') AND p_data->>'action'<>'revoke' AND n<=0 THEN RAISE EXCEPTION 'Informe valor positivo para a multa.'; END IF;
   IF d->>'sanction_kind' NOT IN('fine_fixed','fine_percentage') AND n<>0 THEN RAISE EXCEPTION 'Advertências, regularização e suspensão não têm cobrança. Informe zero no valor de referência.'; END IF;
   IF d->>'sanction_kind'='fine_fixed' AND (n<coalesce((d->>'minimum')::numeric,n) OR n>coalesce((d->>'maximum')::numeric,n)) THEN RAISE EXCEPTION 'O valor fixo precisa respeitar os limites da própria norma.'; END IF;
   IF d->>'sanction_kind'='fine_percentage' AND (n>1 OR coalesce(d->>'calculation_basis','') NOT IN('personal_balance','business_cash','business_revenue','party_treasury')) THEN RAISE EXCEPTION 'Informe percentual até 100%% e uma base financeira executável.'; END IF;
   IF d->>'sanction_kind'='fine_percentage' AND NOT ((d->>'audience'='citizen' AND d->>'calculation_basis'='personal_balance') OR (d->>'audience'='business' AND d->>'calculation_basis' IN('business_cash','business_revenue')) OR (d->>'audience'='party' AND d->>'calculation_basis'='party_treasury')) THEN RAISE EXCEPTION 'Selecione o público correspondente à base da multa percentual.'; END IF;
   IF d->>'sanction_kind'='business_suspension' AND (d->>'audience'<>'business' OR coalesce((d->>'duration_days')::int,0) NOT BETWEEN 1 AND 90) THEN RAISE EXCEPTION 'Suspensão empresarial exige público Empresas e duração de 1 a 90 dias.'; END IF;
   IF d ? 'minimum' AND (d->>'minimum')::numeric<0 OR d ? 'maximum' AND (d->>'maximum')::numeric<coalesce((d->>'minimum')::numeric,0) THEN RAISE EXCEPTION 'Confira os limites mínimo e máximo da multa.'; END IF;
   IF d ? 'recurrence_multiplier' AND (d->>'recurrence_multiplier')::numeric NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'A reincidência deve usar multiplicador entre 1 e 5, baseado em decisão definitiva.'; END IF;
   IF d ? 'late_interest_rate' AND (d->>'late_interest_rate')::numeric NOT BETWEEN 0 AND .01 THEN RAISE EXCEPTION 'Juros diários devem ficar entre 0 e 1%%.'; END IF;
  ELSIF p_kind='regulation' THEN
   IF coalesce(d->>'operation','') NOT IN('party_registration_fee','party_registration_restriction','party_donation_limit','party_donation_period','electoral_minimum_age','electoral_minimum_experience','electoral_party_requirement','media_ad_disclosure','media_political_ad_party','media_ad_restriction') THEN RAISE EXCEPTION 'Escolha uma operação integrada à plataforma.'; END IF;
   IF coalesce(d->>'audience','') NOT IN('all','citizen','business','party') THEN RAISE EXCEPTION 'Selecione o público da medida.'; END IF;
   IF d->>'operation'='party_donation_limit' AND n<=0 AND p_data->>'action'<>'revoke' THEN RAISE EXCEPTION 'Informe o limite positivo de doações.'; END IF;
   IF d->>'operation' IN('party_donation_period','media_ad_restriction') AND (ends IS NULL OR coalesce(d->>'scope_mode','') NOT IN('total','hours','weekdays','period')) THEN RAISE EXCEPTION 'Defina a vigência e o escopo da restrição temporária.'; END IF;
   IF d->>'operation' IN('electoral_minimum_age','electoral_minimum_experience') AND n<>trunc(n) THEN RAISE EXCEPTION 'Informe um número inteiro para tempo ou experiência mínima.'; END IF;
   IF d->>'operation'='electoral_minimum_age' AND n NOT BETWEEN 0 AND 3650 THEN RAISE EXCEPTION 'Idade de conta fora do limite de 0 a 3650 dias.'; END IF;
   IF d->>'operation'='electoral_minimum_experience' AND n>10000000 THEN RAISE EXCEPTION 'Experiência mínima fora do limite.'; END IF;
   IF d ? 'period_days' AND (d->>'period_days')::int NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'O período deve ter de 1 a 365 dias.'; END IF;
  ELSE
   IF coalesce(d->>'infrastructure_kind','') NOT IN('roads','energy','ports','airports','telecom','industry','health') OR NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=d->>'region_code') THEN RAISE EXCEPTION 'Selecione infraestrutura e estado cadastrados.'; END IF;
   IF p_data->>'action'<>'create' THEN RAISE EXCEPTION 'A obra autorizada preserva seu orçamento e histórico. Revise ou cancele a execução pelo painel governamental.'; END IF;
   IF n NOT BETWEEN 10000 AND 50000000 OR coalesce((d->>'construction_days')::int,0) NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Obras exigem orçamento entre R$ 10 mil e R$ 50 milhões e prazo de 1 a 90 dias.'; END IF;
   IF d->>'infrastructure_kind'='ports' AND NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=d->>'region_code' AND coastal) AND NOT EXISTS(SELECT 1 FROM public.world_map_places WHERE region_code=d->>'region_code' AND is_port) THEN RAISE EXCEPTION 'Selecione uma região com referência portuária cadastrada.'; END IF;
  END IF;
 END IF;
 IF p_kind IN('tax','fee','restriction') AND ((d->>'basis'='license' AND d->>'audience'='citizen') OR (d->>'basis' IN('document','transfer') AND d->>'audience'='business')) THEN RAISE EXCEPTION 'O público selecionado não participa desta atividade. Confira a base de cálculo.'; END IF;
 IF p_kind='regulation' AND ((d->>'operation' LIKE 'party_%' AND d->>'audience' NOT IN('all','party')) OR (d->>'operation' NOT LIKE 'party_%' AND d->>'audience' NOT IN('all','citizen'))) THEN RAISE EXCEPTION 'Escolha o público correspondente à atividade regulamentada.'; END IF;
 IF p_kind='penalty' AND d->>'audience' NOT IN('all','citizen') THEN RAISE EXCEPTION 'Penas criminais pessoais exigem público Cidadãos. Use sanções estruturadas para empresas ou partidos.'; END IF;
 IF d ? 'reference_id' AND NOT((d->>'reference_kind'='bill' AND EXISTS(SELECT 1 FROM public.bills WHERE id=(d->>'reference_id')::uuid AND status IN('Sancionado','Promulgado'))) OR (d->>'reference_kind'='decree' AND EXISTS(SELECT 1 FROM public.decrees WHERE id=(d->>'reference_id')::uuid AND is_published AND revoked_at IS NULL))) THEN RAISE EXCEPTION 'Selecione uma norma publicada para referência. A alteração exige nova aprovação legislativa.'; END IF;
 IF d ? 'region_codes' AND (jsonb_typeof(d->'region_codes')<>'array' OR jsonb_array_length(d->'region_codes')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'region_codes') r WHERE NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=r))) THEN RAISE EXCEPTION 'Selecione estados do catálogo territorial.'; END IF;
 IF d ? 'ideologies' AND (jsonb_typeof(d->'ideologies')<>'array' OR jsonb_array_length(d->'ideologies')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'ideologies') v WHERE NOT EXISTS(SELECT 1 FROM public.political_parties WHERE ideology=v) AND NOT v=ANY(enum_range(NULL::public.political_orientation)::text[]))) THEN RAISE EXCEPTION 'Selecione ideologias ou orientações cadastradas.'; END IF;
 IF d ? 'exempt_ideologies' AND (jsonb_typeof(d->'exempt_ideologies')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'exempt_ideologies') v WHERE NOT EXISTS(SELECT 1 FROM public.political_parties WHERE ideology=v) AND NOT v=ANY(enum_range(NULL::public.political_orientation)::text[]))) THEN RAISE EXCEPTION 'Selecione exceções de ideologia cadastradas.'; END IF;
 IF d ? 'scope_mode' AND d->>'scope_mode' NOT IN('total','hours','weekdays','period') THEN RAISE EXCEPTION 'Selecione a abrangência da medida.'; END IF;
 IF d->>'scope_mode'='hours' AND (NOT d ? 'hour_from' OR NOT d ? 'hour_until') THEN RAISE EXCEPTION 'Defina o horário inicial e final.'; END IF;
 IF d ? 'hour_from' THEN PERFORM (d->>'hour_from')::time,(d->>'hour_until')::time; END IF;
 IF d ? 'weekdays' AND (jsonb_typeof(d->'weekdays')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'weekdays') x WHERE x::int NOT BETWEEN 0 AND 6)) THEN RAISE EXCEPTION 'Selecione dias da semana válidos.'; END IF;
 IF d->>'scope_mode'='weekdays' AND (NOT d ? 'weekdays' OR jsonb_array_length(d->'weekdays')=0) THEN RAISE EXCEPTION 'Selecione pelo menos um dia da semana.'; END IF;
 FOR item IN SELECT value FROM jsonb_each_text(d) WHERE key IN('minimum','maximum','recurrence_multiplier','late_interest_rate','period_days','duration_days','construction_days') LOOP
  IF item IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Parâmetro numérico inválido.'; END IF;
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION private.validate_legal_definition(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE d jsonb:=coalesce(p_data->'definition','{}'); k text; extras text[]:=ARRAY['region_codes','scope_mode'];
BEGIN
 IF p_data->>'kind'='policy' AND d->>'operation'='official_salary' THEN IF d-array['operation','role','audience']<>'{}' THEN RAISE EXCEPTION 'Parâmetros de remuneração inválidos.';END IF;RETURN;END IF;

 IF jsonb_typeof(d)<>'object' THEN RAISE EXCEPTION 'Informe parâmetros estruturados válidos.'; END IF;
 IF p_data->>'kind' IN('sanction','regulation','project') THEN
  FOR k IN SELECT jsonb_object_keys(d) LOOP
   IF k NOT IN('audience','sanction_kind','infraction','conditions','reference_kind','reference_id','calculation_basis','minimum','maximum','recurrence_multiplier','late_interest_rate','duration_days','operation','ideologies','exempt_ideologies','period_days','scope_mode','weekdays','hour_from','hour_until','region_codes','region_code','infrastructure_kind','construction_days','subject') THEN RAISE EXCEPTION 'Este parâmetro ainda não possui efeito implementado: %',k; END IF;
  END LOOP;
 ELSE PERFORM private.validate_legal_definition_base(jsonb_set(p_data,'{definition}',d-extras)); END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.configure_structured_law_effect(p_source_kind text, p_source_id uuid, p_data jsonb)
 RETURNS law_effects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); role_name text; source_author uuid; locked boolean; key text; kind text:=p_data->>'kind'; e public.law_effects%rowtype; old_rule public.government_rules%rowtype;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT role INTO role_name FROM public.profiles WHERE id=actor AND deleted_at IS NULL;
 IF public.is_admin(actor) THEN role_name:='Admin'; ELSIF public.is_acting_president(actor) THEN role_name:='Presidente'; ELSIF EXISTS(SELECT 1 FROM public.parliament_members WHERE user_id=actor AND id=public.get_active_parliament_member_id(actor,house_id)) THEN role_name:='Deputado'; END IF;
 IF role_name NOT IN('Admin','Presidente','Deputado','Senador') OR role_name IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF p_source_kind='bill' THEN SELECT author_id,lower(status) NOT IN('em tramitação','rascunho','em discussão') INTO source_author,locked FROM public.bills WHERE id=p_source_id FOR UPDATE;
 ELSIF p_source_kind='decree' THEN SELECT author_id,is_published INTO source_author,locked FROM public.decrees WHERE id=p_source_id FOR UPDATE;
 END IF;
 IF source_author IS NULL THEN RAISE EXCEPTION 'LEGAL_SOURCE_NOT_FOUND'; END IF;
 IF locked THEN RAISE EXCEPTION 'LEGAL_SOURCE_ALREADY_IN_FORCE'; END IF;
 IF source_author<>actor AND role_name<>'Admin' THEN RAISE EXCEPTION 'LEGAL_EFFECT_CONFIGURATION_DENIED'; END IF;
 IF p_source_kind='decree' AND role_name NOT IN('Admin','Presidente') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF p_source_kind='bill' AND role_name IN('Deputado','Senador') AND NOT EXISTS(SELECT 1 FROM public.parliament_members m JOIN public.bills b ON b.house_id=m.house_id WHERE b.id=p_source_id AND m.user_id=actor AND current_date BETWEEN m.term_start_date AND m.term_end_date) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_votings WHERE related_id=p_source_id AND type='bill') THEN RAISE EXCEPTION 'LEGAL_EFFECT_VOTING_LOCKED'; END IF;
 PERFORM private.validate_legal_measure(kind,p_data,p_source_kind);
 key:=nullif(btrim(p_data->>'rule_key'),'');
 IF key IS NULL OR key !~ '^[a-z][a-z0-9_]{2,80}$' THEN RAISE EXCEPTION 'INVALID_RULE_KEY'; END IF;
 IF key LIKE 'official_salary_%' AND (kind<>'policy' OR p_data->'definition'->>'operation' IS DISTINCT FROM 'official_salary') THEN RAISE EXCEPTION 'Use o efeito estruturado de remuneração oficial para este cargo.';END IF;
 SELECT * INTO old_rule FROM public.government_rules WHERE rule_key=key FOR UPDATE;
 IF p_data->>'action'<>'create' AND NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_GOVERNMENT_RULE'; END IF;
 IF old_rule.rule_key IS NOT NULL AND old_rule.rule_kind<>kind THEN RAISE EXCEPTION 'RULE_KIND_MISMATCH'; END IF;
 IF key IN('consumption_tax_rate','corporate_tax_rate','transaction_tax') AND p_data->'definition'->>'nature' IS DISTINCT FROM 'percentage' THEN RAISE EXCEPTION 'As alíquotas nacionais usam percentual. Crie um tributo distinto para cobrança fixa.'; END IF;
 IF kind='penalty' AND (old_rule.rule_key IS NULL OR old_rule.definition->>'penal_code_id' IS DISTINCT FROM p_data->'definition'->>'penal_code_id') THEN RAISE EXCEPTION 'INVALID_PENAL_CODE'; END IF;
 IF p_data->>'action'='create' AND old_rule.rule_key IS NOT NULL AND old_rule.is_active THEN RAISE EXCEPTION 'RULE_ALREADY_ACTIVE'; END IF;
 IF length(btrim(coalesce(p_data->>'name','')))<3 THEN RAISE EXCEPTION 'LEGAL_RULE_NAME_REQUIRED'; END IF;
 INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition)
 VALUES(key,0,case when p_data->'definition'->>'nature'='percentage' OR p_data->'definition'->>'sanction_kind'='fine_percentage' then 'ratio' when kind='penalty' then 'rp_years' else 'BRL' end,p_data->>'name',kind,false,coalesce(p_data->'definition','{}')) ON CONFLICT DO NOTHING;
 INSERT INTO public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,configured_by,effect_data,valid_from,valid_until)
 VALUES(p_source_kind,p_source_id,key,'set',(p_data->>'value')::numeric,coalesce(p_data->>'explanation',p_data->>'name'),actor,p_data,
   nullif(p_data->>'valid_from','')::timestamptz,nullif(p_data->>'valid_until','')::timestamptz)
 ON CONFLICT(source_kind,source_id,effect_key) DO UPDATE SET effect_value=excluded.effect_value,explanation=excluded.explanation,effect_data=excluded.effect_data,valid_from=excluded.valid_from,valid_until=excluded.valid_until
 WHERE public.law_effects.status='draft' RETURNING * INTO e;
 IF e.id IS NULL THEN RAISE EXCEPTION 'ACTIVE_LEGAL_EFFECT_IS_IMMUTABLE'; END IF;
 IF kind='policy' AND p_data->'definition'->>'operation'='official_salary' THEN
  IF p_source_kind<>'bill' OR NOT EXISTS(SELECT 1 FROM public.bills WHERE id=p_source_id AND house_id='a1b2c3d4-e5f6-7890-1234-567890abcdef') THEN RAISE EXCEPTION 'O reajuste salarial inicia a tramitação na Câmara dos Deputados.';END IF;
  UPDATE public.bills SET institutional_data=coalesce(institutional_data,'{}')||jsonb_build_object('requires_bicameral',true,'salary_role',p_data->'definition'->>'role','salary_amount',(p_data->>'value')::numeric) WHERE id=p_source_id;
 END IF;
 RETURN e;
END $function$;

CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text; ordinary_voted integer; chair_voted boolean; required integer; full_house integer; deliberation integer;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return coalesce(v.result,'{}')||jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select cardinality(v.eligible_member_ids) into seats;
 full_house:=coalesce((v.rule_snapshot->>'house_members')::int,seats);
 deliberation:=coalesce((v.rule_snapshot->>'deliberation_required')::int,1);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where member_id=any(v.eligible_member_ids)),coalesce(bool_or(member_id=v.chair_member_id),false)
 into voted,yes,no,ordinary_voted,chair_voted from public.parliament_voting_votes where voting_id=v.id;
 if v.tie_break_pending and not chair_voted and clock_timestamp()<v.end_date then return jsonb_build_object('finalized',false,'tie_break_pending',true); end if;
 if not v.tie_break_pending and clock_timestamp()<v.end_date and (seats=0 or ordinary_voted<seats) then return jsonb_build_object('finalized',false); end if;
 if not v.tie_break_pending and yes=no and voted>=deliberation and coalesce((v.rule_snapshot->>'tie_break')::boolean,false)
 and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then
  update public.parliament_votings set tie_break_pending=true,end_date=clock_timestamp()+make_interval(hours=>(v.rule_snapshot->>'tie_break_hours')::int) where id=v.id;
  insert into public.notifications(user_id,type,content,link,metadata) select user_id,'parliament_tie_break','A votação de '||bill.title||' aguarda seu voto de desempate.','/services/parliament/panel',jsonb_build_object('voting_id',v.id) from public.parliament_members where id=v.chair_member_id;
  return jsonb_build_object('finalized',false,'tie_break_pending',true);
 end if;
 required:=case when v.rule_snapshot->>'approval_basis'='seats' then
 case when v.rule_snapshot->>'numerator'='1' and v.rule_snapshot->>'denominator'='2' then floor(full_house/2.0)+1 else ceil(full_house*(v.rule_snapshot->>'numerator')::numeric/(v.rule_snapshot->>'denominator')::numeric) end else 1 end;
 approved:=voted>=deliberation AND case when v.rule_snapshot->>'approval_basis'='seats' then yes>=greatest(required,1) else yes>no and yes>0 end;
 next_status:=case when approved and bill.type='PDL' and bill.suspends_decree_id is not null then 'Promulgado' when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if (bill.type IN('PEC','Proposta de Emenda Constitucional') or coalesce((bill.institutional_data->>'requires_bicameral')::boolean,false)) and approved then
  select pv.id,pv.status,pv.house_id,pv.result
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when coalesce((other_result.result->>'approved')::boolean,false) then CASE WHEN bill.type IN('PEC','Proposta de Emenda Constitucional') THEN 'Aguardando promulgação presidencial' ELSE 'Aguardando sanção presidencial' END else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
    if other_house is null then raise exception 'A proposta constitucional exige duas Casas legislativas.'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,CASE WHEN bill.institutional_data->>'salary_role' IS NOT NULL THEN 'Reajuste salarial: deliberação da segunda Casa antes da sanção presidencial.' ELSE 'Deliberação constitucional na segunda Casa.' END,'active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select m.user_id,'parliament_voting_result',
 case when vote.vote='Abster' then 'Votação encerrada: o projeto "'||bill.title||'", no qual você registrou abstenção, foi '
 when (vote.vote='Aprovar' and approved) or (vote.vote='Rejeitar' and not approved) then 'Boa notícia! O projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi '
 else 'Resultado da votação: o projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi ' end
 ||case when approved then 'aprovado' else 'rejeitado' end||' pela sua Casa Legislativa.',
 '/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'vote',vote.vote,'approved',approved,'tone',case when vote.vote='Abster' then 'neutral' when (vote.vote='Aprovar')=approved then 'positive' else 'institutional' end)
 from public.parliament_voting_votes vote join public.parliament_members m on m.id=vote.member_id where vote.voting_id=v.id
 and not exists(select 1 from public.notifications n where n.user_id=m.user_id and n.type='parliament_voting_result' and n.metadata->>'voting_id'=v.id::text);
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$;

CREATE OR REPLACE FUNCTION private.apply_structured_effect(p_effect_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e public.law_effects%rowtype; r public.government_rules%rowtype; d jsonb; n numeric; start_at timestamptz; penalty public.penal_code%rowtype;
BEGIN
 SELECT * INTO e FROM public.law_effects WHERE id=p_effect_id FOR UPDATE;
 IF e.status NOT IN('draft','scheduled') THEN RETURN; END IF;
 d:=coalesce(e.effect_data,jsonb_build_object('kind','policy','action','change','definition','{}'));
 IF d->>'kind'='policy' AND d->'definition'->>'operation'='official_salary' THEN PERFORM private.apply_salary_legal_effect(e.id);RETURN;END IF;
 SELECT * INTO r FROM public.government_rules WHERE rule_key=e.effect_key FOR UPDATE;
 IF e.effect_data IS NOT NULL THEN PERFORM private.validate_legal_measure(d->>'kind',d,e.source_kind); END IF;
 start_at:=coalesce(e.valid_from,clock_timestamp());
 IF start_at>clock_timestamp() THEN UPDATE public.law_effects SET status='scheduled' WHERE id=e.id; RETURN; END IF;
 -- Publication cannot backdate an immediate rule or rewrite the applicable penal history.
 IF e.status='draft' THEN start_at:=greatest(start_at,clock_timestamp()); END IF;
 IF e.valid_until IS NOT NULL AND e.valid_until<=clock_timestamp() THEN UPDATE public.law_effects SET status='revoked' WHERE id=e.id; RETURN; END IF;
 n:=case e.operation when 'add' then r.numeric_value+e.effect_value when 'multiply' then r.numeric_value*e.effect_value else e.effect_value end;
 IF d->>'action'='revoke' THEN n:=0; END IF;
 UPDATE public.law_effects SET previous_snapshot=to_jsonb(r),status='active',activated_at=clock_timestamp(),valid_from=start_at,updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE public.government_rules SET numeric_value=n,definition=coalesce(d->'definition',r.definition),description=coalesce(d->>'name',r.description),
   is_active=d->>'action'<>'revoke',valid_from=start_at,valid_until=e.valid_until,source_kind=e.source_kind,source_id=e.source_id,
   active_effect_id=e.id,version=version+1,updated_at=clock_timestamp() WHERE rule_key=r.rule_key;
 IF r.rule_kind='penalty' THEN
   SELECT * INTO penalty FROM public.penal_code WHERE id=(d->'definition'->>'penal_code_id')::uuid FOR UPDATE;
   UPDATE public.penal_code SET minimum_sentence_units=(d->'definition'->>'minimum')::numeric,maximum_sentence_units=(d->'definition'->>'maximum')::numeric,
     base_fine=(d->'definition'->>'fine')::numeric,is_active=d->>'action'<>'revoke',
     legal_history=case when legal_history='[]' THEN jsonb_build_array(jsonb_build_object('valid_from','-infinity','minimum',penalty.minimum_sentence_units,'maximum',penalty.maximum_sentence_units,'fine',penalty.base_fine,'active',penalty.is_active)) else legal_history end
       ||jsonb_build_array(jsonb_build_object('valid_from',start_at,'minimum',d->'definition'->'minimum','maximum',d->'definition'->'maximum','fine',d->'definition'->'fine','active',d->>'action'<>'revoke','effect_id',e.id,'source_id',e.source_id))
   WHERE id=penalty.id;
 END IF;
 PERFORM private.create_normative_project(e.id);
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('legal_effect_activated','government','law_effects',e.id,e.configured_by,jsonb_build_object('sourceId',e.source_id,'ruleKey',r.rule_key,'kind',r.rule_kind,'action',d->>'action','previousValue',r.numeric_value,'newValue',n,'validFrom',start_at,'validUntil',e.valid_until),'legal-effect:'||e.id);
END $function$;

CREATE OR REPLACE FUNCTION public.process_official_payroll()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb; recipients jsonb; recipient jsonb; week_start timestamptz:=private.payroll_week(clock_timestamp());
 treasury numeric; total numeric:=0; count integer:=0; payment uuid; batch uuid:=gen_random_uuid(); amount numeric;
begin
 if not (session_user in ('postgres','supabase_admin') and auth.uid() is null and coalesce(auth.role(),'')='') and coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from public.profiles where id=auth.uid() and public.is_admin(id) and deleted_at is null) then raise exception 'A rotina salarial exige autorização administrativa.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('govrp:official-payroll'));
 select value into cfg from public.system_settings where key='official_salaries' for share;
 select treasury_balance into treasury from public.government_finances where id=1 for update;
 if treasury is null then raise exception 'As finanças públicas não estão disponíveis.'; end if;
 with eligible as (
  select p.id,a.id account_id,r.value salary,
    case when (r.value->>'valid_from')::timestamptz>clock_timestamp() then (r.value->>'previous_amount')::numeric else (r.value->>'amount')::numeric end amount
  from public.profiles p join public.accounts a on a.user_id=p.id AND a.account_kind='personal'
   join lateral jsonb_array_elements(cfg->'roles') r on r.value->>'role'=public.canonical_official_role(p.role)
  where p.deleted_at is null and p.onboarding_completed
   and not exists(select 1 from public.salary_payments sp where sp.user_id=p.id and sp.paid_at>=week_start)
  order by p.id for update of p,a
 ) select coalesce(jsonb_agg(to_jsonb(eligible)),'[]'),coalesce(sum(eligible.amount),0) into recipients,total from eligible where eligible.amount>0;
 if total>treasury then
  for recipient in select value from jsonb_array_elements(recipients) loop
   insert into public.notifications(user_id,type,content,link,metadata)
   select (recipient->>'id')::uuid,'salary_payment_failed','O pagamento semanal aguarda saldo suficiente no Tesouro.','/services/bank',jsonb_build_object('payroll_window_start',week_start,'expected_amount',recipient->'amount','popup_pending',true)
   where not exists(select 1 from public.notifications where user_id=(recipient->>'id')::uuid and type='salary_payment_failed' and metadata->>'payroll_window_start'=week_start::text);
  end loop;
  return jsonb_build_object('success',false,'processedCount',0,'totalAmount',total,'failedDueToFunds',true,'message','Saldo insuficiente no Tesouro. Nenhum débito foi realizado.');
 end if;
 for recipient in select value from jsonb_array_elements(recipients) loop
  amount:=(recipient->>'amount')::numeric;
  insert into public.salary_payments(user_id,role,title,amount,paid_at,payment_batch_id,payroll_window_start,salary_snapshot)
  values((recipient->>'id')::uuid,recipient->'salary'->>'role',recipient->'salary'->>'title',amount,clock_timestamp(),batch,week_start,recipient->'salary'||jsonb_build_object('paid_amount',amount)) returning id into payment;
  update public.accounts set balance=balance+amount,updated_at=clock_timestamp() where id=(recipient->>'account_id')::uuid;
  insert into public.transactions(to_account_id,amount,type,description,metadata)
  values((recipient->>'account_id')::uuid,amount,'salary_payment','Pagamento semanal: '||(recipient->'salary'->>'title'),jsonb_build_object('role',recipient->'salary'->>'role','salary_payment_id',payment,'payroll_window_start',week_start,'salary_snapshot',recipient->'salary','gross_amount',amount,'net_amount',amount,'tax_amount',0));
  insert into public.notifications(user_id,type,content,link,metadata)
  values((recipient->>'id')::uuid,'salary_payment','Seu salário semanal de '||(recipient->'salary'->>'title')||' foi depositado: R$ '||to_char(amount,'FM999999990D00')||'.','/services/bank',jsonb_build_object('salary_payment_id',payment,'payroll_window_start',week_start,'amount',amount,'role',recipient->'salary'->>'role','popup_pending',true,'popup_shown_at',null));
  count:=count+1;
 end loop;
 update public.government_finances set treasury_balance=treasury_balance-total,updated_at=clock_timestamp() where id=1;
 perform economy_private.audit('official_payroll_processed','salary_payments',batch::text,null,jsonb_build_object('count',count,'total',total,'week_start',week_start),'Pagamento semanal atômico dos cargos oficiais.',auth.uid());
 return jsonb_build_object('success',true,'processedCount',count,'totalAmount',total,'payrollWindowStart',week_start,'failedDueToFunds',false,'message','Folha semanal processada.');
end; $function$;

CREATE OR REPLACE FUNCTION public.preview_official_salary(p_role text,p_amount numeric) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE entry jsonb;n int;current_amount numeric;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o impacto.' USING errcode='42501';END IF;
 SELECT r INTO entry FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')r WHERE s.key='official_salaries' AND r->>'role'=p_role;
 IF entry IS NULL OR p_amount IS NULL OR p_amount::text IN('NaN','Infinity','-Infinity') OR p_amount<0 OR p_amount>1000000 THEN RAISE EXCEPTION 'Selecione um cargo e valor válidos.';END IF;
 current_amount:=CASE WHEN (entry->>'valid_from')::timestamptz>clock_timestamp() THEN (entry->>'previous_amount')::numeric ELSE (entry->>'amount')::numeric END;
 SELECT count(*) INTO n FROM public.profiles WHERE deleted_at IS NULL AND onboarding_completed AND public.canonical_official_role(role)=p_role;
 RETURN jsonb_build_object('role',p_role,'current_amount',current_amount,'amount',p_amount,'holders',n,'weekly_difference',(p_amount-current_amount)*n,'version',entry->'version','server_now',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.preview_official_salary(text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_official_salary(text,numeric) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid, p_new_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); bill public.bills%rowtype; voting public.parliament_votings%rowtype; finalized jsonb; qualified boolean; houses integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
 IF bill.type='IMPEACHMENT' THEN RAISE EXCEPTION 'O impeachment é decidido pela votação institucional da Câmara.'; END IF;
 IF bill.type='PDL' AND bill.suspends_decree_id IS NOT NULL THEN RAISE EXCEPTION 'A sustação é decidida pela votação legislativa, sem sanção presidencial.'; END IF;
 qualified:=bill.type IN('PEC','Proposta de Emenda Constitucional');
 IF p_new_status IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') THEN
  IF NOT(public.is_parliament_governance_manager(actor,bill.house_id) OR public.get_active_parliament_member_id(actor,bill.house_id) IS NOT NULL) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  SELECT * INTO voting FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_VOTING_NOT_FOUND'; END IF;
  finalized:=private.finalize_bill_voting(voting.id);
  IF NOT coalesce((finalized->>'finalized')::boolean,false) THEN RAISE EXCEPTION 'BILL_VOTING_NOT_READY'; END IF;
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
  IF bill.status IS DISTINCT FROM p_new_status THEN RAISE EXCEPTION 'O resultado da votação não permite esta transição. Consulte a tramitação atual.'; END IF;
  RETURN;
 ELSIF p_new_status IN('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') THEN
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF NOT public.economic_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'EXECUTIVE_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  IF bill.status=p_new_status THEN RETURN; END IF;
  IF bill.status NOT IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') THEN RAISE EXCEPTION 'BILL_NOT_AWAITING_EXECUTIVE_DECISION'; END IF;
  IF qualified AND p_new_status<>'Promulgado' THEN RAISE EXCEPTION 'A proposta constitucional aprovada deve ser promulgada após deliberação nas duas Casas.'; END IF;
  IF NOT qualified AND p_new_status='Promulgado' THEN RAISE EXCEPTION 'Escolha sanção ou veto para este projeto de lei.'; END IF;
  SELECT count(DISTINCT house_id) INTO houses FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' AND status='closed' AND coalesce((result->>'approved')::boolean,false);
  IF houses<(CASE WHEN qualified OR coalesce((bill.institutional_data->>'requires_bicameral')::boolean,false) THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'A medida exige deliberação legislativa concluída e aprovada nas Casas competentes.'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_BILL_STATUS'; END IF;
 UPDATE public.bills SET status=p_new_status,updated_at=clock_timestamp() WHERE id=bill.id;
 IF p_new_status IN('Sancionado','Promulgado') THEN
  INSERT INTO public.dou_entries(title,summary,content,published_at,type,source_id)
  SELECT bill.title,CASE WHEN p_new_status='Sancionado' THEN 'Lei sancionada pela Presidência da República.' ELSE 'Norma promulgada e publicada oficialmente.' END,coalesce(nullif(bill.full_text,''),bill.summary),clock_timestamp(),bill.type,bill.id
  WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=bill.id);
 END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.start_parliament_bill_voting(p_bill_id uuid, p_house_id uuid, p_title text, p_description text DEFAULT NULL::text)
 RETURNS parliament_votings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=(select auth.uid());
  v_bill public.bills%rowtype;
  v_voting public.parliament_votings%rowtype; v_seats integer; v_required integer; v_electorate jsonb; v_cfg jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select * into v_bill from public.bills where id=p_bill_id for update;
  if not found then raise exception 'BILL_NOT_FOUND'; end if;
  if v_bill.type='IMPEACHMENT' then
    if not private.is_house_president(v_actor,p_house_id) or p_house_id<>v_bill.house_id then raise exception 'Somente o Presidente da Câmara pode pautar este pedido.' using errcode='42501'; end if;
    if v_bill.status not in ('Protocolado','Em votação') then raise exception 'O pedido já foi decidido.'; end if;
    if not exists(select 1 from public.profiles where id=(v_bill.institutional_data->>'president_id')::uuid and role='Presidente') then raise exception 'O Presidente indicado já deixou o cargo. Arquive este pedido.'; end if;
  end if;
  if not public.is_parliament_governance_manager(v_actor,p_house_id)
     and not (
       v_bill.type='PEC'
       and p_house_id<>v_bill.house_id
       and exists(
         select 1 from public.parliament_members
         where user_id=v_actor and house_id=v_bill.house_id
           and term_start_date<=current_date and term_end_date>=current_date
       )
       and exists(
         select 1 from public.parliament_votings
         where related_id=p_bill_id and house_id=v_bill.house_id
           and type='bill' and status='closed'
       )
     ) then
    raise exception 'PARLIAMENT_MANAGER_REQUIRED' using errcode='42501';
  end if;
  if v_bill.house_id<>p_house_id and v_bill.type not in ('PEC','Proposta de Emenda Constitucional') and not coalesce((v_bill.institutional_data->>'requires_bicameral')::boolean,false) then
    raise exception 'BILL_HOUSE_MISMATCH';
  end if;
  if v_bill.status in ('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente','Rejeitado') then
    raise exception 'BILL_ALREADY_DECIDED';
  end if;

  select * into v_voting
  from public.parliament_votings
  where related_id=p_bill_id and house_id=p_house_id and type='bill' and status='active'
  order by created_at desc limit 1;
  if found then return v_voting; end if;

  if v_bill.type='IMPEACHMENT' then
    select count(*),coalesce(jsonb_agg(id),'[]') into v_seats,v_electorate from public.parliament_members m where house_id=p_house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
    if v_seats=0 then raise exception 'Não há Deputados ativos para esta votação.'; end if;
    v_cfg:=v_bill.institutional_data->'rule_snapshot';
    v_required:=ceil(v_seats*(v_cfg->>'impeachment_approval_numerator')::numeric/(v_cfg->>'impeachment_approval_denominator')::numeric);
    update public.bills set institutional_data=institutional_data||jsonb_build_object('eligible_seats',v_seats,'eligible_member_ids',v_electorate,'required_approvals',v_required,'pauted_by',v_actor,'voting_started_at',clock_timestamp()) where id=v_bill.id;
  end if;
  insert into public.parliament_votings(
    house_id,title,description,type,related_id,status,end_date
  ) values(
    p_house_id,
    left(coalesce(nullif(btrim(p_title),''),v_bill.title),180),
    nullif(btrim(coalesce(p_description,'')),''),
    'bill',p_bill_id,'active',clock_timestamp()+case when v_bill.type='IMPEACHMENT' then make_interval(secs=>(v_cfg->>'impeachment_duration_hours')::double precision*3600) else interval '24 hours' end
  ) returning * into v_voting;

  update public.bills set
    status=case when p_house_id=v_bill.house_id then 'Em votação' else 'Em votação (2ª Casa)' end,
    updated_at=clock_timestamp()
  where id=p_bill_id;

  insert into public.domain_events(
    event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at
  ) values(
    'parliament_voting_started','government','parliament_votings',v_voting.id,v_actor,
    jsonb_build_object('bill_id',p_bill_id,'house_id',p_house_id,'end_date',v_voting.end_date),
    'parliament-voting-started:'||v_voting.id,'processed',clock_timestamp()
  ) on conflict(idempotency_key) do nothing;

  return v_voting;
end;
$function$;

NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.configure_law_effect(p_source_kind text, p_source_id uuid, p_effect_key text, p_operation text, p_effect_value numeric, p_explanation text)
 RETURNS law_effects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.government_rules%rowtype; n numeric;
BEGIN
 IF p_effect_key LIKE 'official_salary_%' THEN RAISE EXCEPTION 'Utilize a proposta salarial estruturada com tramitação nas duas Casas.';END IF;
 SELECT * INTO r FROM public.government_rules WHERE rule_key=p_effect_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_GOVERNMENT_RULE'; END IF;
 IF p_operation NOT IN('set','add','multiply') OR p_operation IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECT_OPERATION'; END IF;
 n:=case p_operation when 'set' then p_effect_value when 'add' then r.numeric_value+p_effect_value else r.numeric_value*p_effect_value end;
 RETURN public.configure_structured_law_effect(p_source_kind,p_source_id,jsonb_build_object('kind',r.rule_kind,'action','change','rule_key',r.rule_key,'value',n,'name',r.description,'explanation',p_explanation,'definition',r.definition));
END $function$;
COMMIT;
