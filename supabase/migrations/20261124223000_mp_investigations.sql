-- Procedimento investigatório criminal (PIC), independente de boletim policial.
ALTER TABLE public.criminal_investigations ALTER COLUMN occurrence_id DROP NOT NULL;
ALTER TABLE public.criminal_investigations ADD COLUMN origin text NOT NULL DEFAULT 'police';
ALTER TABLE public.criminal_investigations ADD COLUMN facts_occurred_at timestamptz;
ALTER TABLE public.criminal_investigations ADD CONSTRAINT criminal_investigations_origin_check CHECK ((origin='police' AND occurrence_id IS NOT NULL) OR (origin='mp' AND occurrence_id IS NULL AND facts_occurred_at IS NOT NULL));

CREATE FUNCTION private.is_mp_investigation(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=p_id AND origin='mp');
$$;
REVOKE ALL ON FUNCTION private.is_mp_investigation(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mp_investigation_scope(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT private.is_mp_investigation(p_id) OR (auth.uid() IS NOT NULL AND (
   public.justice_has_role(ARRAY['Admin','Promotor'])
   OR EXISTS(SELECT 1 FROM public.criminal_investigations i WHERE i.id=p_id AND i.status='complement_requested' AND public.justice_has_role(ARRAY['Delegado']))
   OR (public.justice_has_role(ARRAY['Juiz Federal']) AND EXISTS(SELECT 1 FROM public.judicial_requests q WHERE q.investigation_id=p_id AND (q.status='pending' OR q.decided_by=auth.uid())))
   OR (public.justice_has_role(ARRAY['Juiz Federal']) AND EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=p_id AND (c.judge_id=auth.uid() OR EXISTS(SELECT 1 FROM public.appeals a WHERE a.case_id=c.id AND a.reviewing_judge_id=auth.uid()))))
 ));
$$;
REVOKE ALL ON FUNCTION public.mp_investigation_scope(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mp_investigation_scope(uuid) TO authenticated,service_role;

CREATE POLICY mp_subject_scope ON public.investigation_subjects AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (profile_id=auth.uid() AND notified_at IS NOT NULL AND NOT is_secret));
CREATE POLICY mp_request_scope ON public.judicial_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (target_profile_id=auth.uid() AND status<>'pending'));
CREATE POLICY mp_evidence_scope ON public.case_evidence AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (criminal_case_id IS NOT NULL AND public.justice_can_access_case(criminal_case_id)) OR (confidentiality_level='restricted' AND EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=case_evidence.investigation_id AND public.justice_can_access_case(c.id))));
CREATE POLICY mp_timeline_scope ON public.case_timeline_events AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (case_id IS NOT NULL AND public.justice_can_access_case(case_id) AND source_table NOT IN ('criminal_investigations','investigation_events','investigation_subjects')));
CREATE POLICY mp_evidence_case_read ON public.case_evidence FOR SELECT TO authenticated USING (investigation_id IS NOT NULL AND confidentiality_level='restricted' AND EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=case_evidence.investigation_id AND public.justice_can_access_case(c.id)));

CREATE FUNCTION public.open_mp_investigation(p_summary text,p_facts_occurred_at timestamptz DEFAULT now())
RETURNS public.criminal_investigations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.criminal_investigations%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Promotor']) THEN RAISE EXCEPTION 'Somente o Ministério Público pode instaurar PIC.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(coalesce(p_summary,''))) NOT BETWEEN 40 AND 20000 OR p_facts_occurred_at IS NULL OR p_facts_occurred_at>clock_timestamp() THEN RAISE EXCEPTION 'Informe os fatos (40 a 20.000 caracteres) e sua data válida.'; END IF;
 INSERT INTO public.criminal_investigations(origin,investigation_number,summary,status,created_by,facts_occurred_at) VALUES('mp',public.justice_next_number('PIC'),btrim(p_summary),'in_progress',auth.uid(),p_facts_occurred_at) RETURNING * INTO i;
 INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id) VALUES(i.id,'investigation_opened','PIC instaurado pelo MP',i.summary,auth.uid());
 PERFORM public.justice_write_audit('mp.investigation_opened','criminal_investigation',i.id,NULL,to_jsonb(i),p_summary);
 RETURN i;
END $$;
REVOKE ALL ON FUNCTION public.open_mp_investigation(text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_mp_investigation(text,timestamptz) TO authenticated,service_role;

CREATE FUNCTION public.move_mp_investigation(p_id uuid,p_action text,p_reason text,p_profile_id uuid DEFAULT NULL,p_title text DEFAULT NULL,p_subject_status text DEFAULT 'under_review',p_notify boolean DEFAULT false)
RETURNS public.criminal_investigations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.criminal_investigations%rowtype; old_i public.criminal_investigations%rowtype; next_status text; event_title text; director uuid; ev public.case_evidence%rowtype; subject public.investigation_subjects%rowtype; party public.investigation_parties%rowtype; is_mp boolean; is_director boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 is_mp:=public.justice_has_role(ARRAY['Promotor']);
 is_director:=public.justice_has_role(ARRAY['Delegado']);
 IF NOT (is_mp OR (is_director AND p_action IN('reply','evidence'))) THEN RAISE EXCEPTION 'Sem competência para esta ação do PIC.' USING errcode='42501'; END IF;
 SELECT * INTO i FROM public.criminal_investigations WHERE id=p_id AND origin='mp' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PIC não encontrado.'; END IF;
 old_i:=i;
 IF NOT is_mp AND (NOT is_director OR i.status<>'complement_requested') THEN RAISE EXCEPTION 'A Polícia somente atua durante diligência solicitada.' USING errcode='42501'; END IF;
 IF p_action='reply' AND NOT is_director THEN RAISE EXCEPTION 'A resposta compete à Diretoria da Polícia.' USING errcode='42501'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 40 AND 20000 THEN RAISE EXCEPTION 'Fundamente a ação com 40 a 20.000 caracteres.'; END IF;
 IF EXISTS(SELECT 1 FROM public.criminal_cases WHERE investigation_id=i.id) THEN RAISE EXCEPTION 'A denúncia já foi oferecida; utilize o processo judicial.'; END IF;
 IF p_action IN('subject','witness','evidence') AND i.status NOT IN('open','in_progress','complement_requested') THEN RAISE EXCEPTION 'PIC não está aberto para instrução.'; END IF;
 IF p_action IN('subject','witness') AND (p_profile_id IS NULL OR p_profile_id=auth.uid() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile_id AND deleted_at IS NULL)) THEN RAISE EXCEPTION 'Selecione outra pessoa ativa.'; END IF;
 next_status:=i.status;
 CASE p_action
 WHEN 'subject' THEN
  IF p_subject_status NOT IN('under_review','investigated','cleared') OR p_subject_status IS NULL THEN RAISE EXCEPTION 'Situação inválida para PIC.'; END IF;
  INSERT INTO public.investigation_subjects(investigation_id,profile_id,subject_status,notified_at,is_secret,notes)
  VALUES(i.id,p_profile_id,p_subject_status,case when p_notify then clock_timestamp() else null end,not coalesce(p_notify,false),btrim(p_reason))
  ON CONFLICT(investigation_id,profile_id) DO UPDATE SET subject_status=excluded.subject_status,notified_at=coalesce(public.investigation_subjects.notified_at,excluded.notified_at),is_secret=public.investigation_subjects.is_secret AND excluded.is_secret,notes=excluded.notes
  RETURNING * INTO subject;
  IF p_notify THEN PERFORM public.justice_notify(p_profile_id,'investigation_subject_notified','Seu nome foi formalmente vinculado ao PIC '||i.investigation_number||'.','/services/justice?view=citizen',jsonb_build_object('investigation_id',i.id)); END IF;
  event_title:='Situação de investigado registrada';
 WHEN 'witness' THEN
  INSERT INTO public.investigation_parties(investigation_id,profile_id,party_type,notes,is_confidential,added_by) VALUES(i.id,p_profile_id,'witness',btrim(p_reason),true,auth.uid()) ON CONFLICT(investigation_id,profile_id,party_type) DO NOTHING RETURNING * INTO party;
  IF party.id IS NULL THEN RAISE EXCEPTION 'Testemunha já vinculada.'; END IF;
  event_title:='Testemunha vinculada sob sigilo';
 WHEN 'evidence' THEN
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 5 AND 200 THEN RAISE EXCEPTION 'Informe título da prova de 5 a 200 caracteres.'; END IF;
  INSERT INTO public.case_evidence(investigation_id,evidence_type,title,description,submitted_by,status,confidentiality_level,metadata)
  VALUES(i.id,'document',btrim(p_title),btrim(p_reason),auth.uid(),'collected','restricted',jsonb_build_object('origin','mp')) RETURNING * INTO ev;
  INSERT INTO public.evidence_custody_events(evidence_id,event_type,actor_id,justification) VALUES(ev.id,'created',auth.uid(),btrim(p_reason));
  PERFORM public.seal_case_evidence(ev.id,'Lacre de prova registrada no PIC: '||btrim(p_reason));
  event_title:='Prova registrada e lacrada';
 WHEN 'diligence' THEN
  IF i.status NOT IN('open','in_progress','sent_to_prosecutor') THEN RAISE EXCEPTION 'PIC não disponível para nova diligência.'; END IF;
  SELECT id INTO director FROM public.profiles WHERE role='Diretor-Geral de Polícia' AND deleted_at IS NULL LIMIT 1;
  IF director IS NULL THEN RAISE EXCEPTION 'Não há Diretor-Geral de Polícia em exercício.'; END IF;
  next_status:='complement_requested'; event_title:='Diligência solicitada à Polícia';
 WHEN 'reply' THEN
  IF i.status<>'complement_requested' THEN RAISE EXCEPTION 'Nenhuma diligência pendente.'; END IF;
  next_status:='in_progress'; event_title:='Resposta policial à diligência';
 WHEN 'ready' THEN
  IF i.status NOT IN('open','in_progress') THEN RAISE EXCEPTION 'Conclua as diligências antes de preparar a denúncia.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.investigation_subjects WHERE investigation_id=i.id AND subject_status IN('investigated','under_review')) OR NOT EXISTS(SELECT 1 FROM public.case_evidence WHERE investigation_id=i.id AND status='sealed') THEN RAISE EXCEPTION 'Vincule investigado e lacre pelo menos uma prova.'; END IF;
  next_status:='sent_to_prosecutor'; event_title:='PIC concluído para oferecimento de denúncia';
 WHEN 'archive' THEN
  IF i.status NOT IN('open','in_progress','complement_requested','sent_to_prosecutor') THEN RAISE EXCEPTION 'PIC não disponível para arquivamento.'; END IF;
  next_status:='archived'; event_title:='PIC arquivado pelo Ministério Público';
 ELSE RAISE EXCEPTION 'Ação inválida.';
 END CASE;
 UPDATE public.criminal_investigations SET status=next_status,conclusion=case when p_action IN('ready','archive') then btrim(p_reason) else conclusion end,closed_at=case when p_action='archive' then clock_timestamp() else null end WHERE id=i.id RETURNING * INTO i;
 INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id,metadata) VALUES(i.id,'mp_'||p_action,event_title,btrim(p_reason),auth.uid(),jsonb_build_object('action',p_action,'evidence_id',ev.id,'profile_id',p_profile_id));
 PERFORM public.justice_write_audit('mp.'||p_action,'criminal_investigation',i.id,to_jsonb(old_i),to_jsonb(i),p_reason);
 IF p_action='diligence' THEN PERFORM public.justice_notify(director,'mp_diligence_requested','O Ministério Público solicitou diligências no PIC.','/services/justice?view=authority',jsonb_build_object('investigation_id',i.id)); END IF;
 IF p_action='reply' THEN PERFORM public.justice_notify(p.id,'mp_diligence_replied','A Polícia respondeu à diligência do PIC.','/services/justice?view=authority',jsonb_build_object('investigation_id',i.id)) FROM public.profiles p WHERE p.role IN('Promotor','Procurador-Geral da República') AND p.deleted_at IS NULL; END IF;
 IF p_action='archive' THEN PERFORM public.justice_notify(s.profile_id,'mp_investigation_archived','O PIC '||i.investigation_number||' foi arquivado.','/services/justice?view=citizen',jsonb_build_object('investigation_id',i.id)) FROM public.investigation_subjects s WHERE s.investigation_id=i.id AND s.notified_at IS NOT NULL AND NOT s.is_secret; END IF;
 RETURN i;
END $$;
REVOKE ALL ON FUNCTION public.move_mp_investigation(uuid,text,text,uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.move_mp_investigation(uuid,text,text,uuid,text,text,boolean) TO authenticated,service_role;
