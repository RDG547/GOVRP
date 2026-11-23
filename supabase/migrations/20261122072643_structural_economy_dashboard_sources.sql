BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_economic_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with history as (
    select p.id,p.period_type,p.rp_year,p.rp_quarter,p.rp_month,p.ends_at_rp,
      jsonb_object_agg(i.indicator_code,case when i.indicator_code in ('gdp_nominal','average_wage') then i.nominal_value else coalesce(i.real_value,i.nominal_value) end)
       || jsonb_build_object('gdp_total',max((i.metadata->>'gdp_nominal_usd')::numeric) filter(where i.indicator_code='gdp_nominal')) as indicators
    from public.economic_periods p
    join public.economic_indicators i on i.period_id=p.id
    where p.status='closed' and p.period_type in ('month','quarter')
    group by p.id
    order by p.ends_at_rp desc
    limit 24
  ),
  sectors as (
    select es.code,es.name,ss.value_added,ss.real_value_added,ss.growth_rate,
           ss.employment,ss.capacity_utilization,ss.confidence_index
    from public.economic_sector_snapshots ss
    join public.economic_sectors es on es.id=ss.sector_id
    where ss.period_id=(select period_id from public.economic_sector_snapshots
      order by created_at desc limit 1)
    order by ss.value_added desc
  )
  select jsonb_build_object(
    'generated_at',now(),'accounting_source','closed_periods_v2',
    'rp_now',public.rp_now(),
    'state',to_jsonb(s),
    'headline',jsonb_build_object(
      'gdp_total',(SELECT (i.metadata->>'gdp_nominal_usd')::numeric FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='gdp_nominal' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'gdp_basis','quarter','gdp_currency','USD',
      'gdp_nominal',(SELECT i.nominal_value FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='gdp_nominal' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'gdp_real',(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='gdp_real' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'gdp_growth_quarterly',(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='gdp_growth_quarterly' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'gdp_growth_year_over_year',(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='gdp_growth_year_over_year' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'inflation_monthly',economy_private.latest_indicator('inflation_monthly'),
      'inflation_annual',economy_private.latest_indicator('inflation_annual'),
      'unemployment_rate',economy_private.latest_indicator('unemployment_rate'),
      'average_wage',economy_private.latest_indicator('average_wage'),
      'real_average_wage',economy_private.latest_indicator('real_average_wage'),
      'debt_to_gdp',(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='debt_to_gdp' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'primary_fiscal_result',(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE p.period_type='quarter' AND p.status='closed' AND i.indicator_code='primary_fiscal_result' ORDER BY p.ends_at_rp DESC LIMIT 1),
      'purchasing_power',economy_private.latest_indicator('average_purchasing_power')
    ),
    'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.ends_at_rp) from history h),'[]'::jsonb),
    'sectors',coalesce((select jsonb_agg(to_jsonb(x)) from sectors x),'[]'::jsonb),
    'basket',coalesce((select jsonb_agg(jsonb_build_object(
      'code',b.code,'name',b.name,'weight',b.weight,
      'index',round(b.current_price/greatest(b.base_price,.000001)*b.base_index,6)
    ) order by b.weight desc) from public.price_basket_items b where b.is_active),'[]'::jsonb),
    'bulletins',coalesce((select jsonb_agg(to_jsonb(b) order by b.published_at desc)
      from (select id,bulletin_type,title,summary,highlights,published_at,period_id
            from public.economic_bulletins where status in ('published','corrected')
            order by published_at desc limit 8) b),'[]'::jsonb),
    'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.detected_at desc)
      from (select id,alert_code,severity,title,message,detected_at,metadata
            from public.economic_alerts where status='active'
            order by detected_at desc limit 12) a),'[]'::jsonb)
  )
  from public.economic_state s
  where s.id=true
$function$

;
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
    'cash_is_separate',true,'national_tax_model','national_fiscal_v2',
    'effective_from_rp',(SELECT effective_from_rp FROM economy_private.fiscal_model_config WHERE id),
    'national_assets',(SELECT financial_assets FROM economy_private.national_financial_position WHERE id),
    'months',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT p.rp_year,p.rp_month,f.estimated_tax,f.government_consumption,f.operational_revenue,f.operational_primary_expense,f.simulated_transfers FROM economy_private.national_fiscal_months f JOIN public.economic_periods p ON p.id=f.period_id ORDER BY p.starts_at_rp DESC LIMIT 12) x))
   FROM public.economic_state s CROSS JOIN public.government_finances g WHERE s.id=true AND g.id=1),
  'jobs',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
   SELECT run_type,status,started_at,finished_at,errors FROM public.economic_engine_runs
   ORDER BY started_at DESC LIMIT 10) x));
END $$;
REVOKE ALL ON FUNCTION public.get_economic_structural_diagnostics() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_economic_structural_diagnostics() TO authenticated;

COMMIT;
