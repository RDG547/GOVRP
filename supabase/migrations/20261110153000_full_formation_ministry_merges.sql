BEGIN;

-- Ministries are globally defined, but mergers are scoped to the current government.
-- A merged portfolio does not create another minister record or salary.
CREATE TABLE IF NOT EXISTS public.government_ministry_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  government_id uuid NOT NULL REFERENCES public.government_terms(id) ON DELETE CASCADE,
  primary_ministry_id uuid NOT NULL REFERENCES public.government_ministries(id) ON DELETE RESTRICT,
  merged_ministry_id uuid NOT NULL REFERENCES public.government_ministries(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT different_ministries CHECK (primary_ministry_id <> merged_ministry_id),
  CONSTRAINT one_parent_per_ministry UNIQUE (government_id, merged_ministry_id)
);
CREATE INDEX IF NOT EXISTS government_ministry_merges_parent_idx
ON public.government_ministry_merges(government_id, primary_ministry_id);
ALTER TABLE public.government_ministry_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.government_ministry_merges FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_government_ministry_merges()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
DECLARE v_government uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o gabinete.' USING errcode='42501'; END IF;
  SELECT id INTO v_government FROM public.government_terms
  WHERE ended_at IS NULL AND (head_id=auth.uid() OR public.has_full_admin_access())
  ORDER BY term_starts_at DESC LIMIT 1;
  IF v_government IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'primary_id', merge.primary_ministry_id,
      'primary_name', parent.name,
      'merged_id', merge.merged_ministry_id,
      'merged_name', child.name,
      'created_at', merge.created_at
    ) ORDER BY parent.name,child.name)
    FROM public.government_ministry_merges merge
    JOIN public.government_ministries parent ON parent.id=merge.primary_ministry_id
    JOIN public.government_ministries child ON child.id=merge.merged_ministry_id
    WHERE merge.government_id=v_government
  ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_government_ministry_merges() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_government_ministry_merges() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.merge_government_ministries(
  p_primary_id uuid, p_merged_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE g public.government_terms%rowtype; parent public.government_ministries%rowtype;
child public.government_ministries%rowtype; result public.government_ministry_merges%rowtype;
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role(auth.uid()) IS DISTINCT FROM 'Presidente'
    THEN RAISE EXCEPTION 'Somente o Presidente em exercício pode fundir ministérios.' USING errcode='42501'; END IF;
  IF p_primary_id IS NULL OR p_merged_id IS NULL OR p_primary_id=p_merged_id
    THEN RAISE EXCEPTION 'Escolha dois ministérios diferentes.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  SELECT * INTO g FROM public.government_terms
    WHERE ended_at IS NULL AND term_ends_at>clock_timestamp() AND head_id=auth.uid()
    ORDER BY term_starts_at DESC LIMIT 1 FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo vigente sob sua chefia.'; END IF;
  SELECT * INTO parent FROM public.government_ministries WHERE id=p_primary_id AND is_active FOR UPDATE;
  SELECT * INTO child FROM public.government_ministries WHERE id=p_merged_id AND is_active FOR UPDATE;
  IF parent.id IS NULL OR child.id IS NULL THEN RAISE EXCEPTION 'Os dois ministérios devem estar ativos.'; END IF;

  -- No cycles or nested mergers: only a root ministry may absorb a vacant one.
  IF EXISTS (
    SELECT 1 FROM public.government_ministry_merges m
    WHERE m.government_id=g.id AND (
       m.merged_ministry_id=p_primary_id OR
       m.merged_ministry_id=p_merged_id OR m.primary_ministry_id=p_merged_id)
  ) THEN RAISE EXCEPTION 'Uma dessas pastas já foi incorporada. Desfaça a fusão anterior antes de reorganizá-la.'; END IF;

  IF EXISTS (SELECT 1 FROM public.ministers m WHERE m.ministry_id=p_merged_id AND m.status='active')
    THEN RAISE EXCEPTION 'Exonere o titular da pasta a ser incorporada antes da fusão.'; END IF;
  PERFORM private.maintain_minister_invitations();
  IF EXISTS (SELECT 1 FROM public.minister_invitations i
    WHERE i.government_id=g.id AND i.ministry_id=p_merged_id AND i.status='pending')
    THEN RAISE EXCEPTION 'Cancele o convite pendente para a pasta a incorporar.'; END IF;

  INSERT INTO public.government_ministry_merges
    (government_id,primary_ministry_id,merged_ministry_id,created_by)
    VALUES(g.id,parent.id,child.id,auth.uid()) RETURNING * INTO result;
  PERFORM public.justice_write_audit('executive.ministries_merged','government',g.id,
    NULL,to_jsonb(result),'Fusão ministerial com manutenção das competências e dos registros de ambas as pastas.');
  RETURN jsonb_build_object('success',true,'primary_name',parent.name,'merged_name',child.name);
END $$;
REVOKE ALL ON FUNCTION public.merge_government_ministries(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_government_ministries(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.unmerge_government_ministry(p_merged_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE g public.government_terms%rowtype; previous public.government_ministry_merges%rowtype;
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role(auth.uid()) IS DISTINCT FROM 'Presidente'
    THEN RAISE EXCEPTION 'Somente o Presidente em exercício pode desfazer fusões.' USING errcode='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-succession'));
  PERFORM pg_advisory_xact_lock(hashtext('govrp:executive:appointments'));
  SELECT * INTO g FROM public.government_terms
    WHERE ended_at IS NULL AND term_ends_at>clock_timestamp() AND head_id=auth.uid()
    ORDER BY term_starts_at DESC LIMIT 1 FOR UPDATE;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo vigente sob sua chefia.'; END IF;
  SELECT * INTO previous FROM public.government_ministry_merges
    WHERE government_id=g.id AND merged_ministry_id=p_merged_id FOR UPDATE;
  IF previous.id IS NULL THEN RAISE EXCEPTION 'Essa pasta não está incorporada a outra.'; END IF;
  DELETE FROM public.government_ministry_merges WHERE id=previous.id;
  PERFORM public.justice_write_audit('executive.ministries_separated','government',g.id,
    to_jsonb(previous),NULL,'Separação de ministérios: a pasta volta a exigir titular próprio na formação ainda em aberto.');
  RETURN jsonb_build_object('success',true,'merged_id',p_merged_id);
END $$;
REVOKE ALL ON FUNCTION public.unmerge_government_ministry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unmerge_government_ministry(uuid) TO authenticated,service_role;

-- Authoritative, server-side portfolio check for the primary and absorbed ministries.
CREATE OR REPLACE FUNCTION public.current_minister_has_portfolio(p_ministry_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ministers m
    JOIN public.government_terms g ON g.id=m.government_id
    JOIN public.government_ministries requested ON requested.name=p_ministry_name AND requested.is_active
    LEFT JOIN public.government_ministry_merges merged
      ON merged.government_id=g.id AND merged.merged_ministry_id=requested.id
    WHERE m.user_id=auth.uid() AND m.status='active'
      AND g.ended_at IS NULL AND g.term_ends_at>clock_timestamp()
      AND m.ministry_id=coalesce(merged.primary_ministry_id,requested.id)
  );
$$;
REVOKE ALL ON FUNCTION public.current_minister_has_portfolio(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_minister_has_portfolio(text) TO authenticated,service_role;

-- The ministerial dashboard can display the absorbed portfolios without
-- creating duplicate minister records or paying duplicate salaries.
CREATE OR REPLACE FUNCTION public.get_active_ministry_portfolios()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.' USING errcode='42501'; END IF;
 RETURN coalesce((
   SELECT jsonb_agg(to_jsonb(portfolio) ORDER BY portfolio.ministry)
   FROM (
     SELECT m.user_id,m.ministry, m.ministry AS primary_ministry, false AS merged
     FROM public.ministers m JOIN public.government_terms g ON g.id=m.government_id
     WHERE m.status='active' AND g.ended_at IS NULL AND g.term_ends_at>clock_timestamp()
       AND (m.user_id=auth.uid() OR public.has_full_admin_access())
     UNION ALL
     SELECT m.user_id, child.name AS ministry, parent.name AS primary_ministry, true AS merged
     FROM public.ministers m
     JOIN public.government_terms g ON g.id=m.government_id
     JOIN public.government_ministry_merges link
       ON link.government_id=g.id AND link.primary_ministry_id=m.ministry_id
     JOIN public.government_ministries child ON child.id=link.merged_ministry_id
     JOIN public.government_ministries parent ON parent.id=link.primary_ministry_id
     WHERE m.status='active' AND g.ended_at IS NULL AND g.term_ends_at>clock_timestamp()
       AND child.is_active AND (m.user_id=auth.uid() OR public.has_full_admin_access())
   ) portfolio
 ),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_active_ministry_portfolios() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_active_ministry_portfolios() TO authenticated,service_role;

-- Full formation: all effective ministries + three directly appointable
-- government-bound executive offices, not just three accepted ministers.
-- Independent judiciary/attorney offices follow their own approval procedures.
CREATE OR REPLACE FUNCTION public.get_presidential_formation()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE f public.presidential_formation%rowtype; offices jsonb; ministries jsonb; cfg jsonb;
 remaining integer; appointed_ministers integer; required_ministers integer;
 remaining_offices integer; required_offices integer; appointed_offices integer;
BEGIN
 IF auth.uid() IS NULL OR coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' THEN RETURN NULL; END IF;
 PERFORM private.maintain_minister_invitations();
 INSERT INTO public.presidential_formation(user_id,government_id)
 SELECT auth.uid(),id FROM public.government_terms WHERE ended_at IS NULL AND head_id=auth.uid()
 ON CONFLICT DO NOTHING;
 SELECT * INTO f FROM public.presidential_formation
  WHERE user_id=auth.uid() AND ended_at IS NULL FOR UPDATE;
 IF f.id IS NULL OR f.government_id IS NULL THEN RETURN NULL; END IF;
 SELECT value INTO cfg FROM public.system_settings WHERE key='executive_governance';

 SELECT coalesce(jsonb_agg(
  to_jsonb(o) || jsonb_build_object(
    'appointment', CASE WHEN cfg->'specialAppointments'->o.office_key->>'government_id'=f.government_id::text
      THEN cfg->'specialAppointments'->o.office_key ELSE NULL END,
    'invitation',(SELECT to_jsonb(i) FROM public.minister_invitations i
     WHERE i.government_id=f.government_id AND i.office_key=o.office_key
     ORDER BY i.created_at DESC LIMIT 1)
  ) ORDER BY sort_order),'[]'::jsonb) INTO offices
 FROM public.executive_office_definitions o
 WHERE o.required_for_formation AND o.is_assignable AND o.government_bound;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',m.id, 'name',m.name, 'holder_id',holder.user_id,
  'merged_into_id',link.primary_ministry_id, 'merged_into',parent.name,
  'invitation',(SELECT to_jsonb(i) FROM public.minister_invitations i
    WHERE i.government_id=f.government_id AND i.ministry_id=m.id
    ORDER BY created_at DESC LIMIT 1)
 ) ORDER BY m.name),'[]'::jsonb) INTO ministries
 FROM public.government_ministries m
 LEFT JOIN public.government_ministry_merges link
   ON link.government_id=f.government_id AND link.merged_ministry_id=m.id
 LEFT JOIN public.government_ministries parent ON parent.id=link.primary_ministry_id
 LEFT JOIN LATERAL (
   SELECT mi.user_id FROM public.ministers mi
   WHERE mi.ministry_id=coalesce(link.primary_ministry_id,m.id)
     AND mi.government_id=f.government_id AND mi.status='active'
   ORDER BY mi.appointed_at DESC LIMIT 1
 ) holder ON true
 WHERE m.is_active;

 SELECT count(*)::int,count(*) FILTER(WHERE x->>'holder_id' IS NOT NULL)::int
 INTO required_ministers,appointed_ministers
 FROM jsonb_array_elements(ministries) x WHERE x->>'merged_into_id' IS NULL;

 SELECT count(*)::int,count(*) FILTER(WHERE o->'appointment'->>'user_id' IS NOT NULL)::int
 INTO required_offices,appointed_offices FROM jsonb_array_elements(offices) o;

 remaining_offices:=required_offices-appointed_offices;
 remaining:=greatest(0,required_ministers-appointed_ministers)+greatest(0,remaining_offices);

 IF f.status='pending' THEN
   UPDATE public.presidential_formation SET status='in_progress' WHERE id=f.id RETURNING * INTO f;
 END IF;
 RETURN to_jsonb(f)||jsonb_build_object(
   'offices',offices,'ministries',ministries,'remaining',remaining,
   'appointed_ministers',appointed_ministers,'required_ministers',required_ministers,
   'required_offices',required_offices,'appointed_offices',appointed_offices,
   'remaining_offices',remaining_offices,'can_complete',remaining=0,
   'awaiting',(SELECT count(*) FROM public.minister_invitations
       WHERE government_id=f.government_id AND status='pending'
         AND expires_at>clock_timestamp()),
   'revision',(SELECT max(change_at) FROM (
       SELECT coalesce(responded_at,created_at) AS change_at FROM public.minister_invitations
         WHERE government_id=f.government_id
       UNION ALL
       SELECT created_at FROM public.government_ministry_merges
         WHERE government_id=f.government_id
     ) changes),
   'government',(SELECT to_jsonb(g) FROM public.government_terms g
       WHERE g.id=f.government_id AND g.ended_at IS NULL)
 );
END $$;

CREATE OR REPLACE FUNCTION public.complete_presidential_formation()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE f jsonb;
BEGIN
 f:=public.get_presidential_formation();
 IF f IS NULL THEN RAISE EXCEPTION 'Somente o Presidente em exercício pode concluir a formação.' USING errcode='42501'; END IF;
 IF coalesce((f->>'remaining')::integer,1)<>0 THEN
   RAISE EXCEPTION 'Preencha todos os ministérios não incorporados e as nomeações estratégicas obrigatórias antes de concluir.';
 END IF;
 IF f->'government'->>'cabinet_decision'='pending' THEN RAISE EXCEPTION 'Escolha o gabinete que assumirá o Governo.'; END IF;
 UPDATE public.presidential_formation
   SET completed_at=coalesce(completed_at,clock_timestamp()),status='completed'
   WHERE id=(f->>'id')::uuid;
END $$;

-- After presidential succession, keeping the prior cabinet does not bypass
-- the restored full formation checklist.
CREATE OR REPLACE FUNCTION public.choose_government_cabinet(p_choice text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE g public.government_terms%rowtype;
BEGIN
 IF auth.uid() IS NULL OR (coalesce(public.get_user_role(auth.uid()),'')<>'Presidente' AND NOT public.has_full_admin_access())
  THEN RAISE EXCEPTION 'Somente a chefia do Governo pode escolher a equipe.' USING errcode='42501'; END IF;
 IF p_choice NOT IN ('keep','reform') OR p_choice IS NULL THEN RAISE EXCEPTION 'Escolha manter a equipe ou formar uma nova.'; END IF;
 SELECT * INTO g FROM public.government_terms WHERE ended_at IS NULL
 AND (head_id=auth.uid() OR public.has_full_admin_access())
 ORDER BY term_starts_at DESC LIMIT 1 FOR UPDATE;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Não há Governo ativo sob sua chefia.'; END IF;
 IF g.cabinet_decision<>'pending' THEN RETURN to_jsonb(g); END IF;
 IF p_choice='reform' THEN
  PERFORM private.end_government_cabinet(g.id,'Reforma ministerial decidida pela nova chefia do Governo.');
 ELSE
  INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,actor_id,metadata)
   SELECT user_id,ministry_id,'retained','Equipe mantida após sucessão presidencial.',auth.uid(),
     jsonb_build_object('government_id',g.id,'head_id',g.head_id)
   FROM public.ministers WHERE government_id=g.id AND status='active';
 END IF;
 UPDATE public.presidential_formation SET status='in_progress',completed_at=NULL
   WHERE government_id=g.id AND user_id=g.head_id AND ended_at IS NULL;
 UPDATE public.government_terms SET cabinet_decision=CASE WHEN p_choice='keep' THEN 'kept' ELSE 'reformed' END
   WHERE id=g.id RETURNING * INTO g;
 PERFORM public.justice_write_audit('executive.cabinet_choice','government',g.id,NULL,to_jsonb(g),
   'Escolha ministerial após sucessão.');
 RETURN to_jsonb(g);
END $$;

-- Reject invitations to a portfolio that has been absorbed.
DO $guard$
DECLARE definition text; before_text text; after_text text;
BEGIN
 SELECT pg_get_functiondef('public.appoint_minister(uuid,text)'::regprocedure) INTO definition;
 before_text:=' if m.id is null then raise exception ''Selecione um Ministério ativo.'';end if;';
 after_text:=before_text||E'\n if exists(select 1 from public.government_ministry_merges j where j.government_id=g.id and j.merged_ministry_id=m.id) then raise exception ''Esta pasta está incorporada a outro ministério; indique o titular da pasta principal.'';end if;';
 IF strpos(definition,before_text)=0 THEN
  RAISE EXCEPTION 'A estrutura de appoint_minister mudou; revisão necessária.';
 END IF;
 EXECUTE replace(definition,before_text,after_text);

 SELECT pg_get_functiondef('private.respond_ministry_invitation(uuid,boolean)'::regprocedure) INTO definition;
 before_text:=' if m.id is null then raise exception ''Este Ministério não está mais ativo.'';end if;';
 after_text:=before_text||E'\n if exists(select 1 from public.government_ministry_merges j where j.government_id=i.government_id and j.merged_ministry_id=m.id) then raise exception ''Este Ministério foi incorporado e não recebe convite próprio.'';end if;';
 IF strpos(definition,before_text)=0 THEN
  RAISE EXCEPTION 'A estrutura de respond_ministry_invitation mudou; revisão necessária.';
 END IF;
 EXECUTE replace(definition,before_text,after_text);

 SELECT pg_get_functiondef('public.apply_policy_decision(text,numeric,text,numeric,timestamp with time zone)'::regprocedure) INTO definition;
 before_text:='and ministry_assignment.ministry=''Ministério da Economia'')) then';
 after_text:='and ministry_assignment.ministry=''Ministério da Economia'') or public.current_minister_has_portfolio(''Ministério da Economia'')) then';
 IF strpos(definition,before_text)=0 THEN
  RAISE EXCEPTION 'A competência fiscal mudou; revisão necessária.';
 END IF;
 EXECUTE replace(definition,before_text,after_text);
END $guard$;

COMMIT;
