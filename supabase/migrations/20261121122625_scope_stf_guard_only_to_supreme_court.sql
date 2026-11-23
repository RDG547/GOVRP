-- Scope the STF-only nomination guard strictly to STF seats.
-- Ordinary ministry invitations have office_key=NULL and must remain untouched.
BEGIN;
DO $patch$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('private.guard_live_stf_nomination()'::regprocedure) INTO definition;
 IF strpos(definition,$new$IF new.office_key IS NULL OR new.office_key NOT LIKE 'supreme_court_%'$new$)>0 THEN
   RETURN;
 END IF;
 IF strpos(definition,$old$IF new.office_key NOT LIKE 'supreme_court_%'$old$)=0 THEN
   RAISE EXCEPTION 'STF guard changed; audit the current code before modifying it.';
 END IF;
 definition:=replace(definition,
   $old$IF new.office_key NOT LIKE 'supreme_court_%'$old$,
   $new$IF new.office_key IS NULL OR new.office_key NOT LIKE 'supreme_court_%'$new$);
 EXECUTE definition;
END $patch$;
COMMIT;