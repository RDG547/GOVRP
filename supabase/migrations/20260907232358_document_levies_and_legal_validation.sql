BEGIN;
-- Retain the existing document prices in the same authoritative rule engine.
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
SELECT lower(m.key),coalesce((s.value->>m.key)::numeric,0),'BRL','Taxa de emissão: '||m.doc,'system','fee',
 jsonb_build_object('basis','document','document_type',m.doc,'nature','fixed','payer','buyer','audience','all')
FROM public.system_settings s CROSS JOIN (VALUES ('doc_CNH','CNH'),('doc_Passport','Passport'),('doc_CNPJ','CNPJ'),('doc_CTD','CTD'),('doc_Titulo_Eleitor','Título de Eleitor'),('doc_Certificado_Reservista','Certificado de Reservista'),('doc_Certidao_Casamento','Certidão de Casamento'),('doc_Registro_Profissional','Registro Profissional')) m(key,doc)
WHERE s.key='base_tariffs' ON CONFLICT(rule_key) DO NOTHING;
CREATE INDEX IF NOT EXISTS government_rules_active_effect_idx ON public.government_rules(active_effect_id);
CREATE INDEX IF NOT EXISTS warrants_sentence_idx ON public.warrants(sentence_id);
CREATE INDEX IF NOT EXISTS case_timeline_investigation_idx ON public.case_timeline_events(investigation_id,created_at);
CREATE OR REPLACE FUNCTION private.assign_mandate_current_party()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_party uuid;
BEGIN
 SELECT party_id INTO current_party FROM public.party_members WHERE user_id=NEW.user_id ORDER BY joined_at DESC,id LIMIT 1;
 IF TG_OP='INSERT' THEN NEW.elected_party_id:=coalesce(NEW.elected_party_id,NEW.party_id,current_party); END IF;
 NEW.party_id:=current_party;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.assign_mandate_current_party() FROM PUBLIC,anon,authenticated;
ALTER FUNCTION private.assign_mandate_current_party() OWNER TO postgres;
CREATE TRIGGER mandate_current_party BEFORE INSERT OR UPDATE OF party_id,user_id ON public.parliament_members FOR EACH ROW EXECUTE FUNCTION private.assign_mandate_current_party();
NOTIFY pgrst,'reload schema';
COMMIT;
