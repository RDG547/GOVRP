BEGIN;

-- Elected officers keep exercising their mandate while a successor has NOT
-- actually been inaugurated. Inauguration (including reelection) supersedes
-- the outgoing assignment atomically; merely reaching its nominal date does not.
-- Extend shortly BEFORE expiry to avoid a gap between minute-based cron runs.
CREATE OR REPLACE FUNCTION private.extend_due_elected_mandates()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $holdover$
DECLARE
  a public.election_office_assignments%rowtype;
  new_end timestamptz;
  changed boolean := false;
  v_house_id uuid;
BEGIN
  FOR a IN
    SELECT ea.* FROM public.election_office_assignments ea
    JOIN public.profiles p ON p.id=ea.profile_id AND p.deleted_at IS NULL
    WHERE ea.status='active'
      AND ea.term_starts_at<=clock_timestamp()
      AND ea.term_ends_at<=clock_timestamp()+interval '2 days'
      AND (p.role=ea.office_role OR
        (ea.office_role IN('Deputado','Senador') AND ea.office_role=ANY(public.official_role_capabilities(p.role))))
    ORDER BY ea.term_ends_at,ea.id FOR UPDATE OF ea
  LOOP
    new_end:=greatest(a.term_ends_at,clock_timestamp())+interval '1 month';
    UPDATE public.election_office_assignments
       SET term_ends_at=new_end,
           metadata=coalesce(metadata,'{}'::jsonb)
             ||jsonb_build_object(
               'holdover',true,
               'scheduled_term_ends_at',coalesce(metadata->>'scheduled_term_ends_at',a.term_ends_at::text),
               'last_holdover_extended_at',clock_timestamp())
     WHERE id=a.id AND status='active';

    IF a.office_role='Presidente' THEN
      UPDATE public.government_terms g
         SET term_ends_at=greatest(g.term_ends_at,new_end)
       WHERE g.ended_at IS NULL AND g.head_id=a.profile_id
         AND g.election_id=a.election_id AND g.term_ends_at<new_end;
    ELSIF a.office_role IN('Deputado','Senador') THEN
      v_house_id:=CASE a.office_role
        WHEN 'Deputado' THEN 'a1b2c3d4-e5f6-7890-1234-567890abcdef'::uuid
        ELSE 'fedcba09-8765-4321-0987-654321fedcba'::uuid END;
      UPDATE public.parliament_members
         SET term_end_date=new_end::date
       WHERE user_id=a.profile_id AND parliament_members.house_id=v_house_id
         AND term_end_date<new_end::date;
    END IF;
    changed:=true;
  END LOOP;
  IF changed THEN PERFORM private.refresh_office_assignment_snapshot(); END IF;
END;
$holdover$;
REVOKE ALL ON FUNCTION private.extend_due_elected_mandates() FROM PUBLIC,anon,authenticated;

-- The normal 1-month limit continues for elected terms. A holdover is not a
-- new term and must be allowed to retain institutional parliamentary access.
CREATE OR REPLACE FUNCTION public.enforce_parliament_member_monthly_term()
RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $member_guard$
DECLARE normal_limit date;
BEGIN
  new.term_start_date:=coalesce(new.term_start_date,current_date);
  normal_limit:=(new.term_start_date+interval '1 month')::date;
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
$member_guard$;

DO $patch$
DECLARE
  definition text;
  before_text text;
  after_text text;
BEGIN
  SELECT pg_get_functiondef('private.maintain_government_term()'::regprocedure) INTO definition;
  before_text:=E' PERFORM pg_advisory_xact_lock(hashtext(''govrp:presidential-succession''));\n SELECT * INTO g FROM public.government_terms';
  after_text:=E' PERFORM pg_advisory_xact_lock(hashtext(''govrp:presidential-succession''));\n PERFORM private.extend_due_elected_mandates();\n SELECT * INTO g FROM public.government_terms';
  IF strpos(definition,before_text)=0 THEN
    RAISE EXCEPTION 'Unexpected government term function; refuse partial migration';
  END IF;
  EXECUTE replace(definition,before_text,after_text);

  SELECT pg_get_functiondef('private.activate_due_elected_offices()'::regprocedure) INTO definition;
  before_text:='   AND NOT EXISTS(SELECT 1 FROM public.election_office_assignments current_term WHERE current_term.election_id=e.election_id AND current_term.status=''active'' AND current_term.profile_id=previous.profile_id AND current_term.office_role=previous.office_role) FOR UPDATE LOOP';
  after_text:='   FOR UPDATE LOOP';
  IF strpos(definition,before_text)=0 THEN
    RAISE EXCEPTION 'Expected outgoing election loop missing';
  END IF;
  definition:=replace(definition,before_text,after_text);
  before_text:=' WHERE id=old.profile_id AND role=old.office_role AND NOT manual_role_override;';
  after_text:=' WHERE id=old.profile_id AND role=old.office_role AND NOT manual_role_override
   AND NOT EXISTS(SELECT 1 FROM public.election_office_assignments incumbent_new
     WHERE incumbent_new.election_id=e.election_id AND incumbent_new.status=''active''
     AND incumbent_new.profile_id=old.profile_id AND incumbent_new.office_role=old.office_role);';
  IF strpos(definition,before_text)=0 THEN
    RAISE EXCEPTION 'Expected outgoing profile cleanup missing';
  END IF;
  EXECUTE replace(definition,before_text,after_text);

  -- Prevent silent presidential removal based on clock expiry alone.
  SELECT pg_get_functiondef('private.guard_presidential_transition()'::regprocedure) INTO definition;
  before_text:=' or g.term_ends_at<=clock_timestamp() or ';
  IF strpos(definition,before_text)=0 THEN RAISE EXCEPTION 'Unexpected transition guard'; END IF;
  EXECUTE replace(definition,before_text,' or ');
END $patch$;

-- Reserve national fiscal decisions for actual Finance/Economy portfolio or
-- head of state. Generic Minister access previously allowed other ministries
-- to modify the whole economic policy engine.
DO $policy$
DECLARE definition text; baseline text; restricted text;
BEGIN
  SELECT pg_get_functiondef('public.apply_policy_decision(text,numeric,text,numeric,timestamp with time zone)'::regprocedure) INTO definition;
  baseline:=E'    if not public.economic_has_role(array[\n      ''Admin'',''Presidente'',''Ministro da Fazenda'',''Ministro da Economia'',''Ministro''\n    ]) then';
  restricted:=E'    if not (public.economic_has_role(array[\n      ''Admin'',''Presidente'',''Ministro da Fazenda'',''Ministro da Economia''\n    ]) or exists (select 1 from public.ministers ministry_assignment\n      where ministry_assignment.user_id=actor_id and ministry_assignment.status=''active''\n        and ministry_assignment.ministry=''Ministério da Economia'')) then';
  IF strpos(definition,baseline)=0 THEN
    RAISE EXCEPTION 'Current fiscal policy permission logic differs, refusing migration';
  END IF;
  EXECUTE replace(definition,baseline,restricted);
END $policy$;

COMMIT;
