-- Preserve the identity of the reporting player in the oversight-only access scope.
CREATE FUNCTION public.mp_oversight_audit_visible(p_case_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM private.mp_oversight_cases c WHERE c.id=p_case_id AND private.mp_oversight_is_manager(c));
$$;
REVOKE ALL ON FUNCTION public.mp_oversight_audit_visible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mp_oversight_audit_visible(uuid) TO authenticated,service_role;
CREATE POLICY mp_oversight_audit_scope ON public.justice_audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING (entity_type IS DISTINCT FROM 'mp_oversight_case' OR actor_id=auth.uid() OR public.mp_oversight_audit_visible(entity_id));
NOTIFY pgrst,'reload schema';
