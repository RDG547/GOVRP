-- GOVRP: optional citizen explanation on credit-limit requests, with authorized
-- platform-admin self-review (the Admin can already set limits through the bank RPC).
-- Other bank officers still cannot approve/reject their own requests.
BEGIN;

DO $patch$
DECLARE
  def text;
  original text;
  replacement text;
BEGIN
  SELECT pg_get_functiondef('public.request_card_limit_increase(uuid,numeric,text)'::regprocedure) INTO def;
  original := $old$IF length(btrim(p_justification))<10 OR length(p_justification)>2000 THEN RAISE EXCEPTION 'Informe uma justificativa entre 10 e 2.000 caracteres.';END IF;$old$;
  replacement := $new$IF length(coalesce(p_justification,''))>2000 THEN RAISE EXCEPTION 'A justificativa opcional deve conter até 2.000 caracteres.';END IF;$new$;
  IF strpos(def,original)=0 THEN
    RAISE EXCEPTION 'Validation of the limit request changed; review the existing function before patching.';
  END IF;
  def:=replace(def,original,replacement);

  -- The idempotency comparison and stored explanation must work with NULL or blank.
  original:=$old$a.justification=btrim(p_justification)$old$;
  replacement:=$new$a.justification=btrim(coalesce(p_justification,''))$new$;
  IF strpos(def,original)=0 THEN RAISE EXCEPTION 'Request idempotency condition changed.';END IF;
  def:=replace(def,original,replacement);

  original:=$old$c.id,c.card_limit,btrim(p_justification))$old$;
  replacement:=$new$c.id,c.card_limit,btrim(coalesce(p_justification,'')))$new$;
  IF strpos(def,original)=0 THEN RAISE EXCEPTION 'Request insert signature changed.';END IF;
  def:=replace(def,original,replacement);
  EXECUTE def;

  SELECT pg_get_functiondef('private.review_card_limit_request(uuid,boolean,numeric,text)'::regprocedure) INTO def;
  original := $old$IF a.user_id=auth.uid() THEN RAISE EXCEPTION 'Você não pode analisar seu próprio pedido.' USING errcode='42501';END IF;$old$;
  replacement := $new$-- A platform Admin has existing authorization to change bank limits directly.
  -- Other bank managers must have a different authorized reviewer.
  IF a.user_id=auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'O pedido próprio precisa ser analisado por outro gestor autorizado.' USING errcode='42501';
  END IF;$new$;
  IF strpos(def,original)=0 THEN
    RAISE EXCEPTION 'Self-review authorization changed; inspect the current function.';
  END IF;
  def:=replace(def,original,replacement);
  original:=$old$PERFORM economy_private.audit('card_limit_request_reviewed','credit_card_applications',a.id::text,to_jsonb(a),jsonb_build_object('approved',p_approved,'new_limit',amount),p_feedback,auth.uid());$old$;
  replacement:=$new$PERFORM economy_private.audit('card_limit_request_reviewed','credit_card_applications',a.id::text,to_jsonb(a),
    jsonb_build_object('approved',p_approved,'new_limit',amount,'admin_self_review',a.user_id=auth.uid()),
    CASE WHEN a.user_id=auth.uid() THEN concat('Análise do próprio pedido por Admin autorizado. ',coalesce(p_feedback,'')) ELSE p_feedback END,
    auth.uid());$new$;
  IF strpos(def,original)=0 THEN RAISE EXCEPTION 'Review audit contract changed.';END IF;
  def:=replace(def,original,replacement);
  EXECUTE def;
END
$patch$;

NOTIFY pgrst, 'reload schema';
COMMIT;