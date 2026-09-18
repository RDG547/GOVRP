import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chromium } from 'playwright';
import { actor, local, service, request, rpc, waitFor, cleanup } from './lib/world-test.mjs';
import { documentCatalog, documentHasTwoSides } from '../src/lib/documentCatalog.js';
const origin='http://127.0.0.1:3101';const widths=[320,360,375,390,412,430,768,1024,1440];
const output=createWriteStream('/tmp/govrp-citizen-vite.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3101','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY||local.SERVICE_ROLE_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(output);dev.stderr.pipe(output);
let browser,page,governanceBefore;const errors=[];
async function responsive(p,label){for(const width of widths){await p.setViewportSize({width,height:950});assert(await p.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: largura ${width}`);assert(await p.getByRole('dialog').evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1)),`${label}: modal ${width}`);}console.log(`OK ${label}: nove larguras`);}
async function login(person){const context=await browser.newContext({viewport:{width:1440,height:1000}});const p=await context.newPage();page=p;p.on('pageerror',error=>errors.push(error.message));await rpc(person.client,'claim_daily_check_in').catch(()=>undefined);await p.goto(`${origin}/login`);await p.getByLabel('E-mail da conta',{exact:true}).fill(person.email);await p.getByLabel('Senha',{exact:true}).fill(person.password);await p.getByRole('button',{name:'Somente essenciais',exact:true}).click();await p.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();await p.waitForURL(url=>!url.pathname.includes('login'),{timeout:30000}); return p;}
try {
 await waitFor(async()=>{try{return (await fetch(origin)).ok;}catch{return false;}},'servidor local',30000);
 browser=await chromium.launch({headless:true,executablePath:process.env.GOVRP_CHROMIUM_PATH||'/opt/google/chrome/chrome',args:['--no-sandbox']});
 if(!process.env.GOVRP_FORMATION_ONLY){
 const citizen=await actor('citizen-ui','Cidadão',{date_of_birth:'2000-01-01'});
 await request(service.from('accounts').insert({user_id:citizen.id,account_number:crypto.randomUUID().slice(0,18),agency_number:'0001',balance:100000}));
 const p=await login(citizen);
 await p.getByRole('button',{name:'Ajuda',exact:true}).hover();
 await p.getByRole('navigation').getByRole('button',{name:'Instalar GOVRP',exact:true}).click();
 await p.getByRole('heading',{name:'Instalar GOVRP',exact:true}).waitFor();
 await p.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
 await p.evaluate(()=>{localStorage.setItem('govrp:pwa-install-dismissed-at',String(Date.now()));const event=new Event('beforeinstallprompt');event.prompt=async()=>{window.installPromptWasCalled=true;};event.userChoice=Promise.resolve({outcome:'dismissed'});window.dispatchEvent(event);});
 const invite=p.getByRole('button',{name:'Fechar convite de instalação',exact:true});if(await invite.isVisible())await invite.click();
 await p.getByRole('button',{name:'Ajuda',exact:true}).hover();await p.getByRole('navigation').getByRole('button',{name:'Instalar GOVRP',exact:true}).click();await p.getByRole('button',{name:'Instalar aplicativo',exact:true}).click();assert(await p.evaluate(()=>window.installPromptWasCalled));await p.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
 console.log('OK instalação permanente no menu; convite dispensado e evento tardio continuam funcionais');
 await p.goto(`${origin}/services/national-market`);
 await p.getByText('Arroz com feijão',{exact:true}).waitFor({timeout:30000});
 await responsive(p,'Mercado Nacional');
 const foodCard=p.locator('div.rounded-lg').filter({has:p.getByText('Arroz com feijão',{exact:true})}).filter({has:p.getByRole('button',{name:'Comprar',exact:true})}).last();
 await foodCard.getByRole('button',{name:'Comprar',exact:true}).click();await responsive(p,'Confirmação da compra');
 await p.getByRole('button',{name:'Confirmar compra',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 const bought=await request(citizen.client.from('user_inventory').select('id').eq('product_id','f2100000-0000-4000-8000-000000000002').single());assert(bought.id);console.log('OK compra pela interface cria inventário');
 await request(service.from('citizen_needs').update({hunger:20}).eq('user_id',citizen.id));
 await p.goto(`${origin}/services/inventory`);await p.getByRole('button',{name:'Consumir',exact:true}).click();
 await waitFor(async()=>Number((await rpc(citizen.client,'get_citizen_needs')).hunger)===60,'consumo pela interface');
 for(const width of widths){await p.setViewportSize({width,height:950});const hud=p.getByRole('button',{name:'Estado do cidadão',exact:true}).filter({visible:true});await hud.click();const bar=p.getByRole('progressbar',{name:'Fome',exact:true});await bar.waitFor();assert.equal(await bar.getAttribute('aria-valuenow'),'60');assert(await p.getByRole('dialog').last().evaluate(el=>el.getBoundingClientRect().left>=0 && el.getBoundingClientRect().right<=innerWidth));await p.keyboard.press('Escape');await bar.waitFor({state:'hidden'});}
 console.log('OK consumo e HUD acessível com estado persistido nas nove larguras');
 await rpc(citizen.client,'buy_product',{p_product_id:'f2100000-0000-4000-8000-000000000002',p_payment_method:'balance',p_card_id:null,p_idempotency_key:crypto.randomUUID()});
 await request(service.from('citizen_needs').update({hunger:20}).eq('user_id',citizen.id));
 const inventoryUrl=p.url(),inventoryLoad=await p.evaluate(()=>performance.timeOrigin);
 await p.getByRole('button',{name:'Estado do cidadão',exact:true}).filter({visible:true}).click();
 await p.getByRole('button',{name:'Meus consumíveis',exact:true}).click();
 await p.getByRole('region',{name:'Meus consumíveis',exact:true}).getByRole('button',{name:'Consumir',exact:true}).click();
 await waitFor(async()=>Number((await rpc(citizen.client,'get_citizen_needs')).hunger)===60,'consumo dentro do HUD');
 await p.getByRole('button',{name:'Voltar ao estado do cidadão',exact:true}).click();
 await waitFor(async()=>await p.getByRole('progressbar',{name:'Fome',exact:true}).getAttribute('aria-valuenow')==='60','HUD exibe consumo confirmado');
 assert.equal(p.url(),inventoryUrl);assert.equal(await p.evaluate(()=>performance.timeOrigin),inventoryLoad);
 await p.getByRole('button',{name:'Fechar estado do cidadão',exact:true}).click();
 console.log('OK consumíveis funcionam dentro do HUD, sem sair da página');

 await p.getByRole('button',{name:'Estado do cidadão',exact:true}).filter({visible:true}).click();await p.getByRole('link',{name:'Moradia',exact:true}).click();await p.waitForURL('**/services/national-housing');await p.getByText('Kitnet Cidadã',{exact:true}).waitFor();await responsive(p,'Imobiliária Nacional');
 const homeCard=p.locator('div.rounded-lg').filter({has:p.getByText('Kitnet Cidadã',{exact:true})}).filter({has:p.getByRole('button',{name:'Comprar',exact:true})}).last();
 await homeCard.getByRole('button',{name:'Comprar',exact:true}).click();await p.getByRole('button',{name:'Confirmar compra',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
 await p.getByRole('button',{name:'Tomar banho',exact:true}).click();await request(service.from('citizen_needs').update({sleep:20}).eq('user_id',citizen.id));await p.getByRole('button',{name:'Dormir',exact:true}).click();await p.getByRole('heading',{name:'Seu cidadão está dormindo',exact:true}).waitFor();const housingUrl=p.url();
 await p.getByRole('link',{name:'Ir para outra área',exact:true}).click();
 await p.getByRole('button',{name:'Continuar dormindo',exact:true}).click();assert.equal(p.url(),housingUrl);
 await p.evaluate(()=>history.back());
 await p.getByRole('button',{name:'Continuar dormindo',exact:true}).click();assert.equal(p.url(),housingUrl);
 await p.getByRole('link',{name:'Ir para outra área',exact:true}).click();
 await p.getByRole('button',{name:'Acordar e continuar',exact:true}).click();await p.waitForURL('**/dashboard');
 assert(!(await rpc(citizen.client,'get_citizen_needs')).sleep_started_at);
 console.log('OK sono bloqueia links e voltar do navegador, continua ou acorda antes de navegar');console.log('OK imóvel comprado e usado pela interface');
 for(const type of Object.keys(documentCatalog))await request(service.from('documents').insert({user_id:citizen.id,type,document_number:`DOC-${crypto.randomUUID().slice(0,8)}`,is_valid:true,issued_at:new Date().toISOString(),metadata:{result:'nothing_found'}}));
 await p.goto(`${origin}/services/dic`);await p.getByRole('button',{name:'Gerar PDF com Todos os Documentos',exact:true}).waitFor({timeout:30000});
 const containers=p.locator('[data-export-host] > div');
 const expected=Object.keys(documentCatalog).reduce((n,type)=>n+(documentHasTwoSides(type)?2:1),0);
 assert.equal(await containers.count(),expected);
 for(const container of await containers.all())assert(await container.evaluate(el=>{const card=el.querySelector('[data-official-document]');if(!card)return false;const a=el.getBoundingClientRect(),b=card.getBoundingClientRect();return b.left-a.left>=19 && a.right-b.right>=19 && b.top-a.top>=19 && a.bottom-b.bottom>=19;}),'documento tem margem completa em cada lado');
 const overflow=await containers.evaluateAll(els=>els.flatMap(el=>{const card=el.querySelector('[data-official-document]');const b=card.getBoundingClientRect();return [...card.querySelectorAll('p')].filter(p=>p.getBoundingClientRect().bottom>b.bottom-2).map(p=>p.textContent);}));assert.deepEqual(overflow,[],'texto dos documentos cabe dentro do cartão');
 const download=p.waitForEvent('download',{timeout:90000});await p.getByRole('button',{name:'Gerar PDF com Todos os Documentos',exact:true}).click();const file=await download;await file.saveAs('/tmp/govrp-citizen-all-documents.pdf');
 const info=execFileSync('pdfinfo',['/tmp/govrp-citizen-all-documents.pdf'],{encoding:'utf8'});assert.equal(Number(info.match(/Pages:\s+(\d+)/)?.[1]),expected);
 console.log(`OK PDF real exportado: ${expected} páginas, todos os modelos e lados com margem`);
 await p.goto(`${origin}/services/x`);await p.getByPlaceholder('O que está acontecendo?').fill('Rascunho durante manutenção');
 const settingsBefore=await request(service.from('system_settings').select('*').eq('key','service_availability').maybeSingle());
 try{
 await p.getByRole('button',{name:'Adicionar Story',exact:true}).click();await p.getByRole('button',{name:'Texto',exact:true}).click();await p.getByPlaceholder('Comece a digitar...').fill('Story preservado durante manutenção');
 await request(service.from('system_settings').upsert({key:'service_availability',value:{...settingsBefore?.value,'/services/x':{mode:'maintenance'}}}));
 await p.getByRole('heading',{name:'Estamos fazendo ajustes nesta área',exact:true}).waitFor({timeout:20000});assert(!await p.getByPlaceholder('O que está acontecendo?').isVisible());
 await p.getByRole('dialog').waitFor({state:'hidden'});assert(!await p.getByRole('button',{name:'Publicar Story',exact:true}).isVisible());
 await request(service.from('system_settings').upsert({key:'service_availability',value:{...settingsBefore?.value,'/services/x':{mode:'active'}}}));
 await p.getByPlaceholder('Comece a digitar...').waitFor({timeout:20000});assert.equal(await p.getByPlaceholder('Comece a digitar...').inputValue(),'Story preservado durante manutenção');await p.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click();
 await p.getByPlaceholder('O que está acontecendo?').waitFor({timeout:20000});assert.equal(await p.getByPlaceholder('O que está acontecendo?').inputValue(),'Rascunho durante manutenção');
 console.log('OK manutenção suspende ações em portais e preserva modal, Story e rascunho ao reativar');
 }finally{if(settingsBefore)await request(service.from('system_settings').upsert(settingsBefore));else await request(service.from('system_settings').delete().eq('key','service_availability'));}
 await p.context().close();
 }
 governanceBefore=await request(service.from('system_settings').select('*').eq('key','executive_governance').maybeSingle());const formationSettings=structuredClone(governanceBefore?.value||{});if(formationSettings.specialAppointments)delete formationSettings.specialAppointments.intelligence_commander;await request(service.from('system_settings').upsert({key:'executive_governance',value:formationSettings}));await actor('formation-nominee','Cidadão',{full_name:'AAA Formação Cidadão'});const president=await actor('president-ui');await request(service.from('profiles').update({role:'Presidente'}).eq('id',president.id));const pp=await login(president);page=pp;
 const roleModal=pp.getByRole('button',{name:'Entendi',exact:true});await roleModal.waitFor({timeout:30000});await roleModal.click();await pp.getByRole('heading',{name:'Forme seu Governo',exact:true}).waitFor({timeout:30000});
 await responsive(pp,'Formação obrigatória do Governo');
 for(let i=0;i<20;i++){const before=await rpc(president.client,'get_presidential_formation');if(before.completed_at)break;await pp.getByText(`Faltam ${before.remaining} nomeações.`,{exact:true}).waitFor();await pp.getByRole('combobox',{name:'Selecionar cidadão para nomeação',exact:true}).click();await pp.getByRole('option').first().click();await pp.getByRole('button',{name:'Confirmar nomeação',exact:true}).click();await waitFor(async()=>{const f=await rpc(president.client,'get_presidential_formation');return f.remaining<before.remaining;},'nomeação pela interface');console.log(`OK formação: etapa ${i+1}`);}
 assert((await rpc(president.client,'get_presidential_formation')).completed_at);await pp.getByRole('button',{name:'Ir para o Painel Presidencial',exact:true}).click();await pp.waitForURL('**/dashboard/president');await responsive(pp,'Painel Presidencial');
 const selicBefore=(await request(service.from('economic_state').select('current_selic').eq('id',true).single())).current_selic;
 const presidentLoad=await pp.evaluate(()=>performance.timeOrigin);
 await pp.getByRole('tab',{name:'Gestão Financeira',exact:true}).click();await pp.getByRole('tab',{name:'Política Monetária',exact:true}).click();
 await pp.getByRole('spinbutton',{name:'Taxa Selic anual',exact:true}).fill('-10');await pp.getByRole('button',{name:'Salvar Taxa Selic',exact:true}).click();
 await waitFor(async()=>Number((await request(service.from('economic_state').select('current_selic').eq('id',true).single())).current_selic)===-10,'Selic negativa salva pela interface');
 await pp.getByRole('button',{name:'Salvar Taxa Selic',exact:true}).waitFor();assert.equal(await pp.getByRole('tab',{name:'Política Monetária',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await pp.evaluate(()=>performance.timeOrigin),presidentLoad);
 await pp.getByRole('spinbutton',{name:'Taxa Selic anual',exact:true}).fill(String(selicBefore));await pp.getByRole('button',{name:'Salvar Taxa Selic',exact:true}).click();
 await waitFor(async()=>Number((await request(service.from('economic_state').select('current_selic').eq('id',true).single())).current_selic)===Number(selicBefore),'restaura Selic de teste');
 console.log('OK Selic negativa salva pela interface e preserva a aba Política Monetária sem reload');
 assert(!errors.length,errors.join('\n'));
 console.log('OK nomeação pela interface; nenhum erro de execução no navegador');
}catch(error){if(page){await page.screenshot({path:'/tmp/govrp-citizen-interface-error.png'});console.error((await page.locator('body').innerText()).slice(-5000));console.error(await page.getByRole('dialog').evaluateAll(els=>els.map(e=>({state:e.dataset.state,animation:getComputedStyle(e).animation,html:e.outerHTML.slice(0,300)}))));}throw error;}
finally {if(governanceBefore)await request(service.from('system_settings').upsert(governanceBefore));await browser?.close();dev.kill('SIGTERM');output.end();await cleanup();}
