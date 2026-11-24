-- GOVRP / Parliament: VP substitutes the House President ONLY after
-- 96 actual hours of inactivity. Upon the President's next activity,
-- authority reverts automatically. Applies to Chamber and Senate.
-- A vacancy leads to formal VP promotion, never dual presidencies.
BEGIN;

-- Only an elected, in-term Vice-President of the SAME house is eligible.
CREATE OR REPLACE FUNCTION private.is_acting_house_president(
  p_user_id uuid, p_house_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT p_user_id IS NOT NULL AND p_house_id IS NOT NULL
 AND EXISTS (
   SELECT 1
     FROM public.parliament_leadership_terms vice
     JOIN public.parliament_members vm
       ON vm.id=vice.member_id AND vm.house_id=vice.house_id
     JOIN public.profiles vp
       ON vp.id=vm.user_id AND vp.deleted_at IS NULL
    WHERE vice.house_id=p_house_id
      AND vice.position='vice_president'
      AND vice.status='active'
      AND vice.term_start_date<=current_date
      AND vice.term_end_date>=current_date
      AND vm.id=public.get_active_parliament_member_id(p_user_id,p_house_id)
      AND vm.user_id=p_user_id
      AND vp.role=public.canonical_official_role(
        public.get_parliament_leadership_role_label(p_house_id,'vice_president')
      )
 )
 AND EXISTS (
   SELECT 1
     FROM public.parliament_leadership_terms president
     JOIN public.parliament_members pm
       ON pm.id=president.member_id AND pm.house_id=president.house_id
     JOIN public.profiles pp
       ON pp.id=pm.user_id AND pp.deleted_at IS NULL
     LEFT JOIN auth.users au ON au.id=pm.user_id
    WHERE president.house_id=p_house_id
      AND president.position='president'
      AND president.status='active'
      AND president.term_start_date<=current_date
      AND president.term_end_date>=current_date
      AND pm.id=public.get_active_parliament_member_id(pm.user_id,pm.house_id)
      AND greatest(
           president.created_at,
           coalesce(au.last_sign_in_at,'-infinity'::timestamptz),
           coalesce((
             SELECT max(least(s.last_seen_at,clock_timestamp()))
               FROM public.user_activity_sessions s
              WHERE s.user_id=pm.user_id
           ),'-infinity'::timestamptz)
         ) <= clock_timestamp()-interval '4 days'
 );
$function$;

-- The President keeps their own powers even while absent. The VP gets the
-- same authorization only during the four-day absence.
CREATE OR REPLACE FUNCTION private.is_house_president(
 p_user_id uuid,p_house_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT coalesce(
  EXISTS (
   SELECT 1 FROM public.parliament_leadership_terms t
   JOIN public.parliament_members m ON m.id=t.member_id AND m.house_id=t.house_id
   JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
   WHERE t.house_id=p_house_id AND t.position='president'
     AND t.status='active' AND t.term_start_date<=current_date
     AND t.term_end_date>=current_date
     AND m.user_id=p_user_id
     AND m.id=public.get_active_parliament_member_id(p_user_id,p_house_id)
  ) OR private.is_acting_house_president(p_user_id,p_house_id),false
 );
$function$;

-- Existing institutional procedures (commissions, suggestions, etc.)
-- resolve the acting House chair the same way as the elected President.
CREATE OR REPLACE FUNCTION public.is_house_presiding_authority(
 p_actor uuid,p_house_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT public.get_authority_role(p_actor)='Admin'
    OR private.is_house_president(p_actor,p_house_id);
$function$;

-- Remove blanket privilege granted to the Senate VP in November 24's
-- change: the exception applies only if the four-day absence is proven;
-- both legislative houses follow precisely the same rule.
CREATE OR REPLACE FUNCTION private.is_senate_vice_bill_voting_authority(
 p_actor uuid,p_house_id uuid,p_bill_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT private.is_acting_house_president(p_actor,p_house_id)
   AND EXISTS (
      SELECT 1 FROM public.bills b
      WHERE b.id=p_bill_id
        AND b.type IN ('PL','PEC','Proposta de Emenda Constitucional')
        AND (b.house_id=p_house_id
          OR b.type IN ('PEC','Proposta de Emenda Constitucional')
          OR coalesce((b.institutional_data->>'requires_bicameral')::boolean,false))
   );
$function$;

-- Voting start previously accepted ANY active board term as an executive
-- governance manager, which would bypass the four-day requirement.
-- Keep the pre-existing bicameral PEC exception intact.
DO $patch$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_functiondef('public.start_parliament_bill_voting(uuid,uuid,text,text)'::regprocedure)
   INTO v_definition;
 IF strpos(v_definition,
     'if not public.is_parliament_governance_manager(v_actor,p_house_id)')=0 THEN
   RAISE EXCEPTION 'Unexpected bill-voting authorization shape; inspect before applying.';
 END IF;
 v_definition:=replace(v_definition,
   'if not public.is_parliament_governance_manager(v_actor,p_house_id)',
   'if not (private.is_house_president(v_actor,p_house_id) or public.has_full_admin_access())');
 EXECUTE v_definition;
END $patch$;

-- The current scheduled-start and scheduled-cancel routines already check
-- private.is_house_president/private.is_senate_vice_bill_voting_authority:
-- the updated functions above immediately revoke this power on the
-- President's return. The scheduler rechecks at its execution time.

-- Public status is scoped to the logged-in actor and does not disclose
-- another user's private activity timestamps.
CREATE OR REPLACE FUNCTION public.get_house_presidency_authority(
 p_house_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid();
        v_is_acting boolean;
        v_is_president boolean;
        v_can_manage boolean;
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
 v_can_manage:=v_is_president OR v_is_acting OR public.has_full_admin_access();
 RETURN jsonb_build_object(
  'can_manage_votings',v_can_manage,
  'is_temporary_substitute',v_is_acting,
  'is_house_president',v_is_president,
  'absence_threshold_hours',96
 );
END $function$;
REVOKE ALL ON FUNCTION public.get_house_presidency_authority(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_house_presidency_authority(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION private.is_acting_house_president(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.is_acting_house_president(uuid,uuid) TO service_role;

-- On a real vacancy (dismissal, removal, profile role change), electing a
-- new chair may take several updates in one transaction. Deferred execution
-- prevents an accidental VP promotion during a planned presidential switch.
-- The existing resignation routine already promotes the VP immediately.
CREATE OR REPLACE FUNCTION private.promote_house_vice_after_vacancy()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_vice public.parliament_leadership_terms%rowtype;
        v_successor uuid;
BEGIN
 IF old.position<>'president' OR old.status<>'active'
    OR new.status='active' OR old.term_end_date<current_date THEN
   RETURN NULL;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('house-transition:'||old.house_id::text,0));
 IF EXISTS (
   SELECT 1 FROM public.parliament_leadership_terms x
   WHERE x.house_id=old.house_id AND x.position='president'
     AND x.status='active' AND x.term_start_date<=current_date
     AND x.term_end_date>=current_date
 ) THEN RETURN NULL; END IF;
 SELECT v.* INTO v_vice
 FROM public.parliament_leadership_terms v
 JOIN public.parliament_members m ON m.id=v.member_id
 JOIN public.profiles p ON p.id=m.user_id AND p.deleted_at IS NULL
 WHERE v.house_id=old.house_id AND v.position='vice_president'
   AND v.status='active'
   AND v.term_start_date<=current_date AND v.term_end_date>=current_date
   AND m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 ORDER BY v.created_at DESC LIMIT 1 FOR UPDATE OF v;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT m.user_id INTO v_successor FROM public.parliament_members m
 WHERE m.id=v_vice.member_id;
 UPDATE public.parliament_leadership_terms
 SET status='completed',concluded_at=clock_timestamp()
 WHERE id=v_vice.id AND status='active';
 INSERT INTO public.parliament_leadership_terms(
   house_id,position,member_id,status,term_start_date,term_end_date
 ) VALUES(
   old.house_id,'president',v_vice.member_id,'active',
   current_date,least(old.term_end_date,v_vice.term_end_date)
 );
 UPDATE public.profiles SET
   role=public.get_parliament_leadership_role_label(old.house_id,'president'),
   role_assigned_at=clock_timestamp(),updated_at=clock_timestamp()
 WHERE id=v_successor;
 RETURN NULL;
END $function$;
DROP TRIGGER IF EXISTS parliament_promote_vice_on_presidency_vacancy
  ON public.parliament_leadership_terms;
CREATE CONSTRAINT TRIGGER parliament_promote_vice_on_presidency_vacancy
AFTER UPDATE ON public.parliament_leadership_terms
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (old.position='president' AND old.status='active' AND new.status<>'active')
EXECUTE FUNCTION private.promote_house_vice_after_vacancy();

COMMIT;