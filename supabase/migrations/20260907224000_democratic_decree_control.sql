BEGIN;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS suspends_decree_id uuid REFERENCES public.decrees(id);
ALTER TABLE public.decrees ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.decrees ADD COLUMN IF NOT EXISTS revoked_by_bill_id uuid REFERENCES public.bills(id);

CREATE OR REPLACE FUNCTION public.propose_decree_suspension(p_decree_id uuid,p_house_id uuid,p_reason text)
RETURNS public.bills LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.decrees%rowtype; b public.bills%rowtype;
BEGIN
 IF NOT public.justice_has_role(ARRAY['Admin','Deputado','Senador']) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<40 THEN RAISE EXCEPTION 'LEGAL_TEXT_REQUIRED'; END IF;
 SELECT * INTO d FROM public.decrees WHERE id=p_decree_id AND is_published AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'LEGAL_SOURCE_NOT_FOUND'; END IF;
 b:=public.propose_parliament_bill('Sustação do decreto: '||d.title,p_reason,
   'Art. 1º. Fica sustado o decreto '||d.title||'. Art. 2º. Cessam seus efeitos sobre novas operações, preservado o histórico. Justificativa: '||p_reason,'PDL',p_house_id);
 UPDATE public.bills SET suspends_decree_id=d.id WHERE id=b.id RETURNING * INTO b;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.propose_decree_suspension(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_decree_suspension(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.promulgate_decree_suspension(p_bill_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.bills%rowtype;
BEGIN
 SELECT * INTO b FROM public.bills WHERE id=p_bill_id FOR UPDATE;
 IF b.suspends_decree_id IS NULL OR b.type<>'PDL' THEN RAISE EXCEPTION 'INVALID_LEGAL_SOURCE'; END IF;
 IF b.status='Promulgado' THEN RETURN; END IF;
 -- Reuse the exact same quorum, voting and mandate checks as other legislation.
 PERFORM public.update_bill_status(p_bill_id,'Aguardando sanção presidencial');
 UPDATE public.bills SET status='Promulgado',updated_at=clock_timestamp() WHERE id=p_bill_id;
END $$;
REVOKE ALL ON FUNCTION public.promulgate_decree_suspension(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.promulgate_decree_suspension(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.execute_decree_suspension()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;
BEGIN
 IF NEW.suspends_decree_id IS NOT NULL AND NEW.status='Promulgado' AND OLD.status IS DISTINCT FROM 'Promulgado' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('govrp-legal-world',0));
   FOR e IN SELECT id FROM public.law_effects WHERE source_kind='decree' AND source_id=NEW.suspends_decree_id AND status IN('active','scheduled') ORDER BY id FOR UPDATE LOOP PERFORM private.expire_structured_effect(e.id); END LOOP;
   UPDATE public.decrees SET revoked_at=clock_timestamp(),revoked_by_bill_id=NEW.id WHERE id=NEW.suspends_decree_id AND revoked_at IS NULL;
   INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
   VALUES('decree_suspended','government','decrees',NEW.suspends_decree_id,auth.uid(),jsonb_build_object('bill_id',NEW.id,'title',NEW.title),'decree-suspended:'||NEW.suspends_decree_id) ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER decree_suspension AFTER UPDATE OF status ON public.bills FOR EACH ROW EXECUTE FUNCTION private.execute_decree_suspension();
CREATE OR REPLACE FUNCTION private.guard_published_decree()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.is_published THEN RAISE EXCEPTION 'DECREE_DRAFT_REQUIRED'; END IF;
 IF TG_OP IN('UPDATE','DELETE') AND OLD.is_published THEN
   IF TG_OP='UPDATE' AND pg_trigger_depth()>1 AND NEW.revoked_by_bill_id IS NOT NULL
     AND (to_jsonb(NEW)-ARRAY['revoked_at','revoked_by_bill_id','updated_at'])=(to_jsonb(OLD)-ARRAY['revoked_at','revoked_by_bill_id','updated_at'])
     AND EXISTS(SELECT 1 FROM public.bills WHERE id=NEW.revoked_by_bill_id AND suspends_decree_id=OLD.id AND status='Promulgado') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'PUBLISHED_NORM_IS_IMMUTABLE';
 END IF;
 IF TG_OP='UPDATE' AND NEW.is_published THEN
   IF NOT public.justice_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
   NEW.published_at:=clock_timestamp();
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.execute_decree_suspension() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
