-- Enforce leadership membership with null-safe comparison.
BEGIN;
DO $patch$
DECLARE f text;
 old_check text:='IF NOT (v_actor=v_party.owner_id OR v_actor=v_party.president_id OR v_actor=v_party.vice_president_id) THEN';
 new_check text:='IF v_actor IS DISTINCT FROM v_party.owner_id AND v_actor IS DISTINCT FROM v_party.president_id AND v_actor IS DISTINCT FROM v_party.vice_president_id THEN';
BEGIN
 SELECT pg_get_functiondef('public.set_party_vote_guidance(uuid,uuid,text,text)'::regprocedure) INTO f;
 IF strpos(f,old_check)=0 THEN RAISE EXCEPTION 'Party guidance function is different than expected.';END IF;
 EXECUTE replace(f,old_check,new_check);
END $patch$;
COMMIT;