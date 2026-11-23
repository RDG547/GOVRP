import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createStructuralTestDatabase} from './structural-test-db.mjs';
import {installStructuralTestClock,withTestClock} from './structural-test-clock.mjs';
process.on('uncaughtException',error=>{console.error(error.message,error.where||'');process.exit(1);});
const catalog=JSON.parse(readFileSync(new URL('./fixtures/structural-economy-catalog.json',import.meta.url),'utf8'));
let checks=0;const check=(x,m)=>{assert(x,m);checks++;};const results=[];
const requestedHumans=process.env.GOVRP_TEST_HUMANS?.split(',').map(Number)||[0,5,30];
assert(requestedHumans.every(n=>[0,5,30].includes(n)),'Select only the specified 0, 5 or 30 human scenarios');
const diversified=process.env.GOVRP_TEST_SCENARIO==='diversified';
const circulation=process.env.GOVRP_TEST_CIRCULATION==='true';
const initialHouseholds=diversified?100000:16158.49;
const days=Number(process.env.GOVRP_TEST_DAYS||28);assert([28,56].includes(days));
const humanTypes=['solar','marketing','contabilidade','advocacia','tecnologia','seguranca','engenharia','gestora_investimentos','agencia_noticias','consultoria'];
for(const humans of requestedHumans){
 const db=await createStructuralTestDatabase();let clocked=false;const exec=s=>db.exec(clocked?withTestClock(s):s),row=async s=>(await db.query(clocked?withTestClock(s):s)).rows[0];
 try{
  for(const f of ['schema','extra-schema','lifecycle-schema','macro-runtime','legal-runtime','existing-runtime','lifecycle-runtime'])await exec(readFileSync(new URL(`./fixtures/structural-economy-${f}.sql`,import.meta.url),'utf8'));
  // Authentication boundary only; the run itself has no user JWT.
  await exec("CREATE FUNCTION public.has_full_admin_access() RETURNS boolean LANGUAGE sql AS 'SELECT public.economic_has_role(ARRAY[''Admin''])'");
  for(const f of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(x=>x.includes('structural_economy')).sort())await exec(readFileSync(new URL('../supabase/migrations/'+f,import.meta.url),'utf8'));
  for(const [table,rows]of Object.entries(catalog))await db.query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table},$1)`,[JSON.stringify(rows)]);
  const origin=Date.parse((await row("SELECT to_char(current_date,'YYYY-MM-DD') AS day_text")).day_text+'T12:00:00Z');
  await installStructuralTestClock(db,new Date(origin).toISOString());clocked=true;
  await exec(`SET TIME ZONE 'America/Sao_Paulo';
   INSERT INTO public.accounts(account_kind,account_number,balance) VALUES('population','QA-POP',${initialHouseholds}),('national_market','QA-MARKET',36.13);
   INSERT INTO public.state_enterprises(name,sector,service_key) VALUES('QA Market','commerce','national_market');
   UPDATE public.accounts SET state_enterprise_id=(SELECT id FROM public.state_enterprises WHERE service_key='national_market') WHERE account_kind='national_market';
   INSERT INTO public.national_market_references(resource_code,unit_price,base_price,per_capita_daily) VALUES('energy',18,18,.001);
   INSERT INTO public.government_finances(id,treasury_balance) VALUES(1,0);
   INSERT INTO public.economic_state(id,consumer_confidence) VALUES(true,50);
   INSERT INTO public.country_population_segments(country_code,segment_key,name,description,population_share,population_count) VALUES('BR','qa','QA','Synthetic',1,212812405);
   INSERT INTO public.country_rp_states(country_code,country_name,economic_current) VALUES('BR','BR','{"inflation":3,"unemployment":8}');
   UPDATE private.autonomous_economy_config SET enabled=true;
   SELECT private.manage_autonomous_enterprises(current_date);`);
  const npc=(await row("SELECT id FROM public.businesses WHERE control_kind='population'")).id;
  for(let i=0;i<humans;i++){
   const type=diversified?humanTypes[i%humanTypes.length]:'solar';
   const estimate=(await row(`SELECT private.economy_sector_viability('${type}','SP') value`)).value;
   const b=(await row(`INSERT INTO public.businesses(business_type_id,name,status,region_code,control_kind,owner_operates) VALUES('${type}','QA Human ${i}','active','SP','player',false) RETURNING id`)).id;
   const capital=diversified?Math.round(estimate.estimated_daily_cost*14*100)/100:1620;
   // Synthetic starting capital is declared before the conservation baseline.
   // No transfer or stock is injected during the simulated operating days.
   await exec(`UPDATE public.accounts SET balance=${capital} WHERE business_id='${b}';
    INSERT INTO public.business_employees(business_id,name,role,salary,is_npc,role_template_id,skill_area,qualification_level,experience)
    SELECT '${b}','Worker '||n,r.name,r.base_weekly_salary,true,r.id,r.skill_area,1,0 FROM generate_series(1,(SELECT min_employees FROM public.business_types WHERE id='${type}')) n CROSS JOIN LATERAL(SELECT * FROM public.business_role_templates WHERE business_type_id='${type}' AND NOT can_manage ORDER BY base_weekly_salary,id LIMIT 1) r;`);
  }
  // Real-time primitives are replaced only in this disposable database, so
  // weekly decisions see their own week instead of today's later sales.
  await exec(`UPDATE public.businesses SET created_at=current_date::timestamptz,last_fiscal_cycle_at=current_date::timestamptz;
   UPDATE public.business_employees SET hired_at=current_date::timestamptz,last_accrued_on=current_date;`);
  if(circulation)await exec(`CREATE FUNCTION private.require_competition_admin() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
   IF auth.uid() IS NULL OR NOT coalesce(public.economic_has_role(ARRAY['Admin']),false) THEN RAISE EXCEPTION 'Admin only' USING errcode='42501';END IF;END $$;
   INSERT INTO public.profiles(id) VALUES('00000000-0000-4000-8000-000000000001');
   SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; SET test.admin='true';
   SELECT public.approve_population_circulation(gen_random_uuid(),10000,${10000*days},current_date+${days-1},'Programa sintético QA: dotação finita, não autorizada em produção');
   SET request.jwt.claim.sub=''; SET test.admin='false';`);
  const money=async()=>Number((await row('SELECT sum(balance)+(SELECT treasury_balance FROM public.government_finances WHERE id=1) n FROM public.accounts')).n);
  const initialMoney=await money();const series=[];const started=performance.now();
  for(let day=0;day<days;day++){
   await db.query("SELECT set_config('qa.clock',$1,false)",[new Date(origin+day*86400000).toISOString()]);
   const confidence=day>=7&&day<14?25:day>=14?80:50;
   await exec(`UPDATE public.economic_state SET consumer_confidence=${confidence};
    SELECT private.process_population_circulation(current_date);
    SELECT private.manage_autonomous_enterprises(current_date);
    SELECT private.simulate_company_day(id,current_date) FROM public.businesses ORDER BY id;
    SELECT private.simulate_population_demand(current_date);`);
   if(day%7===6)await exec(`SELECT private.pay_company_wages(id) FROM public.businesses ORDER BY id;
    SELECT private.close_company_fiscal_cycle(id,(current_date+1)::timestamptz) FROM public.businesses ORDER BY id;`);
   const daily=await row(`SELECT coalesce(sum(produced_quantity),0)::float8 output,coalesce(sum(revenue),0)::float8 revenue FROM public.business_daily_operations WHERE operation_date=current_date`);
   series.push({day,confidence,...daily});
   check(Math.abs(await money()-initialMoney)<.02,`${humans} humans, day ${day}: money is conserved`);
  }
  check(Number((await row('SELECT min(balance) n FROM public.accounts')).n)>=0,`${humans} humans: no negative account`);
  check(Number((await row('SELECT min(quantity) n FROM public.business_inventory')).n)>=0,`${humans} humans: no negative stock`);
  check(Number((await row("SELECT count(*) n FROM public.transactions WHERE type='company_salary'")).n)>0,`${humans} humans: salaries actually reach accounts`);
  check(Number((await row('SELECT sum(amount) n FROM public.government_revenues')).n)>0,`${humans} humans: legal tax receipts exist`);
  check(Number((await row(`SELECT count(*) n FROM public.business_balance_cycles WHERE business_id='${npc}'`)).n)>=4,`${humans} humans: at least four weekly closes are recorded`);
  const summary=await row(`SELECT (SELECT balance FROM public.accounts WHERE account_kind='population') household_cash,
    (SELECT treasury_balance FROM public.government_finances WHERE id=1) treasury_cash,
    (SELECT sum(wage_due) FROM public.business_employees) unpaid_wages,
    (SELECT sum(net_result) FROM public.business_balance_cycles) operating_result,
    (SELECT count(*) FROM public.businesses WHERE operational_status='closed') closed_companies`);
  const companies=(await db.query(`SELECT b.business_type_id,b.control_kind,b.status,b.operational_status,
   (SELECT sum(net_result) FROM public.business_balance_cycles c WHERE c.business_id=b.id) net_result,
   (SELECT balance FROM public.accounts a WHERE a.business_id=b.id) cash,
   (SELECT sum(wage_due) FROM public.business_employees e WHERE e.business_id=b.id) unpaid_wages
   FROM public.businesses b ORDER BY b.business_type_id,b.control_kind,b.name`)).rows;
  const supplyTrades=Number((await row("SELECT count(*) n FROM public.transactions WHERE type='business_supply'")).n);
  const paid=Number((await row('SELECT coalesce(sum(amount),0) n FROM private.population_circulation_payments')).n);
  results.push({scenario:diversified?'diversified_synthetic_capital':'solar_competition_baseline',authorizedCirculation:circulation,disbursed:paid,initialHouseholds,humans,days,initialMoney,endingMoney:await money(),durationMs:Math.round(performance.now()-started),...summary,supplyTrades,companies,series});
  if(process.env.GOVRP_TEST_RESULTS_PATH)writeFileSync(process.env.GOVRP_TEST_RESULTS_PATH,JSON.stringify(results,null,2));
  console.log('LONG RUN '+JSON.stringify({...results.at(-1),series:undefined,companies:undefined}));
 }finally{await db.close();}
}
if(process.env.GOVRP_TEST_RESULTS_PATH)writeFileSync(process.env.GOVRP_TEST_RESULTS_PATH,JSON.stringify(results,null,2));
console.log(`PASS: ${checks} long-run accounting assertions. ${days} days, actual catalogue and tax engine, controlled test clock; marketplace listings and manual purchases are absent. Economic sustainability must be assessed from the reported outcomes; synthetic capital is not a production funding approval.`);
