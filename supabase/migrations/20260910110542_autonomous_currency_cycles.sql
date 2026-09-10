begin;
-- Advance the existing market once per operational hour. Never fabricate missed quotes.
create or replace function public.recalculate_currency_market(
  p_country_code text,p_cycle_key text,p_advance boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_country text:=upper(coalesce(nullif(p_country_code,''),'BR'));
  v_cycle text:=coalesce(nullif(p_cycle_key,''),to_char(clock_timestamp(),'YYYY-MM-DD-HH24'));
  v_state public.currency_market_states%rowtype;
  v_economy public.economic_state%rowtype;
  v_driver numeric;
  v_delta numeric;
  v_brl_strength numeric:=1;
  v_revision bigint:=0;
  v_result jsonb;
begin
  if p_advance then
    perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
    perform 1 from public.economic_state where id=true for update;
    perform pg_advisory_xact_lock(hashtext('govrp:currency:'||v_country));
  end if;
  if p_advance and exists(
    select 1 from public.currency_market_cycles where country_code=v_country and cycle_key=v_cycle
  ) then
    select state_snapshot into v_result from public.currency_market_cycles
    where country_code=v_country and cycle_key=v_cycle;
    return v_result;
  end if;
  select * into v_economy from public.economic_state where id=true;
  select revision into v_revision from public.country_rp_states where country_code=v_country;

  for v_state in
    select * from public.currency_market_states where country_code=v_country
    order by currency_code for update
  loop
    if v_state.currency_code='BRL' then
      v_driver:=coalesce(v_economy.current_selic,10)*.00045
        -coalesce(v_economy.inflation_target,3)*.00065
        +(coalesce(v_economy.consumer_confidence,50)-50)*.00008
        +(coalesce(v_economy.fiscal_confidence,50)-50)*.00009
        -(v_state.risk_factor-50)*.00008;
    else
      v_driver:=(v_state.economic_strength-50)*.000025
        +(v_state.interest_factor-50)*.000018
        -(v_state.inflation_factor-50)*.00002
        -(v_state.risk_factor-50)*.000018
        +(v_state.stability_factor-50)*.000012
        +(v_state.international_demand-50)*.000015
        +v_state.trend;
    end if;
    v_delta:=greatest(-v_state.volatility,least(v_state.volatility,
      v_driver+(1-v_state.current_strength)*.025));
    if p_advance then
      update public.currency_market_states
      set current_strength=greatest(.5,least(1.5,current_strength+v_delta)),
          last_cycle_key=v_cycle,updated_at=clock_timestamp()
      where country_code=v_country and currency_code=v_state.currency_code
      returning current_strength into v_state.current_strength;
    end if;
    if v_state.currency_code='BRL' then v_brl_strength:=v_state.current_strength; end if;
  end loop;

  for v_state in
    select * from public.currency_market_states where country_code=v_country and currency_code<>'BRL'
    order by currency_code
  loop
    perform public.upsert_country_rp_exchange_rate(
      v_country,v_state.currency_code,
      greatest(.000001,v_state.base_brl_per_unit*v_state.current_strength/greatest(.5,v_brl_strength)),
      'independent_currency_market',v_revision
    );
  end loop;
  select jsonb_object_agg(rate.currency_code,jsonb_build_object(
    'brlPerUnit',rate.brl_per_unit,'strength',state.current_strength,'updatedAt',rate.updated_at
  )) into v_result
  from public.country_rp_exchange_rates rate
  join public.currency_market_states state using(country_code,currency_code)
  where rate.country_code=v_country;
  if p_advance then
    insert into public.currency_market_cycles(country_code,cycle_key,state_snapshot)
    values(v_country,v_cycle,coalesce(v_result,'{}'::jsonb))
    on conflict(country_code,cycle_key) do nothing;
  end if;
  return coalesce(v_result,'{}'::jsonb);
end;
$$;

create or replace function public.run_currency_market_cycle(p_cycle_key text default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role'
     and not exists(select 1 from public.profiles where id=auth.uid() and role='Admin' and deleted_at is null) then
    raise exception 'CURRENCY_MARKET_ADMIN_REQUIRED';
  end if;
  return public.recalculate_currency_market('BR',p_cycle_key,true);
end;
$$;

CREATE OR REPLACE FUNCTION "economy_private"."run_operational_engine"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  run_id uuid;
  rp_at timestamptz:=public.rp_now();
  offset_month integer;
  period_row public.economic_periods%rowtype;
  activity_result jsonb;
  status_result jsonb;
  price_result jsonb;
  currency_result jsonb;
  closed_months integer:=0;
  closed_quarters integer:=0;
  closed_years integer:=0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
  insert into public.economic_engine_runs(run_type,engine_version,status)
  values ('operational','1.0.0','running')
  returning id into run_id;

  for offset_month in 0..3 loop
    perform economy_private.ensure_periods(rp_at-(offset_month||' months')::interval);
  end loop;

  status_result:=economy_private.refresh_policy_and_shock_statuses();
  activity_result:=economy_private.update_activity_mix();
  currency_result:=public.recalculate_currency_market('BR','operational:'||to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD-HH24'),true);
  price_result:=economy_private.process_operational_prices(run_id);

  for period_row in
    select * from public.economic_periods
    where period_type='month' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_month(period_row.id,true,null);
    closed_months:=closed_months+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='quarter' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_quarter(period_row.id,true,null);
    closed_quarters:=closed_quarters+1;
  end loop;

  for period_row in
    select * from public.economic_periods
    where period_type='year' and status in ('open','failed') and ends_at<=now()
    order by ends_at
  loop
    perform economy_private.close_year(period_row.id,true,null);
    closed_years:=closed_years+1;
  end loop;

  update public.economic_state
  set last_operational_run_at=now(),updated_at=now()
  where id=true;

  result:=jsonb_build_object(
    'run_id',run_id,'rp_at',rp_at,'activity',activity_result,
    'statuses',status_result,'prices',price_result,'currency',currency_result,
    'closed_months',closed_months,
    'closed_quarters',closed_quarters,
    'closed_years',closed_years
  );
  update public.economic_engine_runs
  set status='completed',finished_at=now(),results=result,
      output_hash=encode(extensions.digest(result::text,'sha256'),'hex')
  where id=run_id;
  return result;
exception
  when others then
    if run_id is not null then
      update public.economic_engine_runs
      set status='failed',finished_at=now(),
          errors=jsonb_build_array(jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm))
      where id=run_id;
    end if;
    raise;
end;
$$;



notify pgrst,'reload schema';
commit;
