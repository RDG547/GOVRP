BEGIN;
ALTER TABLE public.government_rules ADD COLUMN IF NOT EXISTS active_effect_id uuid REFERENCES public.law_effects(id);
ALTER TABLE public.dou_entries ADD COLUMN IF NOT EXISTS legal_metadata jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.criminal_cases ADD COLUMN IF NOT EXISTS facts_occurred_at timestamptz;

CREATE OR REPLACE FUNCTION private.validate_legal_definition(p_data jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d jsonb:=coalesce(p_data->'definition','{}'); k text;
BEGIN
 IF jsonb_typeof(d)<>'object' THEN RAISE EXCEPTION 'INVALID_LEGAL_MEASURE'; END IF;
 FOR k IN SELECT jsonb_object_keys(d) LOOP
   IF k NOT IN('basis','payer','nature','audience','min_amount','max_amount','exempt_below','sector_id','category','document_type','penal_code_id','minimum','maximum','fine','weekdays','hour_from','hour_until','budget','eligible_balance_max','discount_rate','discount_sector_id') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 END LOOP;
 IF d ? 'category' AND NOT EXISTS(SELECT 1 FROM public.products WHERE category=d->>'category') THEN RAISE EXCEPTION 'INVALID_LEGAL_CATEGORY'; END IF;
 IF d->>'basis'='document' AND (coalesce(d->>'document_type','') NOT IN('CNH','Passport','RG','CPF','CTD','CNPJ','Título de Eleitor','Certificado de Reservista','Certidão de Casamento','Registro Profissional')) THEN RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE'; END IF;
 IF d ? 'discount_sector_id' AND NOT EXISTS(SELECT 1 FROM public.economic_sectors WHERE id=(d->>'discount_sector_id')::uuid) THEN RAISE EXCEPTION 'INVALID_LEGAL_SECTOR'; END IF;
 IF d ? 'discount_rate' AND ((d->>'discount_rate')::numeric NOT BETWEEN 0 AND 1 OR (d->>'discount_rate')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 IF d ? 'eligible_balance_max' AND ((d->>'eligible_balance_max')::numeric<0 OR (d->>'eligible_balance_max')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 IF p_data->>'kind'='benefit' AND (d ? 'category' OR d ? 'min_amount' OR d ? 'max_amount' OR d ? 'hour_from') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF d->>'basis'='transfer' AND (d ? 'sector_id' OR d->>'audience'='business') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF p_data->>'kind' IN('tax','fee') AND (d ? 'weekdays' OR d ? 'hour_from' OR d ? 'budget') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF p_data->>'kind' IN('tax','fee') AND d->>'basis' IN('license','document') AND d->>'nature'<>'fixed' THEN RAISE EXCEPTION 'INVALID_TAX_BASIS'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_legal_definition(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.check_legal_effect_definition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.effect_data IS NOT NULL THEN
   PERFORM private.validate_legal_definition(NEW.effect_data);
   PERFORM private.validate_legal_measure(NEW.effect_data->>'kind',NEW.effect_data,NEW.source_kind);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER structured_effect_definition BEFORE INSERT OR UPDATE OF effect_data ON public.law_effects FOR EACH ROW EXECUTE FUNCTION private.check_legal_effect_definition();
REVOKE ALL ON FUNCTION private.check_legal_effect_definition() FROM PUBLIC,anon,authenticated;

-- Compatibility entry point uses the same permissions and structured validation.
CREATE OR REPLACE FUNCTION public.configure_law_effect(p_source_kind text,p_source_id uuid,p_effect_key text,p_operation text,p_effect_value numeric,p_explanation text)
RETURNS public.law_effects LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; n numeric;
BEGIN
 SELECT * INTO r FROM public.government_rules WHERE rule_key=p_effect_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_GOVERNMENT_RULE'; END IF;
 IF p_operation NOT IN('set','add','multiply') OR p_operation IS NULL THEN RAISE EXCEPTION 'INVALID_EFFECT_OPERATION'; END IF;
 n:=case p_operation when 'set' then p_effect_value when 'add' then r.numeric_value+p_effect_value else r.numeric_value*p_effect_value end;
 RETURN public.configure_structured_law_effect(p_source_kind,p_source_id,jsonb_build_object('kind',r.rule_kind,'action','change','rule_key',r.rule_key,'value',n,'name',r.description,'explanation',p_explanation,'definition',r.definition));
END $$;

CREATE OR REPLACE FUNCTION public.submit_structured_legal_measure(p_source_kind text,p_title text,p_summary text,p_full_text text,p_house_id uuid,p_effects jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); role_name text; source uuid; data jsonb; b public.bills%rowtype;
BEGIN
 SELECT role INTO role_name FROM public.profiles WHERE id=actor AND deleted_at IS NULL;
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 IF role_name IS NULL OR role_name NOT IN('Admin','Presidente','Deputado','Senador') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_title,'')))<5 OR length(btrim(coalesce(p_summary,'')))<20 OR length(btrim(coalesce(p_full_text,'')))<40 THEN RAISE EXCEPTION 'LEGAL_TEXT_REQUIRED'; END IF;
 IF jsonb_typeof(p_effects) IS DISTINCT FROM 'array' OR jsonb_array_length(p_effects) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'STRUCTURED_EFFECTS_REQUIRED'; END IF;
 IF p_source_kind='bill' THEN
   b:=public.propose_parliament_bill(p_title,p_summary,p_full_text,'PL',p_house_id); source:=b.id;
 ELSIF p_source_kind='decree' THEN
   IF role_name NOT IN('Admin','Presidente') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
   INSERT INTO public.decrees(title,content,author_id,is_published) VALUES(btrim(p_title),p_full_text,actor,false) RETURNING id INTO source;
 ELSE RAISE EXCEPTION 'INVALID_LEGAL_SOURCE'; END IF;
 FOR data IN SELECT * FROM jsonb_array_elements(p_effects) LOOP PERFORM public.configure_structured_law_effect(p_source_kind,source,data); END LOOP;
 RETURN jsonb_build_object('id',source,'source_kind',p_source_kind,'status',case when p_source_kind='bill' then 'Em tramitação' else 'Rascunho' end);
END $$;
REVOKE ALL ON FUNCTION public.submit_structured_legal_measure(text,text,text,text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_structured_legal_measure(text,text,text,text,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.apply_structured_effect(p_effect_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.law_effects%rowtype; r public.government_rules%rowtype; d jsonb; n numeric; start_at timestamptz; penalty public.penal_code%rowtype;
BEGIN
 SELECT * INTO e FROM public.law_effects WHERE id=p_effect_id FOR UPDATE;
 IF e.status NOT IN('draft','scheduled') THEN RETURN; END IF;
 d:=coalesce(e.effect_data,jsonb_build_object('kind','policy','action','change','definition','{}'));
 SELECT * INTO r FROM public.government_rules WHERE rule_key=e.effect_key FOR UPDATE;
 IF e.effect_data IS NOT NULL THEN PERFORM private.validate_legal_measure(d->>'kind',d,e.source_kind); END IF;
 start_at:=coalesce(e.valid_from,clock_timestamp());
 IF start_at>clock_timestamp() THEN UPDATE public.law_effects SET status='scheduled' WHERE id=e.id; RETURN; END IF;
 -- Publication cannot backdate an immediate rule or rewrite the applicable penal history.
 IF e.status='draft' THEN start_at:=greatest(start_at,clock_timestamp()); END IF;
 IF e.valid_until IS NOT NULL AND e.valid_until<=clock_timestamp() THEN UPDATE public.law_effects SET status='revoked' WHERE id=e.id; RETURN; END IF;
 n:=case e.operation when 'add' then r.numeric_value+e.effect_value when 'multiply' then r.numeric_value*e.effect_value else e.effect_value end;
 IF d->>'action'='revoke' THEN n:=0; END IF;
 UPDATE public.law_effects SET previous_snapshot=to_jsonb(r),status='active',activated_at=clock_timestamp(),valid_from=start_at,updated_at=clock_timestamp() WHERE id=e.id;
 UPDATE public.government_rules SET numeric_value=n,definition=coalesce(d->'definition',r.definition),description=coalesce(d->>'name',r.description),
   is_active=d->>'action'<>'revoke',valid_from=start_at,valid_until=e.valid_until,source_kind=e.source_kind,source_id=e.source_id,
   active_effect_id=e.id,version=version+1,updated_at=clock_timestamp() WHERE rule_key=r.rule_key;
 IF r.rule_kind='penalty' THEN
   SELECT * INTO penalty FROM public.penal_code WHERE id=(d->'definition'->>'penal_code_id')::uuid FOR UPDATE;
   UPDATE public.penal_code SET minimum_sentence_units=(d->'definition'->>'minimum')::numeric,maximum_sentence_units=(d->'definition'->>'maximum')::numeric,
     base_fine=(d->'definition'->>'fine')::numeric,is_active=d->>'action'<>'revoke',
     legal_history=case when legal_history='[]' THEN jsonb_build_array(jsonb_build_object('valid_from','-infinity','minimum',penalty.minimum_sentence_units,'maximum',penalty.maximum_sentence_units,'fine',penalty.base_fine,'active',penalty.is_active)) else legal_history end
       ||jsonb_build_array(jsonb_build_object('valid_from',start_at,'minimum',d->'definition'->'minimum','maximum',d->'definition'->'maximum','fine',d->'definition'->'fine','active',d->>'action'<>'revoke','effect_id',e.id,'source_id',e.source_id))
   WHERE id=penalty.id;
 END IF;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('legal_effect_activated','government','law_effects',e.id,e.configured_by,jsonb_build_object('sourceId',e.source_id,'ruleKey',r.rule_key,'kind',r.rule_kind,'action',d->>'action','previousValue',r.numeric_value,'newValue',n,'validFrom',start_at,'validUntil',e.valid_until),'legal-effect:'||e.id);
END $$;
REVOKE ALL ON FUNCTION private.apply_structured_effect(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.expire_structured_effect(p_effect_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.law_effects%rowtype; r public.government_rules%rowtype; prev jsonb; parent public.law_effects%rowtype; d jsonb;
BEGIN
 SELECT * INTO e FROM public.law_effects WHERE id=p_effect_id FOR UPDATE;
 IF e.status='revoked' THEN RETURN; END IF;
 SELECT * INTO r FROM public.government_rules WHERE rule_key=e.effect_key FOR UPDATE;
 UPDATE public.law_effects SET status='revoked',updated_at=clock_timestamp() WHERE id=e.id;
 IF r.active_effect_id=e.id THEN
   prev:=e.previous_snapshot;
   WHILE nullif(prev->>'active_effect_id','') IS NOT NULL LOOP
     SELECT * INTO parent FROM public.law_effects WHERE id=(prev->>'active_effect_id')::uuid;
     EXIT WHEN parent.status='active' AND (parent.valid_until IS NULL OR parent.valid_until>clock_timestamp());
     prev:=parent.previous_snapshot;
   END LOOP;
   UPDATE public.government_rules SET numeric_value=coalesce((prev->>'numeric_value')::numeric,0),is_active=coalesce((prev->>'is_active')::boolean,false),
     definition=coalesce(prev->'definition',definition),source_kind=prev->>'source_kind',source_id=(prev->>'source_id')::uuid,active_effect_id=(prev->>'active_effect_id')::uuid,
     valid_from=coalesce((prev->>'valid_from')::timestamptz,'-infinity'),valid_until=(prev->>'valid_until')::timestamptz,version=version+1,updated_at=clock_timestamp() WHERE rule_key=r.rule_key;
   IF r.rule_kind='penalty' THEN
     d:=prev->'definition';
     UPDATE public.penal_code SET minimum_sentence_units=coalesce((d->>'minimum')::numeric,minimum_sentence_units),maximum_sentence_units=coalesce((d->>'maximum')::numeric,maximum_sentence_units),base_fine=coalesce((d->>'fine')::numeric,base_fine),
       is_active=coalesce((prev->>'is_active')::boolean,false),legal_history=legal_history||jsonb_build_array(jsonb_build_object('valid_from',clock_timestamp(),'minimum',d->'minimum','maximum',d->'maximum','fine',d->'fine','active',coalesce((prev->>'is_active')::boolean,false),'source','expiry'))
     WHERE id=(r.definition->>'penal_code_id')::uuid;
   END IF;
 END IF;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,payload,idempotency_key)
 VALUES('legal_effect_expired','government','law_effects',e.id,jsonb_build_object('ruleKey',r.rule_key),'legal-effect-expired:'||e.id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION private.expire_structured_effect(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.activate_legal_effects(p_source_kind text,p_source_id uuid,p_actor_id uuid,p_title text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record; total integer:=0; summary_data jsonb; legal_text text; gazette_type text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp-legal-world',0));
 FOR e IN SELECT id FROM public.law_effects WHERE source_kind=p_source_kind AND source_id=p_source_id AND status='draft' ORDER BY created_at,id FOR UPDATE LOOP
   PERFORM private.apply_structured_effect(e.id); total:=total+1;
 END LOOP;
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',coalesce(effect_data->>'name',effect_key),'previous',previous_snapshot->'numeric_value','value',effect_value,'action',effect_data->>'action','definition',effect_data->'definition','valid_from',valid_from,'valid_until',valid_until,'status',status)),'[]') INTO summary_data FROM public.law_effects WHERE source_kind=p_source_kind AND source_id=p_source_id;
 IF p_source_kind='bill' THEN SELECT coalesce(full_text,summary),case when upper(type) LIKE '%PEC%' then 'Emenda Constitucional' when upper(type) IN('PLC','LC') then 'Lei Complementar' else 'Lei' end INTO legal_text,gazette_type FROM public.bills WHERE id=p_source_id;
 ELSE SELECT content,'Decreto' INTO legal_text,gazette_type FROM public.decrees WHERE id=p_source_id; END IF;
 INSERT INTO public.dou_entries(title,summary,content,published_at,type,source_id,legal_metadata)
 SELECT p_title,'Norma publicada com efeitos estruturados e vigência registrada.',legal_text,clock_timestamp(),gazette_type,p_source_id,
   jsonb_build_object('authority_id',coalesce(auth.uid(),p_actor_id),'authority_name',(SELECT full_name FROM public.profiles WHERE id=coalesce(auth.uid(),p_actor_id)),'origin',p_source_kind,'effects',summary_data)
 WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=p_source_id);
 UPDATE public.dou_entries SET legal_metadata=jsonb_build_object('authority_id',coalesce(auth.uid(),p_actor_id),'authority_name',(SELECT full_name FROM public.profiles WHERE id=coalesce(auth.uid(),p_actor_id)),'origin',p_source_kind,'effects',summary_data) WHERE source_id=p_source_id;
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES(case when p_source_kind='bill' then 'law_enacted' else 'decree_enacted' end,'government',case when p_source_kind='bill' then 'bills' else 'decrees' end,p_source_id,coalesce(auth.uid(),p_actor_id),jsonb_build_object('title',p_title,'effects',summary_data),'legal-source:'||p_source_kind||':'||p_source_id) ON CONFLICT DO NOTHING;
 RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.process_due_legal_effects()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp-legal-world',0));
 FOR e IN SELECT id FROM public.law_effects WHERE status='active' AND valid_until<=clock_timestamp() ORDER BY valid_until,id FOR UPDATE LOOP PERFORM private.expire_structured_effect(e.id); END LOOP;
 FOR e IN SELECT id FROM public.law_effects WHERE status='scheduled' AND valid_from<=clock_timestamp() ORDER BY valid_from,id FOR UPDATE LOOP PERFORM private.apply_structured_effect(e.id); END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.process_due_legal_effects() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_legal_effects() TO service_role;

CREATE OR REPLACE FUNCTION public.get_government_rule(p_rule_key text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT case when is_active AND valid_from<=statement_timestamp() AND (valid_until IS NULL OR valid_until>statement_timestamp()) then numeric_value else 0 end FROM public.government_rules WHERE rule_key=p_rule_key
$$;

CREATE OR REPLACE FUNCTION private.legal_scope_matches(d jsonb,p_basis text,p_amount numeric,p_business boolean,p_sector uuid,p_category text,p_document text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(d->>'basis',p_basis)=p_basis
   AND (coalesce(d->>'audience','all')='all' OR d->>'audience'=case when p_business then 'business' else 'citizen' end)
   AND (NOT d ? 'sector_id' OR d->>'sector_id'=p_sector::text)
   AND (NOT d ? 'category' OR d->>'category'=p_category)
   AND (NOT d ? 'document_type' OR d->>'document_type'=p_document)
   AND p_amount>=coalesce((d->>'min_amount')::numeric,0)
   AND (NOT d ? 'max_amount' OR p_amount<=(d->>'max_amount')::numeric)
   AND (NOT d ? 'exempt_below' OR p_amount>(d->>'exempt_below')::numeric)
$$;
REVOKE ALL ON FUNCTION private.legal_scope_matches(jsonb,text,numeric,boolean,uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.quote_legal_levies(p_basis text,p_amount numeric,p_business boolean DEFAULT false,p_sector uuid DEFAULT NULL,p_category text DEFAULT NULL,p_document text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; items jsonb:='[]'; buyer numeric:=0; seller numeric:=0; amount numeric; rp timestamp:=public.rp_now() AT TIME ZONE 'America/Sao_Paulo'; h time; from_h time; to_h time; restricted boolean:=false;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND valid_from<=statement_timestamp() AND (valid_until IS NULL OR valid_until>statement_timestamp()) AND rule_kind IN('tax','fee','restriction') ORDER BY rule_key LOOP
   IF NOT coalesce(private.legal_scope_matches(r.definition,p_basis,p_amount,p_business,p_sector,p_category,p_document),false) THEN CONTINUE; END IF;
   IF r.rule_kind='restriction' THEN
     IF r.definition ? 'weekdays' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(r.definition->'weekdays') day WHERE day::integer=extract(dow from rp)::integer) THEN CONTINUE; END IF;
     IF r.definition ? 'hour_from' THEN
       h:=rp::time; from_h:=(r.definition->>'hour_from')::time; to_h:=(r.definition->>'hour_until')::time;
       IF NOT (case when from_h<to_h then h>=from_h AND h<to_h else h>=from_h OR h<to_h end) THEN CONTINUE; END IF;
     END IF;
     restricted:=true; CONTINUE;
   END IF;
   amount:=round(case when r.definition->>'nature'='percentage' then p_amount*r.numeric_value else r.numeric_value end*(1-case when NOT r.definition ? 'discount_sector_id' OR r.definition->>'discount_sector_id'=p_sector::text then coalesce((r.definition->>'discount_rate')::numeric,0) else 0 end),2);
   IF r.definition->>'payer'='seller' THEN seller:=seller+amount; ELSE buyer:=buyer+amount; END IF;
   items:=items||jsonb_build_array(jsonb_build_object('rule_key',r.rule_key,'name',r.description,'kind',r.rule_kind,'payer',r.definition->>'payer','nature',r.definition->>'nature','rate_snapshot',r.numeric_value,'tax_amount',amount,'version',r.version,'source_kind',r.source_kind,'source_id',r.source_id,'definition_snapshot',r.definition));
 END LOOP;
 IF seller>p_amount THEN RAISE EXCEPTION 'TAX_EXCEEDS_OPERATION'; END IF;
 RETURN jsonb_build_object('restricted',restricted,'gross_amount',p_amount,'buyer_tax',buyer,'seller_tax',seller,'tax_amount',buyer+seller,'total_debited',p_amount+buyer,'net_amount',p_amount-seller,'levies',items);
END $$;
REVOKE ALL ON FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text) TO authenticated,anon,service_role;

-- Critical legacy settings cannot silently bypass the legislature.
CREATE OR REPLACE FUNCTION private.guard_tax_settings()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF coalesce(NEW.key,OLD.key) IN('tax_rates','transaction_tax','base_tariffs') AND current_user IN('authenticated','anon') THEN RAISE EXCEPTION 'LEGISLATIVE_APPROVAL_REQUIRED'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_tax_settings BEFORE INSERT OR UPDATE OR DELETE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION private.guard_tax_settings();

CREATE OR REPLACE FUNCTION private.guard_published_decree()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.is_published THEN RAISE EXCEPTION 'DECREE_DRAFT_REQUIRED'; END IF;
 IF TG_OP IN('UPDATE','DELETE') AND OLD.is_published THEN RAISE EXCEPTION 'PUBLISHED_NORM_IS_IMMUTABLE'; END IF;
 IF TG_OP='UPDATE' AND NEW.is_published THEN
   IF NOT public.justice_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
   NEW.published_at:=clock_timestamp();
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER guard_published_decree BEFORE INSERT OR UPDATE OR DELETE ON public.decrees FOR EACH ROW EXECUTE FUNCTION private.guard_published_decree();
REVOKE ALL ON FUNCTION private.guard_published_decree() FROM PUBLIC,anon,authenticated;

-- Existing treasury and transaction ledger also execute bounded financial benefits.
CREATE UNIQUE INDEX IF NOT EXISTS legal_benefit_once ON public.transactions((metadata->>'benefit_rule_key'),(metadata->>'beneficiary_id')) WHERE type='government_benefit';
CREATE OR REPLACE FUNCTION public.process_legal_benefits()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; recipient record; spent numeric; balance numeric; tx uuid; total integer:=0;
BEGIN
 PERFORM public.process_due_legal_effects();
 FOR r IN SELECT * FROM public.government_rules WHERE rule_kind='benefit' AND is_active AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp() ORDER BY rule_key FOR UPDATE LOOP
   SELECT coalesce(sum(amount),0) INTO spent FROM public.transactions WHERE type='government_benefit' AND metadata->>'benefit_rule_key'=r.rule_key;
   FOR recipient IN SELECT p.id,a.id AS account_id FROM public.profiles p JOIN public.accounts a ON a.user_id=p.id
     WHERE p.deleted_at IS NULL AND p.onboarding_completed
       AND (NOT r.definition ? 'eligible_balance_max' OR a.balance<=(r.definition->>'eligible_balance_max')::numeric)
       AND (coalesce(r.definition->>'audience','all') IN('all','citizen') OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.owner_id=p.id AND b.status='active'))
       AND (NOT r.definition ? 'sector_id' OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.owner_id=p.id AND b.status='active' AND b.economic_sector_id=(r.definition->>'sector_id')::uuid))
       AND NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.type='government_benefit' AND t.metadata->>'benefit_rule_key'=r.rule_key AND t.metadata->>'beneficiary_id'=p.id::text)
     ORDER BY p.created_at,p.id LIMIT 100
   LOOP
     EXIT WHEN spent+r.numeric_value>(r.definition->>'budget')::numeric;
     SELECT a.balance INTO balance FROM public.accounts a WHERE a.id=recipient.account_id FOR UPDATE;
     IF NOT FOUND OR (r.definition ? 'eligible_balance_max' AND balance>(r.definition->>'eligible_balance_max')::numeric) THEN CONTINUE; END IF;
     SELECT treasury_balance INTO balance FROM public.government_finances WHERE id=1 FOR UPDATE;
     EXIT WHEN balance IS NULL OR balance<r.numeric_value;
     UPDATE public.government_finances SET treasury_balance=treasury_balance-r.numeric_value,updated_at=clock_timestamp() WHERE id=1;
     UPDATE public.accounts SET balance=public.accounts.balance+r.numeric_value,updated_at=clock_timestamp() WHERE id=recipient.account_id;
     INSERT INTO public.transactions(to_account_id,amount,type,description,metadata) VALUES(recipient.account_id,r.numeric_value,'government_benefit',r.description,jsonb_build_object('benefit_rule_key',r.rule_key,'beneficiary_id',recipient.id,'legal_source_id',r.source_id,'rule_version',r.version,'gross_amount',r.numeric_value,'net_amount',r.numeric_value,'tax_amount',0)) RETURNING id INTO tx;
     INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(recipient.id,'government_benefit','Você recebeu o benefício: '||r.description,'/services/bank',jsonb_build_object('transaction_id',tx));
     INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,payload,idempotency_key) VALUES('legal_benefit_paid','economy','transactions',tx,jsonb_build_object('ruleKey',r.rule_key,'amount',r.numeric_value),'legal-benefit:'||tx);
     spent:=spent+r.numeric_value; total:=total+1;
   END LOOP;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.process_legal_benefits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_legal_benefits() TO service_role;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
   PERFORM cron.schedule('govrp-legal-validity','1 second','select public.process_due_legal_effects()');
   PERFORM cron.schedule('govrp-legal-benefits','10 seconds','select public.process_legal_benefits()');
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
