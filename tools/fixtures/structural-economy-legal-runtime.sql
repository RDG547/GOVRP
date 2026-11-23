-- Existing legal engine, extracted from the repository and checked against the live definition.
ALTER TABLE public.profiles ADD COLUMN residence_state_code text;
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
END $function$;
