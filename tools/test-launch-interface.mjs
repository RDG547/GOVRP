import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {chromium} from 'playwright';
import {actor,local,service,request,rpc,waitFor,cleanup} from './lib/world-test.mjs';
const origin='http://127.0.0.1:3128',log=createWriteStream('/tmp/govrp-launch-interface.log');
const dev=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3128','--strictPort'],{env:{...process.env,VITE_SUPABASE_URL:local.API_URL,VITE_SUPABASE_ANON_KEY:local.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SECRET_KEY:local.SECRET_KEY||local.SERVICE_ROLE_KEY,VITE_HCAPTCHA_SITE_KEY:'',VITE_HCAPTCHA_SITEKEY:''},stdio:['ignore','pipe','pipe']});dev.stdout.pipe(log);dev.stderr.pipe(log);
const sql=query=>execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
let browser,page;const errors=[];
try{
 await waitFor(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}},'Vite local',30000);
 const person=await actor('launch-interface'),director=await actor('launch-interface-director','Comandante da Agência de Inteligência');
 await request(service.from('accounts').insert({user_id:person.id,bank_welcome_completed:true,balance:50000,account_number:crypto.randomUUID()}));await rpc(person.client,'claim_daily_check_in');
 const account=await rpc(person.client,'get_my_bank_account');
 const card=await request(service.from('cards').insert({user_id:person.id,account_id:account.id,brand:'visa',card_type:'credit',type:'credit',is_active:true,card_number:'3699'+String(Math.floor(Math.random()*1e12)).padStart(12,'0'),card_holder_name:'Teste interface',expiry_date:'12/30',cvv:'123',card_limit:1000,used_limit:0}).select('*').single());
 browser=await chromium.launch({headless:true,executablePath:'/opt/google/chrome/chrome',args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
 const login=async actor=>{await page.goto(origin+'/login');await page.getByLabel('E-mail da conta',{exact:true}).fill(actor.email);await page.getByLabel('Senha',{exact:true}).fill(actor.password);if(await page.getByRole('button',{name:'Somente essenciais',exact:true}).isVisible())await page.getByRole('button',{name:'Somente essenciais',exact:true}).click();await page.getByRole('main').getByRole('button',{name:'Entrar',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('login'));};
 await login(person);
 await page.goto(origin+'/services/agies/panel');await page.getByRole('heading',{name:'ACESSO RESTRITO',exact:true}).waitFor();assert(!await page.getByRole('button',{name:'Criar operação',exact:true}).count());
 console.log('✓ Cidadão comum recebe a página restrita da AGIES, sem painel sigiloso.');
 await page.goto(origin+'/services/bank');await page.getByRole('tab',{name:'Cartões & Faturas',exact:true}).click();await page.getByRole('button',{name:'Cancelar Cartão',exact:true}).click();
 const cancel=page.getByRole('alertdialog',{name:'Cancelar cartão Visa',exact:true});await cancel.waitFor();assert((await cancel.innerText()).includes(card.card_number.slice(-4)));assert.equal(await page.locator('.rccs__card--visa').count(),1,'Persisted Visa brand overrides the numeric BIN');
 for(const width of [320,360,375,390,412,430,768,1024,1280,1440]){await page.setViewportSize({width,height:1000});assert(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1));}
 await cancel.getByRole('button',{name:'Sim, Cancelar',exact:true}).click();await cancel.waitFor({state:'hidden'});await waitFor(async()=>!(await request(service.from('cards').select('is_active').eq('id',card.id).single())).is_active,'cancelamento persistido');
 console.log('✓ Cartão exibe a bandeira persistida; confirmação responsiva cancela sem apagar histórico.');
 await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/services/national-housing');await page.getByRole('button',{name:'Comprar',exact:true}).first().click();
 const purchase=page.getByRole('dialog',{name:'Adquirir imóvel',exact:true});await purchase.getByText('Saldo disponível',{exact:true}).waitFor();await purchase.getByText('Saldo após compra',{exact:true}).waitFor();await purchase.evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 for(const width of [320,360,375,390,412,430,768,1024,1280,1440]){await page.setViewportSize({width,height:1000});assert(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await waitFor(async()=>{const box=await purchase.boundingBox();return box.x>=-1&&box.x+box.width<=width+1;},`modal dentro de ${width}px`,3000);}
 await purchase.getByRole('button',{name:'Cancelar',exact:true}).click();await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Estado do cidadão',exact:true}).click();await page.getByText('Felicidade',{exact:true}).waitFor();await page.getByRole('button',{name:'Estado do cidadão',exact:true}).click();await page.getByRole('button',{name:'Fechar estado do cidadão',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Abrir celular',exact:true}).click();const phone=page.getByRole('region',{name:'Celular do cidadão',exact:true});await phone.getByRole('button',{name:'Abrir Banco',exact:true}).click();
 const bank=page.frameLocator('iframe[title="Aplicativo Banco no celular"]');await bank.getByRole('tab',{name:'Investir',exact:true}).click();await bank.getByRole('tab',{name:'Oportunidades',exact:true}).click();
 await phone.getByRole('button',{name:'Voltar no aplicativo',exact:true}).click();await expectVisible(bank.getByRole('tab',{name:'Meu Portfólio',exact:true}));
 await phone.getByRole('button',{name:'Voltar no aplicativo',exact:true}).click();await expectVisible(bank.getByRole('tab',{name:'Extrato',exact:true}));
 await phone.getByRole('button',{name:'Voltar no aplicativo',exact:true}).click();await phone.getByRole('button',{name:'Abrir Banco',exact:true}).waitFor();
 console.log('✓ Saldo real e projeção aparecem na aquisição; Felicidade é independente; Voltar respeita subaba, aplicativo e início.');
 await phone.getByRole('button',{name:'Fechar celular',exact:true}).click();
 await page.goto(origin+'/dashboard?tab=invitations');await page.getByRole('heading',{name:'Meus Convites',exact:false}).waitFor();
 // Realtime is exercised by creating the authoritative institutional invitation
 // after the receiving dashboard is open; the actual response is tested via RPC.
 const head=sql("select coalesce((select head_id from public.government_terms where ended_at is null order by term_starts_at desc limit 1),(select id from public.profiles where role='Presidente' and deleted_at is null limit 1))");
 if(head){
  const ministry=sql('select id from public.government_ministries where is_active order by name limit 1');
  const id=sql(`insert into public.minister_invitations(invited_by,candidate_id,ministry_id,government_id,status,expires_at,popup_deferred_at) values('${head}','${person.id}','${ministry}',(select id from public.government_terms where ended_at is null order by term_starts_at desc limit 1),'pending',now()+interval '1 hour',now()) returning id` ).split('\n')[0];
  await page.getByRole('heading',{name:/Ministério/}).waitFor();assert.match(await page.getByRole('timer').last().innerText(),/\d{2}:\d{2}:\d{2}/);await page.getByRole('button',{name:'Recusar',exact:true}).click();await page.getByRole('button',{name:'Respondidos',exact:true}).click();await page.getByText('Recusado',{exact:true}).waitFor();assert.equal((await request(service.from('minister_invitations').select('status').eq('id',id).single())).status,'declined');
  console.log('✓ Convite chega por Realtime à central aberta e a resposta persiste no histórico.');
 }
 await page.context().clearCookies();await page.evaluate(()=>localStorage.clear());await login(director);await page.goto(origin+'/services/agies/panel');await page.getByRole('button',{name:'Criar operação',exact:true}).waitFor();await page.getByRole('button',{name:'Criar operação',exact:true}).click();const op=page.getByRole('dialog',{name:'Criar operação de inteligência',exact:true});await op.getByRole('combobox',{name:'Classificação',exact:true}).waitFor();await op.getByRole('button',{name:'Cancelar',exact:true}).click();
 const queued=await actor('launch-queue');await request(service.from('accounts').insert({user_id:queued.id,balance:1000,account_number:crypto.randomUUID(),bank_welcome_completed:true}));
 const info=await request(service.from('notifications').insert([{user_id:queued.id,type:'institutional_result',content:'Primeiro aviso de validação',metadata:{popup_pending:true,outcome:'Validação da fila'}},{user_id:queued.id,type:'institutional_result',content:'Segundo aviso de validação',metadata:{popup_pending:true,outcome:'Segundo aviso'}}]).select('id'));
 let protectedInvitation;
 if(head){const ministry=sql('select id from public.government_ministries where is_active order by name limit 1');protectedInvitation=sql(`insert into public.minister_invitations(invited_by,candidate_id,ministry_id,government_id,status,expires_at,popup_deferred_at) values('${head}','${queued.id}','${ministry}',(select id from public.government_terms where ended_at is null order by term_starts_at desc limit 1),'pending',now()+interval '1 hour',now()) returning id`).split('\n')[0];}
 await page.context().clearCookies();await page.evaluate(()=>localStorage.clear());await login(queued);
 await page.getByRole('button',{name:'Fechar todos os avisos',exact:true}).waitFor();
 assert((await page.getByRole('dialog').count())+(await page.getByRole('button',{name:'Fechar check-in diário',exact:true}).count())<=1,'Only one queued popup is visible');
 await page.getByRole('button',{name:'Fechar todos os avisos',exact:true}).click();
 await waitFor(async()=>{const rows=await request(service.from('notifications').select('metadata').in('id',info.map(row=>row.id)));return rows.every(row=>row.metadata.popup_shown_at);},'avisos informativos dispensados');
 await page.getByRole('button',{name:'Fechar todos os avisos',exact:true}).waitFor({state:'hidden'});
 if(protectedInvitation)assert.equal((await request(service.from('minister_invitations').select('status').eq('id',protectedInvitation).single())).status,'pending');
 console.log('✓ Fila mostra um aviso por vez; Fechar todos funciona com foco no modal e não responde convites.');
 assert.deepEqual(errors,[]);console.log('✓ Diretor acessa o formulário real de inteligência; nenhuma exceção JavaScript nos fluxos.');
}catch(error){if(page&&!page.isClosed()){console.error(await page.getByRole('dialog').evaluateAll(els=>els.map(el=>({box:el.getBoundingClientRect().toJSON(),transform:getComputedStyle(el).transform,left:getComputedStyle(el).left,animation:getComputedStyle(el).animation,classes:el.className}))));await page.screenshot({path:'/tmp/govrp-launch-interface-error.png'});console.error((await page.locator('body').innerText()).slice(-2500));}throw error;}
finally{await browser?.close();dev.kill('SIGTERM');log.end();await cleanup();}
async function expectVisible(locator){await locator.waitFor();assert.equal(await locator.getAttribute('data-state'),'active');}
