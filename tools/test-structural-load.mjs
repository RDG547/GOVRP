import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
assert(process.env.GOVRP_TEST_DATABASE_URL,'Load measurements require native loopback PostgreSQL.');
const db=await createStructuralTestDatabase();const rows=50000;
try{
 for(const name of ['schema','extra-schema','macro-runtime'])await db.exec(readFileSync(new URL(`./fixtures/structural-economy-${name}.sql`,import.meta.url),'utf8'));
 for(const file of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(f=>f.includes('structural_economy')).sort())await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec("SET statement_timeout='30s'; SELECT economy_private.ensure_periods('2020-01-15T00:00Z')");
 const period=(await db.query("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=1")).rows[0].id;
 const begin=performance.now();
 await db.exec(`INSERT INTO public.economic_events(event_type,economic_classification,source_table,source_id,economic_amount,occurred_at_rp)
 SELECT 'qa_load','gross_output','qa_load',n::text,1,'2020-01-01T00:00Z'::timestamptz+n*interval '1 second' FROM generate_series(1,${rows}) n;
 ANALYZE public.economic_events;`);
 const seeded=performance.now();
 await db.query('SELECT economy_private.capture_period_inputs($1)',[period]);
 const captured=performance.now();
 await db.query("UPDATE public.economic_periods SET status='closed' WHERE id=$1",[period]);
 const beforeSweep=performance.now();
 const sweep=(await db.query('SELECT economy_private.queue_missing_period_events() n')).rows[0].n;
 const done=performance.now();
 const ledger=(await db.query('SELECT count(*) n,sum(economic_amount) amount FROM economy_private.period_input_events($1)',[period])).rows[0];
 assert.equal(Number(ledger.n),rows);assert.equal(Number(ledger.amount),rows);assert.equal(Number(sweep),0);
 const result={rows,seedMs:Math.round(seeded-begin),captureMs:Math.round(captured-seeded),revisionSweepMs:Math.round(done-beforeSweep),checks:3,boundary:'Native isolated PostgreSQL; event capture/revision queries, not a complete production load benchmark'};
 if(process.env.GOVRP_TEST_LOAD_RESULTS_PATH)writeFileSync(process.env.GOVRP_TEST_LOAD_RESULTS_PATH,JSON.stringify(result,null,2));
 console.log('PASS: '+JSON.stringify(result));
}finally{await db.close();}
