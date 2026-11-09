BEGIN;
DO $fix$
DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('private.extend_due_elected_mandates()'::regprocedure);
  IF strpos(definition,'house_id uuid;')=0 OR strpos(definition,'WHERE user_id=a.profile_id AND house_id=house_id')=0 THEN
    RAISE EXCEPTION 'Unexpected holdover helper version';
  END IF;
  definition:=replace(definition,'house_id uuid;','v_house_id uuid;');
  definition:=replace(definition,'house_id:=CASE a.office_role','v_house_id:=CASE a.office_role');
  definition:=replace(definition,'WHERE user_id=a.profile_id AND house_id=house_id',
                      'WHERE user_id=a.profile_id AND parliament_members.house_id=v_house_id');
  EXECUTE definition;
END $fix$;
COMMIT;