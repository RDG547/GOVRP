-- Preserve previous Admin and national-President start permissions while
-- barring unauthorized VPs. Scheduling remains exclusive to the elected
-- or temporary House President and existing "full admin" override.
BEGIN;
DO $patch$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.start_parliament_bill_voting(uuid,uuid,text,text)'::regprocedure)
 INTO v_definition;
 IF strpos(v_definition,
   'if not (private.is_house_president(v_actor,p_house_id) or public.has_full_admin_access())')=0 THEN
   RAISE EXCEPTION 'Unexpected vote-start rules; review before applying.';
 END IF;
 v_definition:=replace(v_definition,
   'if not (private.is_house_president(v_actor,p_house_id) or public.has_full_admin_access())',
   'if not (private.is_house_president(v_actor,p_house_id) or public.get_authority_role(v_actor) in (''Admin'',''Presidente''))');
 EXECUTE v_definition;
END $patch$;

CREATE OR REPLACE FUNCTION public.get_house_presidency_authority(
 p_house_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid();
        v_is_acting boolean;
        v_is_president boolean;
        v_is_vice boolean;
        v_can_start boolean;
        v_can_schedule boolean;
BEGIN
 IF v_actor IS NULL OR p_house_id IS NULL THEN
   RAISE EXCEPTION 'Faça login para consultar as permissões da Mesa Diretora.'
     USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.parliament_houses WHERE id=p_house_id) THEN
   RAISE EXCEPTION 'Casa legislativa inexistente.' USING ERRCODE='22023';
 END IF;
 v_is_acting:=private.is_acting_house_president(v_actor,p_house_id);
 v_is_president:=private.is_house_president(v_actor,p_house_id) AND NOT v_is_acting;
 v_is_vice:=EXISTS(
   SELECT 1 FROM public.parliament_leadership_terms t
   JOIN public.parliament_members m ON m.id=t.member_id AND m.house_id=t.house_id
   JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
   WHERE t.house_id=p_house_id AND t.position='vice_president'
     AND t.status='active' AND t.term_start_date<=current_date
     AND t.term_end_date>=current_date AND m.user_id=v_actor
     AND m.id=public.get_active_parliament_member_id(v_actor,p_house_id)
 );
 v_can_start:=v_is_president OR v_is_acting
   OR public.get_authority_role(v_actor) IN ('Admin','Presidente');
 v_can_schedule:=v_is_president OR v_is_acting OR public.has_full_admin_access();
 RETURN jsonb_build_object(
  'can_manage_votings',v_can_start,
  'can_schedule_votings',v_can_schedule,
  'is_temporary_substitute',v_is_acting,
  'is_house_president',v_is_president,
  'is_house_vice_president',v_is_vice,
  'absence_threshold_hours',96
 );
END $function$;
REVOKE ALL ON FUNCTION public.get_house_presidency_authority(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_house_presidency_authority(uuid) TO authenticated,service_role;
COMMIT;