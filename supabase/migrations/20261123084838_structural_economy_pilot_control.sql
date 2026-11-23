BEGIN;
CREATE TABLE private.autonomous_economy_decisions(
 id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),enabled boolean NOT NULL,
 justification text NOT NULL,previous_config jsonb NOT NULL,next_config jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE private.autonomous_economy_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.autonomous_economy_decisions FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.configure_autonomous_economy(p_enabled boolean,p_justification text,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; result jsonb; decision private.autonomous_economy_decisions%rowtype;
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN RAISE EXCEPTION 'Acesso administrativo obrigatório.' USING errcode='42501';END IF;
 IF p_enabled IS NULL OR p_key IS NULL OR p_justification IS NULL OR length(btrim(p_justification))<20 THEN
  RAISE EXCEPTION 'Informe a decisão e justificativa administrativa de pelo menos 20 caracteres.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 SELECT * INTO decision FROM private.autonomous_economy_decisions WHERE id=p_key;
 IF FOUND THEN
  IF decision.actor_id IS DISTINCT FROM auth.uid() OR decision.enabled<>p_enabled OR decision.justification<>btrim(p_justification) THEN
   RAISE EXCEPTION 'Identificação já usada para outra decisão.';
  END IF;
  RETURN decision.next_config||jsonb_build_object('idempotent',true);
 END IF;
 SELECT to_jsonb(c) INTO prior FROM private.autonomous_economy_config c WHERE id=true FOR UPDATE;
 UPDATE private.autonomous_economy_config SET enabled=p_enabled,updated_at=clock_timestamp(),updated_by=auth.uid(),justification=btrim(p_justification) WHERE id=true;
 SELECT to_jsonb(c) INTO result FROM private.autonomous_economy_config c WHERE id=true;
 INSERT INTO private.autonomous_economy_decisions(id,actor_id,enabled,justification,previous_config,next_config)
 VALUES(p_key,auth.uid(),p_enabled,btrim(p_justification),prior,result);
 UPDATE public.economic_state SET updated_at=clock_timestamp() WHERE id=true;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.configure_autonomous_economy(boolean,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_autonomous_economy(boolean,text,uuid) TO authenticated;
COMMIT;
