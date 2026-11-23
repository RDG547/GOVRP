import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'');process.exit(1);});
const db=await createStructuralTestDatabase();
const exec=s=>db.exec(s), row=async s=>(await db.query(s)).rows[0];
let checks=0;
const check=(x,message)=>{assert(x,message);checks++;};
for(const file of ['schema','extra-schema','macro-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${file}.sql`,import.meta.url),'utf8'));
for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
// Controlled clock/policy fixtures. Actual pricing, CPI and cycle SQL runs unchanged.
await exec(`CREATE OR REPLACE FUNCTION public.rp_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT current_setting(''test.rp_now'')::timestamptz';
 CREATE FUNCTION economy_private.active_policy_impact(text) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
 CREATE FUNCTION economy_private.active_shock_impact(text,uuid DEFAULT NULL) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
 CREATE FUNCTION economy_private.create_alert(text,text,text,text,uuid) RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
 INSERT INTO public.economic_state(id) VALUES(true);
 INSERT INTO public.price_basket_items(code,name,category,weight,base_price,current_price) VALUES('food','Food','food',2,100,100),('energy','Energy','energy',1,100,100);
 SET test.rp_now='2020-01-01T00:00:00Z';`);
const tick=async id=>(await row(`SELECT economy_private.process_operational_prices('${id}') value`)).value;
const id='00000000-0000-4000-8000-000000000010';
await tick(id);
await exec("SET test.rp_now='2020-01-16T00:00:00Z'");
check((await tick(id)).observations===0,'Retry does not update prices before detecting duplicate observations');
const price=async()=>Number((await row("SELECT current_price FROM public.price_basket_items WHERE code='food'")).current_price);
const evolution=async ticks=>{
 await exec('BEGIN');
 for(let n=1;n<=ticks;n++){
  const date=new Date(Date.UTC(2020,0,1)+30*86400000*n/ticks).toISOString();
  await exec(`SET test.rp_now='${date}'; SELECT economy_private.process_operational_prices(gen_random_uuid())`);
 }
 const result=await price(); await exec('ROLLBACK'); return result;
};
check(Math.abs(await evolution(1)-await evolution(30))<.003,'One versus thirty ticks over identical RP time yields the same price within storage rounding');
await exec("SET test.rp_now='2020-01-31T00:00:00Z'; SELECT economy_private.process_operational_prices(gen_random_uuid())");
check(await price()>100 && await price()<101,'Annual inflation target produces gradual monthly inflation');
const month=(await row("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=1")).id;
const cpi=(await row(`SELECT economy_private.calculate_cpi('${month}') value`)).value;
check(cpi.cpi>100&&cpi.cpi<101,'CPI normalizes weights whose sum is not one');
check(cpi.annual_inflation===null,'Missing twelve-month history is not presented as observed annual inflation');
await exec(`INSERT INTO public.price_observations(basket_item_id,source_table,source_id,price,is_simulated,observed_at_rp)
 SELECT id,'raw_product','different_unit',999999,false,'2020-01-31T23:00Z' FROM public.price_basket_items;`);
check((await row(`SELECT economy_private.calculate_cpi('${month}') value`)).value.cpi===cpi.cpi,'An unnormalized product price cannot replace a comparable basket index');
await exec(`UPDATE public.price_basket_items SET current_price=9999;`);
check((await row(`SELECT economy_private.calculate_cpi('${month}') value`)).value.cpi===cpi.cpi,'Later current prices do not leak into historical CPI calculation');
await exec(`SELECT economy_private.ensure_periods('2020-04-15');
 UPDATE public.economic_periods SET status='closed' WHERE rp_year=2020 AND rp_quarter=1 AND period_type='quarter';
 INSERT INTO public.economic_indicators(period_id,indicator_code,real_value,nominal_value)
 SELECT id,'gdp_growth_quarterly',case when rp_quarter=1 then 2 else -5 end,case when rp_quarter=1 then 2 else -5 end
 FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2020;`);
const q=(await row("SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_quarter=2 AND rp_year=2020")).id;
check((await row(`SELECT economy_private.detect_cycle('${q}') value`)).value==='slowdown','One severe contraction is not declared persistent recession');
await exec("UPDATE public.economic_indicators SET real_value=-1,nominal_value=-1 WHERE indicator_code='gdp_growth_quarterly' AND period_id IN(SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_quarter=1)");
check((await row(`SELECT economy_private.detect_cycle('${q}') value`)).value==='deep_recession','Two persistent contractions still report recession; negative results are not hidden');
await exec(`UPDATE public.economic_periods SET status='closed' WHERE id='${q}';
 SELECT economy_private.ensure_periods('2020-07-15'); SELECT economy_private.ensure_periods('2020-10-15');
 INSERT INTO public.economic_indicators(period_id,indicator_code,real_value,nominal_value)
 SELECT id,'gdp_growth_quarterly',1,1 FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2020 AND rp_quarter IN (3,4);`);
const q3=(await row("SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_quarter=3 AND rp_year=2020")).id;
const q4=(await row("SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_quarter=4 AND rp_year=2020")).id;
check((await row(`SELECT economy_private.detect_cycle('${q3}') value`)).value==='slowdown','First positive quarter after recession is not yet a persistent recovery');
await exec(`UPDATE public.economic_periods SET status='closed' WHERE id='${q3}'`);
check((await row(`SELECT economy_private.detect_cycle('${q4}') value`)).value==='recovery','Second positive quarter recognizes recovery from the two preceding contractions');
await exec("UPDATE public.economic_state SET economic_cycle='boom'");
check((await row(`SELECT economy_private.detect_cycle('${q4}') value`)).value==='recovery','Classification depends on period history rather than mutable global cycle');
await exec("SET test.rp_now='2020-12-20T00:00:00Z'; SELECT economy_private.process_operational_prices(gen_random_uuid())");
check(Number((await row(`SELECT count(*) n FROM public.price_observations o JOIN public.economic_periods p ON p.id=o.period_id
 WHERE o.source_table='economic_engine_runs' AND (o.observed_at_rp<p.starts_at_rp OR o.observed_at_rp>=p.ends_at_rp)`)).n)===0,'Backlogged price observations belong to their actual RP month');
await exec(`INSERT INTO public.country_population_segments(country_code,segment_key,name,description,population_share,population_count)
 VALUES('BR','test','Test','Fixture',1,212000000);`);
check(Number((await row('SELECT economy_private.national_population() n')).n)===212000000,'National statistics use the actual demographic population');
await db.close();
console.log('PASS: '+checks+' macroeconomic PostgreSQL assertions (controlled clock and policy boundaries).');
