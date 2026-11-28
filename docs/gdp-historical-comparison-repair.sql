
-- GDP statistical repair, 2026-11-26. Historical accounting closes and the money/stock ledger are untouched.
CREATE TABLE IF NOT EXISTS economy_private.gdp_comparison_revisions (
 period_id uuid PRIMARY KEY REFERENCES public.economic_periods(id),
 nominal_gdp numeric NOT NULL CHECK(nominal_gdp>0), real_gdp numeric NOT NULL CHECK(real_gdp>0),
 deflator numeric NOT NULL CHECK(deflator>0), evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE economy_private.gdp_comparison_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON economy_private.gdp_comparison_revisions FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.historical_comparable_cpi(p_end timestamptz,p_share numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 WITH first_price AS (
  SELECT DISTINCT ON(po.product_id,po.basket_item_id) po.product_id,po.basket_item_id,po.price,po.observed_at_rp,po.id
  FROM public.price_observations po WHERE NOT po.is_simulated AND po.product_id IS NOT NULL AND po.price>0 AND po.observed_at_rp<p_end
  ORDER BY po.product_id,po.basket_item_id,po.observed_at_rp,po.id
 ), latest AS (
  SELECT DISTINCT ON(po.product_id,po.basket_item_id) po.product_id,po.basket_item_id,po.price,po.observed_at_rp,po.id
  FROM public.price_observations po WHERE NOT po.is_simulated AND po.product_id IS NOT NULL AND po.price>0 AND po.observed_at_rp<p_end
  ORDER BY po.product_id,po.basket_item_id,po.observed_at_rp DESC,po.id DESC
 ), normalized AS (
  SELECT l.basket_item_id,avg(l.price/f.price*coalesce(anchor.price,b.base_price)) price,count(*) n
  FROM latest l JOIN first_price f USING(product_id,basket_item_id) JOIN public.price_basket_items b ON b.id=l.basket_item_id
  LEFT JOIN LATERAL(SELECT o.price FROM public.price_observations o WHERE o.basket_item_id=b.id AND o.is_simulated AND o.observed_at_rp<=f.observed_at_rp ORDER BY o.observed_at_rp DESC,o.id DESC LIMIT 1) anchor ON true
  WHERE l.id<>f.id GROUP BY l.basket_item_id
 ) SELECT sum(b.weight*(coalesce(s.price,b.base_price)*(1-CASE WHEN n.n>0 THEN p_share ELSE 0 END)+coalesce(n.price,0)*CASE WHEN n.n>0 THEN p_share ELSE 0 END)/greatest(b.base_price,.000001)*100)/nullif(sum(b.weight),0)
 FROM public.price_basket_items b LEFT JOIN normalized n ON n.basket_item_id=b.id
 LEFT JOIN LATERAL(SELECT o.price FROM public.price_observations o WHERE o.basket_item_id=b.id AND o.is_simulated AND o.observed_at_rp<p_end ORDER BY o.observed_at_rp DESC,o.id DESC LIMIT 1)s ON true WHERE b.is_active
$fn$;
REVOKE ALL ON FUNCTION economy_private.historical_comparable_cpi(timestamptz,numeric) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION economy_private.comparable_quarter_gdp(p_year integer,p_quarter integer)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT coalesce(
  (SELECT r.real_gdp FROM economy_private.gdp_comparison_revisions r JOIN public.economic_periods p ON p.id=r.period_id WHERE p.period_type='quarter' AND p.rp_year=p_year AND p.rp_quarter=p_quarter),
  (SELECT i.real_value FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id JOIN economy_private.period_input_manifests m ON m.period_id=p.id WHERE p.period_type='quarter' AND p.rp_year=p_year AND p.rp_quarter=p_quarter AND p.status='closed' AND i.indicator_code='gdp_real' AND i.real_value>0 AND p.starts_at_rp=make_timestamptz(p_year,(p_quarter-1)*3+1,1,0,0,0,'UTC') AND p.ends_at_rp=(p.starts_at_rp AT TIME ZONE 'UTC'+interval '3 months') AT TIME ZONE 'UTC')
 );
$fn$;
REVOKE ALL ON FUNCTION economy_private.comparable_quarter_gdp(integer,integer) FROM PUBLIC,anon,authenticated;

DO $patch$
DECLARE d text; a integer; b integer;
BEGIN
 d:=pg_get_functiondef('economy_private.close_quarter(uuid,boolean,uuid)'::regprocedure);
 a:=strpos(d,'select i.real_value into previous_real_gdp'); b:=strpos(d,'growth_quarter := case');
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Quarter comparison definition changed';END IF;
 d:=left(d,a-1)||$s$previous_real_gdp:=economy_private.comparable_quarter_gdp(
   case when period_row.rp_quarter=1 then period_row.rp_year-1 else period_row.rp_year end,
   case when period_row.rp_quarter=1 then 4 else period_row.rp_quarter-1 end);
  year_ago_real_gdp:=economy_private.comparable_quarter_gdp(period_row.rp_year-1,period_row.rp_quarter);
  $s$||substring(d from b);
 EXECUTE d;
 d:=pg_get_functiondef('public.sync_brazil_rp_indicator()'::regprocedure);
 IF strpos(d,'if field is not null and amount is not null then')=0 THEN RAISE EXCEPTION 'Indicator sync definition changed';END IF;
 EXECUTE replace(d,'if field is not null and amount is not null then','if field is not null and (amount is not null or new.indicator_code in (''gdp_growth_year_over_year'',''gdp_growth_quarterly'')) then');
 d:=pg_get_functiondef('economy_private.detect_cycle(uuid)'::regprocedure);
 IF strpos(d,'  detected := case')=0 THEN RAISE EXCEPTION 'Cycle definition changed';END IF;
 EXECUTE replace(d,'  detected := case',$s$  IF current_growth IS NULL THEN
    SELECT economic_cycle INTO detected FROM public.economic_state WHERE id=true;
    PERFORM economy_private.upsert_indicator(p_quarter_period_id,'economic_cycle_code',NULL,NULL,NULL,'code',jsonb_build_object('cycle',NULL,'status','insufficient_data','last_known_cycle',detected));
    RETURN detected;
  END IF;
  detected := case$s$);
 d:=pg_get_functiondef('public.bot_whatsapp_command(text,text)'::regprocedure);
 a:=strpos(d,$s$coalesce(
      nullif(c.economic_current->>'growth','')::numeric,$s$); b:=strpos(d,') AS crescimento_anual');
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Bot annual growth definition changed';END IF;
 d:=left(d,a-1)||$s$(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE i.indicator_code='gdp_growth_year_over_year' AND p.period_type='quarter' AND p.status='closed' ORDER BY p.ends_at_rp DESC LIMIT 1)$s$||substring(d from b+1);
 a:=strpos(d,$s$coalesce(
      nullif(c.economic_current->>'growthQuarterly','')::numeric,$s$); b:=strpos(d,') AS crescimento_trimestral');
 IF a=0 OR b<=a THEN RAISE EXCEPTION 'Bot quarterly growth definition changed';END IF;
 d:=left(d,a-1)||$s$(SELECT coalesce(i.real_value,i.nominal_value) FROM public.economic_indicators i JOIN public.economic_periods p ON p.id=i.period_id WHERE i.indicator_code='gdp_growth_quarterly' AND p.period_type='quarter' AND p.status='closed' ORDER BY p.ends_at_rp DESC LIMIT 1)$s$||substring(d from b+1);
 EXECUTE d;
END $patch$;

DO $revision$
DECLARE target uuid; q1 uuid; old_rows jsonb; details jsonb; before_audit jsonb; after_audit jsonb; before_balances text; after_balances text; real_now numeric; previous_gdp numeric; year_gdp numeric; quarterly numeric; annual numeric; cycle_value text; affected integer;
BEGIN
 SELECT id INTO target FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2030 AND rp_quarter=2 AND status='closed';
 IF target IS NULL THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.economic_indicators WHERE period_id=target AND indicator_code='gdp_growth_quarterly' AND metadata->>'revision_method'='historical_comparison_20261126_v1') THEN RETURN;END IF;
 IF EXISTS(SELECT 1 FROM public.economic_periods WHERE period_type='quarter' AND status='closed' AND (rp_year,rp_quarter)>(2030,2)) THEN RAISE EXCEPTION 'Current quarter advanced';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('govrp:economy:quarter:'||target::text));
 PERFORM pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 IF (SELECT count(*) FROM public.economic_indicators WHERE period_id=target AND indicator_code IN('gdp_growth_quarterly','gdp_growth_year_over_year') AND nominal_value IS NULL AND real_value IS NULL)<>2 THEN RAISE EXCEPTION 'Target growth already changed';END IF;
 SELECT id INTO q1 FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2030 AND rp_quarter=1;
 IF q1 IS NULL THEN RAISE EXCEPTION 'Missing historical quarter';END IF;
 SELECT private.economy_accounting_reconciliation_snapshot() INTO before_audit;
 SELECT md5(coalesce(string_agg(id::text||':'||balance::text,'|' ORDER BY id),'')) INTO before_balances FROM public.accounts;
 SELECT jsonb_build_object('target_indicators',(SELECT jsonb_agg(to_jsonb(i)) FROM public.economic_indicators i WHERE period_id=target),'bulletin',(SELECT to_jsonb(b) FROM public.economic_bulletins b WHERE period_id=target AND bulletin_type='quarterly'),'state',(SELECT to_jsonb(s) FROM public.economic_state s WHERE id=true),'country',(SELECT economic_current FROM public.country_rp_states WHERE country_code='BR'),'historical_periods',(SELECT jsonb_agg(to_jsonb(p)) FROM public.economic_periods p WHERE (rp_year=2030 AND (rp_month IN(1,2,3) OR rp_quarter=1)) OR (rp_year=2029 AND rp_quarter IN(2,3,4)))) INTO old_rows;
 WITH months AS (
  SELECT p.id,p.rp_year AS y,p.rp_month AS m,make_timestamptz(p.rp_year,p.rp_month,1,0,0,0,'UTC') AS st,(make_timestamptz(p.rp_year,p.rp_month,1,0,0,0,'UTC') AT TIME ZONE 'UTC'+interval '1 month') AT TIME ZONE 'UTC' AS en
  FROM public.economic_periods p WHERE p.period_type='month' AND ((p.rp_year=2029 AND p.rp_month BETWEEN 4 AND 12) OR (p.rp_year=2030 AND p.rp_month BETWEEN 1 AND 3))
 ), ev AS (
  SELECT m.y,m.m,e.economic_classification,e.source_table,e.sector_id,e.economic_amount,e.id FROM months m JOIN public.economic_events e ON e.occurred_at_rp>=m.st AND e.occurred_at_rp<m.en WHERE NOT EXISTS(SELECT 1 FROM economy_private.period_input_manifests x WHERE x.period_id=m.id)
  UNION ALL SELECT m.y,m.m,e.economic_classification,e.source_table,e.sector_id,e.economic_amount,e.id FROM months m JOIN economy_private.period_input_manifests x ON x.period_id=m.id CROSS JOIN LATERAL economy_private.period_input_events(m.id) e WHERE e.occurred_at_rp>=m.st AND e.occurred_at_rp<m.en
 ), feb_est AS (
  SELECT economic_classification,sector_id,avg(economic_amount) amount FROM ev WHERE y=2030 AND m IN(1,3) AND source_table='economy_simulation' GROUP BY 1,2 HAVING count(*)=2
 ), agg AS (
  SELECT y,m,sum(CASE economic_classification WHEN 'gross_output' THEN economic_amount WHEN 'intermediate_consumption' THEN -economic_amount WHEN 'product_tax' THEN economic_amount WHEN 'subsidy' THEN -economic_amount ELSE 0 END) nominal,
  sum(CASE economic_classification WHEN 'household_consumption' THEN economic_amount WHEN 'productive_investment' THEN economic_amount WHEN 'government_spending' THEN economic_amount WHEN 'export' THEN economic_amount WHEN 'import' THEN -economic_amount ELSE 0 END) expenditure,
  count(*) FILTER(WHERE source_table='economy_simulation' AND economic_classification='gross_output') sim_rows,
  count(*) FILTER(WHERE source_table='economy_simulation') sim_components,count(*) AS observed_events FROM ev GROUP BY 1,2
 ), monthly AS (
  SELECT a.*,m.st,m.en,economy_private.historical_comparable_cpi(m.en,.5) cpi,
  (SELECT count(DISTINCT o.basket_item_id) FROM public.price_observations o WHERE o.observed_at_rp>=m.st AND o.observed_at_rp<m.en) price_items,
  CASE WHEN a.y=2030 AND a.m=2 THEN (SELECT sum(CASE economic_classification WHEN 'gross_output' THEN amount WHEN 'intermediate_consumption' THEN -amount ELSE 0 END) FROM feb_est) ELSE 0 END estimated_gdp,
  CASE WHEN a.y=2030 AND a.m=2 THEN (SELECT sum(CASE economic_classification WHEN 'household_consumption' THEN amount WHEN 'productive_investment' THEN amount WHEN 'government_spending' THEN amount WHEN 'export' THEN amount WHEN 'import' THEN -amount ELSE 0 END) FROM feb_est) ELSE 0 END estimated_expenditure,
  CASE WHEN a.y=2030 AND a.m=2 THEN (SELECT jsonb_agg(to_jsonb(f) ORDER BY economic_classification,sector_id) FROM feb_est f) ELSE NULL END estimated_components
  FROM agg a JOIN months m USING(y,m)
 ), quarters AS (
  SELECT y,((m-1)/3+1) q,sum(nominal+estimated_gdp) nominal,sum(expenditure+estimated_expenditure) expenditure,avg(cpi) deflator,sum(nominal+estimated_gdp)/(avg(cpi)/100) real,jsonb_agg(to_jsonb(monthly) ORDER BY m) months
  FROM monthly GROUP BY 1,2 HAVING count(*)=3 AND bool_and(cpi>0 AND price_items=14 AND (CASE WHEN y=2030 AND m=2 THEN sim_rows=0 AND sim_components=0 AND jsonb_array_length(estimated_components)=168 ELSE sim_rows=24 AND sim_components=168 END))
 )
 INSERT INTO economy_private.gdp_comparison_revisions(period_id,nominal_gdp,real_gdp,deflator,evidence)
 SELECT p.id,x.nominal,x.real,x.deflator,jsonb_build_object('revision_method','historical_comparison_20261126_v1','scope','statistical_gdp_only','nominal_expenditure',x.expenditure,'monthly_sources',x.months,'price_method','same_product_normalized_basket_50_percent_canonical_UTC_cutoffs','missing_model_method','arithmetic interpolation of January/March model components by sector; actual events retained','historical_period_status',p.status)
 FROM quarters x JOIN public.economic_periods p ON p.period_type='quarter' AND p.rp_year=x.y AND p.rp_quarter=x.q WHERE abs(x.nominal-x.expenditure)/greatest(x.nominal,1)<.03 ON CONFLICT(period_id) DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>4 THEN RAISE EXCEPTION 'Historical reconstruction: expected 4 quarters, got %',affected;END IF;
 SELECT real_value INTO real_now FROM public.economic_indicators WHERE period_id=target AND indicator_code='gdp_real';
 previous_gdp:=economy_private.comparable_quarter_gdp(2030,1); year_gdp:=economy_private.comparable_quarter_gdp(2029,2);
 IF least(real_now,previous_gdp,year_gdp)<=0 OR real_now IS NULL OR previous_gdp IS NULL OR year_gdp IS NULL THEN RAISE EXCEPTION 'Invalid comparable GDP';END IF;
 quarterly:=round((real_now/previous_gdp-1)*100,6); annual:=round((real_now/year_gdp-1)*100,6);
 details:=jsonb_build_object('revision_method','historical_comparison_20261126_v1','previous_period_id',q1,'previous_real_gdp',previous_gdp,'year_ago_real_gdp',year_gdp,'current_real_gdp',real_now,'quarterly_growth',quarterly,'annual_growth',annual,'estimated_february',true,'comparison_scope','statistical GDP only; original historical closes unchanged','price_basis','normalized comparable basket','revision_is_not_growth',true);
 UPDATE public.economic_indicators SET nominal_value=CASE indicator_code WHEN 'gdp_growth_quarterly' THEN quarterly ELSE annual END,real_value=CASE indicator_code WHEN 'gdp_growth_quarterly' THEN quarterly ELSE annual END,variation=CASE indicator_code WHEN 'gdp_growth_quarterly' THEN quarterly ELSE annual END,status='revised',metadata=metadata||details||jsonb_build_object('comparable_history',true) WHERE period_id=target AND indicator_code IN('gdp_growth_quarterly','gdp_growth_year_over_year');
 GET DIAGNOSTICS affected=ROW_COUNT; IF affected<>2 THEN RAISE EXCEPTION 'Growth update count mismatch';END IF;
 UPDATE public.economic_indicators SET variation=quarterly,status='revised',metadata=metadata||jsonb_build_object('growth_comparison_revision','historical_comparison_20261126_v1') WHERE period_id=target AND indicator_code IN('gdp_nominal','gdp_real','gdp_per_capita');
 cycle_value:=economy_private.detect_cycle(target);
 UPDATE public.economic_indicators SET status='revised',metadata=metadata||jsonb_build_object('revision_method','historical_comparison_20261126_v1','estimated_comparison',true) WHERE period_id=target AND indicator_code='economic_cycle_code';
 UPDATE public.economic_bulletins SET status='corrected',published_at=clock_timestamp(),
 summary=format('PIB real: crescimento trimestral de %s%% e em 12 meses de %s%% (comparações reconstruídas).',to_char(quarterly,'FM999990.00'),to_char(annual,'FM999990.00')),
 content=format('Revisão estatística de 26/11/2026: crescimento trimestral %s%%; crescimento em 12 meses %s%%. A parcela macroeconômica simulada ausente em fevereiro foi interpolada por setor com janeiro e março; os eventos registrados foram preservados. Comparação anual recalculada com a mesma cesta de preços da reforma. Inflação anual %s%% e desemprego %s%%. O PIB do trimestre atual e os registros financeiros permanecem os originais.',to_char(quarterly,'FM999990.00'),to_char(annual,'FM999990.00'),to_char(economy_private.latest_indicator('inflation_annual'),'FM999990.00'),to_char(economy_private.latest_indicator('unemployment_rate'),'FM999990.00')),
 highlights=jsonb_build_array(jsonb_build_object('label','Crescimento trimestral','value',quarterly,'unit','%'),jsonb_build_object('label','Crescimento em 12 meses','value',annual,'unit','%'),jsonb_build_object('label','Inflação','value',economy_private.latest_indicator('inflation_annual'),'unit','%'),jsonb_build_object('label','Desemprego','value',economy_private.latest_indicator('unemployment_rate'),'unit','%')),metadata=coalesce(metadata,'{}'::jsonb)||details WHERE period_id=target AND bulletin_type='quarterly';
 INSERT INTO public.national_indicator_points(country_code,indicator_code,value,unit,domain,source_type,source_table,source_id,metadata)
 SELECT 'BR',i.indicator_code,i.real_value,i.unit,'economy','rp_simulation','economic_indicators',i.id::text,i.metadata FROM public.economic_indicators i WHERE period_id=target AND indicator_code IN('gdp_growth_quarterly','gdp_growth_year_over_year');
 SELECT private.economy_accounting_reconciliation_snapshot() INTO after_audit;
 SELECT md5(coalesce(string_agg(id::text||':'||balance::text,'|' ORDER BY id),'')) INTO after_balances FROM public.accounts;
 IF before_balances IS DISTINCT FROM after_balances OR (before_audit-'checked_at') IS DISTINCT FROM (after_audit-'checked_at') THEN RAISE EXCEPTION 'Financial integrity changed; revision aborted';END IF;
 PERFORM economy_private.audit('historical_gdp_comparison_revision','economic_period',target::text,old_rows,details||jsonb_build_object('cycle',cycle_value,'accounting_before',before_audit,'accounting_after',after_audit,'historical_baselines',(SELECT jsonb_agg(to_jsonb(r)) FROM economy_private.gdp_comparison_revisions r)), 'Revisão estatística solicitada pela administração: lacuna de fevereiro de 2030 e comparações trimestrais/anuais. Sem reexecução financeira.');
 INSERT INTO public.economic_engine_runs(run_type,period_id,engine_version,status,finished_at,results,metadata) VALUES('rebuild',target,'1.0.0','completed',clock_timestamp(),details||jsonb_build_object('cycle',cycle_value),jsonb_build_object('scope','statistical_gdp_comparison_only','no_financial_replay',true));
END $revision$;
