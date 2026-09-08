-- Extend the existing government_rules/law_effects engine, rather than create
-- another tax table or interpret free-form legal text.
ALTER TABLE public.government_rules
 ADD COLUMN IF NOT EXISTS rule_kind text NOT NULL DEFAULT 'policy',
 ADD COLUMN IF NOT EXISTS definition jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT '-infinity',
 ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE public.law_effects
 ADD COLUMN IF NOT EXISTS effect_data jsonb,
 ADD COLUMN IF NOT EXISTS valid_from timestamptz,
 ADD COLUMN IF NOT EXISTS valid_until timestamptz,
 ADD COLUMN IF NOT EXISTS previous_snapshot jsonb;
ALTER TABLE public.law_effects DROP CONSTRAINT IF EXISTS law_effects_status_check;
ALTER TABLE public.law_effects ADD CONSTRAINT law_effects_status_check CHECK(status IN('draft','scheduled','active','revoked'));
ALTER TABLE public.penal_code ADD COLUMN IF NOT EXISTS legal_history jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.case_charges ADD COLUMN IF NOT EXISTS legal_snapshot jsonb;
ALTER TABLE public.sentences ADD COLUMN IF NOT EXISTS legal_snapshot jsonb;

CREATE TABLE IF NOT EXISTS public.legal_authority_rules(
 capability text PRIMARY KEY,
 legislative_allowed boolean NOT NULL DEFAULT true,
 decree_allowed boolean NOT NULL DEFAULT false,
 decree_max_value numeric,
 decree_max_days integer,
 description text NOT NULL
);
ALTER TABLE public.legal_authority_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_authority_public_read ON public.legal_authority_rules;
CREATE POLICY legal_authority_public_read ON public.legal_authority_rules FOR SELECT TO anon,authenticated USING(true);
REVOKE ALL ON public.legal_authority_rules FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legal_authority_rules TO anon,authenticated;
GRANT ALL ON public.legal_authority_rules TO service_role;
INSERT INTO public.legal_authority_rules VALUES
 ('tax',true,false,null,null,'Criação, alteração ou revogação de impostos exige aprovação legislativa.'),
 ('fee',true,true,500,null,'Taxas administrativas de até R$ 500 podem ser regulamentadas por decreto.'),
 ('penalty',true,false,null,null,'Matéria penal exige aprovação legislativa.'),
 ('restriction',true,true,null,7,'Decreto pode restringir atividade integrada por no máximo sete dias RP.'),
 ('benefit',true,true,1000,30,'Benefícios por decreto limitados a R$ 1.000 por cidadão e trinta dias RP.'),
 ('policy',true,false,null,null,'Demais regras estruturais exigem aprovação legislativa.')
ON CONFLICT(capability) DO NOTHING;

UPDATE public.government_rules SET rule_kind='tax',definition=jsonb_build_object('basis','purchase','payer',case when rule_key='corporate_tax_rate' then 'seller' else 'buyer' end,'nature','percentage','audience',case when rule_key='corporate_tax_rate' then 'business' else 'all' end)
WHERE rule_key IN('consumption_tax_rate','corporate_tax_rate');
UPDATE public.government_rules SET rule_kind='fee',definition='{"basis":"license","payer":"buyer","nature":"fixed","audience":"all"}' WHERE rule_key='business_license_fee';
-- Migrate the rate actually used by transfers, retaining an explicitly known baseline.
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
SELECT 'transaction_tax',coalesce((value->>'value')::numeric,0),case when value->>'type'='fixed' then 'BRL' else 'ratio' end,
 'Imposto sobre transferências','system','tax',jsonb_build_object('basis','transfer','payer','buyer','audience','all','nature',case when value->>'type'='fixed' then 'fixed' else 'percentage' end)
FROM public.system_settings WHERE key='transaction_tax'
ON CONFLICT(rule_key) DO NOTHING;
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,source_kind,rule_kind,definition)
VALUES('transaction_tax',0,'ratio','Imposto sobre transferências','system','tax','{"basis":"transfer","payer":"buyer","nature":"percentage","audience":"all"}') ON CONFLICT DO NOTHING;
UPDATE public.penal_code SET legal_history=jsonb_build_array(jsonb_build_object('valid_from','-infinity','minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine,'active',is_active,'source','baseline')) WHERE legal_history='[]';

CREATE OR REPLACE FUNCTION private.validate_legal_measure(p_kind text,p_data jsonb,p_source_kind text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE authority public.legal_authority_rules%rowtype; n numeric; d jsonb:=coalesce(p_data->'definition','{}'); start_at timestamptz; until_at timestamptz;
BEGIN
 SELECT * INTO authority FROM public.legal_authority_rules WHERE capability=p_kind;
 IF NOT FOUND OR p_source_kind NOT IN('bill','decree') THEN RAISE EXCEPTION 'INVALID_LEGAL_MEASURE'; END IF;
 IF p_data->>'action' IS NULL OR p_data->>'action' NOT IN('create','change','revoke') THEN RAISE EXCEPTION 'INVALID_LEGAL_ACTION'; END IF;
 IF p_source_kind='bill' AND NOT authority.legislative_allowed THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF p_source_kind='decree' AND NOT authority.decree_allowed THEN RAISE EXCEPTION 'LEGISLATIVE_APPROVAL_REQUIRED'; END IF;
 n:=(p_data->>'value')::numeric;
 IF n IS NULL OR n::text IN('NaN','Infinity','-Infinity') OR n<0 THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 start_at:=coalesce(nullif(p_data->>'valid_from','')::timestamptz,clock_timestamp());
 until_at:=nullif(p_data->>'valid_until','')::timestamptz;
 IF until_at IS NOT NULL AND until_at<=start_at THEN RAISE EXCEPTION 'INVALID_LEGAL_VALIDITY'; END IF;
 IF p_source_kind='decree' AND authority.decree_max_value IS NOT NULL AND n>authority.decree_max_value THEN RAISE EXCEPTION 'DECREE_VALUE_LIMIT'; END IF;
 IF p_source_kind='decree' AND authority.decree_max_days IS NOT NULL AND (until_at IS NULL OR until_at>start_at+make_interval(secs=>public.rp_duration_to_real_seconds(authority.decree_max_days,'day'))) THEN RAISE EXCEPTION 'DECREE_DURATION_LIMIT'; END IF;
 IF p_kind IN('tax','fee') THEN
   IF coalesce(d->>'basis','') NOT IN('purchase','transfer','license','document') OR coalesce(d->>'nature','') NOT IN('percentage','fixed') OR coalesce(d->>'payer','') NOT IN('buyer','seller') THEN RAISE EXCEPTION 'INVALID_TAX_BASIS'; END IF;
   IF d->>'nature'='percentage' AND n>1 THEN RAISE EXCEPTION 'RATE_RULE_OUT_OF_RANGE'; END IF;
   IF p_source_kind='decree' AND (d->>'nature'<>'fixed' OR d->>'basis' NOT IN('license','document')) THEN RAISE EXCEPTION 'LEGISLATIVE_APPROVAL_REQUIRED'; END IF;
   IF d->>'payer'='seller' AND d->>'basis'<>'purchase' THEN RAISE EXCEPTION 'INVALID_TAX_PAYER'; END IF;
 END IF;
 IF coalesce(d->>'audience','all') NOT IN('all','citizen','business') THEN RAISE EXCEPTION 'INVALID_LEGAL_AUDIENCE'; END IF;
 IF d ? 'min_amount' AND ((d->>'min_amount')::numeric<0 OR (d->>'min_amount')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_THRESHOLD'; END IF;
 IF d ? 'exempt_below' AND ((d->>'exempt_below')::numeric<0 OR (d->>'exempt_below')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_THRESHOLD'; END IF;
 IF d ? 'max_amount' AND ((d->>'max_amount')::numeric<coalesce((d->>'min_amount')::numeric,0) OR (d->>'max_amount')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_THRESHOLD'; END IF;
 IF d ? 'sector_id' AND NOT EXISTS(SELECT 1 FROM public.economic_sectors WHERE id=(d->>'sector_id')::uuid) THEN RAISE EXCEPTION 'INVALID_LEGAL_SECTOR'; END IF;
 IF p_kind='penalty' THEN
   IF NOT EXISTS(SELECT 1 FROM public.penal_code WHERE id=(d->>'penal_code_id')::uuid) THEN RAISE EXCEPTION 'INVALID_PENAL_CODE'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_each_text(d) WHERE key IN('minimum','maximum','fine') AND value IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_PENAL_LIMITS'; END IF;
   IF coalesce((d->>'minimum')::numeric,-1)<0 OR coalesce((d->>'maximum')::numeric,-1)<(d->>'minimum')::numeric OR coalesce((d->>'fine')::numeric,-1)<0 THEN RAISE EXCEPTION 'INVALID_PENAL_LIMITS'; END IF;
 END IF;
 IF p_kind='restriction' THEN
   IF coalesce(d->>'basis','') NOT IN('purchase','transfer','license') THEN RAISE EXCEPTION 'UNSUPPORTED_RESTRICTED_ACTIVITY'; END IF;
   IF d ? 'weekdays' AND (jsonb_typeof(d->'weekdays')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'weekdays') day WHERE day::integer NOT BETWEEN 0 AND 6)) THEN RAISE EXCEPTION 'INVALID_RESTRICTION_DAYS'; END IF;
   IF (d ? 'hour_from') IS DISTINCT FROM (d ? 'hour_until') THEN RAISE EXCEPTION 'INVALID_RESTRICTION_HOURS'; END IF;
   IF d ? 'hour_from' THEN PERFORM (d->>'hour_from')::time,(d->>'hour_until')::time; END IF;
 END IF;
 IF p_kind='benefit' AND p_data->>'action'<>'revoke' THEN
   IF coalesce((d->>'budget')::numeric,0)<=0 OR (d->>'budget')::numeric::text IN('NaN','Infinity','-Infinity') OR n<=0 OR until_at IS NULL THEN RAISE EXCEPTION 'BENEFIT_BUDGET_REQUIRED'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_legal_measure(text,jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.configure_structured_law_effect(p_source_kind text,p_source_id uuid,p_data jsonb)
RETURNS public.law_effects LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role_name text; source_author uuid; locked boolean; key text; kind text:=p_data->>'kind'; e public.law_effects%rowtype; old_rule public.government_rules%rowtype;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT role INTO role_name FROM public.profiles WHERE id=actor AND deleted_at IS NULL;
 IF role_name NOT IN('Admin','Presidente','Deputado','Senador') OR role_name IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF p_source_kind='bill' THEN SELECT author_id,lower(status) NOT IN('em tramitação','rascunho','em discussão') INTO source_author,locked FROM public.bills WHERE id=p_source_id FOR UPDATE;
 ELSIF p_source_kind='decree' THEN SELECT author_id,is_published INTO source_author,locked FROM public.decrees WHERE id=p_source_id FOR UPDATE;
 END IF;
 IF source_author IS NULL THEN RAISE EXCEPTION 'LEGAL_SOURCE_NOT_FOUND'; END IF;
 IF locked THEN RAISE EXCEPTION 'LEGAL_SOURCE_ALREADY_IN_FORCE'; END IF;
 IF source_author<>actor AND role_name<>'Admin' THEN RAISE EXCEPTION 'LEGAL_EFFECT_CONFIGURATION_DENIED'; END IF;
 IF p_source_kind='decree' AND role_name NOT IN('Admin','Presidente') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF p_source_kind='bill' AND role_name IN('Deputado','Senador') AND NOT EXISTS(SELECT 1 FROM public.parliament_members m JOIN public.bills b ON b.house_id=m.house_id WHERE b.id=p_source_id AND m.user_id=actor AND current_date BETWEEN m.term_start_date AND m.term_end_date) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM public.parliament_votings WHERE related_id=p_source_id AND type='bill') THEN RAISE EXCEPTION 'LEGAL_EFFECT_VOTING_LOCKED'; END IF;
 PERFORM private.validate_legal_measure(kind,p_data,p_source_kind);
 key:=nullif(btrim(p_data->>'rule_key'),'');
 IF key IS NULL OR key !~ '^[a-z][a-z0-9_]{2,80}$' THEN RAISE EXCEPTION 'INVALID_RULE_KEY'; END IF;
 SELECT * INTO old_rule FROM public.government_rules WHERE rule_key=key FOR UPDATE;
 IF p_data->>'action'<>'create' AND NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_GOVERNMENT_RULE'; END IF;
 IF old_rule.rule_key IS NOT NULL AND old_rule.rule_kind<>kind THEN RAISE EXCEPTION 'RULE_KIND_MISMATCH'; END IF;
 IF kind='penalty' AND (old_rule.rule_key IS NULL OR old_rule.definition->>'penal_code_id' IS DISTINCT FROM p_data->'definition'->>'penal_code_id') THEN RAISE EXCEPTION 'INVALID_PENAL_CODE'; END IF;
 IF p_data->>'action'='create' AND old_rule.rule_key IS NOT NULL AND old_rule.is_active THEN RAISE EXCEPTION 'RULE_ALREADY_ACTIVE'; END IF;
 IF length(btrim(coalesce(p_data->>'name','')))<3 THEN RAISE EXCEPTION 'LEGAL_RULE_NAME_REQUIRED'; END IF;
 INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition)
 VALUES(key,0,case when p_data->'definition'->>'nature'='percentage' then 'ratio' else 'BRL' end,p_data->>'name',kind,false,coalesce(p_data->'definition','{}')) ON CONFLICT DO NOTHING;
 INSERT INTO public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,configured_by,effect_data,valid_from,valid_until)
 VALUES(p_source_kind,p_source_id,key,'set',(p_data->>'value')::numeric,coalesce(p_data->>'explanation',p_data->>'name'),actor,p_data,
   nullif(p_data->>'valid_from','')::timestamptz,nullif(p_data->>'valid_until','')::timestamptz)
 ON CONFLICT(source_kind,source_id,effect_key) DO UPDATE SET effect_value=excluded.effect_value,explanation=excluded.explanation,effect_data=excluded.effect_data,valid_from=excluded.valid_from,valid_until=excluded.valid_until
 WHERE public.law_effects.status='draft' RETURNING * INTO e;
 IF e.id IS NULL THEN RAISE EXCEPTION 'ACTIVE_LEGAL_EFFECT_IS_IMMUTABLE'; END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.configure_structured_law_effect(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.configure_structured_law_effect(text,uuid,jsonb) TO authenticated;
