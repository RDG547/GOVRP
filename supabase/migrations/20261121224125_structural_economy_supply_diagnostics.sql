BEGIN;
-- Physical stock is shared by direct purchases, contracts and marketplace.
CREATE OR REPLACE FUNCTION private.unreserved_company_stock(p_business uuid,p_resource text,p_day date,p_contract uuid DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT greatest(0,coalesce((SELECT quantity FROM public.business_inventory
  WHERE business_id=p_business AND resource_code=p_resource),0)
 -coalesce((SELECT sum(daily_quantity) FROM public.business_supply_contracts
  WHERE seller_business_id=p_business AND resource_code=p_resource AND status='active'
   AND ends_at>(p_day::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND created_at<((p_day+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND (last_processed_on IS NULL OR last_processed_on<p_day) AND id IS DISTINCT FROM p_contract),0)
 -coalesce((SELECT sum(stock) FROM public.products WHERE business_id=p_business AND resource_code=p_resource
   AND moderation_status='approved' AND archived_at IS NULL AND stock>0),0))
$$;
REVOKE ALL ON FUNCTION private.unreserved_company_stock(uuid,text,date,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.economy_supply_diagnostics()
RETURNS TABLE(resource_code text,resource_name text,required_daily numeric,available_stock numeric,
 supplier_count bigint,productive_capacity numeric,min_price numeric,missing_supplier boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH needs AS (
  SELECT i.key resource_code,sum(i.value::numeric*t.base_daily_capacity) required_daily
  FROM public.businesses b JOIN public.business_types t ON t.id=b.business_type_id
  JOIN public.business_recipes r ON r.business_type_id=b.business_type_id
  CROSS JOIN LATERAL jsonb_each_text(r.inputs) i
  WHERE b.status='active' GROUP BY i.key
 ), offers AS (
  SELECT i.resource_code,sum(private.unreserved_company_stock(b.id,i.resource_code,
   (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date)) available_stock,
   count(DISTINCT b.id) supplier_count,min(i.selling_price) min_price
  FROM public.business_inventory i JOIN public.businesses b ON b.id=i.business_id
  WHERE b.status='active' AND i.available_for_sale AND i.selling_price>0 AND i.quantity>0 GROUP BY i.resource_code
 ), capacity AS (
  SELECT r.output_resource,sum(t.base_daily_capacity*r.output_quantity) productive_capacity
  FROM public.businesses b JOIN public.business_types t ON t.id=b.business_type_id
  JOIN public.business_recipes r ON r.business_type_id=t.id WHERE b.status='active' GROUP BY r.output_resource
 )
 SELECT e.code,e.name,coalesce(n.required_daily,0),coalesce(o.available_stock,0),coalesce(o.supplier_count,0),
  coalesce(c.productive_capacity,0),o.min_price,coalesce(o.supplier_count,0)=0
 FROM public.economic_resources e LEFT JOIN needs n ON n.resource_code=e.code
 LEFT JOIN offers o ON o.resource_code=e.code LEFT JOIN capacity c ON c.output_resource=e.code
 WHERE coalesce(n.required_daily,0)>0 OR coalesce(c.productive_capacity,0)>0
 ORDER BY coalesce(o.available_stock,0)/greatest(coalesce(n.required_daily,0),1),e.code
$$;
REVOKE ALL ON FUNCTION private.economy_supply_diagnostics() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_economic_structural_diagnostics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN
  RAISE EXCEPTION 'Painel restrito à Administração.' USING errcode='42501';
 END IF;
 RETURN jsonb_build_object('checked_at',statement_timestamp(),'calendar','UTC',
  'operational_calendar','America/Sao_Paulo: dia real; salário semanal / 7',
  'supply',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM private.economy_supply_diagnostics() x),
  'companies',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT control_kind,status,count(*) count FROM public.businesses GROUP BY control_kind,status) x),
  'periods',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT p.id,p.rp_year,p.rp_quarter,p.rp_month,p.period_type,p.status,
    economy_private.period_close_readiness(p.id) readiness
   FROM public.economic_periods p WHERE status<>'closed' ORDER BY starts_at_rp LIMIT 36) x),
  'historical_divergences',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT p.id,p.rp_year,p.rp_quarter,i.nominal_value published_gdp,
    e.current_gdp,e.current_gdp-i.nominal_value difference,
    (SELECT count(*) FROM public.economic_periods c WHERE c.period_type='month'
     AND c.starts_at_rp>=p.starts_at_rp AND c.ends_at_rp<=p.ends_at_rp) contained_months
   FROM public.economic_periods p JOIN public.economic_indicators i ON i.period_id=p.id AND i.indicator_code='gdp_nominal'
   CROSS JOIN LATERAL (SELECT coalesce(sum(CASE economic_classification
    WHEN 'gross_output' THEN economic_amount WHEN 'intermediate_consumption' THEN -economic_amount
    WHEN 'product_tax' THEN economic_amount WHEN 'subsidy' THEN -economic_amount ELSE 0 END),0) current_gdp
    FROM public.economic_events WHERE occurred_at_rp>=p.starts_at_rp AND occurred_at_rp<p.ends_at_rp) e
   WHERE p.period_type='quarter' AND p.status='closed' ORDER BY p.starts_at_rp DESC LIMIT 12) x),
  'pending_revisions',(SELECT count(*) FROM economy_private.period_revision_queue WHERE status='pending'),
  'channels_7d',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT CASE WHEN type='population_purchase' OR metadata->>'buyer_kind'='population' THEN 'population'
    WHEN metadata->>'national_market'='true' THEN 'national_market'
    WHEN type='business_supply' THEN 'business' ELSE 'members' END channel,
    count(*) operations,sum(amount) gross_amount
   FROM public.transactions WHERE created_at>=statement_timestamp()-interval '7 days'
    AND type IN ('population_purchase','business_supply','purchase') GROUP BY 1) x),
  'fiscal',(SELECT jsonb_build_object('simulated_debt',s.public_debt,'operational_treasury',g.treasury_balance,
    'cash_is_separate',true,'national_tax_model','pending_calibration')
   FROM public.economic_state s CROSS JOIN public.government_finances g WHERE s.id=true AND g.id=1),
  'jobs',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT run_type,status,started_at,finished_at,errors FROM public.economic_engine_runs
   ORDER BY started_at DESC LIMIT 10) x));
END $$;
REVOKE ALL ON FUNCTION public.get_economic_structural_diagnostics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_economic_structural_diagnostics() TO authenticated;
COMMIT;
