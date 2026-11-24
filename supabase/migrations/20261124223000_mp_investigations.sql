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

CREATE FUNCTION public.mp_case_evidence_access(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $
 SELECT private.is_mp_investigation(p_id) AND EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=p_id AND public.justice_can_access_case(c.id));
$;
REVOKE ALL ON FUNCTION public.mp_case_evidence_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mp_case_evidence_access(uuid) TO authenticated,service_role;
CREATE POLICY mp_subject_scope ON public.investigation_subjects AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (profile_id=auth.uid() AND notified_at IS NOT NULL AND NOT is_secret));
CREATE POLICY mp_request_scope ON public.judicial_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (target_profile_id=auth.uid() AND status<>'pending'));
CREATE POLICY mp_evidence_scope ON public.case_evidence AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (criminal_case_id IS NOT NULL AND public.justice_can_access_case(criminal_case_id)) OR (confidentiality_level='restricted' AND public.mp_case_evidence_access(investigation_id)));
CREATE POLICY mp_timeline_scope ON public.case_timeline_events AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_investigation_scope(investigation_id) OR (case_id IS NOT NULL AND public.justice_can_access_case(case_id) AND source_table NOT IN ('criminal_investigations','investigation_events','investigation_subjects')));
CREATE POLICY mp_evidence_case_read ON public.case_evidence FOR SELECT TO authenticated USING (confidentiality_level='restricted' AND public.mp_case_evidence_access(investigation_id));

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

CREATE OR REPLACE FUNCTION public.justice_can_access_investigation(p_investigation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when private.is_mp_investigation(p_investigation_id) then public.mp_investigation_scope(p_investigation_id) else (
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
  ) end
$function$;

CREATE OR REPLACE FUNCTION public.add_investigation_subject(p_investigation_id uuid, p_profile_id uuid, p_subject_status text, p_notify_subject boolean, p_notes text DEFAULT NULL::text)
 RETURNS investigation_subjects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.investigation_subjects%rowtype; v_investigation_number text;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

  if not public.justice_has_role(array['Admin','Policial','Police','Delegado']) then raise exception 'Sem competência para vincular investigados.'; end if;
  if p_subject_status not in('under_review','investigated','cleared','indicted') then raise exception 'Situação inválida.'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'Perfil não encontrado.'; end if;
  select ci.investigation_number into v_investigation_number from public.criminal_investigations ci where ci.id=p_investigation_id for update;
  if v_investigation_number is null then raise exception 'Investigação não encontrada.'; end if;
  insert into public.investigation_subjects(investigation_id,profile_id,subject_status,notified_at,is_secret,notes)
  values(p_investigation_id,p_profile_id,p_subject_status,case when p_notify_subject then clock_timestamp() else null end,not p_notify_subject,nullif(trim(p_notes),''))
  on conflict(investigation_id,profile_id) do update set subject_status=excluded.subject_status,notified_at=case when p_notify_subject then coalesce(public.investigation_subjects.notified_at,clock_timestamp()) else public.investigation_subjects.notified_at end,is_secret=case when p_notify_subject then false else public.investigation_subjects.is_secret end,notes=coalesce(excluded.notes,public.investigation_subjects.notes)
  returning * into result;
  if p_notify_subject then perform public.justice_notify(p_profile_id,'investigation_subject_notified','Seu nome foi formalmente vinculado à investigação '||v_investigation_number||'.','/services/justice?view=citizen',jsonb_build_object('investigation_id',p_investigation_id)); end if;
  perform public.justice_write_audit('investigation.subject_linked','investigation_subject',p_investigation_id,null,to_jsonb(result),coalesce(p_notes,'Vínculo de pessoa à investigação'));
  return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.add_investigation_party(p_investigation_id uuid, p_profile_id uuid, p_party_type text, p_notes text DEFAULT NULL::text, p_is_confidential boolean DEFAULT false)
 RETURNS investigation_parties
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.investigation_parties%rowtype;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.record_investigation_evidence(p_investigation_id uuid, p_evidence_type text, p_title text, p_description text, p_file_url text DEFAULT NULL::text, p_evidence_hash text DEFAULT NULL::text, p_seal boolean DEFAULT false)
 RETURNS case_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_investigation public.criminal_investigations%rowtype;
  v_evidence public.case_evidence%rowtype;
  v_status public.justice_evidence_status;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

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
    encode(extensions.digest(concat_ws('|',p_investigation_id::text,btrim(p_title),btrim(p_description),coalesce(p_file_url,'')),'sha256'),'hex'), v_status,
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
  insert into public.evidence_custody_events(evidence_id,event_type,actor_id,justification)
  values(v_evidence.id,case when p_seal then 'sealed' else 'created' end,v_actor,btrim(p_description));
  return v_evidence;
end;
$function$;

CREATE OR REPLACE FUNCTION public.add_case_evidence(p_investigation_id uuid, p_case_id uuid, p_evidence_type text, p_title text, p_description text, p_file_url text DEFAULT NULL::text, p_confidentiality_level text DEFAULT 'restricted'::text)
 RETURNS case_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.case_evidence%rowtype;
begin
  IF private.is_mp_investigation(p_investigation_id) AND (p_case_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.criminal_cases WHERE id=p_case_id AND investigation_id=p_investigation_id)) THEN RAISE EXCEPTION 'Utilize o fluxo do PIC ou o processo judicial vinculado.' USING errcode='42501'; END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.seal_case_evidence(p_evidence_id uuid, p_justification text)
 RETURNS case_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare before_row public.case_evidence%rowtype; after_row public.case_evidence%rowtype;
begin
 if not public.justice_has_role(array['Admin','Delegado','Promotor','Juiz Federal','Perito']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
 if length(trim(coalesce(p_justification,'')))<10 then raise exception 'JUSTIFICATION_REQUIRED'; end if;
 select * into before_row from public.case_evidence where id=p_evidence_id for update;
 if not found then raise exception 'EVIDENCE_NOT_FOUND'; end if;
 IF private.is_mp_investigation(before_row.investigation_id) AND before_row.criminal_case_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.criminal_investigations i WHERE i.id=before_row.investigation_id AND i.status IN('open','in_progress','complement_requested') AND (public.justice_has_role(ARRAY['Promotor']) OR (i.status='complement_requested' AND public.justice_has_role(ARRAY['Delegado'])))) THEN RAISE EXCEPTION 'Sem competência para lacrar prova do PIC.' USING errcode='42501'; END IF;
 if not (coalesce(public.justice_can_access_investigation(before_row.investigation_id),false) or coalesce(public.justice_can_access_case(before_row.criminal_case_id),false)) then raise exception 'CASE_ACCESS_DENIED'; end if;
 if before_row.status='sealed' then return before_row; end if;
 update public.case_evidence set status='sealed',sealed_at=clock_timestamp(),evidence_hash=encode(extensions.digest(concat_ws('|',id::text,version::text,title,description,coalesce(file_url,'')),'sha256'),'hex') where id=p_evidence_id returning * into after_row;
 insert into public.evidence_custody_events(evidence_id,event_type,actor_id,justification) values(p_evidence_id,'sealed',auth.uid(),trim(p_justification));
 if before_row.investigation_id is not null then
  insert into public.investigation_events(investigation_id,event_type,title,description,actor_id,metadata) values(before_row.investigation_id,'evidence_sealed','Prova lacrada',before_row.title,auth.uid(),jsonb_build_object('evidence_id',p_evidence_id));
 end if;
 perform public.justice_write_audit('evidence.sealed','case_evidence',p_evidence_id,to_jsonb(before_row),to_jsonb(after_row),p_justification);
 return after_row;
end $function$;

CREATE OR REPLACE FUNCTION public.request_judicial_warrant(p_investigation_id uuid, p_target_profile_id uuid, p_warrant_type text, p_justification text, p_duration_rp_days numeric DEFAULT 7)
 RETURNS judicial_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.judicial_requests%rowtype;
  v_real_seconds bigint;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN
 IF NOT public.justice_has_role(ARRAY['Promotor']) OR NOT EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=p_investigation_id AND status IN('open','in_progress','complement_requested','sent_to_prosecutor')) OR NOT EXISTS(SELECT 1 FROM public.investigation_subjects WHERE investigation_id=p_investigation_id AND profile_id=p_target_profile_id AND subject_status<>'cleared') OR p_duration_rp_days IS NULL OR p_duration_rp_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Pedido exige MP, investigado vinculado e prazo de 1 a 30 dias RP.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 END IF;

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

  IF private.is_mp_investigation(p_investigation_id) THEN PERFORM public.justice_notify(p.id,'mp_judicial_request','Novo pedido judicial do Ministério Público.','/services/justice?view=authority',jsonb_build_object('request_id',v_row.id)) FROM public.profiles p WHERE p.role IN('Juiz Federal','Presidente do STF') AND p.deleted_at IS NULL; END IF;
  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_investigation(p_investigation_id uuid, p_outcome text, p_conclusion text, p_recommended_action text DEFAULT NULL::text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

  if not public.justice_has_role(array['Admin', 'Delegado']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if p_outcome not in ('indict', 'no_indictment') then raise exception 'INVALID_INVESTIGATION_OUTCOME'; end if;
  if length(btrim(coalesce(p_conclusion, ''))) < 40 then raise exception 'CONCLUSION_TOO_SHORT'; end if;

  select * into v_old from public.criminal_investigations where id = p_investigation_id for update;
  if not found then raise exception 'INVESTIGATION_NOT_FOUND'; end if;
  if v_old.status='sent_to_prosecutor' and p_outcome='indict' and v_old.conclusion=btrim(p_conclusion) then return v_old; end if;
  if v_old.status not in ('open', 'in_progress', 'delegate_review', 'complement_requested') then
    raise exception 'INVESTIGATION_ALREADY_RESOLVED';
  end if;

  if p_outcome = 'indict' then
    if not exists (
      select 1 from public.investigation_parties
      where investigation_id = p_investigation_id and party_type = 'suspect'
        and not exists(select 1 from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.profile_id=public.investigation_parties.profile_id and s.subject_status='cleared')
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
  if p_outcome='indict' then
    update public.investigation_subjects set subject_status='indicted' where investigation_id=p_investigation_id and subject_status<>'cleared';
    perform public.justice_notify(p.id,'investigation_referred','Nova investigação foi remetida ao Ministério Público.','/services/justice',jsonb_build_object('investigation_id',p_investigation_id))
    from public.profiles p where (public.is_admin(p.id) or p.role in('Promotor','Procurador-Geral da República','Admin')) and p.deleted_at is null;
    perform public.justice_notify(s.profile_id,'investigation_indicted','Você foi formalmente indiciado em uma investigação.','/services/justice?view=citizen',jsonb_build_object('investigation_id',p_investigation_id))
    from public.investigation_subjects s where s.investigation_id=p_investigation_id and s.subject_status='indicted' and not s.is_secret;
  end if;
  return v_new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_investigation_to_prosecutor(p_investigation_id uuid, p_conclusion text, p_recommended_action text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old public.criminal_investigations%rowtype;
  v_new public.criminal_investigations%rowtype;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.request_investigation_complement(p_investigation_id uuid, p_reason text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old public.criminal_investigations%rowtype; v_new public.criminal_investigations%rowtype;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.archive_referred_investigation(p_investigation_id uuid, p_reason text)
 RETURNS criminal_investigations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.criminal_investigations%rowtype;
BEGIN
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Utilize o fluxo de investigação própria do MP.' USING errcode='42501'; END IF;

 IF NOT public.justice_has_role(ARRAY['Admin','Promotor']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'CONCLUSION_TOO_SHORT'; END IF;
 SELECT * INTO r FROM public.criminal_investigations WHERE id=p_investigation_id FOR UPDATE;
 IF r.status IS DISTINCT FROM 'sent_to_prosecutor' THEN RAISE EXCEPTION 'INVESTIGATION_NOT_WITH_PROSECUTOR'; END IF;
 IF EXISTS(SELECT 1 FROM public.criminal_cases WHERE investigation_id=r.id) THEN RAISE EXCEPTION 'INVESTIGATION_ALREADY_CHARGED'; END IF;
 UPDATE public.criminal_investigations SET status='archived',conclusion=btrim(p_reason),closed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id) VALUES(r.id,'prosecutor_archived','Arquivamento pelo Ministério Público',p_reason,auth.uid());
 PERFORM public.justice_write_audit('investigation.prosecutor_archived','criminal_investigation',r.id,null,to_jsonb(r),p_reason);
 RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.file_criminal_charges(p_investigation_id uuid, p_defendant_id uuid, p_title text, p_facts text, p_charges jsonb)
 RETURNS criminal_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_case public.criminal_cases%rowtype;
  v_charge jsonb;
  v_penal public.penal_code%rowtype; v_fact_at timestamptz; v_snapshot jsonb;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN IF NOT public.justice_has_role(ARRAY['Promotor']) OR NOT EXISTS(SELECT 1 FROM public.case_evidence WHERE investigation_id=p_investigation_id AND status='sealed') THEN RAISE EXCEPTION 'Denúncia do PIC exige Ministério Público e prova lacrada.' USING errcode='42501'; END IF; PERFORM public.assert_admin_real_action(auth.uid()); END IF;

  if not public.justice_has_role(array['Admin', 'Promotor']) then
    raise exception 'ROLE_NOT_AUTHORIZED';
  end if;
  perform public.process_due_legal_effects();
  perform id from public.criminal_investigations where id=p_investigation_id for update;
  select c.* into v_case from public.criminal_cases c join public.case_parties p on p.case_id=c.id where c.investigation_id=p_investigation_id and p.profile_id=p_defendant_id and p.party_type='defendant';
  if found then if v_case.summary=btrim(p_facts) and v_case.prosecutor_id=auth.uid() then return v_case; end if; raise exception 'INVESTIGATION_ALREADY_CHARGED'; end if;
  if length(trim(coalesce(p_facts, ''))) < 40 then raise exception 'FACTS_TOO_SHORT'; end if;
  if jsonb_typeof(p_charges) IS DISTINCT FROM 'array' or jsonb_array_length(p_charges) = 0 then
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

  if exists(select 1 from public.investigation_subjects where investigation_id=p_investigation_id and profile_id=p_defendant_id and subject_status='cleared') then raise exception 'DEFENDANT_NOT_INVESTIGATION_SUSPECT'; end if;
  select coalesce(i.facts_occurred_at,o.occurred_at,i.opened_at) into v_fact_at from public.criminal_investigations i left join public.police_occurrences o on o.id=i.occurrence_id where i.id=p_investigation_id;
  insert into public.criminal_cases(
    case_number, investigation_id, prosecutor_id, status, title, summary, filed_at, facts_occurred_at
  )
  values (
    public.justice_next_number('GOV'), p_investigation_id, (select auth.uid()),
    'charge_filed', trim(p_title), trim(p_facts), now(),v_fact_at
  )
  returning * into v_case;

  insert into public.case_parties(case_id, profile_id, party_type, representation_status)
  values
    (v_case.id, p_defendant_id, 'defendant', 'pending'),
    (v_case.id, (select auth.uid()), 'prosecutor', 'active');

  for v_charge in select * from jsonb_array_elements(p_charges)
  loop
    select * into v_penal from public.penal_code
    where id = (v_charge->>'penal_code_id')::uuid;
    if not found then raise exception 'INVALID_PENAL_CODE'; end if;

    v_snapshot:=public.penal_rule_at(v_penal.id,v_fact_at);
    if not coalesce((v_snapshot->>'active')::boolean,false) then raise exception 'INVALID_PENAL_CODE'; end if;
    insert into public.case_charges(
      case_id, defendant_id, penal_code_id, charge_description,
      aggravating_factors, mitigating_factors, requested_sentence, attempted, legal_snapshot
    )
    values (
      v_case.id, p_defendant_id, v_penal.id,
      coalesce(nullif(trim(v_charge->>'description'), ''), v_penal.name),
      coalesce(v_charge->'aggravating_factors', '[]'::jsonb),
      coalesce(v_charge->'mitigating_factors', '[]'::jsonb),
      nullif(v_charge->>'requested_sentence', '')::numeric,
      coalesce((v_charge->>'attempted')::boolean, false),v_snapshot
    );
  end loop;

  perform public.justice_assign_case_judge(v_case.id);
  select * into v_case from public.criminal_cases where id = v_case.id;

  perform public.justice_write_audit(
    'case.charges_filed', 'criminal_case', v_case.id,
    null, to_jsonb(v_case), p_facts
  );

  IF private.is_mp_investigation(p_investigation_id) THEN
    UPDATE public.investigation_subjects SET notified_at=coalesce(notified_at,clock_timestamp()),is_secret=false WHERE investigation_id=p_investigation_id AND profile_id=p_defendant_id;
    PERFORM public.justice_notify(p_defendant_id,'mp_charge_filed','O Ministério Público apresentou denúncia; acompanhe o processo judicial.','/services/justice?view=citizen',jsonb_build_object('case_id',v_case.id));
  END IF;
  return v_case;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_agies_investigation_links(p_mission_id uuid)
 RETURNS TABLE(id uuid, number text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform private.assert_agies();if not private.agies_manager() then raise exception 'Consulta restrita à direção.' using errcode='42501';end if;
 return query select c.id,c.investigation_number from public.criminal_investigations c join public.investigation_subjects s on s.investigation_id=c.id join public.agies_missions m on m.target_id=s.profile_id where m.id=p_mission_id and c.origin='police' and c.status not in ('closed','archived') order by c.opened_at desc;
end $function$;

CREATE OR REPLACE FUNCTION public.request_agies_financial_authorization(p_mission_id uuid, p_investigation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare op public.agies_missions%rowtype;request_id uuid;
begin
  IF private.is_mp_investigation(p_investigation_id) THEN RAISE EXCEPTION 'Este fluxo exige investigação policial.' USING errcode='42501'; END IF;

 perform private.assert_agies();if not private.agies_manager() then raise exception 'O pedido exige a direção da AGIES.' using errcode='42501';end if;
 select * into op from public.agies_missions where id=p_mission_id for update;
 if op.id is null or op.operation_type<>'financial' or op.status<>'active' then raise exception 'Selecione uma operação financeira ativa.';end if;
 if op.judicial_request_id is not null then return op.judicial_request_id;end if;
 if not exists(select 1 from public.criminal_investigations where id=p_investigation_id and status not in ('closed','archived')) or not exists(select 1 from public.investigation_subjects where investigation_id=p_investigation_id and profile_id=op.target_id) then raise exception 'Vincule uma investigação policial aberta na qual o alvo esteja formalmente cadastrado.';end if;
 insert into public.judicial_requests(request_type,requested_by,investigation_id,target_profile_id,justification,expires_at,metadata)
 values('rp_confidentiality_break',auth.uid(),p_investigation_id,op.target_id,op.justification,clock_timestamp()+make_interval(hours=>(select (value->>'financial_access_hours')::int from public.system_settings where key='agies_rules')),jsonb_build_object('agies_mission_id',op.id,'scope','rp_bank_transactions','limit',100)) returning id into request_id;
 update public.agies_missions set judicial_request_id=request_id where id=op.id;
 perform private.agies_audit('judicial_authorization_requested',op.id,op.justification,jsonb_build_object('request',request_id,'investigation',p_investigation_id));
 perform public.justice_notify(p.id,'agies_judicial_request','Pedido de acesso financeiro fictício aguarda decisão judicial.','/services/justice?view=authority',jsonb_build_object('request_id',request_id)) from public.profiles p where p.role='Juiz Federal' and p.deleted_at is null;
 return request_id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_public_wanted_list()
 RETURNS TABLE(profile_id uuid, full_name text, avatar_url text, warrant_number text, warrant_type text, issued_at timestamp with time zone, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p.id,p.full_name,coalesce(nullif(p.x_avatar_url,''),p.avatar_url),w.warrant_number,w.warrant_type,w.issued_at,w.expires_at
 from public.warrants w join public.profiles p on p.id=w.target_profile_id
 left join public.criminal_cases c on c.id=w.case_id left join public.criminal_investigations i on i.id=w.investigation_id left join public.police_occurrences o on o.id=i.occurrence_id
 where w.warrant_type='arrest' and w.status='issued' and (w.expires_at is null or w.expires_at>clock_timestamp()) and p.deleted_at is null
 and (i.origin IS DISTINCT FROM 'mp' OR (c.id IS NOT NULL AND c.confidentiality_level='public')) and coalesce(c.confidentiality_level,'public')='public' and coalesce(o.confidentiality_level,'public')='public';
$function$;

CREATE OR REPLACE FUNCTION public.transition_integrity_case(p_case_id uuid, p_new_status text, p_summary text, p_investigation_id uuid DEFAULT NULL::uuid, p_commission_id uuid DEFAULT NULL::uuid)
 RETURNS public_integrity_cases
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 actor uuid:=auth.uid(); c public.public_integrity_cases%rowtype; result public.public_integrity_cases%rowtype;
 inv public.criminal_investigations%rowtype; inv_id uuid; accused uuid[]; person uuid;
 police boolean; mp boolean; judge boolean; admin boolean; editor boolean;
 outcome text; decision_id uuid; decision_ids uuid[]:='{}'; found_conviction boolean:=false; assigned_judge boolean:=false;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre para continuar.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(actor);
 IF length(btrim(coalesce(p_summary,'')))<20 OR length(p_summary)>20000 THEN RAISE EXCEPTION 'Fundamente a movimentação entre 20 e 20.000 caracteres.'; END IF;
 SELECT * INTO c FROM public.public_integrity_cases WHERE id=p_case_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Caso de integridade não encontrado.'; END IF;
 IF c.institutional_term_id IS NOT NULL OR c.source_type='judicial_impeachment' THEN
   RAISE EXCEPTION 'Utilize o procedimento específico de responsabilidade judicial do Senado.' USING errcode='42501';
 END IF;
 police:=public.justice_has_role(ARRAY['Policial','Police','Delegado']);
 mp:=public.justice_has_role(ARRAY['Promotor']);
 judge:=public.justice_has_role(ARRAY['Juiz Federal']);
 admin:=public.justice_has_role(ARRAY['Admin']);
 editor:=EXISTS(SELECT 1 FROM public.media_outlets WHERE editor_id=actor AND is_active);
 IF p_commission_id IS NOT NULL AND p_commission_id IS DISTINCT FROM c.commission_id THEN
   RAISE EXCEPTION 'O vínculo parlamentar deve ser registrado no procedimento da comissão.';
 END IF;
 IF p_investigation_id IS NOT NULL AND (c.investigation_id IS NOT NULL AND c.investigation_id<>p_investigation_id OR c.status NOT IN ('suspicion','journalistic_investigation','police_investigation')) THEN
   RAISE EXCEPTION 'Não é permitido substituir a investigação vinculada.';
 END IF;
 inv_id:=coalesce(c.investigation_id,p_investigation_id);
 accused:=coalesce(c.accused_profiles,'{}');
 IF inv_id IS NOT NULL THEN
   SELECT * INTO inv FROM public.criminal_investigations WHERE id=inv_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Investigação não encontrada.'; END IF;
   IF inv.origin='mp' THEN RAISE EXCEPTION 'O PIC possui fluxo próprio no Ministério Público.'; END IF;
   IF cardinality(accused)>0 AND EXISTS(SELECT 1 FROM unnest(accused) a(id) WHERE NOT EXISTS(SELECT 1 FROM public.investigation_parties ip WHERE ip.investigation_id=inv_id AND ip.profile_id=a.id AND ip.party_type='suspect')) THEN
     RAISE EXCEPTION 'A investigação não corresponde às pessoas do caso de integridade.';
   END IF;
   IF cardinality(accused)=0 THEN
     SELECT coalesce(array_agg(DISTINCT ip.profile_id),'{}') INTO accused FROM public.investigation_parties ip WHERE ip.investigation_id=inv_id AND ip.party_type='suspect' AND ip.profile_id IS NOT NULL;
   END IF;
 END IF;
 CASE p_new_status
 WHEN 'journalistic_investigation' THEN
   IF c.status<>'suspicion' OR NOT (editor OR admin) THEN RAISE EXCEPTION 'A etapa jornalística exige editor autorizado.' USING errcode='42501'; END IF;
   IF p_investigation_id IS NOT NULL THEN RAISE EXCEPTION 'O vínculo policial pertence à etapa de investigação.'; END IF;
 WHEN 'police_investigation' THEN
   IF c.status NOT IN ('suspicion','journalistic_investigation') OR NOT(police OR admin) THEN RAISE EXCEPTION 'A investigação policial compete à Polícia.' USING errcode='42501'; END IF;
   IF inv_id IS NULL OR inv.status NOT IN ('open','in_progress','delegate_review','complement_requested','sent_to_prosecutor') THEN RAISE EXCEPTION 'Vincule uma investigação policial válida.'; END IF;
 WHEN 'public_prosecution' THEN
   IF c.status<>'police_investigation' OR NOT(mp OR admin) THEN RAISE EXCEPTION 'A análise da acusação compete ao Ministério Público.' USING errcode='42501'; END IF;
   IF inv_id IS NULL OR inv.status<>'sent_to_prosecutor' OR cardinality(accused)=0 THEN RAISE EXCEPTION 'Aguarde a remessa formal da investigação ao MP.'; END IF;
 WHEN 'judicial_process' THEN
   IF c.status<>'public_prosecution' OR NOT(mp OR admin) THEN RAISE EXCEPTION 'O oferecimento da denúncia compete ao Ministério Público.' USING errcode='42501'; END IF;
   IF inv_id IS NULL OR cardinality(accused)=0 OR EXISTS(SELECT 1 FROM unnest(accused) a(id) WHERE NOT EXISTS(SELECT 1 FROM public.criminal_cases cc JOIN public.case_parties cp ON cp.case_id=cc.id WHERE cc.investigation_id=inv_id AND cp.profile_id=a.id AND cp.party_type='defendant')) THEN
     RAISE EXCEPTION 'Ofereça a denúncia no módulo judicial antes de movimentar o caso.';
   END IF;
 WHEN 'archived' THEN
   IF NOT ((c.status IN ('suspicion','journalistic_investigation') AND (police OR mp OR admin)) OR (c.status='police_investigation' AND (police OR admin) AND inv_id IS NOT NULL AND inv.status='archived') OR (c.status='public_prosecution' AND (mp OR admin) AND inv_id IS NOT NULL AND inv.status='archived')) THEN RAISE EXCEPTION 'Arquivamento exige autoridade competente e, quando vinculada, investigação arquivada.' USING errcode='42501'; END IF;
   IF inv_id IS NOT NULL AND inv.status<>'archived' THEN RAISE EXCEPTION 'Arquive primeiro a investigação no módulo competente.'; END IF;
 WHEN 'convicted','acquitted' THEN
   IF c.status<>'judicial_process' OR NOT judge THEN RAISE EXCEPTION 'Somente magistrado em exercício pode registrar o resultado judicial.' USING errcode='42501'; END IF;
   IF inv_id IS NULL OR cardinality(accused)=0 THEN RAISE EXCEPTION 'Não existe investigação e acusação vinculadas.'; END IF;
   FOREACH person IN ARRAY accused LOOP
     -- The latest sentence for the accused must be final or upheld on appeal.
     -- Never infer a verdict from a case status alone or a granted/partial appeal.
     SELECT d.id,d.result INTO decision_id,outcome
     FROM public.criminal_cases cc
     JOIN public.case_parties cp ON cp.case_id=cc.id AND cp.party_type='defendant' AND cp.profile_id=person
     JOIN LATERAL (SELECT jd.* FROM public.judicial_decisions jd WHERE jd.case_id=cc.id AND jd.decision_type='sentence' ORDER BY jd.issued_at DESC,jd.id DESC LIMIT 1) d ON true
     WHERE cc.investigation_id=inv_id AND cc.status::text IN ('final','execution','served')
       AND d.judge_id IS NOT NULL AND d.result IN ('conviction','partial_conviction','acquittal')
       AND NOT EXISTS(SELECT 1 FROM public.appeals a WHERE a.case_id=cc.id AND a.status IN ('filed','under_review'))
       AND NOT EXISTS(SELECT 1 FROM public.appeals a WHERE a.decision_id=d.id AND a.status IN ('granted','partially_granted'))
       AND (d.is_final OR EXISTS(SELECT 1 FROM public.appeals a WHERE a.decision_id=d.id AND a.status='denied' AND a.reviewing_judge_id IS NOT NULL AND a.decided_at IS NOT NULL))
       AND ((d.result='acquittal' AND EXISTS(SELECT 1 FROM public.case_charges ch WHERE ch.case_id=cc.id AND ch.defendant_id=person AND ch.status='acquitted') AND NOT EXISTS(SELECT 1 FROM public.case_charges ch WHERE ch.case_id=cc.id AND ch.defendant_id=person AND ch.status IN ('filed','admitted','convicted')))
        OR (d.result IN ('conviction','partial_conviction') AND EXISTS(SELECT 1 FROM public.sentences s WHERE s.decision_id=d.id AND s.case_id=cc.id AND s.defendant_id=person AND s.status IN ('final','serving','served'))))
     ORDER BY d.issued_at DESC,d.id DESC LIMIT 1;
     IF decision_id IS NULL THEN RAISE EXCEPTION 'Aguarde decisão judicial definitiva e verificável para todas as pessoas acusadas.'; END IF;
     decision_ids:=array_append(decision_ids,decision_id);
     found_conviction:=found_conviction OR outcome IN ('conviction','partial_conviction');
     assigned_judge:=assigned_judge OR EXISTS(SELECT 1 FROM public.judicial_decisions jd JOIN public.criminal_cases cc ON cc.id=jd.case_id WHERE jd.id=decision_id AND (cc.judge_id=actor OR EXISTS(SELECT 1 FROM public.appeals a WHERE a.decision_id=jd.id AND a.reviewing_judge_id=actor AND a.status='denied')));
   END LOOP;
   IF NOT assigned_judge THEN RAISE EXCEPTION 'O registro compete ao magistrado responsável pelo processo ou recurso vinculado.' USING errcode='42501'; END IF;
   IF (p_new_status='convicted') IS DISTINCT FROM found_conviction THEN RAISE EXCEPTION 'O resultado solicitado não corresponde às decisões judiciais definitivas.'; END IF;
 ELSE RAISE EXCEPTION 'Transição de integridade inválida.';
 END CASE;
 UPDATE public.public_integrity_cases SET status=p_new_status,investigation_id=inv_id,accused_profiles=accused,updated_at=clock_timestamp() WHERE id=c.id RETURNING * INTO result;
 INSERT INTO public.public_integrity_case_events(case_id,previous_status,new_status,summary,actor_id) VALUES(c.id,c.status,p_new_status,btrim(p_summary),actor);
 PERFORM public.justice_write_audit('integrity.transition','public_integrity_case',c.id,to_jsonb(c),to_jsonb(result)||jsonb_build_object('judicial_decision_ids',decision_ids),p_summary);
 IF p_new_status='convicted' THEN PERFORM public.apply_government_impact('integrity','corruption_conviction','Condenação em caso de integridade pública.',-6,-2,'public_integrity_cases',p_case_id::text,'{}'); END IF;
 RETURN result;
END $function$;

NOTIFY pgrst,'reload schema';
