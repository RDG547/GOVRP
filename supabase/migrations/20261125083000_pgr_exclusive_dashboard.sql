-- Read-only institutional dashboard; do not expand criminal case or judicial permissions.
CREATE FUNCTION public.get_pgr_dashboard_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); preview boolean; actual boolean; office_start timestamptz; office_end timestamptz; holder text;
BEGIN
 IF actor IS NULL OR NOT public.can_access_platform() THEN RAISE EXCEPTION 'Acesso restrito à Procuradoria-Geral da República.' USING errcode='42501'; END IF;
 preview:=public.is_admin(actor) AND EXISTS(SELECT 1 FROM private.admin_development_modes d WHERE d.user_id=actor AND d.mode='simulate' AND d.simulated_role='Procurador-Geral da República' AND NOT d.execute_real);
 IF preview THEN RETURN jsonb_build_object('preview_only',true,'holder',NULL,'counts',NULL,'generated_at',clock_timestamp()); END IF;
 SELECT p.full_name,t.starts_at,t.ends_at INTO holder,office_start,office_end FROM public.profiles p JOIN public.institutional_terms t ON t.profile_id=p.id
 WHERE p.id=actor AND p.deleted_at IS NULL AND p.role='Procurador-Geral da República' AND t.office_key='public_prosecutor' AND t.status='active' AND t.starts_at<=now() AND (t.ends_at IS NULL OR t.ends_at>now()) ORDER BY t.starts_at DESC LIMIT 1;
 actual:=FOUND AND public.justice_has_role(ARRAY['Procurador-Geral da República']) AND NOT EXISTS(SELECT 1 FROM private.admin_development_modes d WHERE d.user_id=actor AND d.mode<>'normal');
 IF NOT actual THEN RAISE EXCEPTION 'Painel exclusivo do Procurador-Geral em exercício. Administradores devem simular o cargo.' USING errcode='42501'; END IF;
 RETURN jsonb_build_object('preview_only',false,'holder',holder,'term_start',office_start,'term_end',office_end,'generated_at',clock_timestamp(),
 'counts',jsonb_build_object(
 'pic_active',(SELECT count(*) FROM public.criminal_investigations i WHERE i.origin='mp' AND i.status IN('open','in_progress','complement_requested') AND public.justice_can_access_investigation(i.id)),
 'pic_ready',(SELECT count(*) FROM public.criminal_investigations i WHERE i.origin='mp' AND i.status='sent_to_prosecutor' AND public.justice_can_access_investigation(i.id) AND NOT EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=i.id)),
 'police_referred',(SELECT count(*) FROM public.criminal_investigations i WHERE i.origin='police' AND i.status='sent_to_prosecutor' AND public.justice_can_access_investigation(i.id) AND NOT EXISTS(SELECT 1 FROM public.criminal_cases c WHERE c.investigation_id=i.id)),
 'integrity_pending',(SELECT count(*) FROM public.public_integrity_cases i WHERE i.institutional_term_id IS NULL AND i.source_type IS DISTINCT FROM 'judicial_impeachment' AND (i.status='public_prosecution' OR (i.status='police_investigation' AND EXISTS(SELECT 1 FROM public.criminal_investigations ci WHERE ci.id=i.investigation_id AND ci.status='sent_to_prosecutor')))),
 'requests_pending',(SELECT count(*) FROM public.judicial_requests r WHERE r.status='pending' AND (r.expires_at IS NULL OR r.expires_at>now()) AND public.mp_judicial_request_visible(r.id) AND (r.metadata->>'origin'='mp_warrant_v2' OR r.requested_by=actor OR EXISTS(SELECT 1 FROM public.criminal_investigations i WHERE i.id=r.investigation_id AND i.origin='mp'))),
 'warrants_active',(SELECT count(*) FROM public.warrants w JOIN public.judicial_requests r ON r.id=w.request_id WHERE w.status='issued' AND w.expires_at>now() AND public.mp_judicial_request_visible(r.id) AND (r.metadata->>'origin'='mp_warrant_v2' OR r.requested_by=actor OR EXISTS(SELECT 1 FROM public.criminal_investigations i WHERE i.id=r.investigation_id AND i.origin='mp'))),
 'representations_pending',(SELECT count(*) FROM private.mp_oversight_cases c WHERE c.status='submitted' AND private.mp_oversight_is_manager(c)),
 'oversight_open',(SELECT count(*) FROM private.mp_oversight_cases c WHERE c.status='open' AND private.mp_oversight_is_manager(c)),
 'oversight_overdue',(SELECT count(*) FROM private.mp_oversight_messages m JOIN private.mp_oversight_cases c ON c.id=m.case_id WHERE m.status='pending' AND m.due_at<=now() AND private.mp_oversight_is_manager(c)),
 'cases_accessible',(SELECT count(*) FROM public.criminal_cases c WHERE public.justice_can_access_case(c.id))
 ));
END $$;
REVOKE ALL ON FUNCTION public.get_pgr_dashboard_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pgr_dashboard_summary() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
