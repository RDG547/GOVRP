begin;
alter table public.economic_indicators alter column variation type numeric(24,6);
create or replace function public.get_managed_citizen_offers(p_enterprise_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.can_manage_citizen_enterprise(p_enterprise_id),false) then raise exception 'Você não tem acesso à administração destas ofertas.' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'price',p.price,'stock',p.stock,'residence_spec',p.residence_spec,'consumable_effects',p.consumable_effects,'archived',p.archived_at is not null) order by p.name),'[]') from public.products p where p.state_enterprise_id=p_enterprise_id);
end $$;
create or replace function private.broadcast_health_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin perform realtime.send(jsonb_build_object('changed',true),'health-capacity-changed','national-health-capacity',false);return coalesce(new,old);end $$;
create trigger health_capacity_changed after insert on public.healthcare_visits for each statement execute function private.broadcast_health_capacity();
alter table public.state_enterprises add column last_fiscal_cycle_at timestamptz not null default now();
create or replace function private.close_state_enterprise_cycles() returns integer language plpgsql security definer set search_path='' as $$
declare e public.state_enterprises%rowtype;revenue numeric;expense numeric;cycle public.business_balance_cycles%rowtype;cycles integer:=0;start_at timestamptz;end_at timestamptz;
begin
 for e in select * from public.state_enterprises where not is_privatized and last_fiscal_cycle_at+interval '7 days'<=now() order by id for update loop
  start_at:=e.last_fiscal_cycle_at;end_at:=start_at+interval '7 days';
  select coalesce(sum(amount),0) into revenue from public.government_revenues r where r.occurred_at_real>=start_at and r.occurred_at_real<end_at and (r.metadata->>'state_enterprise_id'=e.id::text or r.metadata->>'enterprise_id'=e.id::text or exists(select 1 from public.residence_leases l where l.id::text=r.metadata->>'lease_id' and l.state_enterprise_id=e.id));
  select coalesce(sum(amount),0) into expense from public.government_expenditures x where x.occurred_at_real>=start_at and x.occurred_at_real<end_at and (x.metadata->>'state_enterprise_id'=e.id::text or x.metadata->>'enterprise_id'=e.id::text);
  insert into public.business_balance_cycles(state_enterprise_id,cycle_start_at,gross_revenue,operating_cost,net_result,result_type,metadata) values(e.id,start_at,revenue,expense,revenue-expense,case when revenue>=expense then 'profit' else 'loss' end,jsonb_build_object('period_end',end_at,'engine_version','2.0.0','source','government_ledger','profit_is_not_credited_again',true)) on conflict(state_enterprise_id,cycle_start_at) where state_enterprise_id is not null do nothing returning * into cycle;
  update public.state_enterprises set last_fiscal_cycle_at=end_at where id=e.id;
  if cycle.id is not null then
   cycles:=cycles+1;
   if e.manager_id is not null then insert into public.notifications(user_id,type,content,link,metadata) values(e.manager_id,'business_balance',e.name||' fechou o exercício com resultado de R$ '||(revenue-expense)||'.','/dashboard',jsonb_build_object('cycle_id',cycle.id,'state_enterprise_id',e.id,'net_result',revenue-expense));end if;
  end if;
 end loop;return cycles;
end $$;
revoke all on function public.get_managed_citizen_offers(uuid) from public,anon;
grant execute on function public.get_managed_citizen_offers(uuid) to authenticated;
revoke all on function private.broadcast_health_capacity(),private.close_state_enterprise_cycles() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.run_company_economy()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b record; company_row public.businesses%rowtype; start_day date; day date; result jsonb; cycles integer:=0; processed integer:=0; sold numeric:=0; period_start date:=date_trunc('week',now())::date-7;
begin
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 perform pg_advisory_xact_lock(hashtextextended('govrp:company-economy',0));
 -- A common lock order keeps payroll, capital and B2B settlement atomic with the hourly engine.
 perform id from public.businesses order by id for update;
 perform id from public.accounts order by id for update;
 select greatest(current_date-6,coalesce(min(coalesce(last_simulated_on+1,created_at::date)),current_date)) into start_day from public.businesses where status='active' and region_code is not null;
 for day in select generate_series(start_day,current_date,interval '1 day')::date loop
  for b in select id from public.businesses where status='active' and region_code is not null and created_at::date<=day and (last_simulated_on is null or last_simulated_on<day) order by id loop
   perform private.simulate_company_day(b.id,day);processed:=processed+1;
  end loop;
  sold:=sold+private.simulate_population_demand(day);
 end loop;
 for company_row in select * from public.businesses where status in('active','suspended') order by id loop
  if company_row.last_fiscal_cycle_at+interval '7 days'<=now() then
   perform private.pay_company_wages(company_row.id);
   while company_row.last_fiscal_cycle_at+interval '7 days'<=now() loop
    result:=private.close_company_fiscal_cycle(company_row.id,now());
    exit when result is null;
    cycles:=cycles+1;
    select * into company_row from public.businesses where id=company_row.id;
   end loop;
  end if;
 end loop;
 update public.business_supply_contracts set status='expired' where status='active' and ends_at<=now();
 insert into public.business_national_cycles(cycle_start,cycle_end,revenue,profit,employment,output,company_count,by_region)
 select period_start,period_start+7,coalesce(sum(d.revenue),0),coalesce(sum(d.revenue-d.payroll_accrued-d.input_cost-d.overhead),0),(select count(*) from public.business_employees where fired_at is null),coalesce(sum(d.produced_quantity),0),(select count(*) from public.businesses where status='active'),coalesce((select jsonb_object_agg(region_code,stats) from(select biz.region_code,jsonb_build_object('revenue',sum(x.revenue),'output',sum(x.produced_quantity),'companies',count(distinct biz.id)) stats from public.business_daily_operations x join public.businesses biz on biz.id=x.business_id where x.operation_date>=period_start and x.operation_date<period_start+7 and biz.region_code is not null group by biz.region_code) regions),'{}'::jsonb) from public.business_daily_operations d where d.operation_date>=period_start and d.operation_date<period_start+7
 on conflict(cycle_start) do nothing;
 perform private.close_state_enterprise_cycles();
 return jsonb_build_object('success',true,'processed_company_days',processed,'closed_cycles',cycles,'population_spending',sold,'processed_at',now());
end $function$;
CREATE OR REPLACE FUNCTION private.execute_investment_trade(p_investment_id uuid, p_operation_type text, p_quantity numeric, p_idempotency_key uuid, p_expected_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); option public.investment_options%rowtype; account public.accounts%rowtype; reserve public.accounts%rowtype;holding public.user_investments%rowtype;operation public.investment_operations%rowtype;amount numeric(20,2);new_quantity numeric(24,8);new_average numeric(20,6);realized numeric(20,2):=0;transaction_id uuid;portfolio_cost numeric;portfolio_value numeric;
begin
 if actor is null then raise exception 'Entre para negociar investimentos.' using errcode='42501';end if;
 if p_operation_type is null or p_operation_type not in('buy','sell') or p_quantity is null or p_quantity<=0 or p_quantity>1000000000 or p_quantity<>round(p_quantity,8) or p_idempotency_key is null then raise exception 'Informe uma quantidade válida com até oito casas decimais.';end if;
 perform pg_advisory_xact_lock(hashtext('govrp:stock-market'));
 select * into operation from public.investment_operations where idempotency_key=p_idempotency_key;
 if found then
  if operation.user_id<>actor or operation.investment_id<>p_investment_id or operation.operation_type<>p_operation_type or operation.quantity<>p_quantity then raise exception 'Este identificador pertence a outra operação.';end if;
  return jsonb_build_object('success',true,'message','Operação já processada.','operation',to_jsonb(operation));
 end if;
 select * into option from public.investment_options where id=p_investment_id and is_active for update;
 if not found then raise exception 'Este investimento está indisponível.';end if;
 if option.asset_type='stock' and (p_quantity<>trunc(p_quantity) or p_expected_price is null) then raise exception 'Negocie ações inteiras pela BNV, confirmando a cotação atual.';end if;
 if p_expected_price is not null and p_expected_price<>option.current_unit_price then raise exception 'A cotação mudou. Confira o novo valor antes de confirmar.';end if;
 amount:=round(p_quantity*option.current_unit_price,2);if amount<=0 then raise exception 'Valor da operação abaixo de um centavo.';end if;
 select * into account from public.accounts where user_id=actor and account_kind='personal';
 select * into reserve from public.accounts where investment_id=option.id and account_kind='investment_reserve';
 if account.id is null then raise exception 'Abra uma conta no Banco Nacional.';end if;
 if reserve.id is null and option.asset_type<>'stock' then insert into public.accounts(account_kind,investment_id,account_number,agency_number,balance) values('investment_reserve',option.id,'BNV-'||replace(option.id::text,'-',''),'0003',0) returning * into reserve;end if;
 if reserve.id is null then raise exception 'Esta aplicação aguarda a constituição de sua reserva financeira.';end if;
 perform id from public.accounts where id in(account.id,reserve.id) order by id for update;
 select * into account from public.accounts where id=account.id;select * into reserve from public.accounts where id=reserve.id;
 select * into holding from public.user_investments where user_id=actor and investment_id=option.id for update;
 if p_operation_type='buy' then
  if option.asset_type<>'stock' and amount<option.minimum_amount then raise exception 'O valor está abaixo da aplicação mínima.';end if;
  if account.balance<amount then raise exception 'Saldo insuficiente na conta pessoal.';end if;
  if option.asset_type='stock' and option.available_shares<p_quantity then raise exception 'Não há ações suficientes na oferta disponível.';end if;
  update public.accounts set balance=balance-amount,updated_at=now() where id=account.id;
  update public.accounts set balance=balance+amount,updated_at=now() where id=reserve.id;
  if holding.id is null then
   insert into public.user_investments(user_id,investment_id,amount_invested,quantity,average_unit_price,start_date,updated_at) values(actor,option.id,amount,p_quantity,option.current_unit_price,now(),now()) returning * into holding;
  else
   new_quantity:=holding.quantity+p_quantity;new_average:=round((holding.amount_invested+amount)/new_quantity,6);
   update public.user_investments set quantity=new_quantity,average_unit_price=new_average,amount_invested=amount_invested+amount,is_active=true,updated_at=now() where id=holding.id returning * into holding;
  end if;
  update public.investment_options set available_shares=available_shares-p_quantity where id=option.id and asset_type='stock';
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(account.id,reserve.id,amount,'investment_buy','Compra de '||coalesce(nullif(option.asset_symbol,''),option.name),jsonb_build_object('investmentId',option.id,'quantity',p_quantity,'unitPrice',option.current_unit_price,'fees',0),p_idempotency_key) returning id into transaction_id;
 else
  if holding.id is null or holding.quantity<p_quantity then raise exception 'Você não possui a quantidade informada para venda.';end if;
  if reserve.balance<amount then raise exception 'Liquidez insuficiente nesta oferta. Reduza a quantidade ou aguarde novas negociações.';end if;
  realized:=round(amount-p_quantity*holding.average_unit_price,2);new_quantity:=holding.quantity-p_quantity;
  update public.accounts set balance=balance-amount,updated_at=now() where id=reserve.id;
  update public.accounts set balance=balance+amount,updated_at=now() where id=account.id;
  update public.user_investments set quantity=new_quantity,amount_invested=case when new_quantity=0 then 0 else greatest(0,amount_invested-round(p_quantity*average_unit_price,2)) end,is_active=new_quantity>0,realized_result=realized_result+realized,updated_at=now() where id=holding.id returning * into holding;
  update public.investment_options set available_shares=available_shares+p_quantity where id=option.id and asset_type='stock';
  insert into public.transactions(from_account_id,to_account_id,amount,type,description,metadata,idempotency_key) values(reserve.id,account.id,amount,'investment_sell','Venda de '||coalesce(nullif(option.asset_symbol,''),option.name),jsonb_build_object('investmentId',option.id,'quantity',p_quantity,'unitPrice',option.current_unit_price,'realizedResult',realized,'fees',0),p_idempotency_key) returning id into transaction_id;
 end if;
 insert into public.investment_operations(idempotency_key,user_id,investment_id,holding_id,operation_type,quantity,unit_price,gross_amount,realized_result,transaction_id,metadata) values(p_idempotency_key,actor,option.id,holding.id,p_operation_type,p_quantity,option.current_unit_price,amount,realized,transaction_id,jsonb_build_object('reserve_account_id',reserve.id,'fees',0)) returning * into operation;
 select coalesce(sum(ui.amount_invested),0),coalesce(sum(ui.quantity*io.current_unit_price),0) into portfolio_cost,portfolio_value from public.user_investments ui join public.investment_options io on io.id=ui.investment_id where ui.user_id=actor and ui.is_active;
 insert into public.investment_portfolio_snapshots(user_id,total_cost,market_value,unrealized_result) values(actor,round(portfolio_cost,2),round(portfolio_value,2),round(portfolio_value-portfolio_cost,2));
 return jsonb_build_object('success',true,'message',case when p_operation_type='buy' then 'Compra concluída.' else 'Venda concluída.' end,'operation',to_jsonb(operation),'holding',to_jsonb(holding));
end $function$;
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
      * greatest(0,1-coalesce((select count(*)::numeric from public.business_employees e join public.businesses b on b.id=e.business_id where b.control_kind='population' and e.fired_at is null and b.economic_sector_id=sector_row.id)/nullif((select sum(population)*.6 from public.economic_regions)*greatest(.01,sector_row.gdp_weight),0),0))
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
$function$;

notify pgrst,'reload schema';
commit;
