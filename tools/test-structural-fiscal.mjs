import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'');process.exit(1);});
const db=await createStructuralTestDatabase();const exec=s=>db.exec(s),row=async s=>(await db.query(s)).rows[0];
let checks=0;const check=(x,m)=>{assert(x,m);checks++;};
for(const f of ['schema','extra-schema','macro-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${f}.sql`,import.meta.url),'utf8'));
for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
await exec(`SET TIME ZONE 'UTC'; SELECT economy_private.ensure_periods('2020-01-15');
 UPDATE economy_private.fiscal_model_config SET effective_from_rp='2020-01-01';
 INSERT INTO public.economic_state(id,public_debt) VALUES(true,1000);
 INSERT INTO public.government_finances(id,treasury_balance) VALUES(1,123);
 INSERT INTO public.government_rules(rule_key,numeric_value,description,rule_kind,definition) VALUES
 ('consumption',.1599,'Consumption','tax','{"nature":"percentage","basis":"purchase","audience":"all","payer":"buyer"}'),
 ('corporate',.2816,'Corporate','tax','{"nature":"percentage","basis":"purchase","audience":"business","payer":"seller"}');
 UPDATE economy_private.fiscal_rule_history SET observed_from='2020-01-01';`);
const month=(await row("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_month=1")).id;
await exec(`INSERT INTO public.economic_events(event_type,economic_classification,source_table,source_id,occurred_at_rp,is_simulated,economic_amount,nominal_amount)
 VALUES('output','gross_output','economy_simulation','test','2020-01-15',true,1000,1000),
 ('spending','government_spending','economy_simulation','test','2020-01-15',true,160,160),
 ('tax','product_tax','transactions','receipt','2020-01-15',false,10000,10),
 ('tax','income_tax','transactions','fallback','2020-01-15',false,5000,5),
 ('npc','gross_output','transactions','npc','2020-01-15',false,500,500);
 INSERT INTO public.government_revenues(revenue_type,source_table,source_id,amount,occurred_at_rp) VALUES('consumption_tax','transactions','receipt',10,'2020-01-15');
 INSERT INTO public.government_expenditures(expenditure_type,source_table,source_id,amount,occurred_at_rp) VALUES
 ('social_assistance','automatic_stabilizers','qa',20,'2020-01-15'),('maintenance','transactions','qa',7,'2020-01-15');
 SELECT economy_private.capture_period_inputs('${month}');`);
const captured=Number((await row(`SELECT count(*) n FROM economy_private.period_input_events('${month}')`)).n);
await exec(`INSERT INTO public.economic_events(event_type,economic_classification,source_table,source_id,occurred_at_rp,is_simulated,economic_amount,nominal_amount)
 VALUES('late','gross_output','economy_simulation','late','2020-01-20',true,9999,9999);
 SELECT economy_private.capture_period_inputs('${month}');`);
check(Number((await row(`SELECT count(*) n FROM economy_private.period_input_events('${month}')`)).n)===captured,'Captured monthly inputs are immutable on retry');
await exec(`SELECT economy_private.capture_national_fiscal_month('${month}')`);
const fiscal=await row(`SELECT * FROM economy_private.national_fiscal_months WHERE period_id='${month}'`);
check(Number(fiscal.estimated_tax)===441.5,'Statutory consumption and corporate rates apply once to synthetic turnover');
check(Number(fiscal.operational_revenue)===15,'Tax receipt and its classified event are not counted twice');
check(Number(fiscal.government_consumption)===160,'National spending uses the simulated government component');
check(Number(fiscal.operational_primary_expense)===7&&Number(fiscal.simulated_transfers)===20,'Simulated stabilizers remain separate from operational expenses');
check(Number((await row('SELECT treasury_balance FROM public.government_finances')).treasury_balance)===123,'National tax estimates never credit the bank Treasury');
check(Number((await row('SELECT public_debt FROM public.economic_state')).public_debt)===1000,'Monthly estimates do not erase or rewrite debt');
await exec(`UPDATE public.economic_periods SET status='closed' WHERE id='${month}'; SELECT economy_private.queue_missing_period_events()`);
check(Number((await row(`SELECT count(*) n FROM economy_private.period_revision_queue WHERE period_id='${month}'`)).n)===1,'An event arriving between capture and publication enters controlled revision');
check(Number((await row('SELECT economy_private.queue_missing_period_events() n')).n)===0,'Revision sweep is idempotent');
await exec(`UPDATE public.government_rules SET numeric_value=.2,version=2 WHERE rule_key='consumption'`);
check(Number((await row("SELECT count(*) n FROM economy_private.fiscal_rule_history WHERE rule_key='consumption'")).n)===2,'A legal amendment preserves the preceding rate snapshot');
await exec(`SELECT economy_private.capture_national_fiscal_month('${month}')`);
check(Number((await row(`SELECT estimated_tax FROM economy_private.national_fiscal_months WHERE period_id='${month}'`)).estimated_tax)===441.5,'New law cannot silently rewrite an existing fiscal estimate');
for(const fn of ['capture_period_inputs(uuid)','capture_national_fiscal_month(uuid)','national_fiscal_quarter(uuid)'])check(!(await row(`SELECT has_function_privilege('authenticated','economy_private.${fn}','EXECUTE') n`)).n,'Fiscal internals are not public RPCs');
const flow=async(d,a,r,e)=>(await row(`SELECT economy_private.national_debt_rollforward(${d},${a},12,${r},${e}) value`)).value;
check((await flow(1000,0,100,200)).closing_debt===1130,'Deficit plus interest raises debt');
check((await flow(1000,0,300,100)).closing_debt===830,'Actual surplus repays only the corresponding debt');
check((await flow(1000,100,100,200)).closing_debt===1030,'Existing national assets finance a deficit before new borrowing');
check((await flow(100,0,1000,100)).closing_assets===797,'Surplus beyond debt repayment remains an auditable national asset');
await assert.rejects(db.query("SELECT economy_private.national_debt_rollforward('NaN',0,12,100,100)"),/inválida/);checks++;
await db.close();console.log(`PASS: ${checks} fiscal PostgreSQL assertions (isolated synthetic records).`);
