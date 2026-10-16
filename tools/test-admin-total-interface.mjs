import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {chromium} from 'playwright';
import {actor,local,service,request,rpc,waitFor,cleanup} from './lib/world-test.mjs';
import {MODAL_CATALOG} from '../src/lib/modalCatalog.js';
const origin='http://127.0.0.1:3117',log=createWriteStream('/tmp/govrp-admin-total-interface.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3117','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(log);dev.stderr.pipe(log);
let browser,page;const errors=[],denials=[],writes=[];
try{
 await waitFor(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}},'Vite local',30000);
 const admin=await actor('admin-total-panels');await request(service.from('rp_time_settings').upsert({id:true},{onConflict:'id',ignoreDuplicates:true}));execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-qc',`insert into private.platform_admins(user_id) values('${admin.id}')`]);
 await request(service.from('accounts').insert({user_id:admin.id,balance:10000,account_number:crypto.randomUUID()}));
 await rpc(admin.client,'set_admin_development_mode',{p_mode:'total'});
 browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{if(response.url().includes('/rest/v1/')&&[401,403,400,404,406].includes(response.status()))denials.push({url:response.url(),status:response.status()});});
 page.on('request',request=>{if(request.url().includes('/rest/v1/')&&['PATCH','DELETE','POST','PUT'].includes(request.method())&&!/\/rpc\/(get_|admin_get_|search_|quote_|can_|is_|has_)/.test(request.url()))writes.push(request.url());});
 await page.goto(origin+'/login');await page.getByLabel('E-mail da conta',{exact:true}).fill(admin.email);await page.getByLabel('Senha',{exact:true}).fill(admin.password);if(await page.getByRole('button',{name:'Somente essenciais',exact:true}).isVisible())await page.getByRole('button',{name:'Somente essenciais',exact:true}).click();await page.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('login'),{timeout:30000});
 const routes=['/dashboard/president','/services/parliament/panel','/services/justice?view=authority','/services/prison','/services/agies/panel','/services/armed-forces/panel','/dashboard/bank-management','/admin-dashboard/users','/admin-dashboard/development'];
 for(const route of (process.env.GALLERY_ONLY?['/admin-dashboard/development']:routes)){denials.length=0;writes.length=0;await page.goto(origin+route);await page.waitForTimeout(1800);
  if(!process.env.GALLERY_ONLY){
   const labels=route==='/dashboard/president'?['Gestão Financeira','Gestão Governamental','Indicadores e Governo','Ministros e Nomeações','Nomeações do Executivo','Atos Presidenciais','Estatais','Economia','Justiça']:route==='/dashboard/bank-management'?['Funções do cargo','Solicitações de Cartão','Solicitações de Empréstimo','Economia']:[];
   for(const label of labels){await page.getByRole('tab',{name:label,exact:true}).click();await page.waitForTimeout(300);}
  }
  assert(!/Acesso Negado|Não foi possível consultar o Governo|Erro ao carregar dados|Você não possui um cargo com painel/.test(await page.locator('body').innerText()),route);assert.deepEqual(denials,[],route);assert.deepEqual(writes,[],`${route}: opening a preview must not mutate`);console.log('✓ Acesso Total abre sem gravações: '+route);}
 // Every catalog button must open its own source template, not a shared mock.
 writes.length=0;const signatures=new Set();
 let checked=0;
 for(const entry of MODAL_CATALOG){
  await page.locator(`[data-modal-preview-id="${entry.id}"]`).click();
  const dialog=page.locator(`[data-preview-source="${entry.id}"]`);await dialog.waitFor({timeout:15000});
  const text=(await dialog.innerText()).trim();assert(text.length>20,entry.id);assert(!text.includes('Este exemplo permite inspecionar'),entry.id);signatures.add(text);await dialog.getByRole('button',{name:'Fechar',exact:true}).last().click();await dialog.waitFor({state:'hidden'});
  if(errors.length)throw new Error(entry.id+': '+errors.join('\n'));if(++checked%25===0)console.log(`✓ ${checked} apresentações específicas renderizadas.`);
 }
 assert(signatures.size>MODAL_CATALOG.length*.8,`Distinct modal contents: ${signatures.size}`);assert.deepEqual(writes,[],'Gallery must not issue real mutations');console.log(`✓ ${MODAL_CATALOG.length} specific source modals; ${signatures.size} distinct contents, no real writes.`);
 await page.getByRole('button',{name:'Balanço empresarial',exact:true}).click();await page.getByText('Lucro empresarial',{exact:true}).waitFor();for(const width of [320,360,375,390,412,430,768,1024,1280,1440]){await page.setViewportSize({width,height:950});assert(await page.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}const balanceBox=await page.getByText('Lucro empresarial',{exact:true}).boundingBox();assert(balanceBox.y>80&&balanceBox.y<900,'Balance preview must be inside viewport, above the page');await page.screenshot({path:'/tmp/govrp-balance-preview.png'});await page.getByText('Receita',{exact:false}).last().waitFor();await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Check-in diário',exact:true}).click();await page.getByRole('button',{name:'Fazer Check-in Agora',exact:true}).waitFor();await page.getByText('Sequência',{exact:true}).waitFor();for(const width of [320,360,375,390,412,430,768,1024,1280,1440]){await page.setViewportSize({width,height:950});assert(await page.locator('html').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}const checkinBox=await page.getByRole('button',{name:'Fechar check-in diário',exact:true}).boundingBox();assert(checkinBox.y>80&&checkinBox.y<900,'Check-in close control must remain visible');await page.screenshot({path:'/tmp/govrp-checkin-preview.png'});await page.getByRole('button',{name:'Fazer Check-in Agora',exact:true}).click();await page.getByText('Ação de teste concluída. Nenhum dado do RP foi alterado.',{exact:true}).waitFor();
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal((await request(service.from('profiles').select('role').eq('id',admin.id).single())).role,'Cidadão');
 console.log('✓ Real balance/check-in views are distinct, locally interactive, canonical role preserved.');
}catch(error){console.error('Browser errors:',errors);if(page){await page.screenshot({path:'/tmp/govrp-admin-total-error.png'});console.error((await page.locator('body').innerText()).slice(-3500));}throw error;}
finally{await browser?.close();dev.kill('SIGTERM');log.end();await cleanup();}
