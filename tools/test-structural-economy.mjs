import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
process.on('uncaughtException', error => { console.error(error.message, error.where || '', error.detail || ''); process.exit(1); });

const db = await createStructuralTestDatabase();
const exec = sql => db.exec(sql);
const value = async sql => (await db.query(sql)).rows[0];
let checks = 0;
function check(condition, message) { assert(condition, message); checks++; }
await exec(readFileSync(new URL('./fixtures/structural-economy-schema.sql', import.meta.url), 'utf8'));
await exec(readFileSync(new URL('./fixtures/structural-economy-extra-schema.sql', import.meta.url), 'utf8'));
const migrations = readdirSync(new URL('../supabase/migrations/', import.meta.url))
  .filter(name => name.includes('structural_economy')).sort();
for (const migration of migrations) {
  await exec(readFileSync(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
}
const readiness = async id => (await value(`SELECT economy_private.period_close_readiness('${id}') AS value`)).value;
await exec("UPDATE economy_private.period_transition_policy SET month_from='2020-01-01T00:00Z',quarter_from='2020-01-01T00:00Z',year_from='2020-01-01T00:00Z'");
const quarter = async (year, q) => (await value(`SELECT id FROM public.economic_periods WHERE period_type='quarter' AND rp_year=${year} AND rp_quarter=${q}`)).id;

// G: execute the migration's actual PostgreSQL date arithmetic under three
// different session zones. This catches December-31 and DST interval drift.
for (const zone of ['UTC', 'America/Sao_Paulo', 'America/New_York']) {
  await exec(`SET TIME ZONE '${zone}'`);
  for (const date of ['2020-01-01T00:00:00Z', '2020-02-29T23:59:59Z', '2020-12-31T23:59:59Z']) {
    await exec(`SELECT economy_private.ensure_periods('${date}')`);
  }
  const q4 = await value("SELECT starts_at_rp,ends_at_rp FROM public.economic_periods WHERE period_type='quarter' AND rp_year=2020 AND rp_quarter=4");
  check(q4.ends_at_rp.toISOString() === '2021-01-01T00:00:00.000Z', 'Q4 includes all of December');
  check(q4.starts_at_rp.toISOString() === '2020-10-01T00:00:00.000Z', 'Session timezone cannot move Q4');
}
check(Number((await value("SELECT count(*) n FROM public.economic_periods WHERE period_type='year' AND rp_year=2020")).n) === 1, 'ensure_periods is idempotent');
await exec("SELECT economy_private.ensure_periods('2020-03-01T00:00:00Z')");
const q1 = await quarter(2020, 1);
check((await readiness(q1)).status === 'blocked_children', 'An open month blocks quarter close');
check((await value(`SELECT economy_private.close_quarter('${q1}',true,null) value`)).value.status === 'blocked_children', 'Force cannot bypass child readiness');
await exec("UPDATE public.economic_periods SET status='closed' WHERE period_type='month' AND rp_year=2020 AND rp_month<=3");
check((await readiness(q1)).status === 'blocked_legacy_inputs', 'Closed legacy children without immutable inputs cannot be recaptured as if audited');
check((await value(`SELECT economy_private.close_quarter('${q1}',true,null) value`)).value.status === 'blocked_legacy_inputs', 'Legacy capture gap is a controlled outcome, not a failing job transaction');
await exec("INSERT INTO economy_private.period_input_manifests(period_id) SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month<=3");
check((await readiness(q1)).status === 'ready', 'Three canonical closed months with immutable inputs permit quarter close');
await exec("UPDATE public.economic_periods SET ends_at=ends_at+interval '1 hour' WHERE period_type='month' AND rp_year=2020 AND rp_month=3");
check((await readiness(q1)).status === 'blocked_children', 'A noncanonical real-time child boundary also blocks its quarter');
await exec("UPDATE public.economic_periods SET ends_at=ends_at-interval '1 hour' WHERE period_type='month' AND rp_year=2020 AND rp_month=3");
await exec("UPDATE public.economic_periods SET ends_at_rp=ends_at_rp+interval '3 hours' WHERE period_type='month' AND rp_year=2020 AND rp_month=3");
check((await readiness(q1)).status === 'blocked_children', 'Misaligned third month blocks quarter');
await exec("UPDATE public.economic_periods SET ends_at_rp=ends_at_rp-interval '3 hours' WHERE period_type='month' AND rp_year=2020 AND rp_month=3");
await exec(`UPDATE public.economic_periods SET status='closed' WHERE id='${q1}'`);
check((await value(`SELECT economy_private.close_quarter('${q1}',true,null) value`)).value.status === 'already_closed', 'Close is idempotent');
await exec("SELECT economy_private.ensure_periods('2099-01-01T00:00:00Z')");
const futureMonth = (await value("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2099")).id;
check((await value(`SELECT economy_private.close_month('${futureMonth}',true,null) value`)).value.status === 'not_due', 'Force cannot close a future month');
const futureQuarter = await quarter(2099, 1);
check((await value(`SELECT economy_private.close_quarter('${futureQuarter}',true,null) value`)).value.status === 'not_due', 'Force cannot close future quarter');
await exec(`UPDATE public.economic_periods SET ends_at_rp=ends_at_rp-interval '1 day' WHERE id='${futureQuarter}'`);
check((await readiness(futureQuarter)).status === 'blocked_legacy_bounds', 'Legacy year-end defect requires explicit review');
await assert.rejects(() => exec(`SELECT public.get_economic_period_review('${futureQuarter}')`), e => e.code === '42501'); checks++;
await exec("SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; SET test.admin='false'");
await assert.rejects(() => exec(`SELECT public.get_economic_period_review('${futureQuarter}')`), e => e.code === '42501'); checks++;
await exec("SET test.admin='true'");
const beforeReview = (await value(`SELECT to_jsonb(p) value FROM public.economic_periods p WHERE id='${futureQuarter}'`)).value;
const review = (await value(`SELECT public.get_economic_period_review('${futureQuarter}') value`)).value;
check(review.read_only && review.requires_specific_approval && review.next_step === 'review_open_bounds', 'Admin gets an explicit read-only review proposal');
check(Date.parse(review.canonical_bounds.rp_end) - Date.parse(review.stored_bounds.rp_end) === 86400000, 'Review exposes the exact missing day');
check(JSON.stringify(beforeReview) === JSON.stringify((await value(`SELECT to_jsonb(p) value FROM public.economic_periods p WHERE id='${futureQuarter}'`)).value), 'Review preserves every stored period field');
await exec("SET test.admin='false'; SET request.jwt.claim.sub=''");
const year2020 = (await value("SELECT id FROM public.economic_periods WHERE period_type='year' AND rp_year=2020")).id;
check((await value(`SELECT economy_private.close_year('${year2020}',true,null) value`)).value.status === 'blocked_children', 'Year requires four closed quarters');
await exec("SELECT economy_private.ensure_periods('2019-11-15T12:00Z')");
const legacyMonth=(await value("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2019 AND rp_month=11")).id;
check((await readiness(legacyMonth)).status==='blocked_transition','Old unclosed periods remain pending separate review');
await exec("SELECT economy_private.ensure_periods('2020-04-15T12:00Z')");
const nextMonth=(await value("SELECT id FROM public.economic_periods WHERE period_type='month' AND rp_year=2020 AND rp_month=4")).id;
check((await readiness(nextMonth)).status==='ready','Legacy pending periods before cutover do not freeze complete prospective cycles');
check((await value(`SELECT status FROM public.economic_periods WHERE id='${legacyMonth}'`)).status==='open','Prospective cutover never changes the legacy publication status');

// I: late events remain recorded, while published values remain untouched.
await exec(`INSERT INTO public.economic_indicators(period_id,indicator_code,nominal_value) VALUES('${q1}','gdp_nominal',100);
INSERT INTO public.economic_events(event_type,economic_classification,source_table,source_id,occurred_at_rp,economic_amount)
VALUES('qa','gross_output','qa','late','2020-02-05T12:00:00Z',25)`);
check(Number((await value('SELECT count(*) n FROM economy_private.period_revision_queue')).n) === 2, 'Late event queues both closed month and quarter');
check(Number((await value("SELECT nominal_value FROM public.economic_indicators WHERE indicator_code='gdp_nominal'")).nominal_value) === 100, 'Late event never rewrites published GDP');

// Shared physical stock: a processed contract stops reserving inventory again.
const seller = '00000000-0000-4000-8000-000000000001';
const buyer = '00000000-0000-4000-8000-000000000002';
const contract = '00000000-0000-4000-8000-000000000003';
await exec(`INSERT INTO public.business_inventory(business_id,resource_code,quantity) VALUES('${seller}','food',100);
INSERT INTO public.business_supply_contracts(id,buyer_business_id,seller_business_id,resource_code,daily_quantity,max_unit_price,ends_at,created_by)
 VALUES('${contract}','${buyer}','${seller}','food',20,10,now()+interval '2 days','${buyer}');
INSERT INTO public.products(name,description,price,stock,business_id,resource_code,moderation_status)
 VALUES('QA','QA',10,30,'${seller}','food','approved');`);
const available = async extra => Number((await value(`SELECT private.unreserved_company_stock('${seller}','food',current_date${extra || ''}) n`)).n);
check(await available() === 50, 'Listed stock and outstanding contract reserved once');
check(await available(`,'${contract}'`) === 70, 'A contract can consume its own reservation');
await exec(`UPDATE public.business_supply_contracts SET last_processed_on=current_date WHERE id='${contract}'`);
check(await available() === 70, 'Fulfilled contract is not reserved twice');
await exec('UPDATE public.business_inventory SET quantity=5');
check(await available() === 0, 'Oversubscribed inventory never yields negative availability');

// RPC authorization and inert installation: no silent activation or money.
await assert.rejects(db.query('SELECT public.get_economic_structural_diagnostics()'), /restrito/); checks++;
await assert.rejects(db.query('SELECT public.get_autonomous_economy_preview()'), /administrativo/); checks++;
check((await value("SELECT private.manage_autonomous_enterprises((now() AT TIME ZONE 'America/Sao_Paulo')::date) value")).value.status === 'disabled', 'Autonomous pilot stays disabled until staging');
check(Number((await value('SELECT count(*) n FROM public.transactions')).n) === 0, 'Installation and disabled pilot move no money');
for (const signature of ['economy_private.period_close_readiness(uuid)', 'private.manage_autonomous_enterprises(date)', 'private.autonomous_entry_candidates()']) {
  check(!(await value(`SELECT has_function_privilege('authenticated','${signature}','EXECUTE') allowed`)).allowed, `${signature} remains private`);
}
// Explicit test doubles: legal quote and other purchase channels are separate
// integration boundaries. The production functions are executed unchanged.
await exec(`CREATE FUNCTION public.quote_legal_levies(text,numeric,boolean,uuid,text,text,text)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('restricted',false,
 'total_debited',round($2*1.1599,2),'net_amount',round($2*.7184,2),'seller_tax',round($2*.2816,2),
 'buyer_tax',case when $1='license' then 5 else round($2*.1599,2) end) $$;
 INSERT INTO public.government_finances(id,treasury_balance) VALUES(1,0);
 INSERT INTO public.businesses(id,business_type_id,name,status,bank_account_id)
 VALUES('${seller}','qa','Seller','active','${seller}'),('${buyer}','qa','Buyer','active','${buyer}');
 INSERT INTO public.accounts(id,business_id,account_kind,account_number,balance)
 VALUES('${seller}','${seller}','business','QA-S',0),('${buyer}','${buyer}','business','QA-B',1000);
 UPDATE public.business_inventory SET quantity=100,selling_price=10,available_for_sale=true;`);
const money = async () => Number((await value('SELECT sum(balance)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) n FROM public.accounts')).n);
const before = await money();
const tradeKey = '00000000-0000-4000-8000-000000000004';
const tradeSql = `SELECT private.trade_company_resource('${buyer}','${seller}','food',10,10,'${tradeKey}',null) value`;
const trade = (await value(tradeSql)).value;
check(await money() === before, 'B2B settlement conserves accounts plus treasury');
check(Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${buyer}'`)).quantity) === 10, 'B2B delivers physical inputs');
check(Number((await value(`SELECT balance FROM public.accounts WHERE id='${buyer}'`)).balance) === 884.01, 'Buyer pays quote including consumption tax');
check(Number((await value(`SELECT balance FROM public.accounts WHERE id='${seller}'`)).balance) === 71.84, 'Seller receives net legal quote');
check((await value(tradeSql)).value.id === trade.id, 'B2B idempotency returns the original order');
check(await money() === before, 'Retry does not mint or remove money');
await assert.rejects(db.query(`SELECT private.trade_company_resource('${buyer}','${seller}','food',70,10,gen_random_uuid(),null)`), /reservado/); checks++;
await assert.rejects(db.query(`SELECT private.trade_company_resource('${buyer}','${seller}','food','NaN',10,gen_random_uuid(),null)`), /finitos/); checks++;
await exec(`UPDATE public.accounts SET balance=0 WHERE id='${buyer}'`);
const stockBefore = Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${seller}'`)).quantity);
await assert.rejects(db.query(`SELECT private.trade_company_resource('${buyer}','${seller}','food',1,10,gen_random_uuid(),null)`), /caixa/); checks++;
check(Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${seller}'`)).quantity) === stockBefore, 'Failed payment cannot remove stock');

// A/B/C: actual population purchase function, with 0, 5 and 30 human suppliers.
// This verifies settlement competition paths, not whole-country sustainability.
await exec(`CREATE FUNCTION private.procure_national_market(date) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
 CREATE FUNCTION private.simulate_retail_demand(date,numeric) RETURNS numeric LANGUAGE sql AS 'SELECT 0::numeric';
 INSERT INTO public.economic_state(id) VALUES(true);
 INSERT INTO public.economic_resources(code,name,unit,base_price) VALUES('food','Food','kg',10);
 INSERT INTO public.country_population_segments(country_code,segment_key,name,description,population_share,population_count)
 VALUES('BR','test','Test','Isolated fixture',1,200000000);
 INSERT INTO public.country_rp_states(country_code,country_name,economic_current) VALUES('BR','BR','{"inflation":3,"unemployment":8}');
 INSERT INTO public.accounts(account_kind,account_number,balance) VALUES('population','QA-POP',10000);`);
for (const humans of [0, 5, 30]) {
  await exec('BEGIN');
  await exec(`DELETE FROM public.products; DELETE FROM public.business_supply_contracts; DELETE FROM public.business_inventory;
   DELETE FROM public.businesses; DELETE FROM public.accounts WHERE account_kind='business';
   INSERT INTO public.businesses(id,business_type_id,name,status,bank_account_id,control_kind)
   VALUES('${seller}','qa','NPC','active','${seller}','population');
   INSERT INTO public.accounts(id,business_id,account_kind,account_number,balance) VALUES('${seller}','${seller}','business','NPC',100);
   INSERT INTO public.business_inventory(business_id,resource_code,quantity,selling_price,available_for_sale) VALUES('${seller}','food',1000,10,true);
   INSERT INTO public.businesses(id,business_type_id,name,status,bank_account_id,control_kind)
   SELECT md5('human-'||n)::uuid,'qa','Human '||n,'active',md5('human-'||n)::uuid,'player' FROM generate_series(1,${humans}) n;
   INSERT INTO public.accounts(id,business_id,account_kind,account_number,balance)
   SELECT id,id,'business','QA-'||id,100 FROM public.businesses WHERE control_kind='player';
   INSERT INTO public.business_inventory(business_id,resource_code,quantity,selling_price,available_for_sale)
   SELECT id,'food',1000,10,true FROM public.businesses WHERE control_kind='player';`);
  const startMoney = await money();
  const spent = Number((await value('SELECT private.simulate_population_demand(current_date) n')).n);
  check(spent > 0 && spent <= 10000, `${humans} humans: NPC household demand spends finite funds`);
  check(Math.abs(await money() - startMoney) < .001, `${humans} humans: conserved settlement including taxes`);
  check(Number((await value('SELECT min(quantity) n FROM public.business_inventory')).n) >= 0, `${humans} humans: no negative stock`);
  check(Number((await value('SELECT private.simulate_population_demand(current_date) n')).n) === 0, `${humans} humans: same day cannot consume twice`);
  await exec('ROLLBACK');
}
// Diagnostics must execute successfully for an authorized admin as well.
await exec(`SET request.jwt.claim.sub='${buyer}'; SET test.admin='true'`);
check(Array.isArray((await value('SELECT public.get_economic_structural_diagnostics() value')).value.supply), 'Authorized supply diagnostics execute');
check(Array.isArray((await value('SELECT public.get_autonomous_economy_preview() value')).value.candidates), 'Authorized NPC preview executes');
await exec(readFileSync(new URL('./fixtures/structural-economy-existing-runtime.sql', import.meta.url), 'utf8'));
await exec(`INSERT INTO public.economic_regions(code,name,capital) VALUES('SP','São Paulo','São Paulo');
 INSERT INTO public.economic_resources(code,name,unit,base_price) VALUES('energy','Energy','kWh',10);
 INSERT INTO public.business_types(id,name,category,min_employees,base_daily_capacity,daily_overhead,requires_cnpj)
 VALUES('qa-npc','Energy QA','services',1,10,1,false);
 INSERT INTO public.business_recipes(id,business_type_id,output_resource,output_quantity,inputs)
 VALUES('qa-energy','qa-npc','energy',1,'{}');
 INSERT INTO public.business_role_templates(id,business_type_id,name,skill_area,game_family,base_weekly_salary)
 VALUES('qa-role','qa-npc','Worker','management','sales',7);
 UPDATE private.autonomous_economy_config SET enabled=true;`);
const beforeEntry = await money();
const entry = (await value("SELECT private.manage_autonomous_enterprises((now() AT TIME ZONE 'America/Sao_Paulo')::date) value")).value;
check(entry.entries === 1, 'A funded supply gap creates one legally registered NPC');
check(await money() === beforeEntry, 'NPC capitalization transfers existing household savings');
const npc = (await value("SELECT id,bank_account_id FROM public.businesses WHERE business_type_id='qa-npc'")).id;
check(Number((await value(`SELECT count(*) n FROM public.documents d JOIN public.businesses b ON b.cnpj_document_id=d.id WHERE b.id='${npc}' AND d.type='CNPJ' AND d.is_valid`)).n) === 1, 'NPC registration uses the existing document workflow');
check(Number((await value(`SELECT sum(amount) n FROM public.business_transactions WHERE business_id='${npc}' AND operation_key='population-registration'`)).n) === -5, 'NPC pays the legal licensing fee exactly once');
check(Number((await value(`SELECT count(*) n FROM public.business_inventory WHERE business_id='${npc}'`)).n) === 0, 'Entry never creates imaginary input or output stock');
check((await value("SELECT private.manage_autonomous_enterprises((now() AT TIME ZONE 'America/Sao_Paulo')::date) value")).value.idempotent, 'NPC entry is idempotent per operating day');
check(Number((await value("SELECT count(*) n FROM public.businesses WHERE business_type_id='qa-npc'")).n) === 1, 'No duplicate NPC on retry');
await exec(`SELECT private.simulate_company_day('${npc}',current_date)`);
const produced = Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${npc}' AND resource_code='energy'`)).quantity);
check(produced > 0, 'Funded NPC produces with actual staff and no missing inputs');
await exec(`SELECT private.simulate_company_day('${npc}',current_date)`);
check(Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${npc}' AND resource_code='energy'`)).quantity) === produced, 'Daily production cannot run twice');
await exec('BEGIN');
const stocked = (await value("INSERT INTO public.businesses(business_type_id,name,status,region_code,control_kind,created_at) VALUES('qa-npc','Stocked QA','active','SP','population',now()-interval '14 days') RETURNING id")).id;
await exec(`UPDATE public.accounts SET balance=100 WHERE business_id='${stocked}';
 INSERT INTO public.business_employees(business_id,name,salary,is_npc,hired_at,last_accrued_on) VALUES('${stocked}','Worker',7,true,now()-interval '14 days',current_date);
 INSERT INTO public.business_inventory(business_id,resource_code,quantity) VALUES('${stocked}','energy',10000);
 SELECT private.simulate_company_day('${stocked}',current_date)`);
check(Number((await value(`SELECT produced_quantity FROM public.business_daily_operations WHERE business_id='${stocked}'`)).produced_quantity) === 0, 'An established firm with unsold stock stops adding output');
await exec('ROLLBACK');
const prePayroll = await money();
check(Number((await value(`SELECT private.pay_company_wages('${npc}') n`)).n) > 0, 'NPC wages reach the household account');
check(await money() === prePayroll, 'Payroll conserves money');
check(Number((await value(`SELECT private.pay_company_wages('${npc}') n`)).n) === 0, 'Paid payroll cannot be paid twice');

// F: missing physical inputs suppress output and do not create negative stock.
await exec(`UPDATE public.business_recipes SET inputs='{"paper":2}' WHERE id='qa-energy';
 INSERT INTO public.economic_resources(code,name,unit,base_price) VALUES('paper','Paper','kg',1);
 CREATE FUNCTION private.supply_population_company_from_marketplace(uuid,text,numeric,date) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;`);
const missingNpc = (await value("INSERT INTO public.businesses(business_type_id,name,status,region_code,control_kind) VALUES('qa-npc','Missing-input QA','active','SP','population') RETURNING id")).id;
await exec(`UPDATE public.accounts SET balance=100 WHERE business_id='${missingNpc}';
 INSERT INTO public.business_employees(business_id,name,salary,is_npc,last_accrued_on) VALUES('${missingNpc}','Worker',7,true,current_date);
 SELECT private.simulate_company_day('${missingNpc}',current_date);`);
check(Number((await value(`SELECT produced_quantity FROM public.business_daily_operations WHERE business_id='${missingNpc}'`)).produced_quantity) === 0, 'Missing suppliers cannot produce fictitious output');
check(Number((await value(`SELECT quantity FROM public.business_inventory WHERE business_id='${npc}' AND resource_code='energy'`)).quantity) === produced, 'Missing inputs preserve existing output stock');
// D/E: verify demand responds in both directions under identical starting stock.
const demandAt = async confidence => {
 await exec('BEGIN');
 await exec(`UPDATE public.economic_state SET consumer_confidence=${confidence}; DELETE FROM private.population_demand_runs; UPDATE public.business_inventory SET quantity=10000,available_for_sale=true,selling_price=10; DELETE FROM public.products; DELETE FROM public.business_supply_contracts`);
 const spent = Number((await value('SELECT private.simulate_population_demand(current_date) n')).n);
 await exec('ROLLBACK'); return spent;
};
check(await demandAt(10) < await demandAt(90), 'Lower confidence reduces actual population expenditure');
// Execute the actual national checkout: enough stock, finite cash, legal quote.
await exec(`INSERT INTO public.accounts(account_kind,account_number,balance) VALUES('national_market','QA-MARKET',0);
 INSERT INTO public.national_market_references(resource_code,unit_price,base_price,per_capita_daily) VALUES('food',10,10,.01);
 INSERT INTO public.national_market_stock(resource_code,quantity,unit_cost) VALUES('food',10000,10);`);
const beforeMarket=await money();
const marketSpent=Number((await value('SELECT private.consume_national_market(current_date,100) n')).n);
check(marketSpent>99 && marketSpent<=100, 'National checkout downsizes to tax-inclusive budget instead of dropping the purchase');
check(Math.abs(await money()-beforeMarket)<.001, 'National checkout conserves accounts plus treasury');
check(Number((await value('SELECT private.consume_national_market(current_date,100) n')).n)===0,'National consumption cannot duplicate a resource/day settlement');
await db.close();
console.log(`PASS: ${checks} PostgreSQL assertions. Legal quotes and external purchase channels use explicit test doubles; full Supabase integration remains required.`);
