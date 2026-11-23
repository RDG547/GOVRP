import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
assert(process.env.GOVRP_TEST_DATABASE_URL,'Concurrency requires a disposable native PostgreSQL server on loopback.');
const db=await createStructuralTestDatabase();const clients=[];
const exec=s=>db.exec(s),row=async s=>(await db.query(s)).rows[0];
let checks=0;const check=(x,m)=>{assert(x,m);checks++;};
try{
 for(const f of ['schema','extra-schema','macro-runtime','legal-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${f}.sql`,import.meta.url),'utf8'));
 for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
 const seller=randomUUID(),buyer=randomUUID();
 await exec(`INSERT INTO public.economic_resources(code,name,unit,base_price) VALUES('food','Food','kg',10);
  INSERT INTO public.businesses(id,business_type_id,name,status,bank_account_id) VALUES('${seller}','qa','Seller','active','${seller}'),('${buyer}','qa','Buyer','active','${buyer}');
  INSERT INTO public.accounts(id,business_id,account_kind,account_number,balance) VALUES('${seller}','${seller}','business','QA-S',0),('${buyer}','${buyer}','business','QA-B',1000);
  INSERT INTO public.government_finances(id,treasury_balance) VALUES(1,0);
  INSERT INTO public.business_inventory(business_id,resource_code,quantity,selling_price,available_for_sale) VALUES('${seller}','food',21,10,true);
  INSERT INTO public.government_rules(rule_key,numeric_value,description,rule_kind,definition) VALUES
  ('consumption',.1599,'Consumption','tax','{"nature":"percentage","basis":"purchase","audience":"all","payer":"buyer"}'),
  ('corporate',.2816,'Corporate','tax','{"nature":"percentage","basis":"purchase","audience":"business","payer":"seller"}');`);
 for(let i=0;i<20;i++){const client=await db.connect();clients.push(client);await client.query("SET statement_timeout='15s'");}
 const trade=(client,key)=>client.query('SELECT private.trade_company_resource($1,$2,\'food\',1,10,$3,null) value',[buyer,seller,key]);
 const key=randomUUID();
 const duplicates=await Promise.allSettled(clients.map(c=>trade(c,key)));
 check(duplicates.every(x=>x.status==='fulfilled'),'Twenty simultaneous retries complete without deadlock');
 check(new Set(duplicates.map(x=>x.value.rows[0].value.id)).size===1,'Concurrent retries return one authoritative order');
 check(Number((await row(`SELECT quantity FROM public.business_inventory WHERE business_id='${seller}'`)).quantity)===20,'Twenty retries debit stock only once');
 const start=performance.now();
 const competing=await Promise.allSettled(Array.from({length:40},(_,i)=>trade(clients[i%20],randomUUID())));
 const elapsed=performance.now()-start;
 check(competing.filter(x=>x.status==='fulfilled').length===20,'Forty competing orders can sell only the twenty remaining physical units');
 check(competing.filter(x=>x.status==='rejected').every(x=>x.reason.code==='P0001'&&/estoque|reservado/.test(x.reason.message)),'Unsuccessful buyers receive stock refusals, never timeouts or deadlocks');
 check(Number((await row('SELECT min(quantity) n FROM public.business_inventory')).n)>=0,'Concurrent settlement never produces negative stock');
 check(Math.abs(Number((await row('SELECT sum(balance)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) n FROM public.accounts')).n)-1000)<.001,'Concurrent taxes and settlements conserve all money');
 check(Number((await row('SELECT count(*) n FROM public.business_supply_orders')).n)===21,'Every committed delivery has exactly one order');
 // Genuine MVCC race: an event is inserted while the period is open, commits
 // only after another connection captures and publishes that period.
 await exec("SELECT economy_private.ensure_periods('2020-01-15T00:00Z')");
 const month=(await row("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=1")).id;
 await clients[0].query('BEGIN');
 const late=(await clients[0].query("INSERT INTO public.economic_events(event_type,economic_classification,source_table,source_id,occurred_at_rp,economic_amount) VALUES('qa','gross_output','qa','concurrent','2020-01-15T12:00Z',55) RETURNING id")).rows[0].id;
 await clients[1].query(`BEGIN; SELECT economy_private.capture_period_inputs('${month}'); UPDATE public.economic_periods SET status='closed' WHERE id='${month}'; COMMIT`);
 await clients[0].query('COMMIT');
 check(Number((await row(`SELECT count(*) n FROM economy_private.period_input_events('${month}')`)).n)===0,'A transaction invisible at capture cannot alter published inputs');
 await exec('SELECT economy_private.queue_missing_period_events()');
 check(Number((await row(`SELECT count(*) n FROM economy_private.period_revision_queue WHERE period_id='${month}' AND event_id='${late}'`)).n)===1,'Post-publication commit is detected by the revision sweep');
 console.log(`PASS: ${checks} native PostgreSQL concurrency assertions; 20 independent connections, 60 settlement attempts, ${elapsed.toFixed(0)} ms competing batch.`);
}finally{
 await Promise.allSettled(clients.map(c=>c.end()));await db.close();
}
