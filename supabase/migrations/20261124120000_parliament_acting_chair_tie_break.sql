-- The temporary VP is the effective chair while the elected President
-- has been absent for >=96 hours. A returning President immediately resumes
-- the chair even for a previously opened vote awaiting tie-break.
BEGIN;
CREATE OR REPLACE FUNCTION private.is_effective_house_chair(
  p_actor uuid,p_house_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT private.is_acting_house_president(p_actor,p_house_id)
  OR (
    private.is_house_president(p_actor,p_house_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.parliament_leadership_terms t
      JOIN public.parliament_members m ON m.id=t.member_id AND m.house_id=t.house_id
      WHERE t.house_id=p_house_id AND t.position='vice_president'
        AND t.status='active' AND t.term_start_date<=current_date
        AND t.term_end_date>=current_date
        AND private.is_acting_house_president(m.user_id,p_house_id)
    )
  );
$function$;
REVOKE ALL ON FUNCTION private.is_effective_house_chair(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.is_effective_house_chair(uuid,uuid) TO service_role;

-- The voting electorate snapshot must select one actual chair, rather
-- than a random one when both the president and substitute satisfy the
-- broader institutional president-authority predicate.
DO $patch$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef('private.snapshot_voting_electorate()'::regprocedure)
 INTO source;
 IF strpos(source,
   'AND private.is_house_president(m.user_id,m.house_id) ORDER BY m.id LIMIT 1;')=0 THEN
   RAISE EXCEPTION 'Snapshot chair code has changed; review before patching.';
 END IF;
 source:=replace(source,
   'AND private.is_house_president(m.user_id,m.house_id) ORDER BY m.id LIMIT 1;',
   'AND private.is_effective_house_chair(m.user_id,m.house_id) ORDER BY m.id LIMIT 1;');
 EXECUTE source;
END $patch$;

-- Tie-break is exercised by the actual CURRENT president or, during
-- absence, by the acting VP. If the elected president returns after the
-- ballot was opened, refresh the chair assignment only for the tie-break.
DO $patch$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef('public.cast_parliament_vote(uuid,uuid,text)'::regprocedure)
 INTO source;
 IF strpos(source,
   'if v_member.id is distinct from v_voting.chair_member_id or not private.is_house_president(v_actor,v_voting.house_id) or p_vote=''Abster''')=0 THEN
   RAISE EXCEPTION 'Parliament vote cast chair guard changed; inspect before patching.';
 END IF;
 source:=replace(source,
   'if v_member.id is distinct from v_voting.chair_member_id or not private.is_house_president(v_actor,v_voting.house_id) or p_vote=''Abster''',
   'if not private.is_effective_house_chair(v_actor,v_voting.house_id) or p_vote=''Abster''');
 source:=replace(source,
   'raise exception ''Esta votação aguarda o voto de desempate da Presidência da Casa.'' using errcode=''42501''; end if;',
   'raise exception ''Esta votação aguarda o voto de desempate da Presidência da Casa.'' using errcode=''42501''; end if;
      if v_member.id is distinct from v_voting.chair_member_id then
        update public.parliament_votings set chair_member_id=v_member.id where id=v_voting.id;
      end if;');
 EXECUTE source;
END $patch$;

-- At the instant a tied ballot enters tie-break, the Presidency may have
-- changed because of inactivity or return. Choose the correct chair and
-- notify that person (not the person who held the chair days earlier).
DO $patch$
DECLARE source text;
BEGIN
 SELECT pg_get_functiondef('private.finalize_bill_voting(uuid)'::regprocedure) INTO source;
 IF strpos(source,
   'and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then')=0 THEN
   RAISE EXCEPTION 'Finalization tie-break guard changed; inspect before patching.';
 END IF;
 source:=replace(source,
   'and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then',
   'and exists(select 1 from public.parliament_members m where m.house_id=v.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_effective_house_chair(m.user_id,m.house_id)) then
  select m.id into v.chair_member_id from public.parliament_members m
    where m.house_id=v.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
      and private.is_effective_house_chair(m.user_id,m.house_id)
    order by m.id limit 1;');
 IF strpos(source,
   'update public.parliament_votings set tie_break_pending=true,end_date=')=0 THEN
   RAISE EXCEPTION 'Finalization tie-break UPDATE has changed.';
 END IF;
 source:=replace(source,
   'update public.parliament_votings set tie_break_pending=true,end_date=',
   'update public.parliament_votings set chair_member_id=v.chair_member_id,tie_break_pending=true,end_date=');
 EXECUTE source;
END $patch$;
COMMIT;