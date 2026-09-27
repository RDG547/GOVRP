import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chromium } from 'playwright';
import { actor, local, service, request, rpc, waitFor, cleanup } from './lib/world-test.mjs';
const origin='http://127.0.0.1:3123', widths=[320,360,375,390,412,430,768,1024,1440];
const log=createWriteStream('/home/rdg/.cache/govrp-qa/interim-vite.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3123','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY||local.SERVICE_ROLE_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(log);dev.stderr.pipe(log);
let browser,page;const errors=[];
async function responsive(p,label){for(const width of widths){await p.setViewportSize({width,height:950});await p.waitForTimeout(250);if(!await p.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1))console.error(await p.locator('body *').evaluateAll(els=>els.filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,80)}))));assert(await p.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: página ${width}`);assert(await p.getByRole('dialog').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),`${label}: modal ${width}`);}console.log(`✓ ${label}: nove larguras`);}
async function login(person){const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage();page=p;p.setDefaultTimeout(20000);await p.addLocatorHandler(p.getByRole('button',{name:'Entendi',exact:true}),async()=>{await p.getByRole('button',{name:'Entendi',exact:true}).click();});p.on('pageerror',error=>errors.push(error.message));await rpc(person.client,'claim_daily_check_in').catch(()=>{});await request(service.from('notifications').update({metadata:{popup_shown_at:new Date().toISOString(),celebration_seen_at:new Date().toISOString()}}).eq('user_id',person.id));await p.goto(`${origin}/login`);await p.getByLabel('E-mail da conta',{exact:true}).fill(person.email);await p.getByLabel('Senha',{exact:true}).fill(person.password);await p.getByRole('button',{name:'Somente essenciais',exact:true}).click();await p.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();await p.waitForURL(url=>!url.pathname.includes('login'),{timeout:30000});return p;}
try {
 await waitFor(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}},'servidor',30000);browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});
 const [president,chair]=await Promise.all([actor('interim-interface-president'),actor('interim-interface-chair')]);
 const chamber='a1b2c3d4-e5f6-7890-1234-567890abcdef';
 execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`begin;
 update public.parliament_leadership_terms set status='completed',concluded_at=clock_timestamp() where status='active' and house_id='${chamber}';
 update public.parliament_members set term_end_date=current_date-1 where house_id='${chamber}';
 update public.profiles set role='Deputado',manual_role_override=true,role_assigned_at=clock_timestamp() where id='${chair.id}';
 insert into public.parliament_leadership_terms(house_id,member_id,position,status,term_start_date,term_end_date) select '${chamber}',id,'president','active',current_date,current_date+30 from public.parliament_members where user_id='${chair.id}' and house_id='${chamber}';
 update public.profiles set role='Presidente',manual_role_override=true,role_assigned_at=clock_timestamp() where id='${president.id}';
 update public.profiles set role='Cidadão',manual_role_override=true,role_assigned_at=clock_timestamp() where id='${president.id}';
 commit;`});
 assert(await rpc(chair.client,'is_acting_president',{p_user_id:chair.id}));
 const p=await login(chair);page=p;
 await p.getByRole('heading',{name:'Como deseja conduzir o Governo?',exact:true}).waitFor();await responsive(p,'Escolha do gabinete na interinidade');await p.getByRole('button',{name:'Manter atual equipe ministerial',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.goto(`${origin}/dashboard/president`);await p.getByRole('heading',{name:'Presidência Interina · dupla vacância',exact:true}).waitFor();await p.getByRole('button',{name:'Convocar eleição extraordinária',exact:true}).waitFor();await responsive(p,'Painel presidencial do deputado interino');
 assert.equal(await p.getByText('Erro ao carregar dados',{exact:true}).count(),0);
 await p.getByRole('button',{name:'Convocar eleição extraordinária',exact:true}).click();await p.getByRole('link',{name:'Acompanhar eleição no Portal Eleitoral',exact:true}).waitFor();
 const state=await rpc(chair.client,'get_executive_state');assert(state.is_interim&&state.government.extraordinary_election_id&&state.government.cabinet_decision==='kept');assert.equal((await request(service.from('profiles').select('role').eq('id',chair.id).single())).role,'Deputado');
 assert.equal(errors.length,0,errors.join('\n'));console.log('✓ Interino acessa o painel, escolhe gabinete e convoca eleição pela interface sem perder o mandato parlamentar');
} catch(error){if(page&&!page.isClosed()){await page.screenshot({path:'/home/rdg/.cache/govrp-qa/interim-interface-error.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-6000));}throw error;}
finally {await browser?.close();dev.kill('SIGTERM');log.end();await cleanup();}
