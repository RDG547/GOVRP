-- Distinguish fact-finding, prosecution and judicial outcome. Preserve institutional impeachment.
CREATE OR REPLACE FUNCTION public.transition_integrity_case(p_case_id uuid,p_new_status text,p_summary text,p_investigation_id uuid DEFAULT NULL,p_commission_id uuid DEFAULT NULL)
RETURNS public.public_integrity_cases LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
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
REVOKE EXECUTE ON FUNCTION public.transition_integrity_case(uuid,text,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transition_integrity_case(uuid,text,text,uuid,uuid) TO authenticated,service_role;
