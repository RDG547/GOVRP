-- One authoritative view of eligible, open elections. cast_ballot remains the only vote writer.
CREATE FUNCTION public.get_my_ballot_sequence() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;status jsonb;items jsonb:='[]';skipped jsonb:='[]';completed integer:=0;total integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para acessar a urna.' USING errcode='42501';END IF;
 FOR e IN SELECT x.*,to_jsonb(t) election_types FROM public.elections x JOIN public.election_types t ON t.id=x.election_type_id
 WHERE x.archived_at IS NULL AND x.status='Voting' AND x.voting_start_date<=now() AND now()<x.voting_end_date
 ORDER BY CASE WHEN t.name ILIKE '%deput%' THEN 1 WHEN t.name ILIKE '%senad%' THEN 2 WHEN t.name ILIKE '%presid%' THEN 3 ELSE 4 END,x.voting_start_date,x.id LOOP
  total:=total+1;
  IF EXISTS(SELECT 1 FROM public.votes WHERE election_id=e.id AND voter_id=auth.uid()) THEN completed:=completed+1;CONTINUE;END IF;
  status:=public.get_my_election_voting_status(e.id);
  IF (status->>'eligible')::boolean THEN items:=items||jsonb_build_array(to_jsonb(e));
  ELSE skipped:=skipped||jsonb_build_array(jsonb_build_object('id',e.id,'name',e.name,'reason',status->>'reason','eligibleAt',status->>'eligibleAt'));END IF;
 END LOOP;
 RETURN jsonb_build_object('server_now',now(),'elections',items,'unavailable',skipped,'completed',completed,'active_count',total);
END $$;
REVOKE ALL ON FUNCTION public.get_my_ballot_sequence() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_ballot_sequence() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_electoral_management() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.assert_electoral_management();
 RETURN jsonb_build_object('server_now',now(),'elections',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM(SELECT * FROM public.elections WHERE archived_at IS NULL ORDER BY voting_start_date DESC)e),'[]'),
 'candidates',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT id,election_id,political_name,status,bio,proposals,admin_feedback,user_id,vice_candidate_id,electoral_number,identity_snapshot,vice_identity_snapshot FROM public.candidates WHERE removed_at IS NULL AND election_id IN(SELECT id FROM public.elections WHERE archived_at IS NULL AND candidacy_start_date<=now() AND now()<voting_end_date AND status NOT IN('Finished','Cancelled','Canceled')) ORDER BY created_at DESC)c),'[]'));
END $$;
CREATE FUNCTION public.get_electoral_candidacies(p_election_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.assert_electoral_management();
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM(SELECT id,election_id,political_name,status,bio,proposals,admin_feedback,user_id,vice_candidate_id,electoral_number,identity_snapshot,vice_identity_snapshot FROM public.candidates WHERE removed_at IS NULL AND election_id=p_election_id ORDER BY created_at DESC)c),'[]');
END $$;
REVOKE ALL ON FUNCTION public.get_electoral_candidacies(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_electoral_candidacies(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_parliament_member_monthly_term()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE normal_limit date;legislature_limit date;
BEGIN
  new.term_start_date:=coalesce(new.term_start_date,current_date);
  normal_limit:=(new.term_start_date+interval '1 month')::date;
  IF new.house_id='fedcba09-8765-4321-0987-654321fedcba' THEN
    SELECT min(a.term_ends_at::date) INTO legislature_limit FROM public.election_office_assignments a
    WHERE a.office_role='Senador' AND a.status='active' AND a.ended_at IS NULL
      AND a.term_starts_at::date<=new.term_start_date AND new.term_start_date<a.term_ends_at::date;
    IF legislature_limit IS NOT NULL THEN normal_limit:=least(normal_limit,legislature_limit);END IF;
  END IF;
  IF new.term_end_date IS NULL THEN new.term_end_date:=normal_limit; END IF;
  IF new.term_end_date>normal_limit THEN
    IF tg_op='UPDATE' THEN
      IF new.term_start_date IS NOT DISTINCT FROM old.term_start_date
        AND EXISTS(
          SELECT 1 FROM public.election_office_assignments a
          WHERE a.profile_id=new.user_id
            AND a.office_role=public.get_parliament_base_role_label(new.house_id)
            AND a.status='active'
            AND a.metadata->>'holdover'='true'
            AND a.term_ends_at::date>=new.term_end_date
        ) THEN
        RETURN new;
      END IF;
    END IF;
    new.term_end_date:=normal_limit;
  END IF;
  RETURN new;
END;
$function$

;
-- Audited active manually assigned seats of the first Senate legislature only.
-- Preserve original starts, revoked assignments, completed elections and deputy terms.
DO $$ DECLARE m public.parliament_members%rowtype;previous jsonb;legislature uuid;BEGIN
 SELECT (array_agg(DISTINCT a.election_id))[1] INTO legislature
 FROM public.election_office_assignments a
 WHERE a.office_role='Senador' AND a.status='active' AND a.ended_at IS NULL
 AND a.term_starts_at::date='2026-11-09' AND a.term_ends_at::date='2026-12-09'
 HAVING count(DISTINCT a.election_id)=1;
 IF legislature IS NULL THEN RETURN;END IF;
 FOR m IN SELECT x.* FROM public.parliament_members x
 WHERE EXISTS(SELECT 1 FROM public.election_office_assignments a WHERE a.election_id=legislature AND a.office_role='Senador' AND a.status='active' AND a.ended_at IS NULL AND a.term_starts_at::date<=x.term_start_date AND x.term_start_date<a.term_ends_at::date AND a.term_ends_at::date='2026-12-09')
 AND x.house_id='fedcba09-8765-4321-0987-654321fedcba'
 AND x.id=public.get_active_parliament_member_id(x.user_id,x.house_id)
 AND x.term_start_date>='2026-11-09' AND x.term_start_date<'2026-12-09' AND x.term_end_date<>'2026-12-09' LOOP
  previous:=to_jsonb(m);
  UPDATE public.parliament_members SET term_end_date='2026-12-09' WHERE id=m.id;
  PERFORM economy_private.audit('senate_term_end_corrected','parliament_members',m.id::text,previous,jsonb_build_object('term_end_date','2026-12-09','legislature_election_id',legislature),'Padronização auditada dos mandatos em exercício da legislatura atual, inclusive atribuições administrativas. Início preservado.',NULL);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_judicial_governance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o STF.' USING errcode='42501';END IF;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'electoral_access',public.is_electoral_judge(auth.uid()),
 'seats',(SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('term',to_jsonb(t),'holder',CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object('id',p.id,'full_name',p.full_name,'avatar_url',p.avatar_url,'username',p.username) END) ORDER BY o.sort_order),'[]') FROM public.executive_office_definitions o LEFT JOIN public.institutional_terms t ON t.office_key=o.office_key AND t.status='active' LEFT JOIN public.profiles p ON p.id=t.profile_id WHERE o.office_key LIKE 'supreme_court_%' OR o.office_key='public_prosecutor'),
 'nominations',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'office_key',i.office_key,'candidate_id',i.candidate_id,'candidate_name',p.full_name,'candidate_avatar',p.avatar_url,'invited_by',i.invited_by,'status',i.status,'stage',i.institutional_stage,'hearing_notes',i.hearing_notes,'voting_id',i.senate_voting_id,'created_at',i.created_at,'ready_for_vote',EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='question') AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='answer')) ORDER BY i.created_at DESC),'[]') FROM public.minister_invitations i JOIN public.profiles p ON p.id=i.candidate_id WHERE (i.office_key LIKE 'supreme_court_%' OR i.office_key='public_prosecutor') AND (i.status='accepted' OR i.candidate_id=auth.uid() OR public.get_authority_role(auth.uid()) IN('Admin','Presidente') OR public.get_active_parliament_member_id(auth.uid(),'fedcba09-8765-4321-0987-654321fedcba') IS NOT NULL) AND i.created_at>clock_timestamp()-interval '1 year'),
 'electoral_assignments',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('name',p.full_name) ORDER BY a.starts_at DESC),'[]') FROM public.judicial_electoral_assignments a JOIN public.profiles p ON p.id=a.profile_id WHERE a.ends_at>clock_timestamp()-interval '1 year'),
 'impeachments',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('events',(SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY ev.created_at),'[]') FROM public.public_integrity_case_events ev WHERE ev.case_id=c.id)) ORDER BY c.created_at DESC),'[]') FROM public.public_integrity_cases c WHERE c.institutional_term_id IS NOT NULL),
 'votes',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('votes',(SELECT coalesce(jsonb_agg(jsonb_build_object('member_id',vv.member_id,'user_id',m.user_id,'name',p.full_name,'vote',vv.vote)),'[]') FROM public.parliament_voting_votes vv JOIN public.parliament_members m ON m.id=vv.member_id JOIN public.profiles p ON p.id=m.user_id WHERE vv.voting_id=v.id)) ORDER BY v.created_at DESC),'[]') FROM public.parliament_votings v WHERE v.type IN('institutional_appointment','judicial_impeachment')),
 'senate_member_id',public.get_active_parliament_member_id(auth.uid(),'fedcba09-8765-4321-0987-654321fedcba'),
 'senate_president',private.is_house_president(auth.uid(),'fedcba09-8765-4321-0987-654321fedcba'));
END $function$

;

CREATE OR REPLACE FUNCTION public.manage_judicial_hearing(p_invitation_id uuid, p_action text, p_text text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE i public.minister_invitations%rowtype;members uuid[];v public.parliament_votings%rowtype;senate uuid;senator boolean;BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para participar da sabatina.' USING errcode='42501';END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO i FROM public.minister_invitations WHERE id=p_invitation_id FOR UPDATE;
 IF i.id IS NULL OR i.office_key NOT LIKE 'supreme_court_%' OR i.status<>'accepted' THEN RAISE EXCEPTION 'A sabatina exige uma indicação aceita.';END IF;
 SELECT id INTO senate FROM public.parliament_houses WHERE id='fedcba09-8765-4321-0987-654321fedcba';
 senator:=public.get_active_parliament_member_id(auth.uid(),senate) IS NOT NULL;
 IF p_action IN('question','answer') THEN
  IF i.institutional_stage<>'hearing' THEN RAISE EXCEPTION 'A sabatina já foi encerrada.';END IF;
  IF NOT((p_action='question' AND (senator OR public.has_full_admin_access())) OR (p_action='answer' AND i.candidate_id=auth.uid())) THEN RAISE EXCEPTION 'Você não possui competência para esta manifestação.' USING errcode='42501';END IF;
  IF length(btrim(p_text))<10 OR length(p_text)>10000 THEN RAISE EXCEPTION 'Escreva entre 10 e 10.000 caracteres.';END IF;
  UPDATE public.minister_invitations SET hearing_notes=hearing_notes||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'kind',p_action,'actor_id',auth.uid(),'text',btrim(p_text),'at',clock_timestamp())) WHERE id=i.id;
 ELSIF p_action='open_vote' THEN
  IF NOT(private.is_house_president(auth.uid(),senate) OR public.has_full_admin_access()) THEN RAISE EXCEPTION 'A Presidência do Senado encerra a sabatina e abre a votação.' USING errcode='42501';END IF;
  IF i.senate_voting_id IS NOT NULL THEN RETURN jsonb_build_object('success',true,'voting_id',i.senate_voting_id);END IF;
  IF i.institutional_stage IS DISTINCT FROM 'hearing' THEN RAISE EXCEPTION 'Esta indicação não está em sabatina ativa. Confira seu histórico institucional.';END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='question') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(i.hearing_notes)n WHERE n->>'kind'='answer') THEN RAISE EXCEPTION 'Registre ao menos uma pergunta e a manifestação do indicado antes da votação.';END IF;
  SELECT array_agg(m.id ORDER BY m.id) INTO members FROM public.parliament_members m WHERE m.house_id=senate AND m.id=public.get_active_parliament_member_id(m.user_id,senate);
  IF coalesce(cardinality(members),0)=0 THEN RAISE EXCEPTION 'O Senado não possui membros em exercício para deliberar.';END IF;
  INSERT INTO public.parliament_votings(house_id,title,description,type,related_id,status,end_date,eligible_member_ids,rule_snapshot)
  VALUES(senate,'Indicação ao STF: '||(SELECT full_name FROM public.profiles WHERE id=i.candidate_id),'Aprovação exige maioria absoluta dos senadores em exercício registrados na abertura.','institutional_appointment',i.id,'active',clock_timestamp()+interval '24 hours',members,jsonb_build_object('approval_basis','seats','numerator',1,'denominator',2,'house_members',cardinality(members),'absolute_majority',true)) RETURNING * INTO v;
  UPDATE public.minister_invitations SET institutional_stage='voting',hearing_closed_at=clock_timestamp(),senate_voting_id=v.id WHERE id=i.id;
 ELSE RAISE EXCEPTION 'Ação de sabatina inválida.';END IF;
 PERFORM public.justice_write_audit('judicial_hearing.'||p_action,'minister_invitation',i.id,NULL,jsonb_build_object('voting_id',v.id),'Sabatina do STF.');
 RETURN jsonb_build_object('success',true,'voting_id',v.id);
END $function$

;
-- Archived elections must not consume judicial assignments for current windows.
CREATE OR REPLACE FUNCTION private.maintain_institutional_calendar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE t record;v record;e record;chosen record;needed int;BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtext('govrp:institutional-calendar')) THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
 FOR t IN SELECT id FROM public.institutional_terms WHERE status='active' AND ends_at<=clock_timestamp() ORDER BY ends_at FOR UPDATE SKIP LOCKED LOOP
  PERFORM private.end_institutional_term(t.id,'expired',NULL);
 END LOOP;
 FOR v IN SELECT id FROM public.parliament_votings WHERE type IN('institutional_appointment','judicial_impeachment') AND status='active' AND end_date<=clock_timestamp() ORDER BY end_date FOR UPDATE SKIP LOCKED LOOP
  PERFORM private.finish_institutional_vote(v.id);
 END LOOP;
 UPDATE public.judicial_electoral_assignments SET ended_at=ends_at WHERE ended_at IS NULL AND ends_at<=clock_timestamp();
 -- Simultaneous elections share the same two officials. Overlapping different
 -- windows use separate officials and keep their own rotation history.
 FOR e IN SELECT md5(voting_start_date::text||'/'||voting_end_date::text) cohort,
 array_agg(id ORDER BY id) ids,voting_start_date-interval '7 days' start_at,voting_end_date+interval '1 day' end_at
 FROM public.elections WHERE archived_at IS NULL AND lower(coalesce(status,'')) NOT IN('cancelled','canceled','cancelada')
 AND clock_timestamp()>=voting_start_date-interval '7 days' AND clock_timestamp()<voting_end_date+interval '1 day'
 GROUP BY voting_start_date,voting_end_date ORDER BY voting_start_date LOOP
  UPDATE public.judicial_electoral_assignments SET election_ids=e.ids WHERE cohort_key=e.cohort AND ended_at IS NULL;
  SELECT greatest(0,2-count(*))::int INTO needed FROM public.judicial_electoral_assignments a JOIN public.institutional_terms it ON it.id=a.term_id WHERE a.cohort_key=e.cohort AND a.ended_at IS NULL AND it.status='active';
  FOR chosen IN SELECT it.id,it.profile_id FROM public.institutional_terms it JOIN public.profiles p ON p.id=it.profile_id
  WHERE it.status='active' AND it.office_key LIKE 'supreme_court_%' AND it.ends_at>clock_timestamp() AND p.role IN('Juiz Federal','Presidente do STF') AND p.deleted_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.judicial_electoral_assignments a WHERE a.term_id=it.id AND (a.cohort_key=e.cohort OR a.ended_at IS NULL AND a.starts_at<e.end_at AND a.ends_at>e.start_at))
  ORDER BY (SELECT max(created_at) FROM public.judicial_electoral_assignments WHERE profile_id=it.profile_id) ASC NULLS FIRST,it.starts_at,it.id LIMIT needed LOOP
   INSERT INTO public.judicial_electoral_assignments(cohort_key,election_ids,term_id,profile_id,starts_at,ends_at) VALUES(e.cohort,e.ids,chosen.id,chosen.profile_id,e.start_at,e.end_at);
   PERFORM private.institutional_notice(chosen.profile_id,'electoral_duty_assigned','Você foi designado para a administração do Portal Eleitoral durante esta janela. Seu cargo principal continua sendo Juiz.',e.ids[1],jsonb_build_object('starts_at',e.start_at,'ends_at',e.end_at,'election_ids',e.ids));
  END LOOP;
 END LOOP;
END $function$

;

-- Only repair accepted, unresolved legacy nominations with no competing active record.
DO $$ DECLARE i public.minister_invitations%rowtype;BEGIN
 FOR i IN SELECT * FROM public.minister_invitations x WHERE x.office_key LIKE 'supreme_court_%' AND x.status='accepted' AND x.institutional_stage IS NULL AND x.senate_voting_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM public.institutional_terms t WHERE t.invitation_id=x.id)
 AND NOT EXISTS(SELECT 1 FROM public.minister_invitations y WHERE y.office_key=x.office_key AND y.id<>x.id AND y.status='accepted' AND (y.institutional_stage IN('hearing','voting') OR y.created_at>x.created_at)) LOOP
  UPDATE public.minister_invitations SET institutional_stage='hearing' WHERE id=i.id;
  PERFORM public.justice_write_audit('judicial_hearing.legacy_stage_restored','minister_invitation',i.id,to_jsonb(i),jsonb_build_object('institutional_stage','hearing'),'Indicação aceita regularizada sem dispensar a sabatina ou criar votação.');
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
