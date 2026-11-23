BEGIN;
-- Prospective release completion; no historical rewrite or monetary injection.
CREATE OR REPLACE FUNCTION economy_private.operational_public_investment(p_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(sum(amount*greatest(0,least(1,productive_share))),0)
 FROM economy_private.period_input_expenditures(p_id)
 WHERE source_table IS DISTINCT FROM 'automatic_stabilizers'
  AND (expenditure_type='government_project' OR metadata->>'fiscal_classification'='capital_investment')
$$;
REVOKE ALL ON FUNCTION economy_private.operational_public_investment(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.comparable_basket_prices(p_id uuid)
RETURNS TABLE(basket_item_id uuid,weight numeric,base_price numeric,price numeric,observed_products bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH period AS (SELECT ends_at_rp FROM public.economic_periods WHERE id=p_id),
 first_price AS (
  SELECT DISTINCT ON(po.product_id,po.basket_item_id) po.product_id,po.basket_item_id,po.price,po.observed_at_rp,po.id
  FROM public.price_observations po,period p
  WHERE NOT po.is_simulated AND po.product_id IS NOT NULL AND po.price>0 AND po.observed_at_rp<p.ends_at_rp
  ORDER BY po.product_id,po.basket_item_id,po.observed_at_rp,po.id
 ), latest AS (
  SELECT DISTINCT ON(po.product_id,po.basket_item_id) po.product_id,po.basket_item_id,po.price,po.observed_at_rp,po.id
  FROM public.price_observations po,period p
  WHERE NOT po.is_simulated AND po.product_id IS NOT NULL AND po.price>0 AND po.observed_at_rp<p.ends_at_rp
  ORDER BY po.product_id,po.basket_item_id,po.observed_at_rp DESC,po.id DESC
 ), normalized AS (
  SELECT l.basket_item_id,avg(l.price/f.price*coalesce(anchor.price,b.base_price)) price,count(*) n
  FROM latest l JOIN first_price f USING(product_id,basket_item_id)
  JOIN public.price_basket_items b ON b.id=l.basket_item_id
  LEFT JOIN LATERAL(SELECT o.price FROM public.price_observations o WHERE o.basket_item_id=b.id AND o.is_simulated
   AND o.observed_at_rp<=f.observed_at_rp ORDER BY o.observed_at_rp DESC,o.id DESC LIMIT 1) anchor ON true
  WHERE l.id<>f.id GROUP BY l.basket_item_id
 ) SELECT b.id,b.weight,greatest(b.base_price,.000001),
   coalesce(s.price,b.base_price)*(1-CASE WHEN n.n>0 THEN mix.share ELSE 0 END)
    +coalesce(n.price,0)*CASE WHEN n.n>0 THEN mix.share ELSE 0 END,coalesce(n.n,0)
 FROM public.price_basket_items b CROSS JOIN period p
 CROSS JOIN LATERAL(SELECT greatest(0,least(1,coalesce((SELECT player_share FROM public.economic_state WHERE id),0))) share) mix
 LEFT JOIN normalized n ON n.basket_item_id=b.id
 LEFT JOIN LATERAL(SELECT o.price FROM public.price_observations o WHERE o.basket_item_id=b.id AND o.is_simulated
  AND o.observed_at_rp<p.ends_at_rp ORDER BY o.observed_at_rp DESC,o.id DESC LIMIT 1) s ON true
 WHERE b.is_active
$$;
REVOKE ALL ON FUNCTION economy_private.comparable_basket_prices(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.household_location_weight(p_region text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT greatest(.6,least(1.4,sqrt(greatest(r.population,0)::numeric/nullif((SELECT avg(population) FROM public.economic_regions WHERE country_code='BR'),0))))
  FROM public.economic_regions r WHERE r.code=p_region AND r.country_code='BR'),1)
$$;
REVOKE ALL ON FUNCTION private.household_location_weight(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION economy_private.calculate_cpi(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  cpi_value numeric;
  previous_cpi numeric;
  year_ago_cpi numeric;
  monthly_inflation numeric;
  annual_inflation numeric;
begin
  select * into period_row
  from public.economic_periods
  where id = p_month_period_id
    and period_type = 'month';

  SELECT sum(weight*price/base_price*100)/nullif(sum(weight),0) INTO cpi_value
  FROM economy_private.comparable_basket_prices(p_month_period_id);

  select i.nominal_value into previous_cpi
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = 'cpi_index'
    and p.period_type = 'month'
    and p.ends_at_rp <= period_row.starts_at_rp
  order by p.ends_at_rp desc
  limit 1;

  select i.nominal_value into year_ago_cpi
  from public.economic_indicators i
  join public.economic_periods p on p.id = i.period_id
  where i.indicator_code = 'cpi_index'
    and p.period_type = 'month'
    and p.rp_year = period_row.rp_year - 1
    and p.rp_month = period_row.rp_month
  limit 1;

  IF cpi_value IS NULL OR cpi_value<=0 THEN RAISE EXCEPTION 'Cesta de preços sem ponderação válida.';END IF;
  previous_cpi := coalesce(previous_cpi, 100);
  monthly_inflation := case
    when previous_cpi = 0 then 0
    else ((cpi_value / previous_cpi) - 1) * 100
  end;
  annual_inflation := case
    when coalesce(year_ago_cpi, 0) = 0 then
      NULL
    else ((cpi_value / year_ago_cpi) - 1) * 100
  end;

  perform economy_private.upsert_indicator(
    p_month_period_id, 'cpi_index', cpi_value, cpi_value, monthly_inflation,
    'index', jsonb_build_object('base', 100)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'inflation_monthly', monthly_inflation, monthly_inflation, monthly_inflation,
    'percent', jsonb_build_object('cpi_current', cpi_value, 'cpi_previous', previous_cpi)
  );
  perform economy_private.upsert_indicator(
    p_month_period_id, 'inflation_annual', annual_inflation, annual_inflation, annual_inflation,
    'percent', jsonb_build_object('history_available', year_ago_cpi is not null,'annualized_when_history_missing',false,'price_basis','normalized_same_product_and_simulated_basket')
  );

  update public.economic_state
  set cpi_index = cpi_value,
      gdp_deflator = cpi_value,
      updated_at = now()
  where id = true;

  return jsonb_build_object(
    'cpi', round(cpi_value, 6),
    'monthly_inflation', round(monthly_inflation, 6),
    'annual_inflation', round(annual_inflation, 6)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION economy_private.close_quarter(p_period_id uuid, p_force boolean DEFAULT false, p_initiated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  readiness jsonb;
  period_row public.economic_periods%rowtype;
  run_id uuid;
  gross_output numeric;
  intermediate numeric;
  product_taxes numeric;
  subsidies numeric;
  consumption numeric;
  investment numeric;
  government_spending numeric;
  exports numeric;
  imports numeric;
  gdp_production numeric;
  gdp_expenditure numeric;
  discrepancy numeric;
  tolerance numeric := economy_private.calibration_numeric('reconciliation_tolerance',.03);
  deflator numeric;
  real_gdp numeric;
  previous_real_gdp numeric;
  year_ago_real_gdp numeric;
  growth_quarter numeric;
  growth_year numeric;
  population numeric := economy_private.national_population();
  revenue numeric;
  expenditure_primary numeric;
  transfers numeric;
  interest_cost numeric;
  primary_result numeric;
  nominal_result numeric;
  old_debt numeric;
  new_debt numeric;
  debt_ratio numeric;
  v_fiscal_confidence numeric;
  fiscal_risk text;
  cycle text;
  result jsonb;
  fiscal_snapshot jsonb; fiscal_current numeric; fiscal_investment numeric; fiscal_dividends numeric; fiscal_tax numeric; fiscal_metadata jsonb; debt_flow jsonb; financial_assets numeric;
  event_hash text; fx_snapshot numeric;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:quarter:'||p_period_id::text));
  readiness := economy_private.period_close_readiness(p_period_id);
  if readiness->>'status' <> 'ready' then return readiness; end if;

  select * into period_row
  from public.economic_periods
  where id=p_period_id
  for update;

  if not found or period_row.period_type<>'quarter' then
    raise exception 'Período trimestral inválido.';
  end if;
  if period_row.status='closed' then
    return jsonb_build_object('status','already_closed','period_id',p_period_id);
  end if;
  if not p_force and now()<period_row.ends_at then
    return jsonb_build_object('status','not_due','period_id',p_period_id);
  end if;

  for period_row in
    select *
    from public.economic_periods p
    where p.period_type='month'
      and p.starts_at_rp >= (select starts_at_rp from public.economic_periods where id=p_period_id)
      and p.ends_at_rp <= (select ends_at_rp from public.economic_periods where id=p_period_id)
      and p.status<>'closed'
    order by p.starts_at_rp
  loop
    perform economy_private.close_month(period_row.id,true,p_initiated_by);
  end loop;

  select * into period_row from public.economic_periods where id=p_period_id for update;

  insert into public.economic_engine_runs (
    run_type,period_id,engine_version,status,initiated_by
  )
  values ('quarterly_close',p_period_id,'1.0.0','running',p_initiated_by)
  returning id into run_id;

  update public.economic_periods set status='closing' where id=p_period_id;
  perform economy_private.capture_period_inputs(p_period_id);

  select
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='product_tax'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='subsidy'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='household_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='productive_investment'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='government_spending'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='export'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='import'),0)
  into
    gross_output,intermediate,product_taxes,subsidies,
    consumption,investment,government_spending,exports,imports
  from economy_private.period_input_events(p_period_id) e
  where e.occurred_at_rp>=period_row.starts_at_rp
    and e.occurred_at_rp<period_row.ends_at_rp;

  gdp_production := gross_output-intermediate+product_taxes-subsidies;
  gdp_expenditure := consumption+investment+government_spending+exports-imports;
  if gdp_production<=0 and gdp_expenditure>0 then
    gdp_production := gdp_expenditure;
  end if;
  discrepancy := case
    when greatest(abs(gdp_production),abs(gdp_expenditure))=0 then 0
    else abs(gdp_production-gdp_expenditure)
      / greatest(abs(gdp_production),abs(gdp_expenditure))
  end;

  select avg(i.nominal_value) into deflator from public.economic_indicators i join public.economic_periods p on p.id=i.period_id where i.indicator_code='cpi_index' and p.period_type='month' and p.starts_at_rp>=period_row.starts_at_rp and p.ends_at_rp<=period_row.ends_at_rp;
  deflator:=coalesce(deflator,(select cpi_index from public.economic_state where id=true));
  select brl_per_unit into fx_snapshot from public.country_rp_exchange_rates where country_code='BR' and currency_code='USD';
  fx_snapshot:=coalesce(fx_snapshot,(select exchange_rate from public.economic_state where id=true));
  real_gdp := gdp_production/greatest(deflator/100,.000001);

  select i.real_value into previous_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.ends_at_rp<=period_row.starts_at_rp and p.status='closed'
    and exists(select 1 from economy_private.period_input_manifests m where m.period_id=p.id)
  order by p.ends_at_rp desc limit 1;

  select i.real_value into year_ago_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.rp_year=period_row.rp_year-1
    and p.rp_quarter=period_row.rp_quarter and p.status='closed'
    and exists(select 1 from economy_private.period_input_manifests m where m.period_id=p.id)
  limit 1;

  growth_quarter := case when coalesce(previous_real_gdp,0)=0 then null
    else (real_gdp/previous_real_gdp-1)*100 end;
  growth_year := case when coalesce(year_ago_real_gdp,0)=0 then null
    else (real_gdp/year_ago_real_gdp-1)*100 end;

  perform economy_private.upsert_indicator(
    p_period_id,'gdp_nominal',gdp_production,real_gdp,growth_quarter,'BRL',
    jsonb_build_object(
      'production_method',gdp_production,
      'expenditure_method',gdp_expenditure,
      'statistical_discrepancy_ratio',discrepancy,'fx_brl_per_usd_snapshot',fx_snapshot,'gdp_nominal_usd',gdp_production/fx_snapshot,'reference_period','quarter'
    )
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_real',gdp_production,real_gdp,growth_quarter,'BRL',
    jsonb_build_object('deflator',deflator)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_growth_quarterly',growth_quarter,growth_quarter,growth_quarter,'percent',
    jsonb_build_object('previous_real_gdp',previous_real_gdp,'comparable_history',previous_real_gdp is not null,'revision_is_not_growth',true)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_growth_year_over_year',growth_year,growth_year,growth_year,'percent',
    jsonb_build_object('year_ago_real_gdp',year_ago_real_gdp)
  );
  perform economy_private.upsert_indicator(
    p_period_id,'gdp_per_capita',gdp_production/population,real_gdp/population,growth_quarter,'BRL_per_capita',
    jsonb_build_object('population',population)
  );
  perform economy_private.upsert_indicator(p_period_id,'gross_output',gross_output,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'intermediate_consumption',intermediate,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'household_consumption',consumption,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'productive_investment',investment,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'government_spending',government_spending,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'exports',exports,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'imports',imports,null,null,'BRL','{}'::jsonb);

  insert into public.economic_sector_snapshots (
    period_id,sector_id,gross_output,intermediate_consumption,value_added,
    real_value_added,employment,average_wage,wage_mass,investment,
    price_index,capacity_utilization,productivity_index,confidence_index,growth_rate,metadata
  )
  select
    p_period_id,
    es.id,
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0)
      - coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0),
    (
      coalesce(sum(e.economic_amount) filter (where e.economic_classification='gross_output'),0)
      - coalesce(sum(e.economic_amount) filter (where e.economic_classification='intermediate_consumption'),0)
    )/greatest(deflator/100,.000001),
    coalesce((
      select avg(lms.employed)*es.gdp_weight
      from public.labor_market_snapshots lms
      join public.economic_periods mp on mp.id=lms.period_id
      where mp.starts_at_rp>=period_row.starts_at_rp and mp.ends_at_rp<=period_row.ends_at_rp
    ),population*.4*es.gdp_weight),
    coalesce(economy_private.latest_indicator('average_wage',period_row.ends_at_rp),3000),
    coalesce((
      select avg(lms.wage_mass)*es.gdp_weight
      from public.labor_market_snapshots lms
      join public.economic_periods mp on mp.id=lms.period_id
      where mp.starts_at_rp>=period_row.starts_at_rp and mp.ends_at_rp<=period_row.ends_at_rp
    ),0),
    coalesce(sum(e.economic_amount) filter (where e.economic_classification='productive_investment'),0),
    deflator,
    economy_private.clamp(
      60+(growth_quarter*2)+economy_private.active_shock_impact('capacity_percent',es.id),
      20,115
    ),
    es.base_productivity*100,
    economy_private.clamp(
      (select business_confidence from public.economic_state where id=true)
        + economy_private.active_shock_impact('business_confidence',es.id),
      0,100
    ),
    growth_quarter,
    jsonb_build_object('sector_code',es.code,'gdp_weight',es.gdp_weight)
  from public.economic_sectors es
  left join economy_private.period_input_events(p_period_id) e
    on e.sector_id=es.id
   and e.occurred_at_rp>=period_row.starts_at_rp
   and e.occurred_at_rp<period_row.ends_at_rp
  where es.is_active
  group by es.id;

  select coalesce(sum(gr.amount),0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from economy_private.period_input_events(p_period_id) e
      where e.source_table='transactions'
        and e.economic_classification in ('product_tax','income_tax')
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0)
  into revenue
  from economy_private.period_input_revenues(p_period_id) gr
  where gr.occurred_at_rp>=period_row.starts_at_rp
    and gr.occurred_at_rp<period_row.ends_at_rp;

  select coalesce(sum(ge.amount) filter (where ge.expenditure_type<>'debt_interest'),0),
         coalesce(sum(ge.amount) filter (where ge.expenditure_type='social_assistance'),0)
  into expenditure_primary,transfers
  from economy_private.period_input_expenditures(p_period_id) ge
  where ge.occurred_at_rp>=period_row.starts_at_rp
    and ge.occurred_at_rp<period_row.ends_at_rp;

  expenditure_primary := coalesce(expenditure_primary,0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from economy_private.period_input_events(p_period_id) e
      where e.source_table='transactions'
        and e.economic_classification='social_transfer'
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0);

  fiscal_snapshot:=economy_private.national_fiscal_quarter(p_period_id);
  fiscal_dividends:=coalesce((select sum(amount) from economy_private.period_input_revenues(p_period_id) where revenue_type='state_dividend'
   and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0);
  fiscal_current:=expenditure_primary-transfers; fiscal_investment:=economy_private.operational_public_investment(p_period_id); fiscal_current:=fiscal_current-fiscal_investment;
  fiscal_tax:=revenue-fiscal_dividends;
  fiscal_metadata:=jsonb_build_object('model','legacy_transition','cash_is_separate',true);
  if fiscal_snapshot->>'status'='complete' then
   revenue:=(fiscal_snapshot->>'national_tax')::numeric+(fiscal_snapshot->>'operational_revenue')::numeric;
   expenditure_primary:=(fiscal_snapshot->>'government_consumption')::numeric
    +(fiscal_snapshot->>'operational_primary_expense')::numeric+(fiscal_snapshot->>'simulated_transfers')::numeric;
   transfers:=(fiscal_snapshot->>'simulated_transfers')::numeric
    +coalesce((SELECT sum(amount) FROM economy_private.period_input_expenditures(p_period_id)
      WHERE source_table IS DISTINCT FROM 'automatic_stabilizers' AND expenditure_type='social_assistance'),0);
   fiscal_current:=expenditure_primary-transfers-fiscal_investment;
   fiscal_tax:=revenue-fiscal_dividends;
   fiscal_metadata:=fiscal_snapshot||jsonb_build_object('model','national_fiscal_v2','cash_is_separate',true,
    'national_estimate_is_not_treasury_cash',true);
  end if;
  select public_debt into old_debt from public.economic_state where id=true;
  interest_cost := old_debt
    * (select current_selic from public.economic_state where id=true)
    / 100 / 4;
  primary_result := revenue-expenditure_primary;
  nominal_result := primary_result-interest_cost;
  select f.financial_assets into financial_assets from economy_private.national_financial_position f where id=true for update;
  debt_flow:=economy_private.national_debt_rollforward(old_debt,financial_assets,
   (select current_selic from public.economic_state where id=true),revenue,expenditure_primary);
  new_debt:=(debt_flow->>'closing_debt')::numeric;
  update economy_private.national_financial_position set financial_assets=(debt_flow->>'closing_assets')::numeric where id=true;
  fiscal_metadata:=fiscal_metadata||jsonb_build_object('debt_rollforward',debt_flow);
  debt_ratio := new_debt/greatest(gdp_production*4,1)*100;
  v_fiscal_confidence := economy_private.clamp(
    78-debt_ratio*.45+growth_quarter*1.5
      + case when primary_result>=0 then 5 else -8 end,
    0,100
  );
  fiscal_risk := case
    when debt_ratio>=100 or v_fiscal_confidence<20 then 'critical'
    when debt_ratio>=80 or v_fiscal_confidence<35 then 'high'
    when debt_ratio>=60 or v_fiscal_confidence<50 then 'moderate'
    else 'low'
  end;

  insert into public.fiscal_periods (
    period_id,tax_revenue,state_enterprise_revenue,other_revenue,
    current_expenditure,public_investment,social_transfers,subsidies,
    debt_interest,primary_result,nominal_result,gross_debt,net_debt,
    debt_to_gdp,average_interest_rate,average_maturity_rp_months,
    debt_service,treasury_reserves,fiscal_confidence,fiscal_risk,metadata
  )
  values (
    p_period_id,fiscal_tax,
    coalesce((select sum(amount) from economy_private.period_input_revenues(p_period_id)
      where revenue_type='state_dividend'
        and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0),
    0,fiscal_current,fiscal_investment,transfers,0,
    interest_cost,primary_result,nominal_result,new_debt,new_debt,
    debt_ratio,(select current_selic from public.economic_state where id=true),
    24,interest_cost,
    coalesce((select treasury_balance from public.government_finances where id=1),0),
    v_fiscal_confidence,fiscal_risk,
    fiscal_metadata
  )
  on conflict (period_id) do update set
    tax_revenue=excluded.tax_revenue,
    state_enterprise_revenue=excluded.state_enterprise_revenue,
    other_revenue=excluded.other_revenue,
    current_expenditure=excluded.current_expenditure,
    public_investment=excluded.public_investment,
    social_transfers=excluded.social_transfers,
    subsidies=excluded.subsidies,
    debt_interest=excluded.debt_interest,
    primary_result=excluded.primary_result,
    nominal_result=excluded.nominal_result,
    gross_debt=excluded.gross_debt,
    net_debt=excluded.net_debt,
    debt_to_gdp=excluded.debt_to_gdp,
    average_interest_rate=excluded.average_interest_rate,
    debt_service=excluded.debt_service,
    treasury_reserves=excluded.treasury_reserves,
    fiscal_confidence=excluded.fiscal_confidence,
    fiscal_risk=excluded.fiscal_risk,
    metadata=excluded.metadata;

  update public.economic_state
  set
    public_debt=new_debt,
    fiscal_confidence=v_fiscal_confidence,
    updated_at=now()
  where id=true;

  -- The macroeconomic public debt is held in economic_state.public_debt.
  -- It must NOT overwrite the separate government bank loan balance.

  perform economy_private.upsert_indicator(p_period_id,'primary_fiscal_result',primary_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'nominal_fiscal_result',nominal_result,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'public_debt',new_debt,null,null,'BRL','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'debt_to_gdp',debt_ratio,debt_ratio,null,'percent','{}'::jsonb);
  perform economy_private.upsert_indicator(p_period_id,'fiscal_confidence',v_fiscal_confidence,v_fiscal_confidence,null,'index',jsonb_build_object('risk',fiscal_risk));
  perform economy_private.upsert_indicator(
    p_period_id,'government_approval_economic_effect',
    economy_private.clamp(growth_quarter*1.6-(coalesce(economy_private.latest_indicator('inflation_annual'),0)-3)*1.2-(coalesce(economy_private.latest_indicator('unemployment_rate'),8.5)-8.5),-20,20),
    null,null,'points',
    jsonb_build_object('informational_only',true)
  );

  cycle := economy_private.detect_cycle(p_period_id);

  if discrepancy>tolerance then
    perform economy_private.create_alert(
      'gdp_reconciliation_error','critical','Inconsistência nas óticas do PIB',
      format('A diferença entre produção e despesa foi de %s%%.',to_char(discrepancy*100,'FM999990.00')),
      p_period_id,null,null,
      jsonb_build_object('production',gdp_production,'expenditure',gdp_expenditure,'tolerance',tolerance)
    );
  end if;

  if debt_ratio>economy_private.calibration_numeric('debt_limit_ratio',.9)*100 then
    perform economy_private.create_alert(
      'debt_limit_exceeded','critical','Dívida pública acima do limite',
      format('A dívida atingiu %s%% do PIB.',to_char(debt_ratio,'FM999990.00')),
      p_period_id
    );
  end if;

  select encode(
    extensions.digest(coalesce(string_agg(e.id::text||':'||e.economic_amount::text,'|' order by e.id),'empty'),'sha256'),
    'hex'
  ) into event_hash
  from economy_private.period_input_events(p_period_id) e
  where e.occurred_at_rp>=period_row.starts_at_rp and e.occurred_at_rp<period_row.ends_at_rp;

  result := jsonb_build_object(
    'period_id',p_period_id,
    'gdp_nominal',round(gdp_production,2),
    'gdp_real',round(real_gdp,2),
    'gdp_production',round(gdp_production,2),
    'gdp_expenditure',round(gdp_expenditure,2),
    'discrepancy_ratio',round(discrepancy,8),
    'growth_quarterly',round(growth_quarter,6),
    'growth_year_over_year',growth_year,
    'cycle',cycle,
    'primary_result',round(primary_result,2),
    'public_debt',round(new_debt,2),
    'debt_to_gdp',round(debt_ratio,6)
  );

  update public.economic_periods
  set status='closed',closed_at=now(),close_hash=event_hash,engine_version='1.0.0'
  where id=p_period_id;

  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,input_hash=event_hash,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;

  update public.economic_state
  set last_quarterly_close_at=now(),updated_at=now()
  where id=true;

  perform economy_private.publish_bulletin(p_period_id,'quarterly');
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    if p_period_id is not null then
      update public.economic_periods set status='failed' where id=p_period_id and status<>'closed';
    end if;
    raise;
end;
$function$;
CREATE OR REPLACE FUNCTION private.simulate_population_demand(p_day date)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare resource record; offer record; population public.accounts%rowtype; macro public.economic_state%rowtype; total_budget numeric; budget numeric; spent numeric:=0; v_quantity numeric; total numeric; net numeric; amount numeric; q jsonb; tx uuid; score_sum numeric;retail_share numeric:=.3;population_scale numeric:=1;inflation numeric:=0;employment numeric:=1; resource_count integer; player_count integer; npc_count integer; active_direct_offers boolean:=false; market_share numeric:=.5; direct_budget numeric; offer_budget numeric; affordability_step integer;
begin
 if p_day is null or p_day>current_date or p_day<current_date-30 then raise exception 'Data operacional inválida.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 perform pg_advisory_xact_lock(hashtextextended('govrp:population-demand:'||p_day,0));
 if exists(select 1 from private.population_demand_runs where operation_date=p_day) then return 0;end if;
 select * into population from public.accounts where account_kind='population' for update;
 select * into macro from public.economic_state where id=true;
 total_budget:=least(50000,greatest(0,population.balance)*.1)*(.5+coalesce(macro.consumer_confidence,50)/100);
 select least(1,greatest(.01,coalesce(sum(population_count),0)::numeric/200000000)) into population_scale from public.country_population_segments where country_code='BR';
 select greatest(0,coalesce((economic_current->>'inflation')::numeric,0)),greatest(.05,1-coalesce((economic_current->>'unemployment')::numeric,0)/100) into inflation,employment from public.country_rp_states where country_code='BR';
 total_budget:=round(total_budget*population_scale*coalesce(employment,1)/(1+coalesce(inflation,0)/100),2);
 perform private.procure_national_market(p_day);
 -- Protect the fraction of household demand the administration assigned to players.
 -- If no genuine direct company offers exist, the National Market may use the full budget.
 select exists(
   select 1 from public.business_inventory i
   join public.businesses b on b.id=i.business_id
   join public.economic_resources e on e.code=i.resource_code
   where b.status='active' and i.quantity>0 and i.available_for_sale and i.selling_price>0
     and (e.is_service or e.code in('energy','food','drinks','bread','meals','retail_food',
                                   'retail_electronics','retail_clothing','retail_medicine','retail_vehicles'))
 ) into active_direct_offers;
 market_share:=case when coalesce(macro.simulated_share,0)+coalesce(macro.player_share,0)>0
   then greatest(0,least(1,coalesce(macro.simulated_share,0)/
        (coalesce(macro.simulated_share,0)+coalesce(macro.player_share,0))))
   else .5 end;
 spent:=private.consume_national_market(p_day,round(total_budget*
   case when active_direct_offers then market_share else 1 end,2)); -- Allocate household purchasing power only to categories that currently have genuine offers.
 -- Previously empty categories received an equal share, starving the actual sellers.
 direct_budget:=greatest(0,total_budget-spent)*(1-retail_share);
 for resource in select e.*,w.weight AS demand_weight from public.economic_resources e join private.household_resource_weights(p_day) w on w.resource_code=e.code order by w.weight desc,e.code loop
  budget:=direct_budget*resource.demand_weight;
  select count(*) filter(where b.control_kind='player'),count(*) filter(where b.control_kind='population') into player_count,npc_count from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' and private.unreserved_company_stock(b.id,resource.code,p_day)>0;
  select sum(private.household_location_weight(b.region_code)*(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6)) into score_sum from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' and private.unreserved_company_stock(b.id,resource.code,p_day)>0;
  for offer in select i.*,b.bank_account_id,b.economic_sector_id,b.region_code,b.owner_id,b.name,b.control_kind,private.household_location_weight(b.region_code)*(.5+b.reputation/100)/power(greatest(i.selling_price/resource.base_price,.1),1.6) score from public.business_inventory i join public.businesses b on b.id=i.business_id where i.resource_code=resource.code and i.quantity>0 and i.available_for_sale and i.selling_price>0 and b.status='active' and private.unreserved_company_stock(b.id,resource.code,p_day)>0 order by b.id for update of i loop
   offer_budget:=least(budget*offer.score/greatest(score_sum,.00001),greatest(0,total_budget-spent));
   v_quantity:=least(private.unreserved_company_stock(offer.business_id,resource.code,p_day),offer.quantity,trunc(offer_budget/offer.selling_price,3));
   if v_quantity<=0 then continue;end if;
   amount:=round(v_quantity*offer.selling_price,2);if amount<=0 then continue;end if;
   q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   FOR affordability_step IN 1..4 LOOP
    EXIT WHEN coalesce((q->>'total_debited')::numeric,0)<=offer_budget OR coalesce((q->>'restricted')::boolean,false);
    v_quantity:=trunc(v_quantity*offer_budget/nullif((q->>'total_debited')::numeric,0),3);
    amount:=round(v_quantity*offer.selling_price,2);
    q:=public.quote_legal_levies('purchase',amount,true,offer.economic_sector_id,resource.name,NULL,offer.region_code);
   END LOOP;
   if v_quantity<=0 OR amount<=0 OR (q->>'restricted')::boolean OR (q->>'total_debited')::numeric>offer_budget then continue;end if;
   total:=(q->>'total_debited')::numeric;net:=(q->>'net_amount')::numeric;
   select * into population from public.accounts where account_kind='population';
   if total>population.balance or spent+total>total_budget then continue;end if;
   if not exists(select 1 from public.accounts where id=offer.bank_account_id and business_id=offer.business_id) then raise exception 'Conta do fornecedor indisponível.';end if;
   update public.accounts set balance=balance-total,updated_at=now() where id=population.id;
   update public.accounts set balance=balance+net,updated_at=now() where id=offer.bank_account_id;
   update public.government_finances set treasury_balance=treasury_balance+total-net,updated_at=now() where id=1;
   if not found then raise exception 'Tesouro indisponível para recolhimento.';end if;
   update public.business_inventory set quantity=public.business_inventory.quantity-v_quantity,updated_at=now() where business_id=offer.business_id and resource_code=resource.code;
   insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(population.id,offer.bank_account_id,amount,'population_purchase','Consumo da população: '||offer.name,q||jsonb_build_object('business_id',offer.business_id,'resource_code',resource.code,'quantity',v_quantity,'operation_date',p_day),md5('population-demand:'||p_day||':'||offer.business_id||':'||resource.code)::uuid) returning id into tx;
   insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'revenue',amount,'Venda para a população: '||resource.name,jsonb_build_object('kind','population_sale','transaction_id',tx,'quantity',v_quantity),'population-sale:'||p_day||':'||resource.code,p_day);
   if (q->>'seller_tax')::numeric>0 then insert into public.business_transactions(business_id,type,amount,description,metadata,operation_key,accounting_date) values(offer.business_id,'tax',-(q->>'seller_tax')::numeric,'Tributos sobre consumo da população',q,'population-tax:'||p_day||':'||resource.code,p_day);end if;
   if total>net then insert into public.government_revenues(revenue_type,source_table,source_id,business_id,amount,occurred_at_rp,metadata) values('consumption_tax','transactions',tx::text,offer.business_id,total-net,public.rp_now(),q);end if;
   update public.business_daily_operations set sold_quantity=sold_quantity+v_quantity,revenue=revenue+amount where business_id=offer.business_id and operation_date=p_day;
   spent:=spent+total;
  end loop;
 end loop;
 spent:=spent+private.simulate_retail_demand(p_day,greatest(0,total_budget-spent));
 insert into private.population_demand_runs(operation_date,spent) values(p_day,spent);
 return spent;
end $function$;
COMMIT;
