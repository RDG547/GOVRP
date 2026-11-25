-- Enhanced MP requests: the judicial order is distinct from the request.
CREATE FUNCTION private.mp_request_target_valid(p_investigation uuid,p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_target IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles WHERE id=p_target AND deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.investigation_subjects WHERE investigation_id=p_investigation AND profile_id=p_target AND subject_status='cleared')
 AND (EXISTS(SELECT 1 FROM public.investigation_subjects WHERE investigation_id=p_investigation AND profile_id=p_target AND subject_status IN('under_review','investigated','indicted')) OR EXISTS(SELECT 1 FROM public.investigation_parties WHERE investigation_id=p_investigation AND profile_id=p_target AND party_type='suspect'));
$$;
REVOKE ALL ON FUNCTION private.mp_request_target_valid(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.mp_request_judge_eligible(p_request public.judicial_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.justice_has_role(ARRAY['Juiz Federal'])
 AND auth.uid() IS DISTINCT FROM p_request.requested_by AND auth.uid() IS DISTINCT FROM p_request.target_profile_id
 AND NOT EXISTS(SELECT 1 FROM public.investigation_parties ip WHERE ip.investigation_id=p_request.investigation_id AND ip.profile_id=auth.uid())
 AND NOT EXISTS(SELECT 1 FROM public.criminal_investigations i WHERE i.id=p_request.investigation_id AND auth.uid() IN(i.created_by,i.lead_officer_id,i.delegate_id))
 AND (p_request.case_id IS NULL OR EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.id=p_request.case_id AND c.judge_id=auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.mp_request_judge_eligible(public.judicial_requests) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.mp_judicial_request_visible(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.judicial_requests r WHERE r.id=p_id AND (coalesce(r.metadata->>'origin','')<>'mp_warrant_v2' OR (auth.uid() IS NOT NULL AND (public.justice_has_role(ARRAY['Admin','Promotor']) OR (public.justice_has_role(ARRAY['Juiz Federal']) AND (r.decided_by=auth.uid() OR private.mp_request_judge_eligible(r)))))));
$$;
REVOKE ALL ON FUNCTION public.mp_judicial_request_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mp_judicial_request_visible(uuid) TO authenticated,service_role;
CREATE POLICY mp_warrant_request_scope ON public.judicial_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (public.mp_judicial_request_visible(id));

CREATE FUNCTION public.mp_judicial_evidence_visible(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND public.justice_has_role(ARRAY['Juiz Federal']) AND EXISTS(
 SELECT 1 FROM public.judicial_requests r WHERE r.metadata->>'origin'='mp_warrant_v2'
 AND (r.metadata->'evidence_ids') ? p_id::text AND (r.decided_by=auth.uid() OR (r.status='pending' AND r.expires_at>clock_timestamp() AND private.mp_request_judge_eligible(r))));
$$;
REVOKE ALL ON FUNCTION public.mp_judicial_evidence_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mp_judicial_evidence_visible(uuid) TO authenticated,service_role;
CREATE POLICY mp_judicial_evidence_read ON public.case_evidence FOR SELECT TO authenticated USING (public.mp_judicial_evidence_visible(id));

CREATE FUNCTION public.request_mp_judicial_measure(p_investigation_id uuid,p_target_profile_id uuid,p_request_type text,p_justification text,p_legal_basis text,p_duration_rp_days integer,p_evidence_ids uuid[],p_bank_from timestamptz DEFAULT NULL,p_bank_to timestamptz DEFAULT NULL)
RETURNS public.judicial_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.criminal_investigations%rowtype; r public.judicial_requests%rowtype; v_case uuid; v_judge uuid; v_count int; v_protocol text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Promotor']) THEN RAISE EXCEPTION 'Somente o Ministério Público pode protocolar este pedido.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF p_request_type IS NULL OR p_request_type NOT IN('arrest_warrant','search_warrant','preventive_detention','temporary_detention','rp_confidentiality_break','evidence_production') THEN RAISE EXCEPTION 'Medida judicial não disponível.'; END IF;
 IF p_duration_rp_days IS NULL OR p_duration_rp_days NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'Informe prazo de 1 a 30 dias RP, sujeito à legislação aplicável.'; END IF;
 IF length(btrim(coalesce(p_justification,''))) NOT BETWEEN 40 AND 20000 OR length(btrim(coalesce(p_legal_basis,''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'Informe fundamentação dos fatos e base legal.'; END IF;
 SELECT * INTO i FROM public.criminal_investigations WHERE id=p_investigation_id FOR UPDATE;
 IF NOT FOUND OR i.status NOT IN('open','in_progress','delegate_review','complement_requested','sent_to_prosecutor') THEN RAISE EXCEPTION 'Vincule investigação ativa.'; END IF;
 IF p_target_profile_id=auth.uid() OR NOT private.mp_request_target_valid(i.id,p_target_profile_id) THEN RAISE EXCEPTION 'Selecione investigado ativo e vinculado ao procedimento.'; END IF;
 SELECT c.id,c.judge_id INTO v_case,v_judge FROM public.criminal_cases c JOIN public.case_parties cp ON cp.case_id=c.id WHERE c.investigation_id=i.id AND cp.profile_id=p_target_profile_id AND cp.party_type='defendant' AND c.status NOT IN('archived','served','final','execution','acquitted','convicted') ORDER BY c.created_at DESC LIMIT 1;
 IF v_case IS NULL AND EXISTS(SELECT 1 FROM public.criminal_cases c JOIN public.case_parties cp ON cp.case_id=c.id WHERE c.investigation_id=i.id AND cp.profile_id=p_target_profile_id AND cp.party_type='defendant') THEN RAISE EXCEPTION 'O processo deste investigado não está em fase compatível com este pedido.'; END IF;
 IF v_case IS NOT NULL AND v_judge IS NULL THEN RAISE EXCEPTION 'Aguarde a distribuição judicial do processo.'; END IF;
 IF coalesce(cardinality(p_evidence_ids),0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Vincule de uma a vinte provas lacradas.'; END IF;
 SELECT count(*) INTO v_count FROM public.case_evidence e WHERE e.id=ANY(p_evidence_ids) AND e.status='sealed' AND (e.investigation_id=i.id AND (e.criminal_case_id IS NULL OR e.criminal_case_id=v_case) OR (v_case IS NOT NULL AND e.criminal_case_id=v_case AND (e.investigation_id IS NULL OR e.investigation_id=i.id)));
 IF v_count<>cardinality(p_evidence_ids) THEN RAISE EXCEPTION 'Provas duplicadas, não lacradas ou de outro procedimento.'; END IF;
 IF p_request_type='rp_confidentiality_break' THEN
  IF p_bank_from IS NULL OR p_bank_to IS NULL OR p_bank_from>=p_bank_to OR p_bank_to>clock_timestamp() OR p_bank_to-p_bank_from>interval '30 days' THEN RAISE EXCEPTION 'Informe um intervalo passado de até 30 dias reais para o extrato fictício.'; END IF;
 ELSE p_bank_from:=NULL; p_bank_to:=NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.judicial_requests q WHERE q.investigation_id=i.id AND q.target_profile_id=p_target_profile_id AND q.request_type=p_request_type AND q.status IN('pending','approved') AND q.expires_at>clock_timestamp() AND (q.status='pending' OR NOT EXISTS(SELECT 1 FROM public.warrants w WHERE w.request_id=q.id AND w.status IN('executed','revoked','expired')))) THEN RAISE EXCEPTION 'Já existe pedido ou autorização vigente desta medida para o investigado.'; END IF;
 v_protocol:=public.justice_next_number('PJD');
 INSERT INTO public.judicial_requests(request_type,requested_by,case_id,investigation_id,target_profile_id,justification,expires_at,metadata)
 VALUES(p_request_type,auth.uid(),v_case,i.id,p_target_profile_id,btrim(p_justification),clock_timestamp()+interval '7 days',
 jsonb_build_object('origin','mp_warrant_v2','protocol',v_protocol,'legal_basis',btrim(p_legal_basis),'duration_rp_days',p_duration_rp_days,'evidence_ids',to_jsonb(p_evidence_ids),'bank_from',p_bank_from,'bank_to',p_bank_to,'bank_limit',100)) RETURNING * INTO r;
 PERFORM public.justice_write_audit('mp.judicial_request.created','judicial_request',r.id,NULL,to_jsonb(r),p_justification);
 INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id,metadata) VALUES(i.id,'mp_judicial_request','Pedido judicial protocolado',v_protocol,auth.uid(),jsonb_build_object('request_id',r.id));
 PERFORM public.justice_notify(p.id,'mp_judicial_request','Novo pedido judicial do Ministério Público aguarda análise.','/services/justice?view=authority',jsonb_build_object('request_id',r.id))
 FROM public.profiles p WHERE p.deleted_at IS NULL AND p.role IN('Juiz Federal','Presidente do STF') AND (v_judge IS NULL OR p.id=v_judge) AND p.id<>r.requested_by AND p.id<>r.target_profile_id AND EXISTS(SELECT 1 FROM public.institutional_terms t WHERE t.profile_id=p.id AND t.status='active' AND t.office_key LIKE 'supreme_court_%' AND t.ends_at>clock_timestamp());
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.request_mp_judicial_measure(uuid,uuid,text,text,text,integer,uuid[],timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_mp_judicial_measure(uuid,uuid,text,text,text,integer,uuid[],timestamptz,timestamptz) TO authenticated,service_role;

CREATE FUNCTION public.cancel_mp_judicial_measure(p_id uuid,p_reason text) RETURNS public.judicial_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.judicial_requests%rowtype; old_r public.judicial_requests%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Promotor']) THEN RAISE EXCEPTION 'Apenas o Ministério Público pode retirar o pedido.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 20000 THEN RAISE EXCEPTION 'Fundamente a retirada.'; END IF;
 SELECT * INTO old_r FROM public.judicial_requests WHERE id=p_id AND metadata->>'origin'='mp_warrant_v2' FOR UPDATE;
 IF NOT FOUND OR old_r.requested_by<>auth.uid() OR old_r.status<>'pending' THEN RAISE EXCEPTION 'Somente o requerente pode retirar pedido pendente.' USING errcode='42501'; END IF;
 UPDATE public.judicial_requests SET status='cancelled',decision_reason=btrim(p_reason),decided_at=clock_timestamp() WHERE id=p_id RETURNING * INTO r;
 PERFORM public.justice_write_audit('mp.judicial_request.cancelled','judicial_request',r.id,to_jsonb(old_r),to_jsonb(r),p_reason);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.cancel_mp_judicial_measure(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_mp_judicial_measure(uuid,text) TO authenticated,service_role;

-- Only the requesting active MP officer can consult an approved, bounded RP ledger.
CREATE FUNCTION public.get_mp_financial_evidence(p_request_id uuid,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.judicial_requests%rowtype; result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Promotor']) OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 20000 THEN RAISE EXCEPTION 'Consulta exige competência e fundamentação.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 SELECT * INTO r FROM public.judicial_requests WHERE id=p_request_id FOR SHARE;
 IF NOT FOUND OR r.metadata->>'origin' IS DISTINCT FROM 'mp_warrant_v2' OR r.request_type<>'rp_confidentiality_break' OR r.requested_by<>auth.uid() OR r.status<>'approved' OR r.expires_at<=clock_timestamp() OR r.decided_by IS NULL OR r.decided_by IN(r.requested_by,r.target_profile_id) OR NOT private.mp_request_target_valid(r.investigation_id,r.target_profile_id) OR NOT EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=r.investigation_id AND status NOT IN('archived','closed')) OR (r.case_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.criminal_cases WHERE id=r.case_id AND status NOT IN('archived','served','final','execution','acquitted','convicted'))) THEN RAISE EXCEPTION 'Consulta exige autorização judicial vigente e específica para este requerente.' USING errcode='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]') INTO result FROM (
 SELECT tx.id,tx.amount,tx.type,tx.created_at FROM public.transactions tx
 WHERE tx.created_at >= (r.metadata->>'bank_from')::timestamptz AND tx.created_at <= (r.metadata->>'bank_to')::timestamptz
 AND EXISTS(SELECT 1 FROM public.accounts a WHERE a.user_id=r.target_profile_id AND a.id IN(tx.from_account_id,tx.to_account_id)) ORDER BY tx.created_at DESC LIMIT 100)t;
 PERFORM public.justice_write_audit('mp.financial_evidence.accessed','judicial_request',r.id,NULL,jsonb_build_object('scope','rp_ledger','target',r.target_profile_id,'count',jsonb_array_length(result)),p_reason);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_mp_financial_evidence(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_mp_financial_evidence(uuid,text) TO authenticated,service_role;

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
  IF public.justice_has_role(ARRAY['Promotor']) THEN RAISE EXCEPTION 'Utilize o novo formulário de pedidos judiciais do Ministério Público.' USING errcode='42501'; END IF;
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

CREATE OR REPLACE FUNCTION public.decide_judicial_request(p_request_id uuid, p_approved boolean, p_decision_reason text, p_warrant_duration_rp_days numeric DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare old_request public.judicial_requests%rowtype; decided public.judicial_requests%rowtype; issued public.warrants%rowtype; warrant_kind text; real_seconds bigint; v_enhanced boolean; v_strict boolean;
begin
  if not public.justice_has_role(array['Admin','Juiz Federal']) then raise exception 'ROLE_NOT_AUTHORIZED'; end if;
  if length(trim(coalesce(p_decision_reason,'')))<20 then raise exception 'DECISION_REASON_TOO_SHORT'; end if;
  select * into old_request from public.judicial_requests where id=p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  v_enhanced:=coalesce(old_request.metadata->>'origin','')='mp_warrant_v2';
  v_strict:=v_enhanced OR private.is_mp_investigation(old_request.investigation_id);
  IF v_strict THEN
   PERFORM public.assert_admin_real_action(auth.uid());
   IF NOT private.mp_request_judge_eligible(old_request) THEN RAISE EXCEPTION 'A decisão compete à autoridade judicial habilitada e imparcial.' USING errcode='42501'; END IF;
   IF p_approved IS NULL OR old_request.expires_at IS NULL OR old_request.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Pedido expirado ou decisão inválida.'; END IF;
   IF p_approved AND (NOT private.mp_request_target_valid(old_request.investigation_id,old_request.target_profile_id) OR NOT EXISTS(SELECT 1 FROM public.criminal_investigations WHERE id=old_request.investigation_id AND status NOT IN('archived','closed'))) THEN RAISE EXCEPTION 'O procedimento ou vínculo do investigado não está ativo.'; END IF;
   IF p_approved AND v_enhanced AND (p_warrant_duration_rp_days IS NULL OR p_warrant_duration_rp_days<>trunc(p_warrant_duration_rp_days) OR p_warrant_duration_rp_days NOT BETWEEN 1 AND (old_request.metadata->>'duration_rp_days')::numeric) THEN RAISE EXCEPTION 'Prazo aprovado deve respeitar o limite solicitado.'; END IF;
  END IF;
  if old_request.status<>'pending' then raise exception 'REQUEST_ALREADY_DECIDED'; end if;
  if old_request.requested_by=auth.uid() or old_request.target_profile_id=auth.uid() then raise exception 'JUDGE_CONFLICT_OF_INTEREST'; end if;
  update public.judicial_requests set status=(case when p_approved then 'approved' else 'denied' end)::public.justice_request_status,
    decided_by=auth.uid(),decision_reason=trim(p_decision_reason),decided_at=clock_timestamp(),expires_at=case when v_enhanced and p_approved then clock_timestamp()+make_interval(secs=>public.rp_duration_to_real_seconds(p_warrant_duration_rp_days,'day')) else expires_at end,metadata=case when v_enhanced and p_approved then metadata||jsonb_build_object('approved_duration_rp_days',p_warrant_duration_rp_days) else metadata end where id=p_request_id returning * into decided;
  if p_approved and (decided.request_type in('arrest_warrant','search_warrant') or (v_enhanced and decided.request_type in('preventive_detention','temporary_detention'))) then
    warrant_kind:=case when decided.request_type='search_warrant' then 'search' else 'arrest' end; real_seconds:=public.rp_duration_to_real_seconds(p_warrant_duration_rp_days,'day');
    insert into public.warrants(warrant_number,warrant_type,target_profile_id,case_id,investigation_id,request_id,issued_by,expires_at,status)
    values(public.justice_next_number('MAN'),warrant_kind,decided.target_profile_id,decided.case_id,decided.investigation_id,decided.id,auth.uid(),clock_timestamp()+make_interval(secs=>real_seconds),'issued') returning * into issued;
  end if;
  perform public.justice_notify(decided.requested_by,case when p_approved then 'justice_request_approved' else 'justice_request_denied' end,case when p_approved then 'Seu pedido judicial foi aprovado.' else 'Seu pedido judicial foi negado.' end,'/services/justice?view=authority',jsonb_build_object('request_id',decided.id,'warrant_id',issued.id));
  perform public.justice_write_audit('judicial_request.decided','judicial_request',decided.id,to_jsonb(old_request),to_jsonb(decided),p_decision_reason);
  IF v_enhanced THEN
   INSERT INTO public.investigation_events(investigation_id,event_type,title,description,actor_id,metadata) VALUES(decided.investigation_id,'mp_judicial_decision',CASE WHEN p_approved THEN 'Pedido judicial deferido' ELSE 'Pedido judicial indeferido' END,decided.metadata->>'protocol',auth.uid(),jsonb_build_object('request_id',decided.id,'warrant_id',issued.id));
   IF issued.id IS NOT NULL THEN PERFORM public.justice_notify(p.id,'mp_warrant_issued','Novo mandado judicial disponível para cumprimento.','/services/justice?view=authority',jsonb_build_object('warrant_id',issued.id)) FROM public.profiles p WHERE p.role='Diretor-Geral de Polícia' AND p.deleted_at IS NULL; END IF;
  END IF;
  return jsonb_build_object('request',to_jsonb(decided),'warrant',to_jsonb(issued));
end; $function$;

CREATE OR REPLACE FUNCTION public.revoke_judicial_warrant(p_warrant_id uuid, p_reason text)
 RETURNS warrants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE previous public.warrants%rowtype; result public.warrants%rowtype;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Juiz Federal']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<20 THEN RAISE EXCEPTION 'DECISION_REASON_TOO_SHORT'; END IF;
 SELECT * INTO previous FROM public.warrants WHERE id=p_warrant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'WARRANT_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.judicial_requests r WHERE r.id=previous.request_id AND r.metadata->>'origin'='mp_warrant_v2') THEN
  PERFORM public.assert_admin_real_action(auth.uid());
  IF NOT public.justice_has_role(ARRAY['Juiz Federal']) THEN RAISE EXCEPTION 'Revogação exige autoridade judicial.' USING errcode='42501'; END IF;
 END IF;
 IF previous.status<>'issued' OR previous.expires_at<=now() THEN RAISE EXCEPTION 'WARRANT_NOT_ACTIVE'; END IF;
 IF previous.target_profile_id=auth.uid() THEN RAISE EXCEPTION 'JUDGE_CONFLICT_OF_INTEREST'; END IF;
 IF NOT public.justice_has_role(ARRAY['Admin']) AND previous.issued_by<>auth.uid()
 AND NOT EXISTS(SELECT 1 FROM public.criminal_cases WHERE id=previous.case_id AND judge_id=auth.uid()) THEN
 RAISE EXCEPTION 'ONLY_ASSIGNED_JUDGE_CAN_DECIDE'; END IF;
 UPDATE public.warrants SET status='revoked',revoked_by=auth.uid(),revocation_reason=btrim(p_reason)
 WHERE id=p_warrant_id RETURNING * INTO result;
 PERFORM public.justice_write_audit('warrant.revoked','warrant',result.id,to_jsonb(previous),to_jsonb(result),p_reason);
 PERFORM public.justice_notify(previous.issued_by,'justice_warrant_revoked','O mandado '||previous.warrant_number||' foi revogado.','/services/justice?view=authority',jsonb_build_object('warrant_id',previous.id));
 RETURN result;
END $function$;
CREATE FUNCTION public.revoke_mp_judicial_measure(p_id uuid,p_reason text) RETURNS public.judicial_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.judicial_requests%rowtype; old_r public.judicial_requests%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT public.justice_has_role(ARRAY['Juiz Federal']) THEN RAISE EXCEPTION 'Revogação exige autoridade judicial.' USING errcode='42501'; END IF;
 PERFORM public.assert_admin_real_action(auth.uid());
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 20000 THEN RAISE EXCEPTION 'Fundamente a revogação.'; END IF;
 SELECT * INTO old_r FROM public.judicial_requests WHERE id=p_id AND metadata->>'origin'='mp_warrant_v2' FOR UPDATE;
 IF NOT FOUND OR old_r.status<>'approved' OR old_r.request_type NOT IN('rp_confidentiality_break','evidence_production') OR old_r.expires_at<=clock_timestamp() OR NOT private.mp_request_judge_eligible(old_r) OR (old_r.case_id IS NULL AND old_r.decided_by<>auth.uid()) THEN RAISE EXCEPTION 'Somente a autoridade judicial competente pode revogar medida vigente.' USING errcode='42501'; END IF;
 UPDATE public.judicial_requests SET status='cancelled',metadata=metadata||jsonb_build_object('revoked_at',clock_timestamp(),'revoked_by',auth.uid(),'revocation_reason',btrim(p_reason)) WHERE id=p_id RETURNING * INTO r;
 PERFORM public.justice_write_audit('mp.judicial_request.revoked','judicial_request',r.id,to_jsonb(old_r),to_jsonb(r),p_reason);
 PERFORM public.justice_notify(r.requested_by,'mp_judicial_revoked','A medida judicial autorizada foi revogada.','/services/justice?view=authority',jsonb_build_object('request_id',r.id));
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.revoke_mp_judicial_measure(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revoke_mp_judicial_measure(uuid,text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
