BEGIN;
-- Extend the single normative engine; effects still require publication and valid authority.
INSERT INTO public.legal_authority_rules(capability,legislative_allowed,decree_allowed,description)
VALUES('sanction',true,false,'Sanções e suas bases de cálculo exigem aprovação legislativa.'),
 ('regulation',true,false,'Regras partidárias, eleitorais e de publicidade exigem aprovação legislativa.'),
 ('project',true,false,'Autorização legislativa de obra com reserva orçamentária e execução no sistema existente.') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION private.validate_legal_measure_base(p_kind text, p_data jsonb, p_source_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END $function$
;
CREATE OR REPLACE FUNCTION private.validate_legal_definition_base(p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE d jsonb:=coalesce(p_data->'definition','{}'); k text;
BEGIN
 IF jsonb_typeof(d)<>'object' THEN RAISE EXCEPTION 'INVALID_LEGAL_MEASURE'; END IF;
 FOR k IN SELECT jsonb_object_keys(d) LOOP
   IF k NOT IN('basis','payer','nature','audience','min_amount','max_amount','exempt_below','sector_id','category','document_type','penal_code_id','minimum','maximum','fine','weekdays','hour_from','hour_until','budget','eligible_balance_max','discount_rate','discount_sector_id') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 END LOOP;
 IF d ? 'category' AND NOT EXISTS(SELECT 1 FROM public.products WHERE category=d->>'category') AND NOT (d->>'basis'='purchase' AND (d->>'category' IN('Insumos','Moradia') OR EXISTS(SELECT 1 FROM public.economic_resources WHERE name=d->>'category'))) AND NOT (d->>'basis'='license' AND EXISTS(SELECT 1 FROM public.business_types WHERE id=d->>'category')) THEN RAISE EXCEPTION 'INVALID_LEGAL_CATEGORY'; END IF;
 IF d->>'basis'='document' AND (coalesce(d->>'document_type','') NOT IN('CNH','Passport','RG','CPF','CTD','CNPJ','Título de Eleitor','Certificado de Reservista','Certidão de Casamento','Registro Profissional')) THEN RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE'; END IF;
 IF d ? 'discount_sector_id' AND NOT EXISTS(SELECT 1 FROM public.economic_sectors WHERE id=(d->>'discount_sector_id')::uuid) THEN RAISE EXCEPTION 'INVALID_LEGAL_SECTOR'; END IF;
 IF d ? 'discount_rate' AND ((d->>'discount_rate')::numeric NOT BETWEEN 0 AND 1 OR (d->>'discount_rate')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 IF d ? 'eligible_balance_max' AND ((d->>'eligible_balance_max')::numeric<0 OR (d->>'eligible_balance_max')::numeric::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 IF p_data->>'kind'='benefit' AND (d ? 'category' OR d ? 'min_amount' OR d ? 'max_amount' OR d ? 'hour_from') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF d->>'basis'='transfer' AND (d ? 'sector_id' OR d->>'audience'='business') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF p_data->>'kind' IN('tax','fee') AND (d ? 'weekdays' OR d ? 'hour_from' OR d ? 'budget') THEN RAISE EXCEPTION 'UNSUPPORTED_LEGAL_PARAMETER'; END IF;
 IF p_data->>'kind' IN('tax','fee') AND d->>'basis' IN('license','document') AND d->>'nature'<>'fixed' THEN RAISE EXCEPTION 'INVALID_TAX_BASIS'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION private.validate_legal_measure(p_kind text,p_data jsonb,p_source_kind text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d jsonb:=p_data->'definition'; n numeric; starts timestamptz; ends timestamptz; item text;
BEGIN
 IF p_kind NOT IN('sanction','regulation','project') THEN
  PERFORM private.validate_legal_measure_base(p_kind,p_data,p_source_kind);
 ELSE
  IF p_source_kind<>'bill' THEN RAISE EXCEPTION 'Esta matéria exige aprovação legislativa.'; END IF;
  IF p_data->>'action' IS NULL OR p_data->>'action' NOT IN('create','change','revoke') THEN RAISE EXCEPTION 'Selecione criar, alterar ou revogar.'; END IF;
  n:=(p_data->>'value')::numeric;
  IF n IS NULL OR n<0 OR n::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Informe um valor válido para a medida.'; END IF;
  starts:=coalesce(nullif(p_data->>'valid_from','')::timestamptz,clock_timestamp()); ends:=nullif(p_data->>'valid_until','')::timestamptz;
  IF ends IS NOT NULL AND ends<=starts THEN RAISE EXCEPTION 'O término deve ser posterior ao início da vigência.'; END IF;
  IF p_kind='sanction' THEN
   IF coalesce(d->>'sanction_kind','') NOT IN('fine_fixed','fine_percentage','warning','regularization','business_suspension') OR coalesce(d->>'audience','') NOT IN('all','citizen','business','party') THEN RAISE EXCEPTION 'Selecione sanção e público suportados.'; END IF;
   IF length(trim(coalesce(d->>'infraction','')))<10 OR length(trim(coalesce(d->>'conditions','')))<10 THEN RAISE EXCEPTION 'Descreva a infração e as condições que o juiz deverá verificar.'; END IF;
   IF d->>'sanction_kind' IN('fine_fixed','fine_percentage') AND p_data->>'action'<>'revoke' AND n<=0 THEN RAISE EXCEPTION 'Informe valor positivo para a multa.'; END IF;
   IF d->>'sanction_kind' NOT IN('fine_fixed','fine_percentage') AND n<>0 THEN RAISE EXCEPTION 'Advertências, regularização e suspensão não têm cobrança. Informe zero no valor de referência.'; END IF;
   IF d->>'sanction_kind'='fine_fixed' AND (n<coalesce((d->>'minimum')::numeric,n) OR n>coalesce((d->>'maximum')::numeric,n)) THEN RAISE EXCEPTION 'O valor fixo precisa respeitar os limites da própria norma.'; END IF;
   IF d->>'sanction_kind'='fine_percentage' AND (n>1 OR coalesce(d->>'calculation_basis','') NOT IN('personal_balance','business_cash','business_revenue','party_treasury')) THEN RAISE EXCEPTION 'Informe percentual até 100%% e uma base financeira executável.'; END IF;
   IF d->>'sanction_kind'='fine_percentage' AND NOT ((d->>'audience'='citizen' AND d->>'calculation_basis'='personal_balance') OR (d->>'audience'='business' AND d->>'calculation_basis' IN('business_cash','business_revenue')) OR (d->>'audience'='party' AND d->>'calculation_basis'='party_treasury')) THEN RAISE EXCEPTION 'Selecione o público correspondente à base da multa percentual.'; END IF;
   IF d->>'sanction_kind'='business_suspension' AND (d->>'audience'<>'business' OR coalesce((d->>'duration_days')::int,0) NOT BETWEEN 1 AND 90) THEN RAISE EXCEPTION 'Suspensão empresarial exige público Empresas e duração de 1 a 90 dias.'; END IF;
   IF d ? 'minimum' AND (d->>'minimum')::numeric<0 OR d ? 'maximum' AND (d->>'maximum')::numeric<coalesce((d->>'minimum')::numeric,0) THEN RAISE EXCEPTION 'Confira os limites mínimo e máximo da multa.'; END IF;
   IF d ? 'recurrence_multiplier' AND (d->>'recurrence_multiplier')::numeric NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'A reincidência deve usar multiplicador entre 1 e 5, baseado em decisão definitiva.'; END IF;
   IF d ? 'late_interest_rate' AND (d->>'late_interest_rate')::numeric NOT BETWEEN 0 AND .01 THEN RAISE EXCEPTION 'Juros diários devem ficar entre 0 e 1%%.'; END IF;
  ELSIF p_kind='regulation' THEN
   IF coalesce(d->>'operation','') NOT IN('party_registration_fee','party_registration_restriction','party_donation_limit','party_donation_period','electoral_minimum_age','electoral_minimum_experience','electoral_party_requirement','media_ad_disclosure','media_political_ad_party','media_ad_restriction') THEN RAISE EXCEPTION 'Escolha uma operação integrada à plataforma.'; END IF;
   IF coalesce(d->>'audience','') NOT IN('all','citizen','business','party') THEN RAISE EXCEPTION 'Selecione o público da medida.'; END IF;
   IF d->>'operation'='party_donation_limit' AND n<=0 AND p_data->>'action'<>'revoke' THEN RAISE EXCEPTION 'Informe o limite positivo de doações.'; END IF;
   IF d->>'operation' IN('party_donation_period','media_ad_restriction') AND (ends IS NULL OR coalesce(d->>'scope_mode','') NOT IN('total','hours','weekdays','period')) THEN RAISE EXCEPTION 'Defina a vigência e o escopo da restrição temporária.'; END IF;
   IF d->>'operation' IN('electoral_minimum_age','electoral_minimum_experience') AND n<>trunc(n) THEN RAISE EXCEPTION 'Informe um número inteiro para tempo ou experiência mínima.'; END IF;
   IF d->>'operation'='electoral_minimum_age' AND n NOT BETWEEN 0 AND 3650 THEN RAISE EXCEPTION 'Idade de conta fora do limite de 0 a 3650 dias.'; END IF;
   IF d->>'operation'='electoral_minimum_experience' AND n>10000000 THEN RAISE EXCEPTION 'Experiência mínima fora do limite.'; END IF;
   IF d ? 'period_days' AND (d->>'period_days')::int NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'O período deve ter de 1 a 365 dias.'; END IF;
  ELSE
   IF coalesce(d->>'infrastructure_kind','') NOT IN('roads','energy','ports','airports','telecom','industry','health') OR NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=d->>'region_code') THEN RAISE EXCEPTION 'Selecione infraestrutura e estado cadastrados.'; END IF;
   IF p_data->>'action'<>'create' THEN RAISE EXCEPTION 'A obra autorizada preserva seu orçamento e histórico. Revise ou cancele a execução pelo painel governamental.'; END IF;
   IF n NOT BETWEEN 10000 AND 50000000 OR coalesce((d->>'construction_days')::int,0) NOT BETWEEN 1 AND 90 THEN RAISE EXCEPTION 'Obras exigem orçamento entre R$ 10 mil e R$ 50 milhões e prazo de 1 a 90 dias.'; END IF;
   IF d->>'infrastructure_kind'='ports' AND NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=d->>'region_code' AND coastal) AND NOT EXISTS(SELECT 1 FROM public.world_map_places WHERE region_code=d->>'region_code' AND is_port) THEN RAISE EXCEPTION 'Selecione uma região com referência portuária cadastrada.'; END IF;
  END IF;
 END IF;
 IF p_kind IN('tax','fee','restriction') AND ((d->>'basis'='license' AND d->>'audience'='citizen') OR (d->>'basis' IN('document','transfer') AND d->>'audience'='business')) THEN RAISE EXCEPTION 'O público selecionado não participa desta atividade. Confira a base de cálculo.'; END IF;
 IF p_kind='regulation' AND ((d->>'operation' LIKE 'party_%' AND d->>'audience' NOT IN('all','party')) OR (d->>'operation' NOT LIKE 'party_%' AND d->>'audience' NOT IN('all','citizen'))) THEN RAISE EXCEPTION 'Escolha o público correspondente à atividade regulamentada.'; END IF;
 IF p_kind='penalty' AND d->>'audience' NOT IN('all','citizen') THEN RAISE EXCEPTION 'Penas criminais pessoais exigem público Cidadãos. Use sanções estruturadas para empresas ou partidos.'; END IF;
 IF d ? 'reference_id' AND NOT((d->>'reference_kind'='bill' AND EXISTS(SELECT 1 FROM public.bills WHERE id=(d->>'reference_id')::uuid AND status IN('Sancionado','Promulgado'))) OR (d->>'reference_kind'='decree' AND EXISTS(SELECT 1 FROM public.decrees WHERE id=(d->>'reference_id')::uuid AND is_published AND revoked_at IS NULL))) THEN RAISE EXCEPTION 'Selecione uma norma publicada para referência. A alteração exige nova aprovação legislativa.'; END IF;
 IF d ? 'region_codes' AND (jsonb_typeof(d->'region_codes')<>'array' OR jsonb_array_length(d->'region_codes')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'region_codes') r WHERE NOT EXISTS(SELECT 1 FROM public.economic_regions WHERE code=r))) THEN RAISE EXCEPTION 'Selecione estados do catálogo territorial.'; END IF;
 IF d ? 'ideologies' AND (jsonb_typeof(d->'ideologies')<>'array' OR jsonb_array_length(d->'ideologies')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'ideologies') v WHERE NOT EXISTS(SELECT 1 FROM public.political_parties WHERE ideology=v) AND NOT v=ANY(enum_range(NULL::public.political_orientation)::text[]))) THEN RAISE EXCEPTION 'Selecione ideologias ou orientações cadastradas.'; END IF;
 IF d ? 'exempt_ideologies' AND (jsonb_typeof(d->'exempt_ideologies')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'exempt_ideologies') v WHERE NOT EXISTS(SELECT 1 FROM public.political_parties WHERE ideology=v) AND NOT v=ANY(enum_range(NULL::public.political_orientation)::text[]))) THEN RAISE EXCEPTION 'Selecione exceções de ideologia cadastradas.'; END IF;
 IF d ? 'scope_mode' AND d->>'scope_mode' NOT IN('total','hours','weekdays','period') THEN RAISE EXCEPTION 'Selecione a abrangência da medida.'; END IF;
 IF d->>'scope_mode'='hours' AND (NOT d ? 'hour_from' OR NOT d ? 'hour_until') THEN RAISE EXCEPTION 'Defina o horário inicial e final.'; END IF;
 IF d ? 'hour_from' THEN PERFORM (d->>'hour_from')::time,(d->>'hour_until')::time; END IF;
 IF d ? 'weekdays' AND (jsonb_typeof(d->'weekdays')<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'weekdays') x WHERE x::int NOT BETWEEN 0 AND 6)) THEN RAISE EXCEPTION 'Selecione dias da semana válidos.'; END IF;
 IF d->>'scope_mode'='weekdays' AND (NOT d ? 'weekdays' OR jsonb_array_length(d->'weekdays')=0) THEN RAISE EXCEPTION 'Selecione pelo menos um dia da semana.'; END IF;
 FOR item IN SELECT value FROM jsonb_each_text(d) WHERE key IN('minimum','maximum','recurrence_multiplier','late_interest_rate','period_days','duration_days','construction_days') LOOP
  IF item IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Parâmetro numérico inválido.'; END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.validate_legal_definition(p_data jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE d jsonb:=coalesce(p_data->'definition','{}'); k text; extras text[]:=ARRAY['region_codes','scope_mode'];
BEGIN
 IF jsonb_typeof(d)<>'object' THEN RAISE EXCEPTION 'Informe parâmetros estruturados válidos.'; END IF;
 IF p_data->>'kind' IN('sanction','regulation','project') THEN
  FOR k IN SELECT jsonb_object_keys(d) LOOP
   IF k NOT IN('audience','sanction_kind','infraction','conditions','reference_kind','reference_id','calculation_basis','minimum','maximum','recurrence_multiplier','late_interest_rate','duration_days','operation','ideologies','exempt_ideologies','period_days','scope_mode','weekdays','hour_from','hour_until','region_codes','region_code','infrastructure_kind','construction_days','subject') THEN RAISE EXCEPTION 'Este parâmetro ainda não possui efeito implementado: %',k; END IF;
  END LOOP;
 ELSE PERFORM private.validate_legal_definition_base(jsonb_set(p_data,'{definition}',d-extras)); END IF;
END $$;
REVOKE ALL ON FUNCTION private.validate_legal_measure_base(text,jsonb,text),private.validate_legal_definition_base(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.normative_scope_applies(d jsonb,p_ideology text DEFAULT NULL,p_orientation text DEFAULT NULL,p_region text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE rp timestamp:=public.rp_now() AT TIME ZONE 'America/Sao_Paulo'; h time:=rp::time; a time; b time;
BEGIN
 IF d ? 'ideologies' AND NOT(coalesce(d->'ideologies' ? p_ideology,false) OR coalesce(d->'ideologies' ? p_orientation,false)) THEN RETURN false; END IF;
 IF d ? 'exempt_ideologies' AND (coalesce(d->'exempt_ideologies' ? p_ideology,false) OR coalesce(d->'exempt_ideologies' ? p_orientation,false)) THEN RETURN false; END IF;
 IF d ? 'region_codes' AND NOT coalesce(d->'region_codes' ? p_region,false) THEN RETURN false; END IF;
 IF d ? 'weekdays' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d->'weekdays') day WHERE day::int=extract(dow FROM rp)::int) THEN RETURN false; END IF;
 IF d ? 'hour_from' THEN a:=(d->>'hour_from')::time; b:=(d->>'hour_until')::time; IF NOT(CASE WHEN a<b THEN h>=a AND h<b ELSE h>=a OR h<b END) THEN RETURN false; END IF; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.normative_scope_applies(jsonb,text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_party_legal_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; fee numeric:=0; snapshots jsonb:='[]'; a public.accounts%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND rule_kind='regulation' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND definition->>'operation' IN('party_registration_fee','party_registration_restriction') ORDER BY rule_key LOOP
  IF NOT private.normative_scope_applies(r.definition,NEW.ideology,NEW.orientation::text) THEN CONTINUE; END IF;
  IF r.definition->>'operation'='party_registration_restriction' THEN RAISE EXCEPTION 'A fundação deste partido está restrita pela norma vigente: %.',r.description; END IF;
  fee:=fee+r.numeric_value; snapshots:=snapshots||jsonb_build_array(to_jsonb(r));
 END LOOP;
 IF fee>0 THEN
  SELECT * INTO a FROM public.accounts WHERE user_id=NEW.founder_id AND account_kind='personal' FOR UPDATE;
  IF NOT FOUND OR a.balance<fee THEN RAISE EXCEPTION 'Saldo pessoal insuficiente para a taxa de fundação de %.',public.format_currency_brl(fee); END IF;
  UPDATE public.accounts SET balance=balance-fee,updated_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.government_finances SET treasury_balance=treasury_balance+fee,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.transactions(from_account_id,amount,type,description,metadata) VALUES(a.id,fee,'party_registration_fee','Taxa de fundação: '||NEW.name,jsonb_build_object('party_id',NEW.id,'party_snapshot',jsonb_build_object('name',NEW.name,'acronym',NEW.acronym,'ideology',NEW.ideology,'orientation',NEW.orientation::text),'legal_snapshot',snapshots,'gross_amount',0,'tax_amount',fee,'total_debited',fee,'net_amount',0));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_legal_registration BEFORE INSERT ON public.political_parties FOR EACH ROW EXECUTE FUNCTION private.guard_party_legal_registration();

CREATE OR REPLACE FUNCTION private.check_party_donation_rules(p_party_id uuid,p_actor uuid,p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE party public.political_parties%rowtype; r public.government_rules%rowtype; donated numeric; snapshot jsonb:='[]';
BEGIN
 SELECT * INTO party FROM public.political_parties WHERE id=p_party_id;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND rule_kind='regulation' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND definition->>'operation' IN('party_donation_limit','party_donation_period') ORDER BY rule_key LOOP
  IF NOT private.normative_scope_applies(r.definition,party.ideology,party.orientation::text) THEN CONTINUE; END IF;
  IF r.definition->>'operation'='party_donation_period' THEN RAISE EXCEPTION 'Doações suspensas no período definido pela norma: %.',r.description; END IF;
  SELECT coalesce(sum(amount),0) INTO donated FROM public.party_treasury_entries WHERE party_id=p_party_id AND actor_id=p_actor AND kind='donation' AND created_at>=clock_timestamp()-make_interval(days=>coalesce((r.definition->>'period_days')::int,30));
  IF donated+p_amount>r.numeric_value THEN RAISE EXCEPTION 'O limite de doações desta norma é % no período configurado: %.',public.format_currency_brl(r.numeric_value),r.description; END IF;
  snapshot:=snapshot||jsonb_build_array(to_jsonb(r));
 END LOOP;
 RETURN snapshot;
END $$;
REVOKE ALL ON FUNCTION private.guard_party_legal_registration(),private.check_party_donation_rules(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.donate_to_party(p_party_id uuid, p_amount numeric, p_idempotency_key uuid)
 RETURNS party_treasury_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); donor public.profiles%rowtype; party public.political_parties%rowtype;
 account public.accounts%rowtype; ledger public.party_treasury_entries%rowtype; tx uuid; balance_after numeric; legal_snapshot jsonb;
begin
 if actor is null then raise exception 'Entre na sua conta para doar.' using errcode='42501'; end if;
 if p_idempotency_key is null or p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount<>round(p_amount,2) or p_amount>100000000 then raise exception 'Informe um valor válido, maior que zero e com até duas casas decimais.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('party-donation:'||p_idempotency_key::text,0));
 select * into ledger from public.party_treasury_entries where idempotency_key=p_idempotency_key;
 if found then
  if ledger.kind='donation' and ledger.actor_id=actor and ledger.party_id=p_party_id and ledger.amount=p_amount then return ledger; end if;
  raise exception 'Esta identificação já pertence a outra doação.';
 end if;
 select * into donor from public.profiles where id=actor and deleted_at is null;
 if not found then raise exception 'Cidadão indisponível.'; end if;
 select * into party from public.political_parties where id=p_party_id for update;
 if not found or party.status='Encerrado' then raise exception 'Este partido não está recebendo doações.'; end if;
 legal_snapshot:=private.check_party_donation_rules(p_party_id,actor,p_amount);
 select * into account from public.accounts where user_id=actor and account_kind='personal' for update;
 if not found then raise exception 'Você precisa de uma conta bancária para doar.'; end if;
 if account.balance<p_amount then raise exception 'Seu saldo é insuficiente para esta doação.'; end if;
 update public.accounts set balance=balance-p_amount,updated_at=clock_timestamp() where id=account.id;
 insert into public.party_treasuries(party_id) values(p_party_id) on conflict do nothing;
 update public.party_treasuries set balance=balance+p_amount,updated_at=clock_timestamp() where party_id=p_party_id returning balance into balance_after;
 insert into public.transactions(from_account_id,amount,type,description,idempotency_key,status,currency,metadata)
 values(account.id,p_amount,'party_donation','Doação para '||party.name||' ('||party.acronym||')',p_idempotency_key,'completed','BRL',
 jsonb_build_object('legal_snapshot',legal_snapshot,'party_id',p_party_id,'recipient_name',party.name,'recipient_type','political_party','party_snapshot',jsonb_build_object('name',party.name,'acronym',party.acronym,'logo_url',party.logo_url,'ideology',party.ideology,'orientation',party.orientation::text,'electoral_number',party.electoral_number),'gross_amount',p_amount,'net_amount',p_amount,'total_debited',p_amount,'tax_amount',0,'buyer_tax',0,'seller_tax',0,'levies','[]'::jsonb)) returning id into tx;
 insert into public.party_treasury_entries(party_id,transaction_id,actor_id,kind,amount,balance_after,description,donor_snapshot,idempotency_key)
 values(p_party_id,tx,actor,'donation',p_amount,balance_after,'Doação de cidadão',jsonb_build_object('full_name',donor.full_name,'avatar_url',donor.avatar_url,'username',donor.username),p_idempotency_key) returning * into ledger;
 insert into public.party_history(party_id,actor_id,event_type,summary,previous_state)
 values(p_party_id,actor,'donation','Doação recebida no caixa partidário.',jsonb_build_object('ledger_id',ledger.id,'transaction_id',tx,'amount',p_amount));
 insert into public.notifications(user_id,type,content,link,metadata)
 select distinct recipient,'party_donation_received','O partido recebeu uma doação de R$ '||to_char(p_amount,'FM999999990.00')||'.','/services/political-parties/'||p_party_id,jsonb_build_object('party_id',p_party_id,'entry_id',ledger.id)
 from unnest(array[party.owner_id,party.president_id,party.vice_president_id]) recipient where recipient is not null;
 return ledger;
end $function$
;

ALTER TABLE public.candidates ADD COLUMN eligibility_rule_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION private.check_candidate_legal_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; citizen public.profiles%rowtype; party public.political_parties%rowtype; experience numeric;
BEGIN
 SELECT * INTO citizen FROM public.profiles WHERE id=NEW.user_id;
 SELECT * INTO party FROM public.political_parties WHERE id=NEW.party_id;
 SELECT coalesce(sum(e.experience),0) INTO experience FROM public.citizen_professional_experience e WHERE e.profile_id=NEW.user_id;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND rule_kind='regulation' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND definition->>'operation' IN('electoral_minimum_age','electoral_minimum_experience','electoral_party_requirement') ORDER BY rule_key LOOP
  IF NOT private.normative_scope_applies(r.definition,party.ideology,party.orientation::text,citizen.residence_state_code) THEN CONTINUE; END IF;
  IF r.definition->>'operation'='electoral_minimum_age' AND citizen.created_at>clock_timestamp()-make_interval(days=>r.numeric_value::int) THEN RAISE EXCEPTION 'Sua conta ainda não cumpre o prazo mínimo definido em %.',r.description; END IF;
  IF r.definition->>'operation'='electoral_minimum_experience' AND experience<r.numeric_value THEN RAISE EXCEPTION 'Experiência insuficiente para a regra eleitoral %.',r.description; END IF;
  IF r.definition->>'operation'='electoral_party_requirement' AND NEW.party_id IS NULL THEN RAISE EXCEPTION 'A norma % exige filiação partidária para novas candidaturas.',r.description; END IF;
  NEW.eligibility_rule_snapshot:=NEW.eligibility_rule_snapshot||jsonb_build_array(to_jsonb(r));
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER candidate_legal_rules BEFORE INSERT ON public.candidates FOR EACH ROW EXECUTE FUNCTION private.check_candidate_legal_rules();
REVOKE ALL ON FUNCTION private.check_candidate_legal_rules() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.check_post_advertising_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; snapshots jsonb:='[]'; political_party uuid;
BEGIN
 -- An undeclared advertisement may be investigated; text is never interpreted as guilt.
 IF coalesce((NEW.metadata->>'sponsored')::boolean,false) THEN
  FOR r IN SELECT * FROM public.government_rules WHERE is_active AND rule_kind='regulation' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND definition->>'operation' IN('media_ad_disclosure','media_political_ad_party','media_ad_restriction') ORDER BY rule_key LOOP
   IF NOT private.normative_scope_applies(r.definition) THEN CONTINUE; END IF;
   IF r.definition->>'operation'='media_ad_restriction' THEN RAISE EXCEPTION 'A publicação de publicidade está restrita neste período pela norma %.',r.description; END IF;
   IF r.definition->>'operation'='media_ad_disclosure' AND length(trim(coalesce(NEW.metadata->>'sponsor_name','')))<3 THEN RAISE EXCEPTION 'Identifique o patrocinador conforme a norma %.',r.description; END IF;
   IF r.definition->>'operation'='media_political_ad_party' AND NEW.metadata->>'ad_kind'='political' THEN
    political_party:=nullif(NEW.metadata->>'sponsor_party_id','')::uuid;
    IF political_party IS NULL OR NOT EXISTS(SELECT 1 FROM public.political_parties WHERE id=political_party AND status<>'Encerrado') THEN RAISE EXCEPTION 'Publicidade política exige identificação de um partido existente.'; END IF;
   END IF;
   snapshots:=snapshots||jsonb_build_array(to_jsonb(r));
  END LOOP;
  NEW.metadata:=NEW.metadata||jsonb_build_object('advertising_rule_snapshot',snapshots);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER post_advertising_rules BEFORE INSERT OR UPDATE OF content,metadata ON public.posts FOR EACH ROW EXECUTE FUNCTION private.check_post_advertising_rules();
REVOKE ALL ON FUNCTION private.check_post_advertising_rules() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.create_normative_project(p_effect_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.law_effects%rowtype; d jsonb; project uuid; treasury numeric; sector uuid;
BEGIN
 SELECT * INTO e FROM public.law_effects WHERE id=p_effect_id;
 IF e.status<>'active' OR e.effect_data->>'kind'<>'project' OR EXISTS(SELECT 1 FROM public.government_projects WHERE metadata->>'legal_effect_id'=e.id::text) THEN RETURN; END IF;
 d:=e.effect_data->'definition';
 SELECT id INTO sector FROM public.economic_sectors WHERE is_active ORDER BY CASE WHEN name ILIKE '%saúde%' AND d->>'infrastructure_kind'='health' THEN 0 WHEN name ILIKE '%constru%' THEN 1 ELSE 2 END,code LIMIT 1;
 SELECT treasury_balance INTO treasury FROM public.government_finances WHERE id=1 FOR UPDATE;
 INSERT INTO public.government_projects(name,description,ministry,sector_id,project_type,approved_budget,reserved_amount,status,created_by,approved_by,approved_at,started_at,expected_completion_at,region_code,infrastructure_kind,construction_days,infrastructure_gain,maintenance_weekly,healthcare_capacity,metadata)
 VALUES(e.effect_data->>'name','Obra autorizada por norma publicada. Efeitos regionais após a construção e manutenção semanal de 1%.',CASE WHEN d->>'infrastructure_kind'='health' THEN 'Saúde' ELSE 'Infraestrutura' END,sector,CASE WHEN d->>'infrastructure_kind'='health' THEN 'health' ELSE 'infrastructure' END,e.effect_value,CASE WHEN treasury>=e.effect_value THEN e.effect_value ELSE 0 END,CASE WHEN treasury>=e.effect_value THEN 'funded' ELSE 'proposed' END,e.configured_by,e.configured_by,clock_timestamp(),CASE WHEN treasury>=e.effect_value THEN clock_timestamp() END,clock_timestamp()+make_interval(days=>(d->>'construction_days')::int),d->>'region_code',d->>'infrastructure_kind',(d->>'construction_days')::int,least(20,e.effect_value/10000),round(e.effect_value*.01,2),CASE WHEN d->>'infrastructure_kind'='health' THEN least(10000,floor(e.effect_value/100)) ELSE 0 END,jsonb_build_object('legal_effect_id',e.id,'legal_source_id',e.source_id,'legal_snapshot',to_jsonb(e),'awaiting_funding',treasury<e.effect_value)) RETURNING id INTO project;
 IF treasury>=e.effect_value THEN UPDATE public.government_finances SET treasury_balance=treasury_balance-e.effect_value,updated_at=clock_timestamp() WHERE id=1; END IF;
 PERFORM economy_private.audit('legal_project_created','government_project',project::text,NULL,jsonb_build_object('effect_id',e.id,'reserved',CASE WHEN treasury>=e.effect_value THEN e.effect_value ELSE 0 END),'Execução da autorização legislativa sem antecipar os efeitos da obra',e.configured_by);
END $$;
REVOKE ALL ON FUNCTION private.create_normative_project(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.apply_structured_effect(p_effect_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 PERFORM private.create_normative_project(e.id);
 INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 VALUES('legal_effect_activated','government','law_effects',e.id,e.configured_by,jsonb_build_object('sourceId',e.source_id,'ruleKey',r.rule_key,'kind',r.rule_kind,'action',d->>'action','previousValue',r.numeric_value,'newValue',n,'validFrom',start_at,'validUntil',e.valid_until),'legal-effect:'||e.id);
END $function$
;
CREATE OR REPLACE FUNCTION public.process_due_legal_effects()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e record;
BEGIN
 PERFORM private.expire_judicial_sanctions();
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp-legal-world',0));
 FOR e IN SELECT id FROM public.law_effects WHERE status='active' AND valid_until<=clock_timestamp() ORDER BY valid_until,id FOR UPDATE LOOP PERFORM private.expire_structured_effect(e.id); END LOOP;
 FOR e IN SELECT id FROM public.law_effects WHERE status='scheduled' AND valid_from<=clock_timestamp() ORDER BY valid_from,id FOR UPDATE LOOP PERFORM private.apply_structured_effect(e.id); END LOOP;
END $function$
;

ALTER TABLE public.parliament_voting_rules ADD COLUMN deliberation_numerator integer NOT NULL DEFAULT 1 CHECK(deliberation_numerator>0),
 ADD COLUMN deliberation_denominator integer NOT NULL DEFAULT 2 CHECK(deliberation_denominator>=deliberation_numerator),
 ADD COLUMN deliberation_basis text NOT NULL DEFAULT 'eligible' CHECK(deliberation_basis IN('eligible','house'));
CREATE OR REPLACE FUNCTION private.snapshot_voting_electorate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.bills%rowtype;
begin
 if new.type<>'bill' then return new; end if;
 select * into b from public.bills where id=new.related_id;
 select to_jsonb(r) into new.rule_snapshot from public.parliament_voting_rules r where r.key=CASE WHEN b.type IN('PEC','Proposta de Emenda Constitucional') THEN 'qualified_majority' WHEN b.type IN('PL','Projeto de Lei') THEN 'simple_majority' ELSE b.voting_rule END;
 IF b.type IN('PL','Projeto de Lei') THEN new.rule_snapshot:=new.rule_snapshot||jsonb_build_object('approval_basis','cast','numerator',1,'denominator',2); ELSIF b.type IN('PEC','Proposta de Emenda Constitucional') THEN new.rule_snapshot:=new.rule_snapshot||jsonb_build_object('approval_basis','seats','numerator',2,'denominator',3); END IF;
 if b.type='IMPEACHMENT' then new.rule_snapshot:=new.rule_snapshot||jsonb_build_object('numerator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_numerator')::int,2),'denominator',coalesce((b.institutional_data->'rule_snapshot'->>'impeachment_approval_denominator')::int,3)); end if;
 select m.id into new.chair_member_id from public.parliament_members m where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id) order by m.id limit 1;
 select coalesce(array_agg(m.id),'{}'::uuid[]) into new.eligible_member_ids from public.parliament_members m
 where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id)
 and (coalesce((new.rule_snapshot->>'chair_votes_normally')::boolean,false) or m.id is distinct from new.chair_member_id);
 select new.rule_snapshot||jsonb_build_object('house_members',count(*),'deliberation_required',floor((CASE WHEN new.rule_snapshot->>'deliberation_basis'='house' THEN count(*) ELSE cardinality(new.eligible_member_ids) END)*coalesce((new.rule_snapshot->>'deliberation_numerator')::numeric,1)/coalesce((new.rule_snapshot->>'deliberation_denominator')::numeric,2))+1) into new.rule_snapshot
 from public.parliament_members m where m.house_id=new.house_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id);
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION private.finalize_bill_voting(p_voting_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.parliament_votings%rowtype; bill public.bills%rowtype; seats integer; voted integer; yes integer; no integer; approved boolean; other_house uuid; other_result record; next_status text; ordinary_voted integer; chair_voted boolean; required integer; full_house integer; deliberation integer;
begin
 select * into v from public.parliament_votings where id=p_voting_id for update;
 if not found or v.type<>'bill' then raise exception 'Votação legislativa não encontrada.'; end if;
 if v.status='closed' then return coalesce(v.result,'{}')||jsonb_build_object('finalized',true,'message','Votação já encerrada.'); end if;
 select * into bill from public.bills where id=v.related_id for update;
 if bill.type='IMPEACHMENT' then return private.finalize_impeachment(p_voting_id); end if;
 if lower(coalesce(bill.status,'')) in ('sancionado','promulgado','rejeitado','vetado','arquivado','sustado') then
  update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
  return jsonb_build_object('finalized',true,'message','Votação encerrada; decisão institucional preservada.');
 end if;
 select cardinality(v.eligible_member_ids) into seats;
 full_house:=coalesce((v.rule_snapshot->>'house_members')::int,seats);
 deliberation:=coalesce((v.rule_snapshot->>'deliberation_required')::int,1);
 select count(*),count(*) filter(where vote='Aprovar'),count(*) filter(where vote='Rejeitar'),count(*) filter(where member_id=any(v.eligible_member_ids)),coalesce(bool_or(member_id=v.chair_member_id),false)
 into voted,yes,no,ordinary_voted,chair_voted from public.parliament_voting_votes where voting_id=v.id;
 if v.tie_break_pending and not chair_voted and clock_timestamp()<v.end_date then return jsonb_build_object('finalized',false,'tie_break_pending',true); end if;
 if not v.tie_break_pending and clock_timestamp()<v.end_date and (seats=0 or ordinary_voted<seats) then return jsonb_build_object('finalized',false); end if;
 if not v.tie_break_pending and yes=no and voted>=deliberation and coalesce((v.rule_snapshot->>'tie_break')::boolean,false)
 and exists(select 1 from public.parliament_members m where m.id=v.chair_member_id and m.id=public.get_active_parliament_member_id(m.user_id,m.house_id) and private.is_house_president(m.user_id,m.house_id)) then
  update public.parliament_votings set tie_break_pending=true,end_date=clock_timestamp()+make_interval(hours=>(v.rule_snapshot->>'tie_break_hours')::int) where id=v.id;
  insert into public.notifications(user_id,type,content,link,metadata) select user_id,'parliament_tie_break','A votação de '||bill.title||' aguarda seu voto de desempate.','/services/parliament/panel',jsonb_build_object('voting_id',v.id) from public.parliament_members where id=v.chair_member_id;
  return jsonb_build_object('finalized',false,'tie_break_pending',true);
 end if;
 required:=case when v.rule_snapshot->>'approval_basis'='seats' then
 case when v.rule_snapshot->>'numerator'='1' and v.rule_snapshot->>'denominator'='2' then floor(full_house/2.0)+1 else ceil(full_house*(v.rule_snapshot->>'numerator')::numeric/(v.rule_snapshot->>'denominator')::numeric) end else 1 end;
 approved:=voted>=deliberation AND case when v.rule_snapshot->>'approval_basis'='seats' then yes>=greatest(required,1) else yes>no and yes>0 end;
 next_status:=case when approved and bill.type='PDL' and bill.suspends_decree_id is not null then 'Promulgado' when approved then 'Aguardando sanção presidencial' else 'Rejeitado' end;
 if bill.type IN('PEC','Proposta de Emenda Constitucional') and approved then
  select pv.id,pv.status,pv.house_id,pv.result
  into other_result from public.parliament_votings pv left join public.parliament_voting_votes pvv on pvv.voting_id=pv.id
  where pv.related_id=bill.id and pv.type='bill' and pv.house_id<>v.house_id group by pv.id order by pv.created_at desc limit 1;
  if found and other_result.status='closed' then next_status:=case when coalesce((other_result.result->>'approved')::boolean,false) then 'Aguardando promulgação presidencial' else 'Rejeitado' end;
  else
   next_status:='Em votação (2ª Casa)';
   if other_result.id is null then
    select id into other_house from public.parliament_houses where id<>v.house_id order by case when id in ('a1b2c3d4-e5f6-7890-1234-567890abcdef','fedcba09-8765-4321-0987-654321fedcba') then 0 else 1 end,id limit 1;
    if other_house is null then raise exception 'A proposta constitucional exige duas Casas legislativas.'; end if;
    insert into public.parliament_votings(house_id,type,related_id,title,description,status,end_date) values(other_house,'bill',bill.id,'[2ª Casa] '||bill.title,'Votação constitucional na segunda Casa. Exige aprovação de dois terços.','active',clock_timestamp()+interval '24 hours');
   end if;
  end if;
 end if;
 update public.bills set status=next_status,updated_at=clock_timestamp() where id=bill.id;
 update public.parliament_votings set status='closed',tie_break_pending=false,result=jsonb_build_object('approved',approved,'yes',yes,'no',no,'seats',full_house,'required',required,'deliberation_required',deliberation,'present',voted) where id=v.id;
 insert into public.notifications(user_id,type,content,link,metadata)
 select m.user_id,'parliament_voting_result',
 case when vote.vote='Abster' then 'Votação encerrada: o projeto "'||bill.title||'", no qual você registrou abstenção, foi '
 when (vote.vote='Aprovar' and approved) or (vote.vote='Rejeitar' and not approved) then 'Boa notícia! O projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi '
 else 'Resultado da votação: o projeto "'||bill.title||'", em que você votou '||case vote.vote when 'Aprovar' then 'a favor' else 'contra' end||', foi ' end
 ||case when approved then 'aprovado' else 'rejeitado' end||' pela sua Casa Legislativa.',
 '/services/parliament',jsonb_build_object('voting_id',v.id,'bill_id',bill.id,'vote',vote.vote,'approved',approved,'tone',case when vote.vote='Abster' then 'neutral' when (vote.vote='Aprovar')=approved then 'positive' else 'institutional' end)
 from public.parliament_voting_votes vote join public.parliament_members m on m.id=vote.member_id where vote.voting_id=v.id
 and not exists(select 1 from public.notifications n where n.user_id=m.user_id and n.type='parliament_voting_result' and n.metadata->>'voting_id'=v.id::text);
 return jsonb_build_object('finalized',true,'approved',approved,'message','Votação encerrada. '||next_status||'.');
end $function$
;
DROP FUNCTION public.submit_structured_legal_measure(text,text,text,text,uuid,jsonb);
CREATE OR REPLACE FUNCTION public.submit_structured_legal_measure(p_source_kind text, p_title text, p_summary text, p_full_text text, p_house_id uuid, p_effects jsonb, p_type text DEFAULT 'PL')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); role_name text; source uuid; data jsonb; b public.bills%rowtype;
BEGIN
 SELECT role INTO role_name FROM public.profiles WHERE id=actor AND deleted_at IS NULL;
 IF public.is_admin(actor) THEN role_name:='Admin'; ELSIF public.is_acting_president(actor) THEN role_name:='Presidente'; ELSIF EXISTS(SELECT 1 FROM public.parliament_members WHERE user_id=actor AND id=public.get_active_parliament_member_id(actor,house_id)) THEN role_name:='Deputado'; END IF;
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 IF role_name IS NULL OR role_name NOT IN('Admin','Presidente','Deputado','Senador') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
 IF length(btrim(coalesce(p_title,'')))<5 OR length(btrim(coalesce(p_summary,'')))<20 OR length(btrim(coalesce(p_full_text,'')))<40 THEN RAISE EXCEPTION 'LEGAL_TEXT_REQUIRED'; END IF;
 IF jsonb_typeof(p_effects) IS DISTINCT FROM 'array' OR jsonb_array_length(p_effects) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'STRUCTURED_EFFECTS_REQUIRED'; END IF;
 IF p_type NOT IN('PL','PEC') THEN RAISE EXCEPTION 'Selecione PL ou PEC.'; END IF;
 IF p_source_kind='bill' THEN
   b:=public.propose_parliament_bill(p_title,p_summary,p_full_text,p_type,p_house_id); source:=b.id;
 ELSIF p_source_kind='decree' THEN
   IF role_name NOT IN('Admin','Presidente') THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED'; END IF;
   INSERT INTO public.decrees(title,content,author_id,is_published) VALUES(btrim(p_title),p_full_text,actor,false) RETURNING id INTO source;
 ELSE RAISE EXCEPTION 'INVALID_LEGAL_SOURCE'; END IF;
 FOR data IN SELECT * FROM jsonb_array_elements(p_effects) LOOP PERFORM public.configure_structured_law_effect(p_source_kind,source,data); END LOOP;
 RETURN jsonb_build_object('id',source,'source_kind',p_source_kind,'status',case when p_source_kind='bill' then 'Em tramitação' else 'Rascunho' end);
END $function$
;
REVOKE ALL ON FUNCTION public.submit_structured_legal_measure(text,text,text,text,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_structured_legal_measure(text,text,text,text,uuid,jsonb,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.propose_parliament_bill(p_title text, p_summary text, p_full_text text, p_type text, p_house_id uuid DEFAULT NULL::uuid)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); actor_role text; resolved_house uuid; result public.bills%rowtype;
begin
  select role into actor_role from public.profiles where id=actor;
  IF public.is_admin(actor) THEN actor_role:='Admin'; ELSIF public.is_acting_president(actor) THEN actor_role:='Presidente'; END IF;
  if actor is null then raise exception 'Autenticação necessária.'; end if;
  if length(trim(coalesce(p_title,'')))<5 or length(trim(coalesce(p_summary,'')))<15 then raise exception 'Título e resumo precisam ser completos.'; end if;
  if actor_role is null or (actor_role not in ('Admin','Presidente') and not exists(select 1 from public.parliament_members m where m.user_id=actor and m.id=public.get_active_parliament_member_id(actor,m.house_id))) then raise exception 'PARLIAMENT_AUTHORITY_REQUIRED'; end if;
  if p_type not in ('PL','PEC','PDL','Projeto de Lei','Proposta de Emenda Constitucional') then raise exception 'Escolha um tipo de proposta legislativa válido.'; end if;
  if actor_role IN('Admin','Presidente') then
    resolved_house:=p_house_id;
  else
    select pm.house_id into resolved_house from public.parliament_members pm
    where pm.user_id=actor and pm.term_start_date<=current_date and pm.term_end_date>=current_date
      and (p_house_id is null or pm.house_id=p_house_id)
    order by pm.term_end_date desc limit 1;
  end if;
  if resolved_house is null or not exists(select 1 from public.parliament_houses where id=resolved_house) then raise exception 'Casa legislativa não autorizada para este mandato.'; end if;
  if actor_role NOT IN('Admin','Presidente') and not exists(select 1 from public.parliament_members where user_id=actor and house_id=resolved_house and term_start_date<=current_date and term_end_date>=current_date) then raise exception 'O projeto deve tramitar na Casa do mandato do parlamentar.'; end if;
  insert into public.bills(title,summary,full_text,type,author_id,house_id,author_role,status)
  values(trim(p_title),trim(p_summary),nullif(trim(p_full_text),''),p_type,actor,resolved_house,actor_role,'Em tramitação') returning * into result;
  insert into public.notifications(user_id,sender_id,type,content,link)
  select pm.user_id,actor,'parliament_bill_proposed','Novo projeto em sua Casa: '||result.title,'/services/parliament/panel'
  from public.parliament_members pm where pm.house_id=resolved_house and pm.term_start_date<=current_date and pm.term_end_date>=current_date and pm.user_id<>actor;
  return result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.configure_structured_law_effect(p_source_kind text, p_source_id uuid, p_data jsonb)
 RETURNS law_effects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); role_name text; source_author uuid; locked boolean; key text; kind text:=p_data->>'kind'; e public.law_effects%rowtype; old_rule public.government_rules%rowtype;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
 SELECT role INTO role_name FROM public.profiles WHERE id=actor AND deleted_at IS NULL;
 IF public.is_admin(actor) THEN role_name:='Admin'; ELSIF public.is_acting_president(actor) THEN role_name:='Presidente'; ELSIF EXISTS(SELECT 1 FROM public.parliament_members WHERE user_id=actor AND id=public.get_active_parliament_member_id(actor,house_id)) THEN role_name:='Deputado'; END IF;
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
 IF key IN('consumption_tax_rate','corporate_tax_rate','transaction_tax') AND p_data->'definition'->>'nature' IS DISTINCT FROM 'percentage' THEN RAISE EXCEPTION 'As alíquotas nacionais usam percentual. Crie um tributo distinto para cobrança fixa.'; END IF;
 IF kind='penalty' AND (old_rule.rule_key IS NULL OR old_rule.definition->>'penal_code_id' IS DISTINCT FROM p_data->'definition'->>'penal_code_id') THEN RAISE EXCEPTION 'INVALID_PENAL_CODE'; END IF;
 IF p_data->>'action'='create' AND old_rule.rule_key IS NOT NULL AND old_rule.is_active THEN RAISE EXCEPTION 'RULE_ALREADY_ACTIVE'; END IF;
 IF length(btrim(coalesce(p_data->>'name','')))<3 THEN RAISE EXCEPTION 'LEGAL_RULE_NAME_REQUIRED'; END IF;
 INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition)
 VALUES(key,0,case when p_data->'definition'->>'nature'='percentage' OR p_data->'definition'->>'sanction_kind'='fine_percentage' then 'ratio' when kind='penalty' then 'rp_years' else 'BRL' end,p_data->>'name',kind,false,coalesce(p_data->'definition','{}')) ON CONFLICT DO NOTHING;
 INSERT INTO public.law_effects(source_kind,source_id,effect_key,operation,effect_value,explanation,configured_by,effect_data,valid_from,valid_until)
 VALUES(p_source_kind,p_source_id,key,'set',(p_data->>'value')::numeric,coalesce(p_data->>'explanation',p_data->>'name'),actor,p_data,
   nullif(p_data->>'valid_from','')::timestamptz,nullif(p_data->>'valid_until','')::timestamptz)
 ON CONFLICT(source_kind,source_id,effect_key) DO UPDATE SET effect_value=excluded.effect_value,explanation=excluded.explanation,effect_data=excluded.effect_data,valid_from=excluded.valid_from,valid_until=excluded.valid_until
 WHERE public.law_effects.status='draft' RETURNING * INTO e;
 IF e.id IS NULL THEN RAISE EXCEPTION 'ACTIVE_LEGAL_EFFECT_IS_IMMUTABLE'; END IF;
 RETURN e;
END $function$
;

CREATE OR REPLACE FUNCTION public.get_legislative_catalogs() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar os modelos.'; END IF;
 RETURN jsonb_build_object('norms',(SELECT coalesce(jsonb_agg(to_jsonb(n)),'[]') FROM (SELECT DISTINCT ON(source_id) source_id,title,publication_number,CASE WHEN EXISTS(SELECT 1 FROM public.bills WHERE id=source_id AND status IN('Sancionado','Promulgado')) THEN 'bill' ELSE 'decree' END source_kind FROM public.dou_entries g WHERE EXISTS(SELECT 1 FROM public.bills WHERE id=g.source_id AND status IN('Sancionado','Promulgado')) OR EXISTS(SELECT 1 FROM public.decrees WHERE id=g.source_id AND is_published AND revoked_at IS NULL) ORDER BY source_id,published_at DESC) n),'ideologies',(SELECT jsonb_agg(x ORDER BY x) FROM (SELECT DISTINCT ideology x FROM public.political_parties WHERE nullif(trim(ideology),'') IS NOT NULL UNION SELECT unnest(enum_range(NULL::public.political_orientation)::text[])) t),'regions',(SELECT jsonb_agg(jsonb_build_object('code',code,'name',name) ORDER BY name) FROM public.economic_regions),'categories',(SELECT jsonb_agg(category ORDER BY category) FROM (SELECT DISTINCT category FROM public.products WHERE category IS NOT NULL UNION SELECT name FROM public.economic_resources UNION SELECT 'Insumos' UNION SELECT 'Moradia') c));
END $$;
REVOKE ALL ON FUNCTION public.get_legislative_catalogs() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_legislative_catalogs() TO authenticated;
NOTIFY pgrst,'reload schema';

DROP FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text);
CREATE OR REPLACE FUNCTION public.quote_legal_levies(p_basis text, p_amount numeric, p_business boolean DEFAULT false, p_sector uuid DEFAULT NULL::uuid, p_category text DEFAULT NULL::text, p_document text DEFAULT NULL::text, p_region text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.government_rules%rowtype; items jsonb:='[]'; buyer numeric:=0; seller numeric:=0; amount numeric; rp timestamp:=public.rp_now() AT TIME ZONE 'America/Sao_Paulo'; h time; from_h time; to_h time; restricted boolean:=false;
BEGIN
 IF p_amount IS NULL OR p_amount<0 OR p_amount::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'INVALID_LEGAL_VALUE'; END IF;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND valid_from<=statement_timestamp() AND (valid_until IS NULL OR valid_until>statement_timestamp()) AND rule_kind IN('tax','fee','restriction') ORDER BY rule_key LOOP
   IF r.definition ? 'region_codes' AND NOT coalesce(r.definition->'region_codes' ? coalesce(p_region,(SELECT residence_state_code FROM public.profiles WHERE id=auth.uid())),false) THEN CONTINUE; END IF;
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
END $function$
;
REVOKE ALL ON FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION private.buy_product_authoritative(p_buyer uuid, p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid, p_renewal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_buyer uuid:=p_buyer;v_product public.products%rowtype;v_business public.businesses%rowtype;
  v_buyer_account public.accounts%rowtype;v_seller_account public.accounts%rowtype;v_card public.cards%rowtype;
  v_base numeric;v_consumption_rate numeric;v_corporate_rate numeric;v_consumption_tax numeric;v_corporate_tax numeric;
  v_total numeric;v_seller_net numeric;v_transaction uuid;v_order public.commerce_orders%rowtype;v_invoice uuid;v_buyer_name text; v_levies jsonb; v_market public.state_enterprises%rowtype; v_market_account uuid; v_market_owner uuid; v_commission numeric; v_commission_snapshot jsonb;
begin
  if v_buyer is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_order from public.commerce_orders where idempotency_key=p_idempotency_key;
  if found then
    if v_order.buyer_id is distinct from v_buyer then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if;
    if v_order.product_id is distinct from p_product_id or v_order.payment_method is distinct from p_payment_method or v_order.card_id is distinct from p_card_id then raise exception 'IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
    return jsonb_build_object('success',v_order.status='completed','message','Compra já processada.','transaction_id',v_order.transaction_id,'order_id',v_order.id,'total',v_order.total_amount,'tax',v_order.consumption_tax+v_order.corporate_tax); end if;
  perform public.process_due_legal_effects();
  perform 1 from public.state_enterprises where service_key='marketplace' for share;
  perform id from public.businesses where id=(select business_id from public.products where id=p_product_id) for update;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  if v_product.state_enterprise_id is not null then return private.buy_state_product(p_product_id,p_payment_method,p_card_id,p_idempotency_key); end if;
  if p_renewal is null then perform private.assert_citizen_service('/services/business');
  elsif not exists(select 1 from public.user_subscriptions where id=p_renewal and user_id=v_buyer and product_id=p_product_id and status in('active','past_due')) then raise exception 'SUBSCRIPTION_NOT_AVAILABLE';end if;
  if v_product.moderation_status<>'approved' or v_product.archived_at is not null then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;
  select * into v_market from public.state_enterprises where service_key='marketplace' for share;
  if not found or not v_market.is_active then raise exception 'MARKETPLACE_UNAVAILABLE'; end if;
  v_market:=private.marketplace_seller_policy(v_market,v_product.business_id,true);
  if v_market.active_listing_fee_enabled and v_market.active_listing_fee_amount>0 and (v_product.listing_status='awaiting_renewal' or v_product.listing_paid_until<=clock_timestamp()) then raise exception 'LISTING_RENEWAL_REQUIRED';end if;
  if v_market.is_privatized then
    select coalesce(b.owner_id,v_market.privatization_buyer_id),b.bank_account_id into v_market_owner,v_market_account from public.businesses b where b.id=v_market.operating_business_id;
    if v_market_owner is null then v_market_owner:=v_market.privatization_buyer_id; end if;
    if v_market_account is null then select id into v_market_account from public.accounts where user_id=v_market_owner; end if;
    if v_market_account is null then raise exception 'MARKETPLACE_RECEIVING_ACCOUNT_REQUIRED'; end if;
  end if;

  if p_renewal is null and v_product.product_type='subscription' and exists(select 1 from public.user_subscriptions where user_id=v_buyer and product_id=v_product.id and status in('active','past_due')) then raise exception 'SUBSCRIPTION_ALREADY_ACTIVE';end if;
  if v_product.seller_id=v_buyer then raise exception 'OWN_PRODUCT_PURCHASE_DENIED'; end if;
  if v_product.business_id is not null then
    select * into v_business from public.businesses where id=v_product.business_id for update;
    if not found or v_business.status is distinct from 'active' then raise exception 'BUSINESS_NOT_ACTIVE'; end if;
    if v_business.owner_id is distinct from v_product.seller_id then raise exception 'SELLER_OWNERSHIP_CHANGED'; end if;
  end if;
  -- Consistent account lock order avoids opposing purchases deadlocking.
  perform id from public.accounts
    where user_id=v_buyer or (v_product.business_id is null and user_id=v_product.seller_id)
       or id=v_business.bank_account_id or id=v_market_account order by id for update;
  if v_product.business_id is null then
    select * into v_seller_account from public.accounts where user_id=v_product.seller_id;
  else
    select * into v_seller_account from public.accounts where id=v_business.bank_account_id;
  end if;
  if not found then raise exception 'SELLER_BANK_ACCOUNT_REQUIRED'; end if;
  if v_product.product_type='one-time' and coalesce(v_product.stock,0)<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
  v_base:=case when v_product.promotion_price is not null and v_product.promotion_expires_at>clock_timestamp() then v_product.promotion_price else v_product.price end;
  v_levies:=public.quote_legal_levies('purchase',v_base,v_product.business_id is not null,coalesce(v_product.economic_sector_id,v_business.economic_sector_id),v_product.category,NULL,coalesce(v_business.region_code,(SELECT residence_state_code FROM public.profiles WHERE id=v_product.seller_id)));
  if (v_levies->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_consumption_tax:=(v_levies->>'buyer_tax')::numeric;v_corporate_tax:=(v_levies->>'seller_tax')::numeric;
  v_total:=(v_levies->>'total_debited')::numeric;v_seller_net:=(v_levies->>'net_amount')::numeric;
  v_commission:=round(case when v_market.commission_type='percentage' then v_base*v_market.commission_value/100 else v_market.commission_value end+v_market.fixed_sale_fee,2);
  if v_commission>v_seller_net then raise exception 'COMMISSION_EXCEEDS_PROCEEDS'; end if;
  v_seller_net:=v_seller_net-v_commission;
  v_commission_snapshot:=jsonb_build_object('enterprise_id',v_market.id,'type',v_market.commission_type,'value',v_market.commission_value,'fixed_sale_fee',v_market.fixed_sale_fee,'percentage_amount',case when v_market.commission_type='percentage' then round(v_base*v_market.commission_value/100,2) else 0 end,'base_amount',v_base,'amount',v_commission,'seller_type',case when v_product.business_id is null then 'PF' else 'PJ' end,'private',v_market.is_privatized,'recipient_account_id',v_market_account);
  v_levies:=v_levies||jsonb_build_object('net_amount',v_seller_net,'commission_amount',v_commission,'commission_snapshot',v_commission_snapshot);


  if p_payment_method='balance' then
    select * into v_buyer_account from public.accounts where user_id=v_buyer for update;
    if not found then raise exception 'BUYER_BANK_ACCOUNT_REQUIRED'; end if;
    if v_buyer_account.balance<v_total then raise exception 'INSUFFICIENT_BALANCE'; end if;
    update public.accounts set balance=balance-v_total,updated_at=clock_timestamp() where id=v_buyer_account.id;
  elsif p_payment_method='card' then
    select * into v_card from public.cards where id=p_card_id and user_id=v_buyer and is_active and card_type='credit' for update;
    if not found then raise exception 'INVALID_CARD'; end if;
    if v_card.card_limit-v_card.used_limit<v_total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
    update public.cards set used_limit=used_limit+v_total where id=v_card.id;
  else raise exception 'INVALID_PAYMENT_METHOD'; end if;

  update public.accounts set balance=balance+v_seller_net,updated_at=clock_timestamp() where id=v_seller_account.id;
  if v_market.is_privatized and v_commission>0 then update public.accounts set balance=balance+v_commission,updated_at=clock_timestamp() where id=v_market_account; end if;
  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  update public.government_finances set treasury_balance=treasury_balance+v_consumption_tax+v_corporate_tax+case when not v_market.is_privatized then v_commission else 0 end,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
  values(v_buyer_account.id,v_seller_account.id,v_total,'Compra: '||v_product.name,
    case when p_payment_method='card' then 'purchase_card' else 'purchase' end,
    jsonb_build_object('billing_subscription_id',p_renewal,'platform','Negócios Livres','business_id',v_business.id,'product_id',v_product.id,'seller_type',v_product.seller_type,'seller_id',v_product.seller_id,'seller_name',(select full_name from public.profiles where id=v_product.seller_id),
      'base_price',v_base,'consumption_tax',v_consumption_tax,'corporate_tax',v_corporate_tax,'seller_net',v_seller_net,'card_id',p_card_id)||v_levies,
    p_idempotency_key) returning id into v_transaction;
  insert into public.commerce_orders(
    idempotency_key,buyer_id,seller_id,business_id,product_id,buyer_account_id,seller_account_id,card_id,payment_method,
    base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id,status,completed_at,marketplace_enterprise_id,commission_amount,commission_snapshot
  ) values(p_idempotency_key,v_buyer,v_product.seller_id,v_business.id,v_product.id,v_buyer_account.id,v_seller_account.id,p_card_id,p_payment_method,
    v_base,v_consumption_tax,v_corporate_tax,v_total,v_seller_net,v_transaction,'completed',clock_timestamp(),v_market.id,v_commission,v_commission_snapshot) returning * into v_order;
  if v_product.business_id is not null then
  insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'revenue',v_base,'Venda: '||v_product.name);
  if v_corporate_tax>0 then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'tax',-v_corporate_tax,'Imposto da venda: '||v_product.name); end if;
  update public.businesses set monthly_revenue=monthly_revenue+v_base,updated_at=clock_timestamp() where id=v_business.id;
  end if;

  if v_commission>0 then
    if v_product.business_id is not null then insert into public.business_transactions(business_id,type,amount,description) values(v_business.id,'expense',-v_commission,'Comissão Negócios Livre: '||v_product.name); end if;
    if v_market.is_privatized then
      insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata) values(null,v_market_account,v_commission,'marketplace_commission','Comissão de venda no Negócios Livre',jsonb_build_object('commerce_order_id',v_order.id,'gross_amount',v_commission,'net_amount',v_commission,'tax_amount',0,'commission_snapshot',v_commission_snapshot));
    else
      insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('fee','commerce_orders',v_order.id::text,v_product.seller_id,v_commission,public.rp_now(),jsonb_build_object('kind','marketplace_commission','transaction_id',v_transaction,'snapshot',v_commission_snapshot));
    end if;
  end if;
  if v_consumption_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('consumption_tax','commerce_orders',v_order.id::text,v_buyer,v_business.id,v_consumption_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;
  if v_corporate_tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
    values('corporate_tax','commerce_orders',v_order.id::text,v_business.owner_id,v_business.id,v_corporate_tax,public.rp_now(),jsonb_build_object('transactionId',v_transaction)); end if;

  if v_product.product_type='subscription' then
    if p_renewal is null then
      insert into public.user_subscriptions(user_id,product_id,seller_id,status,last_payment_date,next_payment_date)
      values(v_buyer,v_product.id,v_product.seller_id,'active',clock_timestamp(),clock_timestamp()+(v_product.subscription_interval)::interval);
      update public.products set subscribers_count=coalesce(subscribers_count,0)+1 where id=v_product.id;
    else
      update public.user_subscriptions set status='active',seller_id=v_product.seller_id,last_payment_date=clock_timestamp(),next_payment_date=greatest(next_payment_date,clock_timestamp())+(v_product.subscription_interval)::interval,updated_at=clock_timestamp() where id=p_renewal;
    end if;
  else
    insert into public.user_inventory(user_id,product_id,quantity,acquired_at,metadata) values(v_buyer,v_product.id,1,clock_timestamp(),jsonb_build_object('consumable_effects',v_product.consumable_effects,'transaction_id',v_transaction,'origin','Negócios Livres','purchase_price',v_base));
    update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=v_product.id;
  end if;
  if p_payment_method='card' then
    select id into v_invoice from public.card_invoices where card_id=v_card.id and status='open' order by created_at desc limit 1 for update;
    if v_invoice is null then
      insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
      values(v_card.id,v_buyer,current_date+30,current_date+40,v_total,'open') returning id into v_invoice;
    else update public.card_invoices set amount=amount+v_total,updated_at=clock_timestamp() where id=v_invoice; end if;
    insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(v_invoice,v_transaction,'Compra: '||v_product.name,v_total);
  end if;
  select full_name into v_buyer_name from public.profiles where id=v_buyer;
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(v_product.seller_id,v_buyer,'product_sold',coalesce(v_buyer_name,'Um cidadão')||' comprou: '||v_product.name,'/dashboard?tab=products');
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('commerce_purchase_completed','economy','commerce_orders',v_order.id,v_buyer,
    jsonb_build_object('businessId',v_business.id,'productId',v_product.id,'total',v_total,'tax',v_consumption_tax+v_corporate_tax,'transactionId',v_transaction),
    'commerce-purchase:'||p_idempotency_key,'processed',clock_timestamp());
  return jsonb_build_object('success',true,'message','Compra realizada com sucesso!','transaction_id',v_transaction,'order_id',v_order.id,
    'total',v_total,'tax',v_consumption_tax+v_corporate_tax);
exception when others then
  raise;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.buy_state_product(p_product_id uuid, p_payment_method text, p_card_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.products%rowtype; a public.accounts%rowtype; t uuid; inv uuid; q jsonb; total numeric; tax numeric; net numeric; o uuid; spec jsonb; service_path text; payment_card public.cards%rowtype; invoice_id uuid; enterprise public.state_enterprises%rowtype; recipient uuid;
begin
 perform private.assert_housing_offer(p_product_id,'sale');
 select * into p from public.products where id=p_product_id for update;
 service_path:=case when p.residence_spec is null then '/services/national-market' else '/services/national-housing' end;
 perform private.assert_citizen_service(service_path);
 select * into enterprise from public.state_enterprises where id=p.state_enterprise_id and is_active for share;
 if not found or p.archived_at is not null or p.moderation_status<>'approved' then raise exception 'Esta oferta está indisponível.'; end if;
 if enterprise.is_privatized then select bank_account_id into recipient from public.businesses where id=enterprise.operating_business_id and status='active';if recipient is null then raise exception 'A empresa operadora está indisponível.';end if;end if;
 if p.stock<=0 then raise exception 'PRODUCT_OUT_OF_STOCK'; end if;
 if p.price<=0 then raise exception 'A oferta precisa de um preço válido.'; end if;
 q:=public.quote_legal_levies('purchase',p.price,enterprise.is_privatized,p.economic_sector_id,p.category,NULL,coalesce(p.residence_spec->>'state',(SELECT region_code FROM public.businesses WHERE id=enterprise.operating_business_id)));
 if (q->>'restricted')::boolean then raise exception 'Esta operação está temporariamente restrita por norma vigente.'; end if;
 total:=(q->>'total_debited')::numeric;tax:=(q->>'buyer_tax')::numeric+(q->>'seller_tax')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where user_id=auth.uid() or id=recipient order by id for update;
 select * into a from public.accounts where user_id=auth.uid();
 if not found then raise exception 'Abra sua conta no Banco Nacional antes de comprar.'; end if;
 if p_payment_method='balance' then
   if p_card_id is not null then raise exception 'INVALID_PAYMENT_METHOD'; end if;
   if a.balance<total then raise exception 'INSUFFICIENT_BALANCE'; end if;
   update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=a.id;
 elsif p_payment_method='card' then
   select * into payment_card from public.cards where id=p_card_id and user_id=auth.uid() and is_active and card_type='credit' for update;
   if not found then raise exception 'INVALID_CARD'; end if;
   if payment_card.card_limit-payment_card.used_limit<total then raise exception 'INSUFFICIENT_CARD_LIMIT'; end if;
   update public.cards set used_limit=used_limit+total where id=payment_card.id;
 else raise exception 'INVALID_PAYMENT_METHOD'; end if;
 update public.government_finances set treasury_balance=treasury_balance+case when enterprise.is_privatized then tax else total end,updated_at=clock_timestamp() where id=1;
 if recipient is not null then
 update public.accounts set balance=balance+net,updated_at=now() where id=recipient;
 insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'revenue',p.price,'Venda: '||p.name);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description) values(enterprise.operating_business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos: '||p.name);end if;
 end if;
 insert into public.transactions(from_account_id,to_account_id,amount,description,type,metadata,idempotency_key)
 values(case when p_payment_method='balance' then a.id else null end,recipient,total,'Compra: '||p.name,case when p_payment_method='card' then 'purchase_card' else 'purchase' end,q||jsonb_build_object('platform',case when p.residence_spec is null then 'Mercado Nacional' else 'Imobiliária Nacional' end,'state_enterprise_id',p.state_enterprise_id,'product_id',p.id,'base_price',p.price,'card_id',payment_card.id,'buyer_id',auth.uid()),p_idempotency_key) returning id into t;
 insert into public.commerce_orders(idempotency_key,buyer_id,product_id,buyer_account_id,state_enterprise_id,payment_method,card_id,base_amount,consumption_tax,corporate_tax,total_amount,seller_net_amount,transaction_id)
 values(p_idempotency_key,auth.uid(),p.id,a.id,p.state_enterprise_id,p_payment_method,payment_card.id,p.price,(q->>'buyer_tax')::numeric,(q->>'seller_tax')::numeric,total,net,t) returning id into o;
 insert into public.user_inventory(user_id,product_id,quantity,metadata) values(auth.uid(),p.id,1,jsonb_build_object('transaction_id',t,'origin',service_path,'purchase_price',p.price,'consumable_effects',p.consumable_effects)) returning id into inv;
 if p.residence_spec is not null then
   spec:=p.residence_spec;
   insert into public.citizen_residences(owner_id,inventory_id,product_id,transaction_id,name,city,state,area_sqm,purchase_price,quality,rooms,hygiene_recovery,sleep_minutes)
   values(auth.uid(),inv,p.id,t,p.name,spec->>'city',spec->>'state',(spec->>'area_sqm')::numeric,p.price,(spec->>'quality')::integer,coalesce(spec->'rooms','{"bedrooms":1,"bathrooms":1,"living_rooms":1,"kitchens":1}'),coalesce((spec->>'hygiene_recovery')::integer,100),coalesce((spec->>'sleep_minutes')::numeric,15));
   insert into public.notifications(user_id,type,content,link) values(auth.uid(),'housing_acquired','Você adquiriu '||p.name||'. Sua residência permite dormir e tomar banho.','/services/national-housing');
 end if;
 if not enterprise.is_privatized then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata)
 values('other','commerce_orders',o::text,auth.uid(),net,public.rp_now(),jsonb_build_object('state_enterprise_id',p.state_enterprise_id,'transaction_id',t));end if;
 if tax>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','commerce_orders',o::text,auth.uid(),tax,public.rp_now(),q); end if;
 update public.products set stock=stock-1,sales_count=coalesce(sales_count,0)+1 where id=p.id;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key)
 values('commerce_purchase_completed','economy','commerce_orders',o,auth.uid(),jsonb_build_object('stateEnterpriseId',p.state_enterprise_id,'productId',p.id,'total',total,'tax',tax,'transactionId',t),'commerce-purchase:'||p_idempotency_key);
 if p_payment_method='card' then
   select id into invoice_id from public.card_invoices where card_id=payment_card.id and status='open' order by created_at desc limit 1 for update;
   if invoice_id is null then
     insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status)
     values(payment_card.id,auth.uid(),current_date+30,current_date+40,total,'open') returning id into invoice_id;
   else update public.card_invoices set amount=amount+total,updated_at=clock_timestamp() where id=invoice_id; end if;
   insert into public.card_invoice_items(invoice_id,transaction_id,description,amount) values(invoice_id,t,'Compra: '||p.name,total);
 end if;
 return jsonb_build_object('success',true,'message','Compra concluída.','transaction_id',t,'order_id',o,'total',total,'tax',tax);
end; $function$
;
CREATE OR REPLACE FUNCTION private.pay_residence_lease(p_lease_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.residence_leases%rowtype; r public.citizen_residences%rowtype; a public.accounts%rowtype; receiver uuid; e public.state_enterprises%rowtype; t uuid; q jsonb; total numeric; net numeric; due timestamptz; k uuid;
begin
 select * into l from public.residence_leases where id=p_lease_id for update;
 if l.id is null or l.status not in('active','arrears') or (l.periods_paid>0 and l.paid_until>now()) then return false;end if;
 if l.periods_paid>=l.max_periods then update public.residence_leases set status='ended',ended_at=now(),updated_at=now() where id=l.id;return false;end if;
 select * into r from public.citizen_residences where id=l.residence_id;
 select * into a from public.accounts where user_id=l.tenant_id;
 if l.state_enterprise_id is not null then
  select * into e from public.state_enterprises where id=l.state_enterprise_id;
  if e.is_privatized then select bank_account_id into receiver from public.businesses where id=e.operating_business_id;end if;
 else select id into receiver from public.accounts where user_id=l.landlord_id;end if;
 if a.id is null or (receiver is null and (l.state_enterprise_id is null or e.is_privatized)) then raise exception 'Não foi possível identificar a conta do contrato.';end if;
 perform id from public.accounts where id in(a.id,receiver) order by id for update;
 select * into a from public.accounts where id=a.id;
 q:=public.quote_legal_levies('purchase',l.price,false,null,'Moradia',NULL,r.state);total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 if (q->>'restricted')::boolean or a.balance<total then
  if l.status<>'arrears' then insert into public.notifications(user_id,type,content,link) values(l.tenant_id,'housing_rent_due','Seu aluguel está pendente. Confira o saldo e as regras vigentes para regularizar o contrato.','/services/national-housing');end if;
  update public.residence_leases set status='arrears',updated_at=now() where id=l.id;
  return false;
 end if;
 due:=greatest(l.paid_until,clock_timestamp());
 k:=md5('residence-rent:'||l.id||':'||l.periods_paid)::uuid;
 update public.accounts set balance=balance-total,updated_at=now() where id=a.id;
 if receiver is not null then update public.accounts set balance=balance+net,updated_at=now() where id=receiver;end if;
 update public.government_finances set treasury_balance=treasury_balance+case when receiver is null then total else total-net end,updated_at=now() where id=1;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key)
 values(a.id,receiver,l.price,'residence_rent','Aluguel: '||r.name,q||jsonb_build_object('lease_id',l.id,'residence_id',r.id,'tenant_id',l.tenant_id,'landlord_id',l.landlord_id,'period',l.periods_paid+1,'period_start',due,'period_end',due+make_interval(days=>l.period_days)),k) returning id into t;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',t::text,l.tenant_id,total-net,public.rp_now(),q);end if;
 if receiver is null then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('other','transactions',t::text,l.tenant_id,net,public.rp_now(),jsonb_build_object('lease_id',l.id));
 elsif e.is_privatized then
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(e.operating_business_id,'revenue',l.price,'Aluguel: '||r.name,jsonb_build_object('transaction_id',t),'rent:'||k);
  if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(e.operating_business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre aluguel',q,'rent-tax:'||k);end if;
 end if;
 update public.residence_leases set paid_until=due+make_interval(days=>l.period_days),periods_paid=periods_paid+1,status='active',updated_at=now() where id=l.id;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION private.register_business_authoritative(p_owner_id uuid, p_business_type_id text, p_company_name text, p_description text, p_idempotency_key uuid)
 RETURNS businesses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account public.accounts%rowtype;
  v_type public.business_types%rowtype;
  v_business public.businesses%rowtype;
  v_fee numeric;
  v_transaction uuid; v_quote jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  select * into v_business from public.businesses where registration_idempotency_key=p_idempotency_key;
  if found then if v_business.owner_id IS DISTINCT FROM p_owner_id then raise exception 'IDEMPOTENCY_KEY_FORBIDDEN'; end if; return v_business; end if;
  if length(btrim(coalesce(p_company_name,'')))<5 or length(btrim(coalesce(p_description,'')))<15 then
    raise exception 'BUSINESS_DETAILS_INCOMPLETE';
  end if;
  select * into v_type from public.business_types where id=p_business_type_id and is_active for share;
  if not found then raise exception 'BUSINESS_TYPE_NOT_AVAILABLE'; end if;
  perform public.process_due_legal_effects();
  select * into v_account from public.accounts where user_id=p_owner_id for update;
  if not found then raise exception 'BANK_ACCOUNT_REQUIRED'; end if;
  v_quote:=public.quote_legal_levies('license',0,true,v_type.economic_sector_id,p_business_type_id,NULL,(SELECT residence_state_code FROM public.profiles WHERE id=p_owner_id));
  if (v_quote->>'restricted')::boolean then raise exception 'ACTIVITY_RESTRICTED_BY_LAW'; end if;
  v_fee:=(v_quote->>'buyer_tax')::numeric;
  if v_account.balance<v_fee then raise exception 'INSUFFICIENT_BALANCE'; end if;

  insert into public.government_finances(id) values(1) on conflict(id) do nothing;
  insert into public.businesses(
    owner_id,business_type_id,name,description,status,employees,monthly_revenue,
    bank_account_id,registration_idempotency_key,economic_sector_id
  ) values(
    p_owner_id,p_business_type_id,btrim(p_company_name),btrim(p_description),'active',
    0,0,v_account.id,p_idempotency_key,v_type.economic_sector_id
  ) returning * into v_business;
  update public.accounts set balance=balance-v_fee,updated_at=clock_timestamp() where id=v_account.id;
  update public.government_finances set treasury_balance=treasury_balance+v_fee,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,amount,description,type,metadata,idempotency_key)
  values(v_account.id,v_fee,'Taxa de registro empresarial: '||v_business.name,'service_fee',
    jsonb_build_object('business_id',v_business.id,'business_type_id',p_business_type_id,'fee_type','business_registration','treasury_credit',true)||v_quote,
    p_idempotency_key) returning id into v_transaction;
  insert into public.business_transactions(business_id,type,amount,description)
  values(v_business.id,'registration',-v_fee,'Taxa de registro: '||v_business.name);
  if v_fee>0 then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata)
  values('fee','transactions',v_transaction::text,p_owner_id,v_business.id,v_fee,public.rp_now(),jsonb_build_object('kind','business_registration')); end if;
  insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key,status,processed_at)
  values('business_registered','economy','businesses',v_business.id,p_owner_id,
    jsonb_build_object('businessName',v_business.name,'fee',v_fee,'transactionId',v_transaction),
    'business-registration:'||p_idempotency_key,'processed',clock_timestamp());
  return v_business;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.regularize_population_company(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype;kind public.business_types%rowtype;doc uuid;fee numeric;quote jsonb;cash numeric;
begin
 select * into b from public.businesses where id=p_business_id and control_kind='population' for update;
 if b.id is null or b.cnpj_document_id is not null then return;end if;
 select * into kind from public.business_types where id=b.business_type_id;
 quote:=public.quote_legal_levies('license',0,true,kind.economic_sector_id,kind.id,NULL,b.region_code);
 if (quote->>'restricted')::boolean then return;end if;
 fee:=(quote->>'buyer_tax')::numeric;select balance into cash from public.accounts where id=b.bank_account_id for update;
 if cash<fee then return;end if;
 insert into public.documents(user_id,type,document_number,is_valid,full_name,metadata) values(null,'CNPJ',public.generate_unique_document_number('CNPJ'),true,b.name,jsonb_build_object('entity_kind','population_company','business_id',b.id,'business_type_id',kind.id,'activity_name',kind.name,'company_name',b.name)) returning id into doc;
 update public.businesses set cnpj_document_id=doc,metadata=metadata||jsonb_build_object('cnpj_regularization_required',false) where id=b.id;
 if fee>0 then
  update public.accounts set balance=balance-fee,updated_at=now() where id=b.bank_account_id;
  update public.government_finances set treasury_balance=treasury_balance+fee,updated_at=now() where id=1;
  insert into public.transactions(from_account_id,amount,type,description,metadata) values(b.bank_account_id,fee,'service_fee','Regularização da empresa da população',quote||jsonb_build_object('business_id',b.id,'treasury_credit',true));
  insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'tax',-fee,'Licenciamento da empresa da população',quote,'population-registration');
 end if;
end $function$
;
CREATE OR REPLACE FUNCTION private.trade_company_resource(p_buyer uuid, p_seller uuid, p_resource text, p_quantity numeric, p_max_price numeric, p_key uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.businesses%rowtype; s public.businesses%rowtype; stock public.business_inventory%rowtype; a public.accounts%rowtype; q jsonb; total numeric; net numeric; amount numeric; order_row public.business_supply_orders%rowtype; tx uuid;
begin
 if p_buyer is null or p_seller is null or p_buyer=p_seller or p_key is null or p_quantity is null or p_quantity<=0 or p_quantity>1000000 or p_quantity<>round(p_quantity,3) or p_max_price is null or p_max_price<=0 then raise exception 'Confira as empresas, quantidade e preço máximo do fornecimento.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into order_row from public.business_supply_orders where idempotency_key=p_key;
 if found then
  if order_row.buyer_business_id<>p_buyer or order_row.seller_business_id<>p_seller or order_row.actor_id is distinct from p_actor or order_row.resource_code<>p_resource or order_row.quantity<>p_quantity then raise exception 'Esta identificação já pertence a outro fornecimento.';end if;
  return to_jsonb(order_row);
 end if;
 perform id from public.businesses where id in(p_buyer,p_seller) order by id for update;
 select * into b from public.businesses where id=p_buyer and status='active';select * into s from public.businesses where id=p_seller and status='active';
 if b.id is null or s.id is null then raise exception 'Comprador e fornecedor precisam estar ativos.';end if;
 select * into stock from public.business_inventory where business_id=s.id and resource_code=p_resource for update;
 if stock.resource_code is null or not stock.available_for_sale or stock.quantity<p_quantity or stock.selling_price is null or stock.selling_price>p_max_price then raise exception 'O preço ou estoque do fornecedor mudou. Confira a oferta.';end if;
 amount:=round(stock.selling_price*p_quantity,2);
 q:=public.quote_legal_levies('purchase',amount,true,s.economic_sector_id,'Insumos',NULL,s.region_code);
 if (q->>'restricted')::boolean then raise exception 'Fornecimento restrito por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 perform id from public.accounts where id in(b.bank_account_id,s.bank_account_id) order by id for update;
 select * into a from public.accounts where id=b.bank_account_id;
 if a.balance<total then raise exception 'O caixa da empresa não cobre este fornecimento.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=b.bank_account_id;
 update public.accounts set balance=balance+net,updated_at=now() where id=s.bank_account_id;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 update public.business_inventory set quantity=quantity-p_quantity,updated_at=now() where business_id=s.id and resource_code=p_resource;
 insert into public.business_inventory(business_id,resource_code,quantity,unit_cost) values(b.id,p_resource,p_quantity,total/p_quantity)
 on conflict(business_id,resource_code) do update set unit_cost=(public.business_inventory.quantity*public.business_inventory.unit_cost+total)/(public.business_inventory.quantity+p_quantity),quantity=public.business_inventory.quantity+p_quantity,updated_at=now();
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(b.bank_account_id,s.bank_account_id,amount,'business_supply','Fornecimento: '||s.name||' → '||b.name,q||jsonb_build_object('buyer_business_id',b.id,'seller_business_id',s.id,'resource_code',p_resource,'quantity',p_quantity),p_key) returning id into tx;
 insert into public.business_supply_orders(buyer_business_id,seller_business_id,resource_code,quantity,unit_price,total,tax_snapshot,transaction_id,actor_id,idempotency_key) values(b.id,s.id,p_resource,p_quantity,stock.selling_price,total,q,tx,p_actor,p_key) returning * into order_row;
 insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(b.id,'other',-total,'Aquisição de insumos: '||p_resource,jsonb_build_object('kind','inventory_purchase','transaction_id',tx),'supply-buyer:'||p_key),(s.id,'revenue',amount,'Fornecimento para '||b.name,jsonb_build_object('kind','b2b_sale','transaction_id',tx),'supply-seller:'||p_key);
 if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key) values(s.id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre fornecimento',q,'supply-tax:'||p_key);end if;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,p_actor,s.id,total-net,public.rp_now(),q);end if;
 return to_jsonb(order_row);
end $function$
;
CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource public.economic_resources%rowtype; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric; resource_count integer; player_count integer; npc_count integer;
begin
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select count(*) into resource_count from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles');
 for resource in select * from public.economic_resources where is_service or code in('energy','food','drinks','bread','meals','retail_food','retail_electronics','retail_clothing','retail_medicine','retail_vehicles') order by code loop
  budget:=total_budget/greatest(resource_count,1);
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  select sum((.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active';
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.region_code,b.owner_id,b.name,b.control_kind,(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)*case when player_count=0 or npc_count=0 then 1 else case when b.control_kind='player' then coalesce(macro.player_share,.2)/player_count else coalesce(macro.simulated_share,.8)/npc_count end end score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' order by b.id for update of i loop
   v_quantity:=least(offer.quantity,trunc(budget*offer.score/greatest(score_sum,.00001)/offer.selling_price/1.25,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   if (q->>'restricted')::boolean then continue;end if;
   total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
   select * into population from public.accounts where account_kind='population';
   if total>population.balance or spent+total>total_budget then continue;end if;
   update public.accounts set balance=balance-total,updated_at=now() where id=population.id;
   update public.accounts set balance=balance+net,updated_at=now() where id=offer.bank_account_id;
   update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
   update public.business_inventory set quantity=public.business_inventory.quantity-v_quantity,updated_at=now() where business_id=offer.business_id and resource_code=resource.code;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(population.id,offer.bank_account_id,amount,'population_purchase','Consumo da população: '||offer.name,q||jsonb_build_object('business_id',offer.business_id,'resource_code',resource.code,'quantity',v_quantity,'operation_date',p_day),md5('population-demand:'||p_day||':'||offer.business_id||':'||resource.code)::uuid) returning id into tx;
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'revenue',amount,'Venda para a população: '||resource.name,jsonb_build_object('kind','population_sale','transaction_id',tx,'quantity',v_quantity),'population-sale:'||p_day||':'||resource.code,p_day);
   if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre consumo da população',q,'population-tax:'||p_day||':'||resource.code,p_day);end if;
   if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,offer.business_id,total-net,public.rp_now(),q);end if;
   update public.business_daily_operations set sold_quantity=sold_quantity+v_quantity,revenue=revenue+amount where business_id=offer.business_id and operation_date=p_day;
   spent:=spent+total;
  end loop;
 end loop;
 insert into private.population_demand_runs(operation_date,spent) values(p_day,spent);
 return spent;
end $function$
;
CREATE OR REPLACE FUNCTION public.buy_residence(p_residence_id uuid, p_expected_price numeric, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.citizen_residences%rowtype; a public.accounts%rowtype; receiver uuid; t public.transactions%rowtype; q jsonb; total numeric; net numeric;
begin
 perform private.assert_citizen_service('/services/national-housing');
 if p_idempotency_key is null then raise exception 'Identifique a operação de compra.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
 select * into t from public.transactions where idempotency_key=p_idempotency_key;
 if found then
  if t.metadata->>'buyer_id' is distinct from auth.uid()::text or t.metadata->>'residence_id' is distinct from p_residence_id::text or t.type<>'residence_sale' then raise exception 'Esta identificação já pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'transaction_id',t.id);
 end if;
 select * into r from public.citizen_residences where id=p_residence_id for update;
 if r.id is null or r.listing_mode<>'sale' or r.asking_price is distinct from p_expected_price then raise exception 'O anúncio mudou. Confira o preço atual antes de comprar.';end if;
 if r.owner_id=auth.uid() or r.owner_id is null then raise exception 'Esta compra não está disponível.';end if;
 if exists(select 1 from public.residence_leases where residence_id=r.id and status<>'ended') then raise exception 'Este imóvel possui um contrato de aluguel em andamento.';end if;
 select id into receiver from public.accounts where user_id=r.owner_id;
 select * into a from public.accounts where user_id=auth.uid();
 if receiver is null or a.id is null then raise exception 'Comprador e vendedor precisam ter conta bancária.';end if;
 perform id from public.accounts where id in(a.id,receiver) order by id for update;
 select * into a from public.accounts where id=a.id;
 q:=public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia',NULL,r.state);
 if (q->>'restricted')::boolean then raise exception 'Esta operação está restrita por norma vigente.';end if;
 total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
 if a.balance<total then raise exception 'Saldo insuficiente para comprar o imóvel e pagar os tributos.';end if;
 update public.accounts set balance=balance-total,updated_at=now() where id=a.id;
 update public.accounts set balance=balance+net,updated_at=now() where id=receiver;
 update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
 insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(a.id,receiver,r.asking_price,'residence_sale','Compra de imóvel: '||r.name,q||jsonb_build_object('buyer_id',auth.uid(),'seller_id',r.owner_id,'residence_id',r.id),p_idempotency_key) returning * into t;
 if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,actor_profile_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',t.id::text,auth.uid(),total-net,public.rp_now(),q);end if;
 update public.citizen_residences set owner_id=auth.uid(),listing_mode='none',asking_price=null,listed_at=null,purchase_price=r.asking_price,transaction_id=t.id,acquired_at=now(),status='owned' where id=r.id;
 update public.user_inventory set user_id=auth.uid(),metadata=coalesce(metadata,'{}')||jsonb_build_object('transaction_id',t.id,'previous_owner_id',r.owner_id) where id=r.inventory_id;
 insert into public.notifications(user_id,type,content,link) values(r.owner_id,'housing_sold','Seu imóvel '||r.name||' foi vendido. O valor líquido foi creditado na sua conta.','/services/national-housing'),(auth.uid(),'housing_acquired','Você adquiriu '||r.name||'.','/services/national-housing');
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('residence_sold','economy','citizen_residences',r.id,auth.uid(),jsonb_build_object('previous_owner_id',r.owner_id,'transaction_id',t.id),'residence-sale:'||p_idempotency_key);
 return jsonb_build_object('success',true,'transaction_id',t.id);
end $function$
;
CREATE OR REPLACE FUNCTION public.get_products_with_final_price()
 RETURNS TABLE(id uuid, seller_id uuid, name text, description text, price numeric, image_url text, created_at timestamp with time zone, product_type text, subscription_interval text, subscription_price numeric, metadata jsonb, category text, stock integer, promotion_price numeric, promotion_expires_at timestamp with time zone, sales_count integer, subscribers_count integer, tax_rate numeric, final_price numeric, seller json)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select product.id,product.seller_id,product.name,product.description,product.price,product.image_url,product.created_at,
    product.product_type,product.subscription_interval,product.subscription_price,coalesce(product.metadata,'{}')||jsonb_build_object('stock_depleted_at',product.stock_depleted_at,'quote',levy.value,'consumable_effects',product.consumable_effects),product.category,product.stock,
    product.promotion_price,product.promotion_expires_at,product.sales_count,product.subscribers_count,
    case when price_data.base>0 then (levy.value->>'buyer_tax')::numeric/price_data.base else 0 end,
    (levy.value->>'total_debited')::numeric,
    json_build_object('id',seller.id,'full_name',seller.full_name,'x_handle',seller.x_handle,'role',seller.role,
      'seller_type',product.seller_type,'business_id',business.id,'business_name',business.name,'business_status',business.status,'business_logo_url',business.logo_url,'business_font_key',business.font_key,'business_brand_color',business.brand_color,'activity_restricted',(levy.value->>'restricted')::boolean,
      'documents',(select json_agg(json_build_object('type',document.type,'document_number',document.document_number,'metadata',json_build_object('company_name',business.name))) from public.documents document where document.user_id=seller.id and document.type='CNPJ' and document.metadata->>'business_id'=business.id::text))
  from public.products product
  join public.profiles seller on seller.id=product.seller_id
  left join public.businesses business on business.id=product.business_id
  cross join lateral (select case when product.promotion_price is not null and product.promotion_expires_at>statement_timestamp() then product.promotion_price else product.price end AS base) price_data
  cross join lateral (select public.quote_legal_levies('purchase',price_data.base,product.business_id is not null,coalesce(product.economic_sector_id,business.economic_sector_id),product.category,NULL,coalesce(business.region_code,seller.residence_state_code)) AS value) levy
  where seller.deleted_at is null and product.archived_at is null and product.moderation_status='approved' and exists(select 1 from public.state_enterprises ms where ms.service_key='marketplace' and ms.is_active and (not (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_enabled or (private.marketplace_seller_policy(ms,product.business_id,true)).active_listing_fee_amount=0 or (product.listing_status='active' and (product.listing_paid_until is null or product.listing_paid_until>statement_timestamp()))))
    and (seller.onboarding_completed or seller.onboarding_mode='legacy_migration')
    and (product.business_id is null or business.status='active')
  order by product.created_at desc, product.id desc
$function$
;
CREATE OR REPLACE FUNCTION public.get_residence_market()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'image_url',r.image_url,'name',r.name,'city',r.city,'state',r.state,'area_sqm',r.area_sqm,'rooms',r.rooms,'quality',r.quality,'hygiene_recovery',r.hygiene_recovery,'sleep_minutes',r.sleep_minutes,'listing_mode',r.listing_mode,'asking_price',r.asking_price,'rent_period_days',r.rent_period_days,'owner_id',r.owner_id,'state_enterprise_id',r.state_enterprise_id,'rent_quote',public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia',NULL,r.state),'quote',public.quote_legal_levies('purchase',r.asking_price,false,null,'Moradia',NULL,r.state)) order by r.state,r.asking_price),'[]'::jsonb)
 from public.citizen_residences r where auth.uid() is not null and r.listing_mode<>'none' and r.asking_price>0 and not exists(select 1 from public.residence_leases l where l.residence_id=r.id and l.status<>'ended')
$function$
;
CREATE OR REPLACE FUNCTION public.get_state_citizen_offers(p_housing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Autenticação necessária.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('rent_quote',case when p.residence_spec is not null then public.quote_legal_levies('purchase',coalesce((p.residence_spec->>'rent_price')::numeric,0),false,null,'Moradia',NULL,p.residence_spec->>'state') end,'quote',public.quote_legal_levies('purchase',p.price,s.is_privatized,p.economic_sector_id,p.category,NULL,coalesce(p.residence_spec->>'state',(SELECT region_code FROM public.businesses WHERE id=s.operating_business_id)))) order by p.price),'[]') into result
 from public.products p join public.state_enterprises s on s.id=p.state_enterprise_id
 where s.is_active and p.archived_at is null and p.moderation_status='approved' and (p.residence_spec is not null)=p_housing;
 return result;
end; $function$
;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.create_repost(p_post_id uuid,p_quote_content text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); original public.posts%rowtype; handle text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Entre na sua conta para repostar.' USING errcode='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('repost:'||actor||':'||p_post_id,0));
 SELECT * INTO original FROM public.posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Esta publicação foi removida.'; END IF;
 IF original.original_post_id IS NOT NULL THEN RAISE EXCEPTION 'Abra a publicação original para repostar.'; END IF;
 IF EXISTS(SELECT 1 FROM public.posts WHERE original_post_id=p_post_id AND user_id=actor) THEN RETURN; END IF;
 INSERT INTO public.posts(user_id,content,quote_content,original_post_id) VALUES(actor,'repost',nullif(trim(p_quote_content),''),p_post_id);
 UPDATE public.posts SET reposts_count=(SELECT count(*) FROM public.posts WHERE original_post_id=p_post_id) WHERE id=p_post_id;
 IF actor<>original.user_id THEN
  SELECT coalesce(x_handle,username,'cidadão') INTO handle FROM public.profiles WHERE id=actor;
  INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata) VALUES(original.user_id,actor,'x_repost','@'||handle||' repostou sua publicação.','/services/x',jsonb_build_object('post_id',p_post_id));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_repost(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_repost(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.guard_repost_uniqueness() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.original_post_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('repost:'||NEW.user_id||':'||NEW.original_post_id,0));
  IF EXISTS(SELECT 1 FROM public.posts WHERE original_post_id=NEW.original_post_id AND user_id=NEW.user_id AND id<>NEW.id) THEN RAISE EXCEPTION 'Você já repostou esta publicação.'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_repost_uniqueness() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER repost_unique_per_author BEFORE INSERT OR UPDATE OF original_post_id,user_id ON public.posts FOR EACH ROW EXECUTE FUNCTION private.guard_repost_uniqueness();

CREATE INDEX party_donation_period_lookup ON public.party_treasury_entries(party_id,actor_id,created_at) WHERE kind='donation';
CREATE OR REPLACE FUNCTION public.process_legal_benefits() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; recipient record; spent numeric; balance numeric; tx uuid; total integer:=0;
BEGIN
 PERFORM public.process_due_legal_effects();
 FOR r IN SELECT * FROM public.government_rules WHERE rule_kind='benefit' AND is_active AND valid_from<=clock_timestamp() AND valid_until>clock_timestamp() ORDER BY rule_key FOR UPDATE LOOP
  SELECT coalesce(sum(amount),0) INTO spent FROM public.transactions WHERE type='government_benefit' AND metadata->>'benefit_rule_key'=r.rule_key;
  FOR recipient IN
   SELECT p.id notify_id,p.id beneficiary_id,NULL::uuid business_id,a.id account_id,p.created_at eligible_at
   FROM public.profiles p JOIN public.accounts a ON a.user_id=p.id AND a.account_kind='personal'
   WHERE p.deleted_at IS NULL AND p.onboarding_completed AND coalesce(r.definition->>'audience','all') IN('all','citizen')
    AND (NOT r.definition ? 'eligible_balance_max' OR a.balance<=(r.definition->>'eligible_balance_max')::numeric)
    AND (NOT r.definition ? 'region_codes' OR coalesce(r.definition->'region_codes' ? p.residence_state_code,false))
    AND (NOT r.definition ? 'sector_id' OR EXISTS(SELECT 1 FROM public.businesses b WHERE b.owner_id=p.id AND b.status='active' AND b.economic_sector_id=(r.definition->>'sector_id')::uuid))
    AND NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.type='government_benefit' AND t.metadata->>'benefit_rule_key'=r.rule_key AND t.metadata->>'beneficiary_id'=p.id::text)
   UNION ALL
   SELECT b.owner_id,b.id,b.id,a.id,b.created_at FROM public.businesses b JOIN public.accounts a ON a.id=b.bank_account_id AND a.account_kind='business'
   WHERE b.status='active' AND r.definition->>'audience'='business'
    AND (NOT r.definition ? 'eligible_balance_max' OR a.balance<=(r.definition->>'eligible_balance_max')::numeric)
    AND (NOT r.definition ? 'sector_id' OR b.economic_sector_id=(r.definition->>'sector_id')::uuid)
    AND (NOT r.definition ? 'region_codes' OR coalesce(r.definition->'region_codes' ? b.region_code,false))
    AND NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.type='government_benefit' AND t.metadata->>'benefit_rule_key'=r.rule_key AND (t.metadata->>'beneficiary_id'=b.id::text OR (NOT t.metadata ? 'beneficiary_type' AND t.metadata->>'beneficiary_id'=b.owner_id::text)))
   ORDER BY eligible_at,beneficiary_id LIMIT 100
  LOOP
   EXIT WHEN spent+r.numeric_value>(r.definition->>'budget')::numeric;
   SELECT a.balance INTO balance FROM public.accounts a WHERE a.id=recipient.account_id FOR UPDATE;
   IF NOT FOUND OR (r.definition ? 'eligible_balance_max' AND balance>(r.definition->>'eligible_balance_max')::numeric) THEN CONTINUE; END IF;
   SELECT treasury_balance INTO balance FROM public.government_finances WHERE id=1 FOR UPDATE;
   EXIT WHEN balance IS NULL OR balance<r.numeric_value;
   UPDATE public.government_finances SET treasury_balance=treasury_balance-r.numeric_value,updated_at=clock_timestamp() WHERE id=1;
   UPDATE public.accounts SET balance=public.accounts.balance+r.numeric_value,updated_at=clock_timestamp() WHERE id=recipient.account_id;
   INSERT INTO public.transactions(to_account_id,amount,type,description,metadata) VALUES(recipient.account_id,r.numeric_value,'government_benefit',r.description,jsonb_build_object('benefit_rule_key',r.rule_key,'beneficiary_id',recipient.beneficiary_id,'beneficiary_type',CASE WHEN recipient.business_id IS NULL THEN 'citizen' ELSE 'business' END,'legal_source_id',r.source_id,'rule_version',r.version,'legal_snapshot',to_jsonb(r),'gross_amount',r.numeric_value,'net_amount',r.numeric_value,'tax_amount',0)) RETURNING id INTO tx;
   IF recipient.business_id IS NOT NULL THEN INSERT INTO public.business_transactions(business_id,amount,type,description,metadata,operation_key) VALUES(recipient.business_id,r.numeric_value,'other',r.description,jsonb_build_object('kind','government_subsidy','transaction_id',tx,'legal_rule_key',r.rule_key),'benefit:'||r.rule_key||':'||recipient.business_id); END IF;
   IF recipient.notify_id IS NOT NULL THEN INSERT INTO public.notifications(user_id,type,content,link,metadata) VALUES(recipient.notify_id,'government_benefit',CASE WHEN recipient.business_id IS NULL THEN 'Você recebeu o benefício: ' ELSE 'O caixa da sua empresa recebeu o benefício: ' END||r.description,CASE WHEN recipient.business_id IS NULL THEN '/services/bank' ELSE '/services/companies/'||recipient.business_id END,jsonb_build_object('transaction_id',tx,'business_id',recipient.business_id)); END IF;
   INSERT INTO public.domain_events(event_type,source_domain,source_table,source_id,payload,idempotency_key) VALUES('legal_benefit_paid','economy','transactions',tx,jsonb_build_object('ruleKey',r.rule_key,'amount',r.numeric_value,'business_id',recipient.business_id),'legal-benefit:'||tx);
   spent:=spent+r.numeric_value;total:=total+1;
  END LOOP;
 END LOOP;
 RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.quote_party_registration(p_ideology text,p_orientation text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.government_rules%rowtype; fee numeric:=0; rules jsonb:='[]'; restrictions jsonb:='[]';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para consultar o registro partidário.' USING errcode='42501'; END IF;
 FOR r IN SELECT * FROM public.government_rules WHERE is_active AND rule_kind='regulation' AND valid_from<=clock_timestamp() AND (valid_until IS NULL OR valid_until>clock_timestamp()) AND definition->>'operation' IN('party_registration_fee','party_registration_restriction') ORDER BY rule_key LOOP
  IF NOT private.normative_scope_applies(r.definition,p_ideology,p_orientation) THEN CONTINUE; END IF;
  IF r.definition->>'operation'='party_registration_restriction' THEN restrictions:=restrictions||jsonb_build_array(r.description);
  ELSE fee:=fee+r.numeric_value;rules:=rules||jsonb_build_array(to_jsonb(r)); END IF;
 END LOOP;
 RETURN jsonb_build_object('fee',fee,'restricted',jsonb_array_length(restrictions)>0,'restrictions',restrictions,'rules',rules,'quoted_at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION public.quote_party_registration(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.quote_party_registration(text,text) TO authenticated;
CREATE OR REPLACE FUNCTION private.guard_party_legal_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE quote jsonb; fee numeric; a public.accounts%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('party-foundation:'||NEW.founder_id,0));
 IF EXISTS(SELECT 1 FROM public.party_members WHERE user_id=NEW.founder_id) THEN RAISE EXCEPTION 'Você já está filiado a um partido. Desfilie-se antes de fundar outro.'; END IF;
 quote:=public.quote_party_registration(NEW.ideology,NEW.orientation::text);
 IF (quote->>'restricted')::boolean THEN RAISE EXCEPTION 'A fundação deste partido está restrita pela norma vigente: %.',quote->'restrictions'->>0; END IF;
 fee:=(quote->>'fee')::numeric;
 IF fee>0 THEN
  SELECT * INTO a FROM public.accounts WHERE user_id=NEW.founder_id AND account_kind='personal' FOR UPDATE;
  IF NOT FOUND OR a.balance<fee THEN RAISE EXCEPTION 'Saldo pessoal insuficiente para a taxa de fundação de %.',public.format_currency_brl(fee); END IF;
  UPDATE public.accounts SET balance=balance-fee,updated_at=clock_timestamp() WHERE id=a.id;
  UPDATE public.government_finances SET treasury_balance=treasury_balance+fee,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.transactions(from_account_id,amount,type,description,metadata) VALUES(a.id,fee,'party_registration_fee','Taxa de fundação: '||NEW.name,jsonb_build_object('party_id',NEW.id,'party_snapshot',jsonb_build_object('name',NEW.name,'acronym',NEW.acronym,'ideology',NEW.ideology,'orientation',NEW.orientation::text),'legal_snapshot',quote->'rules','gross_amount',0,'tax_amount',fee,'total_debited',fee,'net_amount',0));
 END IF;
 RETURN NEW;
END $$;

NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.get_company_rankings()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Entre para consultar o ranking.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select b.id,b.business_type_id,t.name AS activity,b.name,b.region_code,b.control_kind,coalesce(o.current_unit_price*o.total_shares,b.market_value) as market_value,case when o.previous_close>0 then (o.current_unit_price/o.previous_close-1)*100 else null end as variation,b.size_class,b.logo_url,b.brand_color,t.name as sector,coalesce(fin.revenue,0) revenue,coalesce(fin.profit,0) profit,(select count(*) from public.business_employees e where e.business_id=b.id and e.fired_at is null) jobs,(select coalesce(sum(produced_quantity),0) from public.business_daily_operations d where d.business_id=b.id and d.operation_date>=current_date-6) production from public.businesses b left join public.investment_options o on o.business_id=b.id and o.asset_type='stock' and o.is_active join public.business_types t on t.id=b.business_type_id left join lateral(select sum(amount) filter(where type='revenue') revenue,sum(amount) filter(where type in('revenue','expense','tax')) profit from public.business_transactions where business_id=b.id and accounting_date>=current_date-6) fin on true where b.status='active' order by coalesce(o.current_unit_price*o.total_shares,b.market_value) desc,b.id limit 500) r);
end $function$
;
CREATE OR REPLACE FUNCTION public.issue_document(p_request_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    request record;
    new_doc_number text;
    doc_fee numeric := 0.00; -- Taxa pode ser ajustada aqui ou em uma tabela de configurações
    user_account record; quote jsonb;
BEGIN
    -- Apenas admins podem executar
    IF NOT public.is_admin() THEN
        RETURN json_build_object('success', false, 'message', 'Acesso não autorizado.');
    END IF;

    SELECT * INTO request FROM public.document_requests WHERE id = p_request_id FOR UPDATE;

    IF request IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Solicitação não encontrada.');
    END IF;

    IF request.status <> 'Pendente' THEN
        RETURN json_build_object('success', false, 'message', 'Esta solicitação já foi processada.');
    END IF;

    -- Verificar se o usuário tem saldo para a taxa
    PERFORM public.process_due_legal_effects();
    quote:=public.quote_legal_levies('document',0,false,NULL,NULL,request.document_type,(SELECT residence_state_code FROM public.profiles WHERE id=request.user_id));
    doc_fee:=(quote->>'buyer_tax')::numeric;
    SELECT * INTO user_account FROM public.accounts WHERE user_id = request.user_id FOR UPDATE;
    IF user_account IS NULL THEN
        UPDATE public.document_requests SET status = 'Recusado' WHERE id = p_request_id;
        RETURN json_build_object('success', false, 'message', 'Usuário não possui conta bancária para pagar a taxa.');
    END IF;

    IF user_account.balance < doc_fee THEN
        UPDATE public.document_requests SET status = 'Recusado' WHERE id = p_request_id;
        RETURN json_build_object('success', false, 'message', 'Saldo insuficiente para pagar a taxa de emissão.');
    END IF;

    -- Gerar número único
    new_doc_number := public.generate_unique_document_number(request.document_type);

    -- Inserir novo documento
    INSERT INTO public.documents (user_id, type, document_number, issued_at, expires_at, is_valid)
    VALUES (
        request.user_id,
        request.document_type,
        new_doc_number,
        now(),
        CASE
            WHEN request.document_type = 'CNH' THEN now() + interval '5 years'
            WHEN request.document_type = 'Passport' THEN now() + interval '10 years'
            ELSE NULL
        END,
        true
    );

    -- Debitar taxa
    IF doc_fee > 0 THEN
        UPDATE public.accounts SET balance = balance - doc_fee WHERE id = user_account.id;
        INSERT INTO public.transactions (from_account_id, amount, description, type, metadata)
        VALUES (user_account.id, doc_fee, 'Taxa de emissão de ' || request.document_type, 'service_fee',quote);
        INSERT INTO public.government_finances(id) VALUES(1) ON CONFLICT DO NOTHING;
        UPDATE public.government_finances SET treasury_balance=treasury_balance+doc_fee WHERE id=1;
    END IF;

    -- Atualizar status da solicitação
    UPDATE public.document_requests SET status = 'Aprovado' WHERE id = p_request_id;

    -- Notificar usuário
    INSERT INTO public.notifications (user_id, type, content, link)
    VALUES (request.user_id, 'document_issued', 'Seu documento ' || request.document_type || ' foi emitido com sucesso!', '/services/dic');

    RETURN json_build_object('success', true, 'message', 'Documento emitido com sucesso.');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_repost(p_original_post_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Entre para desfazer a republicação.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('repost:'||auth.uid()::text||':'||p_original_post_id::text,0));
 DELETE FROM public.posts WHERE original_post_id=p_original_post_id AND user_id=auth.uid();
 UPDATE public.posts SET reposts_count=(SELECT count(*) FROM public.posts WHERE original_post_id=p_original_post_id) WHERE id=p_original_post_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_repost(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_repost(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.update_bill_status(p_bill_id uuid,p_new_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); bill public.bills%rowtype; voting public.parliament_votings%rowtype; finalized jsonb; qualified boolean; houses integer;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING errcode='42501'; END IF;
 SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILL_NOT_FOUND'; END IF;
 IF bill.type='IMPEACHMENT' THEN RAISE EXCEPTION 'O impeachment é decidido pela votação institucional da Câmara.'; END IF;
 IF bill.type='PDL' AND bill.suspends_decree_id IS NOT NULL THEN RAISE EXCEPTION 'A sustação é decidida pela votação legislativa, sem sanção presidencial.'; END IF;
 qualified:=bill.type IN('PEC','Proposta de Emenda Constitucional');
 IF p_new_status IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Rejeitado') THEN
  IF NOT(public.is_parliament_governance_manager(actor,bill.house_id) OR public.get_active_parliament_member_id(actor,bill.house_id) IS NOT NULL) THEN RAISE EXCEPTION 'PARLIAMENT_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  SELECT * INTO voting FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILL_VOTING_NOT_FOUND'; END IF;
  finalized:=private.finalize_parliament_bill_voting(voting.id);
  IF NOT coalesce((finalized->>'finalized')::boolean,false) THEN RAISE EXCEPTION 'BILL_VOTING_NOT_READY'; END IF;
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id;
  IF bill.status IS DISTINCT FROM p_new_status THEN RAISE EXCEPTION 'O resultado da votação não permite esta transição. Consulte a tramitação atual.'; END IF;
  RETURN;
 ELSIF p_new_status IN('Sancionado','Promulgado','Vetado integralmente','Vetado parcialmente') THEN
  SELECT * INTO bill FROM public.bills WHERE id=p_bill_id FOR UPDATE;
  IF NOT public.economic_has_role(ARRAY['Admin','Presidente']) THEN RAISE EXCEPTION 'EXECUTIVE_AUTHORITY_REQUIRED' USING errcode='42501'; END IF;
  IF bill.status=p_new_status THEN RETURN; END IF;
  IF bill.status NOT IN('Aguardando sanção presidencial','Aguardando promulgação presidencial','Aprovado') THEN RAISE EXCEPTION 'BILL_NOT_AWAITING_EXECUTIVE_DECISION'; END IF;
  IF qualified AND p_new_status<>'Promulgado' THEN RAISE EXCEPTION 'A proposta constitucional aprovada deve ser promulgada após deliberação nas duas Casas.'; END IF;
  IF NOT qualified AND p_new_status='Promulgado' THEN RAISE EXCEPTION 'Escolha sanção ou veto para este projeto de lei.'; END IF;
  SELECT count(DISTINCT house_id) INTO houses FROM public.parliament_votings WHERE related_id=bill.id AND type='bill' AND status='closed' AND coalesce((result->>'approved')::boolean,false);
  IF houses<(CASE WHEN qualified THEN 2 ELSE 1 END) THEN RAISE EXCEPTION 'A medida exige deliberação legislativa concluída e aprovada nas Casas competentes.'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_BILL_STATUS'; END IF;
 UPDATE public.bills SET status=p_new_status,updated_at=clock_timestamp() WHERE id=bill.id;
 IF p_new_status IN('Sancionado','Promulgado') THEN
  INSERT INTO public.dou_entries(title,summary,content,published_at,type,source_id)
  SELECT bill.title,CASE WHEN p_new_status='Sancionado' THEN 'Lei sancionada pela Presidência da República.' ELSE 'Norma promulgada e publicada oficialmente.' END,coalesce(nullif(bill.full_text,''),bill.summary),clock_timestamp(),bill.type,bill.id
  WHERE NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=bill.id);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_bill_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_bill_status(uuid,text) TO authenticated;
COMMIT;
