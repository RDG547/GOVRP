-- GOVRP: all sanctions and vetoes must originate from an explicit presidential confirmation.
-- Restore the two incomplete vetoes so the President may decide again.
BEGIN;

CREATE OR REPLACE FUNCTION private.require_explicit_presidential_bill_decision()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $function$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status
   AND NEW.status IN ('Sancionado','Vetado integralmente','Vetado parcialmente')
   AND current_setting('govrp.presidential_bill_decision',true)
      IS DISTINCT FROM NEW.id::text||':'||NEW.status
 THEN
   RAISE EXCEPTION 'A decisão presidencial exige confirmação expressa. Use o painel de sanção ou veto.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION private.require_explicit_presidential_bill_decision() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS require_explicit_presidential_bill_decision ON public.bills;
CREATE TRIGGER require_explicit_presidential_bill_decision
BEFORE UPDATE OF status ON public.bills
FOR EACH ROW EXECUTE FUNCTION private.require_explicit_presidential_bill_decision();

DO $rewrite$
DECLARE
 f text;
 old_text text;
 new_text text;
BEGIN
 SELECT pg_get_functiondef('public.update_bill_status(uuid,text)'::regprocedure) INTO f;
 old_text:='  IF bill.status=p_new_status THEN RETURN; END IF;';
 new_text:=$target$
  -- A direct call to update_bill_status cannot sanction or veto.
  IF p_new_status IN('Sancionado','Vetado integralmente','Vetado parcialmente')
   AND current_setting('govrp.presidential_bill_decision',true)
      IS DISTINCT FROM p_bill_id::text||':'||p_new_status
  THEN
    RAISE EXCEPTION 'Sanção ou veto exige confirmação explícita no painel presidencial.' USING ERRCODE='42501';
  END IF;
  IF bill.status=p_new_status THEN RETURN; END IF;$target$;
 IF strpos(f,old_text)=0 OR strpos(f,'govrp.presidential_bill_decision')>0 THEN
   RAISE EXCEPTION 'A função update_bill_status mudou; revisar proteção antes de atualizar.';
 END IF;
 EXECUTE replace(f,old_text,new_text);

 SELECT pg_get_functiondef('public.review_presidential_bill(uuid,text,text,text)'::regprocedure) INTO f;
 old_text:=$old$
 IF v_bill.status=v_result_status THEN
   -- Recovery path for the previously half-written veto decisions.
   -- Require a previous status change BY THE SAME current president.
   IF NOT EXISTS(
      SELECT 1 FROM public.bill_status_history h
      WHERE h.bill_id=p_bill_id AND h.status=v_result_status
        AND h.actor_id=v_actor
   ) THEN
     RAISE EXCEPTION 'O ato anterior não pode ser regularizado sem auditoria do responsável.'
       USING ERRCODE='42501';
   END IF;
   v_recovered:=true;
 ELSE
   -- Existing authoritative RPC still verifies parliamentary approval,
   -- current status, executive role and permitted constitutional transitions.
   PERFORM public.update_bill_status(p_bill_id,v_result_status);
 END IF;$old$;
 new_text:=$new$
 IF v_bill.status=v_result_status THEN
   -- Unconfirmed decisions must be formally invalidated before a new decision.
   RAISE EXCEPTION 'A decisão já consta no projeto; solicite revisão administrativa se não foi confirmada.' USING ERRCODE='42501';
 ELSE
   -- The flag is local to this transaction and bound to this bill and status.
   PERFORM set_config('govrp.presidential_bill_decision',p_bill_id::text||':'||v_result_status,true);
   PERFORM public.update_bill_status(p_bill_id,v_result_status);
 END IF;$new$;
 IF strpos(f,old_text)=0 OR strpos(f,'govrp.presidential_bill_decision')>0 THEN
   RAISE EXCEPTION 'A revisão presidencial mudou; revisar antes de atualizar.';
 END IF;
 EXECUTE replace(f,old_text,new_text);
END $rewrite$;

-- Existing vetoes have no presidential decision record, justification, or published veto.
DO $restore$
DECLARE
 b public.bills%rowtype;
 v_count integer:=0;
 v_houses integer;
 v_audit bigint;
 v_expected uuid[]:=ARRAY['3cdf74fc-e1c8-41f3-b69b-21061698c847'::uuid,'51c6c8dd-c1cc-483a-a521-ffd97679fe37'::uuid];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('govrp:presidential-bill-review'));
 -- Schema-only previews do not contain the two historical decisions.
 -- Never fabricate or replay this administrative correction there.
 IF NOT EXISTS(SELECT 1 FROM public.bills WHERE id=ANY(v_expected)) THEN
   RAISE NOTICE 'Historical veto correction skipped: source bills are absent.';
   RETURN;
 END IF;
 IF (SELECT count(*) FROM public.bills WHERE status IN('Vetado integralmente','Vetado parcialmente'))<>2 THEN
    RAISE EXCEPTION 'A quantidade de vetos mudou; revisar antes de reabrir.';
 END IF;
 FOR b IN SELECT * FROM public.bills WHERE id=ANY(v_expected) AND status='Vetado integralmente' ORDER BY id FOR UPDATE LOOP
   SELECT count(DISTINCT house_id) INTO v_houses FROM public.parliament_votings
   WHERE related_id=b.id AND type='bill' AND status='closed'
      AND coalesce((result->>'approved')::boolean,false);
   IF b.type NOT IN('PL','Projeto de Lei') OR v_houses<1 THEN
      RAISE EXCEPTION 'Projeto % não tem aprovação parlamentar suficiente.',b.id;
   END IF;
   IF EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=b.id AND type='Veto Presidencial')
      OR EXISTS(SELECT 1 FROM public.law_effects WHERE source_kind='bill' AND source_id=b.id AND status='active') THEN
       RAISE EXCEPTION 'Veto % possui publicação ou efeito legal; requer verificação isolada.',b.id;
   END IF;
   SELECT economy_private.audit('presidential_veto_invalidated_for_redecision','bills',b.id::text,
      to_jsonb(b),
      jsonb_build_object('status','Aguardando sanção presidencial','motivo','Veto sem ato formal'),
      'Invalidação administrativa de veto incompleto; decisão devolvida ao Presidente. Votação parlamentar mantida.',null::uuid)
      INTO v_audit;
   UPDATE public.bills SET status='Aguardando sanção presidencial',updated_at=clock_timestamp()
      WHERE id=b.id AND status='Vetado integralmente';
   INSERT INTO public.bill_status_history(bill_id,status,event_label,occurred_at,actor_id,metadata)
   VALUES (b.id,'Aguardando sanção presidencial','Veto invalidado; aguardando nova decisão presidencial',
     clock_timestamp(),null,jsonb_build_object('source','administrative_veto_reset','prior_status',b.status,'audit_id',v_audit));
   v_count:=v_count+1;
 END LOOP;
 IF v_count<>2 THEN RAISE EXCEPTION 'A reversão esperava dois vetos e encontrou %.',v_count; END IF;
END $restore$;
COMMIT;
