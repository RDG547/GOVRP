import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chromium } from 'playwright';
import { actor, local, service, request, rpc, waitFor, cleanup } from './lib/world-test.mjs';
const origin='http://127.0.0.1:3105';const widths=[320,360,375,390,412,430,768,1024,1440];
const output=createWriteStream('/tmp/govrp-government-vite.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3105','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY||local.SERVICE_ROLE_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(output);dev.stderr.pipe(output);
let browser,page,salaryBefore;const errors=[];
async function responsive(p,label){for(const width of widths){await p.setViewportSize({width,height:950});assert(await p.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: largura ${width}`);assert(await p.getByRole('dialog').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),`${label}: modal ${width}`);}console.log(`OK ${label}: nove larguras`);}
async function login(person){const context=await browser.newContext({viewport:{width:1440,height:1000}});const p=await context.newPage();page=p;p.on('pageerror',error=>errors.push(error.message));await rpc(person.client,'claim_daily_check_in').catch(()=>undefined);await request(service.from('notifications').update({metadata:{popup_shown_at:new Date().toISOString()}}).eq('user_id',person.id).eq('type','role_changed'));await p.goto(`${origin}/login`);await p.getByLabel('E-mail da conta',{exact:true}).fill(person.email);await p.getByLabel('Senha',{exact:true}).fill(person.password);await p.getByRole('button',{name:'Somente essenciais',exact:true}).click();await p.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();await p.waitForURL(url=>!url.pathname.includes('login'),{timeout:30000}); return p;}
try {
 await waitFor(async()=>{try{return (await fetch(origin)).ok;}catch{return false;}},'servidor local',30000);
 browser=await chromium.launch({headless:true,executablePath:process.env.GOVRP_CHROMIUM_PATH||'/opt/google/chrome/chrome',args:['--no-sandbox']});
 salaryBefore=await request(service.from('system_settings').select('*').eq('key','official_salaries').single());
 const fixture=structuredClone(salaryBefore);fixture.value.roles=fixture.value.roles.map(role=>role.role==='Juiz'?{...role,amount:11111,previous_amount:11111,valid_from:'2026-01-01T00:00:00Z'}:role);await request(service.from('system_settings').upsert(fixture));
 const admin=await actor('salary-ui','Admin');const p=await login(admin);
 await p.goto(`${origin}/admin-dashboard/salaries`);await p.getByRole('heading',{name:'Remuneração dos cargos oficiais',exact:true}).waitFor();
 await waitFor(async()=>await p.getByRole('button',{name:'Salvar remuneração',exact:true}).count()===25,'catálogo dos 25 cargos');await responsive(p,'Gestão salarial');
 const viewer=await browser.newPage({viewport:{width:1440,height:950}});await viewer.goto(`${origin}/country-info`);await viewer.getByRole('button',{name:'Somente essenciais',exact:true}).click();await viewer.getByRole('tab',{name:'Transparência (Salários)',exact:true}).click();
 const publicRow=viewer.getByRole('row').filter({has:viewer.getByText('Juiz',{exact:true})});await publicRow.getByText(/11.111,00/).waitFor();await responsive(viewer,'Transparência salarial');
 const viewerLoad=await viewer.evaluate(()=>performance.timeOrigin);
 const form=p.locator('form').filter({has:p.getByRole('heading',{name:'Juiz',exact:true})});await form.getByRole('spinbutton').fill('18777');await form.getByRole('button',{name:'Salvar remuneração',exact:true}).click();
 await waitFor(async()=>{const setting=await request(service.from('system_settings').select('value').eq('key','official_salaries').single());return setting.value.roles.find(role=>role.role==='Juiz').amount===18777;},'salário salvo pela interface');
 await publicRow.getByText(/11.111,00/).waitFor();assert(await form.getByText(/18.777,00/).isVisible());
 const current=await request(service.from('system_settings').select('*').eq('key','official_salaries').single());current.value.roles=current.value.roles.map(role=>role.role==='Juiz'?{...role,valid_from:new Date(Date.now()+5000).toISOString()}:role);await request(service.from('system_settings').upsert(current));
 await publicRow.getByText(/18.777,00/).waitFor({timeout:20000});assert.equal(await viewer.evaluate(()=>performance.timeOrigin),viewerLoad);
 console.log('OK remuneração salva no Admin e vigência futura atualiza a transparência sem nova escrita ou reload');
 await viewer.close();await p.context().close();
 const manager=await actor('electoral-ui','Presidente do Portal Eleitoral');const electionPage=await login(manager);await electionPage.goto(`${origin}/services/elections`);await electionPage.getByRole('tab',{name:'Gestão eleitoral',exact:true}).click();await electionPage.getByRole('heading',{name:'Gestão do Portal Eleitoral',exact:true}).waitFor();await responsive(electionPage,'Gestão do Portal Eleitoral');
 await electionPage.getByRole('button',{name:'Agendar eleição',exact:true}).click();await responsive(electionPage,'Calendário eleitoral');
 const modal=electionPage.getByRole('dialog');const name=`Calendário UI ${crypto.randomUUID().slice(0,8)}`;await modal.getByLabel('Nome',{exact:true}).fill(name);await modal.getByLabel('Descrição',{exact:true}).fill('Calendário institucional verificado pela interface.');
 const type=await request(service.from('election_types').select('id,name').limit(1).single());await modal.getByRole('combobox',{name:'Tipo de eleição',exact:true}).click();await electionPage.getByRole('option',{name:type.name,exact:true}).click();
 const labels=['Início das candidaturas','Fim das candidaturas','Início da votação','Fim da votação'];for(let i=0;i<labels.length;i++)await modal.getByLabel(labels[i],{exact:true}).fill(new Date(Date.now()+(24+i)*3600000).toISOString().slice(0,16));
 await modal.getByRole('button',{name:'Salvar calendário',exact:true}).click();await modal.waitFor({state:'hidden'});assert((await request(service.from('elections').select('id').eq('name',name).single())).id);
 await electionPage.getByRole('tab',{name:'Informações',exact:true}).click();assert.equal(await electionPage.getByRole('tab',{name:'Informações',exact:true}).getAttribute('aria-selected'),'true');
 console.log('OK gestor eleitoral agenda eleição futura pela interface e acessa a explicação institucional');
 assert(!errors.length,errors.join('\n'));
}catch(error){if(page){await page.screenshot({path:'/tmp/govrp-government-interface-error.png'});console.error((await page.locator('body').innerText()).slice(-3500));}throw error;}
finally{if(salaryBefore)await request(service.from('system_settings').upsert(salaryBefore));await browser?.close();dev.kill('SIGTERM');output.end();await cleanup();}
