begin;

create or replace function public.sync_brazil_rp_indicator()
returns trigger language plpgsql security definer set search_path='' as $$
declare field text; amount numeric; period public.economic_periods%rowtype; scale numeric; fx numeric;
begin
 select * into period from public.economic_periods where id=new.period_id;
 if exists(select 1 from public.economic_indicators i join public.economic_periods p on p.id=i.period_id where i.indicator_code=new.indicator_code and p.ends_at_rp>period.ends_at_rp) then return new; end if;
 if new.indicator_code='gdp_nominal' then
  scale:=case period.period_type when 'quarter' then 4 when 'month' then 12 else 1 end;
  select brl_per_unit into fx from public.country_rp_exchange_rates where country_code='BR' and currency_code='USD';
  fx:=coalesce(fx,(select exchange_rate from public.economic_state where id=true));
  if fx<=0 or new.nominal_value is null then return new; end if;
  update public.country_rp_states set economic_current=economic_current||jsonb_build_object('gdpNominalLocal',new.nominal_value*scale,'gdpRealLocal',new.real_value*scale,'gdp',new.nominal_value*scale/fx,'gdpCurrency','USD','gdpPeriod',period.id,'gdpBasis','annualized_latest_period','exchangeUsd',fx),
   economic_engine_cursor=economic_engine_cursor||jsonb_build_object('gdp',new.nominal_value,'gdp_period',period.id),last_event_type='economic_indicator_update',last_event_summary='PIB nominal, real e conversão cambial atualizados pelo fechamento econômico.' where country_code='BR' and is_playable;
 else
  field:=case new.indicator_code when 'gdp_growth_year_over_year' then 'growth' when 'gdp_growth_quarterly' then 'growthQuarterly' when 'inflation_annual' then 'inflation' when 'unemployment_rate' then 'unemployment' end;
  amount:=coalesce(new.nominal_value,new.real_value);
  if field is not null and amount is not null then
   update public.country_rp_states set economic_current=economic_current||jsonb_build_object(field,amount),economic_engine_cursor=economic_engine_cursor||jsonb_build_object(field,amount),last_event_type='economic_indicator_update',last_event_summary='Indicador publicado pelo fechamento econômico do RP.' where country_code='BR' and is_playable;
  end if;
 end if;
 return new;
end; $$;


CREATE OR REPLACE FUNCTION public.sync_brazil_rp_economic_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.country_rp_states state
  set economic_current = state.economic_current || jsonb_build_object(
        'exchangeUsd', coalesce((select brl_per_unit from public.country_rp_exchange_rates where country_code='BR' and currency_code='USD'),new.exchange_rate),
        'exchangeEur', (select brl_per_unit from public.country_rp_exchange_rates where country_code='BR' and currency_code='EUR'),
        'currency', coalesce(state.economic_current->>'currency', 'BRL'),
        'gdpCurrency', 'USD',
        'selic', new.current_selic,
        'playerShare', new.player_share,
        'simulatedShare', new.simulated_share,
        'activityLevel', new.player_activity_level
      ),
      economic_engine_cursor = state.economic_engine_cursor || jsonb_build_object(
        'exchangeUsd', new.exchange_rate,
        'selic', new.current_selic,
        'playerShare', new.player_share,
        'simulatedShare', new.simulated_share,
        'activityLevel', new.player_activity_level
      ),
      player_share = new.player_share,
      simulated_share = new.simulated_share,
      last_event_type = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate then 'exchange_rate_updated'
        when nullif(state.economic_engine_cursor->>'selic', '')::numeric
          is distinct from new.current_selic then 'selic_updated'
        else state.last_event_type
      end,
      last_event_summary = case
        when nullif(state.economic_engine_cursor->>'exchangeUsd', '')::numeric
          is distinct from new.exchange_rate
          then 'O câmbio nacional variou conforme a economia do RP.'
        when nullif(state.economic_engine_cursor->>'selic', '')::numeric
          is distinct from new.current_selic
          then 'A Selic nacional foi alterada e propagada por toda a plataforma.'
        else state.last_event_summary
      end
  where state.country_code = 'BR'
    and state.is_playable;

  return new;
end;
$function$

;

create or replace function private.sync_currency_gdp()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.currency_code<>'USD' or new.brl_per_unit<=0 then return new; end if;
 update public.country_rp_states s set economic_current=s.economic_current||jsonb_build_object('exchangeUsd',new.brl_per_unit)
  ||case when s.economic_current->>'gdpNominalLocal' is not null then jsonb_build_object('gdp',(s.economic_current->>'gdpNominalLocal')::numeric/new.brl_per_unit,'gdpCurrency','USD') else '{}'::jsonb end
 where country_code=new.country_code and (s.economic_current->>'exchangeUsd')::numeric is distinct from new.brl_per_unit;
 return new;
end; $$;
create trigger currency_gdp_conversion after insert or update of brl_per_unit on public.country_rp_exchange_rates for each row execute function private.sync_currency_gdp();
alter function private.sync_currency_gdp() owner to postgres;
revoke all on function private.sync_currency_gdp() from public,anon,authenticated;


CREATE OR REPLACE FUNCTION economy_private.generate_simulated_base(p_month_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  period_row public.economic_periods%rowtype;
  sector_row public.economic_sectors%rowtype;
  state_row public.economic_state%rowtype;
  sector_gdp numeric;
  output_shock numeric;
  policy_output numeric;
  midpoint_rp timestamptz;
  generated_count integer := 0;
  source_id text; previous_period public.economic_periods%rowtype; previous_index numeric; next_index numeric; target_index numeric;
  consumption_factor numeric; investment_factor numeric; government_factor numeric; exports_factor numeric; imports_factor numeric;
  demand_weights numeric; previous_weights numeric; growth_factor numeric; previous_base numeric; period_base numeric; drivers jsonb;
begin
  select * into period_row
  from public.economic_periods
  where id = p_month_period_id
    and period_type = 'month';

  if not found then
    raise exception 'Período mensal não encontrado.';
  end if;

  select * into state_row
  from public.economic_state
  where id = true;

  midpoint_rp := period_row.starts_at_rp
    + ((period_row.ends_at_rp - period_row.starts_at_rp) / 2);
  policy_output := economy_private.active_policy_impact('output_percent');
  select * into previous_period from public.economic_periods where period_type='month' and status='closed' and ends_at_rp<=period_row.starts_at_rp order by ends_at_rp desc limit 1;
  consumption_factor:=greatest(.4,least(1.5,1+economy_private.active_policy_impact('consumption_percent')/100-(state_row.current_selic-10)*.004+(state_row.consumer_confidence-50)*.002));
  investment_factor:=greatest(.25,least(1.6,1+economy_private.active_policy_impact('investment_percent')/100-(state_row.current_selic-10)*.007+(state_row.business_confidence-50)*.003));
  government_factor:=greatest(.7,least(1.3,1+economy_private.active_policy_impact('output_percent')/200+(state_row.fiscal_confidence-50)*.002));
  exports_factor:=greatest(.7,least(1.3,1+(state_row.exchange_rate/5-1)*.08));
  imports_factor:=greatest(.5,least(1.5,consumption_factor-(state_row.exchange_rate/5-1)*.08));
  target_index:=.62*consumption_factor+.18*investment_factor+.16*government_factor+.12*exports_factor-.08*imports_factor;
  previous_index:=coalesce((previous_period.metadata->'causal_economy'->>'demand_index')::numeric,1);
  next_index:=greatest(.5,least(1.5,previous_index+(target_index-previous_index)*.2));
  growth_factor:=greatest(.94,least(1.04,next_index/previous_index));
  previous_base:=coalesce((previous_period.metadata->'causal_economy'->>'real_monthly_base')::numeric,state_row.base_monthly_gdp);
  period_base:=previous_base*growth_factor;
  drivers:=jsonb_build_object('consumption',consumption_factor,'investment',investment_factor,'government',government_factor,'exports',exports_factor,'imports',imports_factor,'selic',state_row.current_selic,'consumer_confidence',state_row.consumer_confidence,'business_confidence',state_row.business_confidence,'fiscal_confidence',state_row.fiscal_confidence,'target_demand_index',target_index,'demand_index',next_index,'real_growth_factor',growth_factor,'real_monthly_base',period_base,'cpi_snapshot',state_row.cpi_index,'player_share',state_row.player_share,'simulated_share',state_row.simulated_share);
  update public.economic_periods set metadata=metadata||jsonb_build_object('causal_economy',drivers) where id=p_month_period_id;
  demand_weights:=greatest(.1,target_index);


  for sector_row in
    select * from public.economic_sectors where is_active order by code
  loop
    output_shock := economy_private.active_shock_impact('output_percent', sector_row.id);
    sector_gdp := period_base * state_row.cpi_index/100
      * state_row.simulated_share
      * sector_row.gdp_weight
      * greatest(.85,least(1.15,1+output_shock/100));
    source_id := period_row.id::text || ':' || sector_row.code;

    perform economy_private.record_event(
      'simulated_gross_output',
      'gross_output',
      'economy_simulation',
      source_id,
      sector_gdp * 1.45,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'production', 'base_share', state_row.simulated_share),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_intermediate_consumption',
      'intermediate_consumption',
      'economy_simulation',
      source_id,
      sector_gdp * .45,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'production'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_household_consumption',
      'household_consumption',
      'economy_simulation',
      source_id,
      sector_gdp * .62 * consumption_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_productive_investment',
      'productive_investment',
      'economy_simulation',
      source_id,
      sector_gdp * .18 * investment_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_government_spending',
      'government_spending',
      'economy_simulation',
      source_id,
      sector_gdp * .16 * government_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'expenditure'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_export',
      'export',
      'economy_simulation',
      source_id,
      sector_gdp * .12 * exports_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'external'),
      'simulated:' || source_id
    );

    perform economy_private.record_event(
      'simulated_import',
      'import',
      'economy_simulation',
      source_id,
      sector_gdp * .08 * imports_factor/demand_weights,
      null, null, null, sector_row.id,
      null, null, 0, 0,
      period_row.starts_at,
      midpoint_rp,
      true,
      1,
      jsonb_build_object('component', 'external'),
      'simulated:' || source_id
    );

    generated_count := generated_count + 7;
  end loop;

  return jsonb_build_object(
    'period_id', p_month_period_id,
    'events_expected', generated_count,
    'simulated_share', state_row.simulated_share, 'drivers', drivers
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION economy_private.close_quarter(p_period_id uuid, p_force boolean DEFAULT false, p_initiated_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
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
  population numeric := economy_private.calibration_numeric('baseline_population',2000000);
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
  event_hash text; fx_snapshot numeric;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:quarter:'||p_period_id::text));

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
  from public.economic_events e
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
    and p.ends_at_rp<=period_row.starts_at_rp
  order by p.ends_at_rp desc limit 1;

  select i.real_value into year_ago_real_gdp
  from public.economic_indicators i
  join public.economic_periods p on p.id=i.period_id
  where i.indicator_code='gdp_real'
    and p.period_type='quarter'
    and p.rp_year=period_row.rp_year-1
    and p.rp_quarter=period_row.rp_quarter
  limit 1;

  growth_quarter := case when coalesce(previous_real_gdp,0)=0 then 0
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
    jsonb_build_object('previous_real_gdp',previous_real_gdp)
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
  left join public.economic_events e
    on e.sector_id=es.id
   and e.occurred_at_rp>=period_row.starts_at_rp
   and e.occurred_at_rp<period_row.ends_at_rp
  where es.is_active
  group by es.id;

  select coalesce(sum(gr.amount),0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from public.economic_events e
      where e.source_table='transactions'
        and e.economic_classification in ('product_tax','income_tax')
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0)
  into revenue
  from public.government_revenues gr
  where gr.occurred_at_rp>=period_row.starts_at_rp
    and gr.occurred_at_rp<period_row.ends_at_rp;

  select coalesce(sum(ge.amount) filter (where ge.expenditure_type<>'debt_interest'),0),
         coalesce(sum(ge.amount) filter (where ge.expenditure_type='social_assistance'),0)
  into expenditure_primary,transfers
  from public.government_expenditures ge
  where ge.occurred_at_rp>=period_row.starts_at_rp
    and ge.occurred_at_rp<period_row.ends_at_rp;

  expenditure_primary := coalesce(expenditure_primary,0)
    + coalesce((
      select sum(abs(e.nominal_amount))
      from public.economic_events e
      where e.source_table='transactions'
        and e.economic_classification='social_transfer'
        and e.occurred_at_rp>=period_row.starts_at_rp
        and e.occurred_at_rp<period_row.ends_at_rp
    ),0);

  select public_debt into old_debt from public.economic_state where id=true;
  interest_cost := old_debt
    * (select current_selic from public.economic_state where id=true)
    / 100 / 4;
  primary_result := revenue-expenditure_primary;
  nominal_result := primary_result-interest_cost;
  new_debt := greatest(0,old_debt-nominal_result);
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
    p_period_id,revenue,
    coalesce((select sum(amount) from public.government_revenues
      where revenue_type='state_dividend'
        and occurred_at_rp>=period_row.starts_at_rp and occurred_at_rp<period_row.ends_at_rp),0),
    0,expenditure_primary,investment,transfers,subsidies,
    interest_cost,primary_result,nominal_result,new_debt,new_debt,
    debt_ratio,(select current_selic from public.economic_state where id=true),
    24,interest_cost,
    coalesce((select treasury_balance from public.government_finances where id=1),0),
    v_fiscal_confidence,fiscal_risk,
    jsonb_build_object('revenue_source','government_revenues_plus_transaction_taxes')
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

  update public.government_finances
  set loans_balance=new_debt,updated_at=now()
  where id=1;

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
  from public.economic_events e
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
$function$

;

CREATE OR REPLACE FUNCTION public.sync_economic_indicator_to_national_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare indicator_value numeric; simulation_delta numeric:=0;
begin
  indicator_value:=case when new.indicator_code='gdp_real' then new.real_value else coalesce(new.nominal_value,new.real_value) end;
  if indicator_value is null then return new; end if;
  insert into public.national_indicator_points(country_code,indicator_code,value,unit,domain,source_type,source_table,source_id,metadata)
  values('BR',new.indicator_code,indicator_value,new.unit,'economy','rp_simulation','economic_indicators',new.id::text,new.metadata);
  simulation_delta:=case
    when new.indicator_code like 'gdp_growth%' then greatest(-3,least(3,coalesce(new.variation,indicator_value)/4))
    when new.indicator_code like 'unemployment%' then greatest(-3,least(3,-coalesce(new.variation,0)/3))
    when new.indicator_code like 'inflation%' then greatest(-3,least(3,-abs(coalesce(new.variation,0))/4))
    else 0 end;
  if simulation_delta<>0 then perform public.apply_government_impact('economy','indicator_updated','Indicador nacional recalculado.',0,simulation_delta,'economic_indicators',new.id::text,jsonb_build_object('indicator',new.indicator_code,'value',indicator_value)); end if;
  return new;
end; $function$

;

do $$
declare gaps jsonb;
begin
 select jsonb_agg(jsonb_build_object('from',previous_at,'until',recorded_at)) into gaps from (
 select recorded_at,lag(recorded_at) over(order by recorded_at) previous_at from public.country_rp_exchange_history where country_code='BR' and currency_code='USD'
 ) h where recorded_at-previous_at>interval '2 hours';
 if gaps is not null then perform economy_private.create_alert('exchange_observation_gaps','warning','Intervalos sem observações cambiais','O histórico contém intervalos sem observações. Não foram geradas cotações retroativas.',null,null,null,jsonb_build_object('gaps',gaps)); end if;
end; $$;
commit;