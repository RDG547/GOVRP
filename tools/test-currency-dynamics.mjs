import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Local PostgreSQL only. Rollback also restores every historical quotation.
const result = execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  encoding: 'utf8',
  input: `begin;
select pg_advisory_xact_lock(hashtext('govrp:economy:operational'));
create temporary table cycle_returns(step integer,currency text,change numeric);
do $test$
declare snapshot jsonb; repeated jsonb; initial_strength jsonb; previous jsonb; final_strength jsonb;
  steps integer; rows_before bigint; diverse_cycles integer; run integer; fingerprint text;
begin
  if has_function_privilege('authenticated','public.recalculate_currency_market(text,text,boolean)','execute')
    or has_function_privilege('anon','public.recalculate_currency_market(text,text,boolean)','execute') then
    raise exception 'Currency engine is directly callable by an unauthorized client';
  end if;
  for run in 1..2 loop
    delete from public.currency_market_cycles where country_code='BR';
    update public.currency_market_states s set current_strength=1,
      economic_strength=d.economic_strength,interest_factor=d.interest_factor,inflation_factor=d.inflation_factor,
      risk_factor=d.risk_factor,stability_factor=d.stability_factor,trend=d.trend,
      international_demand=d.international_demand,volatility=d.volatility
    from private.currency_market_defaults() d where s.country_code='BR' and s.currency_code=d.currency_code;
    for steps in 1..240 loop
      select jsonb_object_agg(currency_code,current_strength) into previous from public.currency_market_states where country_code='BR';
      snapshot:=public.recalculate_currency_market('BR','currency-regression:'||steps,true);
      if run=1 then
        insert into cycle_returns
        select steps,currency_code,round(100*((current_strength/(previous->>currency_code)::numeric)/
          ((select current_strength from public.currency_market_states where country_code='BR' and currency_code='BRL')/(previous->>'BRL')::numeric)-1),4)
        from public.currency_market_states where country_code='BR' and currency_code<>'BRL';
      end if;
      if exists(select 1 from public.currency_market_states where country_code='BR'
        and (abs(current_strength-(previous->>currency_code)::numeric)>volatility+.00000001 or current_strength not between .5 and 1.5)) then
        raise exception 'Currency exceeded its configured volatility or strength boundary';
      end if;
    end loop;
    select jsonb_object_agg(currency_code,current_strength) into final_strength from public.currency_market_states where country_code='BR';
    if run=1 then initial_strength:=final_strength;
    elsif initial_strength<>final_strength then raise exception 'Identical initial conditions did not reproduce the simulation';end if;
  end loop;
  select count(*) into diverse_cycles from(select step from cycle_returns where step>180 group by step having count(distinct change)>=4) q;
  if diverse_cycles<55 then raise exception 'Currencies converged to a shared percentage after 180 cycles: %',diverse_cycles;end if;
  select count(*) into rows_before from public.country_rp_exchange_history;
  repeated:=public.recalculate_currency_market('BR','currency-regression:240',true);
  if snapshot<>repeated or rows_before<>(select count(*) from public.country_rp_exchange_history) then
    raise exception 'Retry changed the market or added historical quotes';
  end if;
  if exists(select 1 from public.country_rp_exchange_rates r join public.currency_market_states s using(country_code,currency_code)
    where r.country_code='BR' and abs(r.brl_per_unit-s.base_brl_per_unit*s.current_strength/
      (select current_strength from public.currency_market_states where country_code='BR' and currency_code='BRL'))>.000001) then
    raise exception 'A persisted quote does not reflect its own currency/BRL pair';
  end if;
  raise notice 'PASS: 480 cycles, deterministic replay, independent pairs, volatility bounds, idempotency and backend permissions';
end $test$;
rollback;`,
  maxBuffer: 1024 * 1024,
});
assert(result.includes('ROLLBACK'));
console.log('✓ Câmbio: 480 ciclos reais aprovados; todas as alterações foram revertidas.');
