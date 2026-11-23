import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
const db=await createStructuralTestDatabase();
const exec=sql=>db.exec(sql),row=async sql=>(await db.query(sql)).rows[0];
let checks=0;const check=(condition,label)=>{assert(condition,label);checks++;};
try {
 for(const name of ['schema','extra-schema','macro-runtime','close-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${name}.sql`,import.meta.url),'utf8'));
 for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await exec(`SET TIME ZONE 'UTC'; INSERT INTO public.rp_time_settings(id,rp_epoch_real_at,rp_epoch_game_at) VALUES(true,'2020-01-01T03:00Z','2030-01-20T00:00Z');
  INSERT INTO public.economic_state(id,cpi_index) VALUES(true,100);
  CREATE FUNCTION economy_private.resolve_sector(uuid,uuid,text) RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';
  ALTER TABLE public.economic_events ADD UNIQUE(source_table,source_id,event_type);
  CREATE TRIGGER qa_business_event AFTER INSERT ON public.business_transactions FOR EACH ROW EXECUTE FUNCTION economy_private.on_business_transaction_insert();
  INSERT INTO public.business_types(id,name,category) VALUES('qa','QA','services');
  INSERT INTO public.businesses(id,business_type_id,name,control_kind) VALUES('00000000-0000-4000-8000-000000000001','qa','QA','player');`);
 const stateBefore=(await row('SELECT to_jsonb(s) value FROM public.rp_time_settings s')).value;
 let baseline;
 for(const zone of ['UTC','America/Sao_Paulo','America/New_York']) {
  await exec(`SET TIME ZONE '${zone}'`);
  const parts=(await db.query("SELECT * FROM economy_private.daily_accrual_parts('2020-01-01',100.01) ORDER BY part_key")).rows;
  check(parts.length===3,'One accelerated real day intersects the expected three RP months');
  check(Math.abs(parts.reduce((sum,p)=>sum+Number(p.amount),0)-100.01)<.000001,'Allocation conserves cents exactly');
  check(parts.every(p=>p.rp_at>=p.rp_start&&p.rp_at<p.rp_end),'Every allocated event stays inside its half-open RP interval');
  const serialized=JSON.stringify(parts);if(baseline)check(serialized===baseline,'Session zone cannot change accrual weights or timestamps');baseline=serialized;
 }
 await exec(`INSERT INTO public.business_transactions(id,business_id,type,amount,description,accounting_date,created_at,metadata)
  VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','expense',-10000,'Day expense','2020-01-01','2020-01-04T12:00Z','{"kind":"input_consumption"}');`);
 const summed=await row("SELECT count(*) n,sum(nominal_amount) nominal,sum(economic_amount) economic FROM public.economic_events WHERE source_table='business_transactions'");
 check(Number(summed.n)===3&&Number(summed.nominal)===10000,'Delayed daily posting creates three accrual events with one conserved source total');
 check(Math.abs(Number(summed.economic)-10000)<.02,'Daily monetary accrual conserves nominal currency without player extrapolation');
 check(Number((await row("SELECT count(*) n FROM public.economic_events WHERE metadata->>'accounting_basis'='daily_accrual_rp_overlap' AND metadata->>'source_business_transaction_id'='00000000-0000-4000-8000-000000000002'")).n)===3,'Every part keeps its immutable source transaction identity');
 await exec(`INSERT INTO public.business_transactions(id,business_id,type,amount,description,accounting_date,created_at)
  VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','revenue',77,'Cash sale','2020-01-01','2020-01-04T12:00Z');`);
 for(const simulated of [true,false]) {
  await exec(`SELECT economy_private.record_event('qa_money','gross_output','transactions','qa-money-${simulated}',10000,p_is_simulated=>${simulated},p_occurred_at_rp=>'2030-04-01')`);
 }
 const money=(await db.query("SELECT economic_amount,metadata FROM public.economic_events WHERE event_type='qa_money'")).rows;
 check(money.length===2&&money.every(e=>Number(e.economic_amount)===10000&&e.metadata.representativity_factor===1),'Player and population monetary flows use identical units and no representativity cap');
 await exec("SELECT economy_private.record_event('qa_weight','not_in_gdp','transactions','qa-weight',100,p_macro_weight=>0.25,p_occurred_at_rp=>'2030-04-01')");
 check(Number((await row("SELECT economic_amount FROM public.economic_events WHERE event_type='qa_weight'")).economic_amount)===25,'Explicit classification weights are preserved');
 const cash=await row("SELECT source_id,occurred_at_real,metadata FROM public.economic_events WHERE source_id='00000000-0000-4000-8000-000000000003'");
 check(cash.occurred_at_real.toISOString()==='2020-01-04T12:00:00.000Z'&&cash.metadata.accounting_basis==='transaction_timestamp','Cash sales retain actual settlement time and original source identifier');
 await exec("UPDATE public.economic_periods SET status='closed' WHERE period_type='month' AND rp_year=2030 AND rp_month=1");
 await exec(`INSERT INTO public.business_transactions(business_id,type,amount,description,accounting_date,metadata)
  VALUES('00000000-0000-4000-8000-000000000001','expense',-10,'Late payroll','2020-01-01','{"kind":"payroll_accrual"}');`);
 check(Number((await row('SELECT count(*) n FROM economy_private.period_revision_queue')).n)>0,'Late daily accrual reaches the revision queue rather than rewriting a closed aggregate');
 await exec("SET TIME ZONE 'UTC'");
 check(JSON.stringify(stateBefore)===JSON.stringify((await row('SELECT to_jsonb(s) value FROM public.rp_time_settings s')).value),'Accrual processing never changes political time settings');
 await exec("UPDATE public.rp_time_settings SET is_paused=true,paused_real_at='2019-12-31T00:00Z',paused_rp_at='2030-01-20T00:00Z'");
 const paused=(await db.query("SELECT * FROM economy_private.daily_accrual_parts('2020-01-01',7.01)")).rows;
 check(paused.length===1&&Number(paused[0].amount)===7.01,'Paused RP clock preserves a single accrual without division by zero');
 console.log(`PASS: ${checks} accrual calendar assertions, actual time conversion and event recorder; sector resolution is an explicit fixture.`);
} finally {await db.close();}
