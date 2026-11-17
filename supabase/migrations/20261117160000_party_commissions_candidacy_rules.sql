-- GOVRP 2026-11-17: optional electoral approval reasons, mixed commissions, party vote guidance.
BEGIN;

DO $patch$
DECLARE
 f text;
 old_text text;
 new_text text;
BEGIN
 SELECT pg_get_functiondef('public.review_electoral_candidacy(uuid,boolean,text)'::regprocedure) INTO f;
 old_text:=$old$if p_approved is null or length(btrim(coalesce(p_reason,'')))<20 then raise exception 'Informe uma decisão e uma fundamentação de pelo menos 20 caracteres.'; end if;$old$;
 new_text:=$new$if p_approved is null then raise exception 'Selecione aprovar ou indeferir.'; end if;
 if not p_approved and length(btrim(coalesce(p_reason,'')))<20 then
   raise exception 'O indeferimento exige fundamentação de pelo menos 20 caracteres.';
 end if;$new$;
 IF strpos(f,old_text)=0 THEN
   RAISE EXCEPTION 'review_electoral_candidacy divergente; alteração interrompida.';
 END IF;
 EXECUTE replace(f,old_text,new_text);

 SELECT pg_get_functiondef('public.create_parliament_commission(text,text,text,text,uuid[])'::regprocedure) INTO f;
 IF strpos(f,$old$if p_type not in ('permanent', 'temporary', 'cpi', 'cpmi') then$old$)=0
 OR strpos(f,$old$if p_type = 'cpmi' then$old$)=0
 OR strpos(f,$old$v_status := 'collecting_support';$old$)=0 THEN
   RAISE EXCEPTION 'create_parliament_commission divergente; alteração interrompida.';
 END IF;
 f:=replace(f,$old$if p_type not in ('permanent', 'temporary', 'cpi', 'cpmi') then$old$,
              $new$if p_type not in ('permanent', 'temporary', 'cpi', 'cpmi', 'mixed') then$new$);
 f:=replace(f,$old$if p_type = 'cpmi' then$old$,
              $new$if p_type in ('cpmi','mixed') then$new$);
 f:=replace(f,$old$CPMI deve envolver exatamente duas Casas.$old$,
              $new$Comissões mistas precisam envolver Câmara e Senado.$new$);
 f:=replace(f,$old$v_status := 'collecting_support';$old$,
              $new$v_status := case when p_type='mixed' then 'pending_joint_approval' else 'collecting_support' end;$new$);
 f:=replace(f,$old$when p_type = 'temporary' then 'Comissão temporária cadastrada e pronta para deliberação do plenário.'$old$,
              $new$when p_type = 'temporary' then 'Comissão temporária cadastrada e pronta para deliberação do plenário.'
      when p_type = 'mixed' then 'Comissão mista aguardando aprovação pelas presidências das duas Casas.'$new$);
 EXECUTE f;
END $patch$;

ALTER TABLE public.parliament_commissions DROP CONSTRAINT parliament_commissions_type_check;
ALTER TABLE public.parliament_commissions ADD CONSTRAINT parliament_commissions_type_check
 CHECK (type IN('permanent','temporary','cpi','cpmi','mixed'));
ALTER TABLE public.parliament_commissions DROP CONSTRAINT parliament_commissions_status_check;
ALTER TABLE public.parliament_commissions ADD CONSTRAINT parliament_commissions_status_check
 CHECK (status IN('draft','collecting_support','pending_plenary','pending_joint_approval',
                  'approved_pending_officialization','active','completed','rejected','archived'));
ALTER TABLE public.parliament_commissions ADD COLUMN IF NOT EXISTS joint_approvals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.parliament_commissions ADD CONSTRAINT parliament_commissions_joint_approvals_array
 CHECK (jsonb_typeof(joint_approvals)='array');

-- Comissões mistas não investigativas: aprovação da Mesa de ambas as Casas.
CREATE OR REPLACE FUNCTION public.approve_mixed_parliament_commission(p_commission_id uuid,p_house_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_commission public.parliament_commissions%rowtype;
 v_actor uuid:=auth.uid();
 v_total integer;
 v_approvals jsonb;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE='42501';END IF;
 SELECT * INTO v_commission FROM public.parliament_commissions WHERE id=p_commission_id FOR UPDATE;
 IF NOT FOUND OR v_commission.type<>'mixed' THEN RAISE EXCEPTION 'Comissão mista não encontrada.';END IF;
 IF v_commission.status NOT IN('pending_joint_approval','active') THEN RAISE EXCEPTION 'A comissão já encerrou seu rito.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.parliament_commission_houses WHERE commission_id=p_commission_id AND house_id=p_house_id)
 THEN RAISE EXCEPTION 'A Casa não participa desta comissão.';END IF;
 IF NOT public.is_parliament_governance_manager(v_actor,p_house_id) THEN
  RAISE EXCEPTION 'Somente a Presidência/Mesa da Casa pode aprovar a comissão mista.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_commission.joint_approvals) a WHERE a->>'house_id'=p_house_id::text) THEN
  UPDATE public.parliament_commissions
  SET joint_approvals=joint_approvals||jsonb_build_array(
     jsonb_build_object('house_id',p_house_id,'approved_by',v_actor,'approved_at',clock_timestamp())),
     updated_at=clock_timestamp()
  WHERE id=p_commission_id RETURNING joint_approvals INTO v_approvals;
 ELSE v_approvals:=v_commission.joint_approvals;
 END IF;
 SELECT count(*) INTO v_total FROM public.parliament_commission_houses WHERE commission_id=p_commission_id;
 IF v_total<>2 THEN RAISE EXCEPTION 'Uma comissão mista deve envolver exatamente duas Casas.';END IF;
 IF jsonb_array_length(v_approvals)=2 THEN
   UPDATE public.parliament_commissions
   SET status='active',officialized_by=v_actor,officialized_at=coalesce(officialized_at,clock_timestamp()),
       opened_at=coalesce(opened_at,clock_timestamp()),updated_at=clock_timestamp()
   WHERE id=p_commission_id AND status='pending_joint_approval';
 END IF;
 RETURN jsonb_build_object('success',true,'approved_houses',jsonb_array_length(v_approvals),'required_houses',2,
   'active',jsonb_array_length(v_approvals)=2,'message',case when jsonb_array_length(v_approvals)=2
   then 'Comissão mista instalada com aprovação das duas Casas.'
   else 'Aprovação registrada. A comissão aguarda deliberação da outra Casa.' end);
END $function$;

REVOKE ALL ON FUNCTION public.approve_mixed_parliament_commission(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_mixed_parliament_commission(uuid,uuid) TO authenticated;

-- Orientação da bancada é informativa. Nunca altera nem dispara o voto de parlamentares.
CREATE TABLE IF NOT EXISTS public.party_vote_guidance(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 party_id uuid NOT NULL REFERENCES public.political_parties(id) ON DELETE CASCADE,
 bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
 position text NOT NULL CHECK (position IN('support','oppose','abstain','free')),
 rationale text NOT NULL DEFAULT '',
 issued_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(party_id,bill_id),
 CONSTRAINT party_vote_guidance_rationale_limit CHECK(length(rationale)<=2500)
);
CREATE INDEX IF NOT EXISTS party_vote_guidance_bill_idx ON public.party_vote_guidance(bill_id);
ALTER TABLE public.party_vote_guidance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.party_vote_guidance FROM anon,authenticated;
GRANT SELECT ON public.party_vote_guidance TO authenticated;
DROP POLICY IF EXISTS party_guidance_public_read ON public.party_vote_guidance;
CREATE POLICY party_guidance_public_read ON public.party_vote_guidance FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_party_vote_guidance(p_party_id uuid,p_bill_id uuid,p_position text,p_rationale text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid:=auth.uid();
 v_party public.political_parties%rowtype;
 v_bill public.bills%rowtype;
 v_result public.party_vote_guidance%rowtype;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Autenticação necessária.' USING ERRCODE='42501';END IF;
 SELECT * INTO v_party FROM public.political_parties WHERE id=p_party_id;
 IF NOT FOUND OR NOT coalesce(v_party.is_active,false) THEN RAISE EXCEPTION 'Partido não ativo ou não encontrado.';END IF;
 IF v_actor NOT IN (v_party.owner_id,v_party.president_id,v_party.vice_president_id) THEN
  RAISE EXCEPTION 'Somente a direção partidária pode emitir orientação de bancada.' USING ERRCODE='42501';
 END IF;
 IF p_position NOT IN ('support','oppose','abstain','free') THEN RAISE EXCEPTION 'Orientação inválida.';END IF;
 IF length(btrim(coalesce(p_rationale,'')))>2500 THEN RAISE EXCEPTION 'A orientação ultrapassa 2.500 caracteres.'; END IF;
 SELECT * INTO v_bill FROM public.bills WHERE id=p_bill_id;
 IF NOT FOUND OR v_bill.status NOT IN('Em tramitação','Em votação','Em votação (2ª Casa)') THEN
  RAISE EXCEPTION 'A orientação precisa ser dirigida a um projeto em tramitação ou votação.';
 END IF;
 INSERT INTO public.party_vote_guidance(party_id,bill_id,position,rationale,issued_by)
 VALUES(p_party_id,p_bill_id,p_position,btrim(coalesce(p_rationale,'')),v_actor)
 ON CONFLICT(party_id,bill_id) DO UPDATE SET position=excluded.position,rationale=excluded.rationale,
   issued_by=excluded.issued_by,updated_at=clock_timestamp()
 RETURNING * INTO v_result;
 RETURN jsonb_build_object('success',true,'guidance',to_jsonb(v_result),
  'message','Orientação partidária publicada. O voto permanece individual e independente.');
END $function$;
REVOKE ALL ON FUNCTION public.set_party_vote_guidance(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_party_vote_guidance(uuid,uuid,text,text) TO authenticated;
COMMIT;