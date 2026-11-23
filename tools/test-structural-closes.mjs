import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'',error.detail||'');process.exit(1);});
const db=await createStructuralTestDatabase();const exec=s=>db.exec(s),row=async s=>(await db.query(s)).rows[0];
let checks=0;const check=(x,m)=>{assert(x,m);checks++;};
for(const f of ['schema','extra-schema','close-schema','macro-runtime','close-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${f}.sql`,import.meta.url),'utf8'));
for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
// External presentation/activity boundaries are inert. All actual monthly,
// quarterly and annual accounting, tax estimation and debt updates execute.
await exec(`SET TIME ZONE 'UTC';
 UPDATE economy_private.period_transition_policy SET month_from='2020-01-01',quarter_from='2020-01-01',year_from='2020-01-01';
 CREATE SCHEMA extensions;
 CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS 'SELECT sha256(convert_to($1,''UTF8''))';
 CREATE FUNCTION economy_private.active_policy_impact(text) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
 CREATE FUNCTION economy_private.active_shock_impact(text,uuid DEFAULT NULL) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
 CREATE FUNCTION economy_private.refresh_citizen_labor_statuses() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
 CREATE FUNCTION economy_private.calculate_citizen_snapshots(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION economy_private.calculate_business_snapshots(uuid) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION economy_private.publish_bulletin(uuid,text) RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION economy_private.create_alert(text,text,text,text,uuid,uuid DEFAULT NULL,uuid DEFAULT NULL,jsonb DEFAULT '{}') RETURNS uuid LANGUAGE sql AS 'SELECT gen_random_uuid()';
 ALTER TABLE public.economic_events ADD UNIQUE(source_table,source_id,event_type);
 INSERT INTO public.economic_state(id,base_monthly_gdp,simulated_share,player_share,public_debt) VALUES(true,1000,1,0,100);
 INSERT INTO public.government_finances(id,treasury_balance) VALUES(1,321);
 INSERT INTO public.economic_sectors(code,name,gdp_weight) VALUES('qa','Test',1);
 INSERT INTO public.price_basket_items(code,name,category,weight,base_price,current_price) VALUES('qa','Test','qa',1,100,100);
 UPDATE economy_private.fiscal_model_config SET effective_from_rp='2020-01-01';
 INSERT INTO public.government_rules(rule_key,numeric_value,description,rule_kind,definition) VALUES('consumption',.1,'Tax','tax','{"basis":"purchase","nature":"percentage"}');
 UPDATE economy_private.fiscal_rule_history SET observed_from='2020-01-01';
 SET TIME ZONE 'America/Sao_Paulo';`);
const quarters=[];
for(let m=1;m<=12;m++){
 await exec(`SELECT economy_private.ensure_periods('2020-${String(m).padStart(2,'0')}-15T12:00Z')`);
 const id=(await row(`SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=${m}`)).id;
 const result=(await row(`SELECT economy_private.close_month('${id}',false,null) value`)).value;
 check(result.period_id===id&&!result.status,`Month ${m} closes with actual generation, CPI, employment, confidence and fiscal capture`);
 check((await row(`SELECT economy_private.close_month('${id}',true,null) value`)).value.status==='already_closed',`Month ${m} retry preserves published accounting`);
 if(m%3===0){
  const q=(await row(`SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2020 AND rp_quarter=${m/3}`)).id;
  const close=(await row(`SELECT economy_private.close_quarter('${q}',false,null) value`)).value;
  check(close.gdp_nominal>0&&Math.abs(close.gdp_production-close.gdp_expenditure)<.02,'Quarter reconciles production and expenditure from three immutable months');
  const expected=Number((await row(`SELECT sum(CASE economic_classification WHEN 'gross_output' THEN economic_amount WHEN 'intermediate_consumption' THEN -economic_amount ELSE 0 END) n FROM economy_private.period_input_events('${q}')`)).n);
  check(Math.abs(close.gdp_nominal-expected)<.01,'Published quarterly GDP equals captured monthly inputs');
  const fiscal=await row(`SELECT * FROM public.fiscal_periods WHERE period_id='${q}'`);
  check(fiscal.metadata.model==='national_fiscal_v2'&&Number(fiscal.public_investment)===0,'Private investment is not booked as government spending');
  quarters.push(close);
 }
}
const y=(await row("SELECT id FROM public.economic_periods WHERE period_type='year' AND rp_year=2020")).id;
// A year-end balance is a stock, never the maximum seen earlier in the year.
await exec("UPDATE public.fiscal_periods SET gross_debt=999999 WHERE period_id IN(SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_quarter=1)");
const annual=(await row(`SELECT economy_private.close_year('${y}',false,null) value`)).value;
check(Math.abs(annual.public_debt-quarters.at(-1).public_debt)<.01,'Annual debt reports the last quarter balance even if an earlier quarter was higher');
check(Math.abs(annual.gdp_nominal-quarters.reduce((s,q)=>s+q.gdp_nominal,0))<.03,'Annual GDP equals its four closed quarters');
check(Number((await row('SELECT treasury_balance FROM public.government_finances')).treasury_balance)===321,'Twelve monthly and four fiscal closes never modify operational Treasury cash');
const publicDashboard=(await row('SELECT public.get_public_economic_dashboard() value')).value;
check(Math.abs(publicDashboard.headline.gdp_nominal-quarters.at(-1).gdp_nominal)<.01,'Public headline uses latest quarterly GDP rather than annual total');
check(publicDashboard.history.every(p=>p.period_type!=='year'),'History does not mix annual totals with quarterly GDP');
await db.close();console.log(`PASS: ${checks} complete-close PostgreSQL assertions; presentation and external activity boundaries are explicit fixtures.`);
