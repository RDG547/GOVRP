import assert from 'node:assert/strict';
import process from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright';

const directory=process.env.GOVRP_QA_DIRECTORY,artifacts=process.env.GOVRP_QA_ARTIFACTS;
assert.ok(directory);const env=JSON.parse(readFileSync(`${directory}/qa-credentials.json`));assert.equal(env.API_URL,'http://127.0.0.1:54431');
const fixtures=JSON.parse(readFileSync(`${directory}/general-update-fixtures.json`));
const service=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const checked=async promise=>{const result=await promise;if(result.error)throw Error(result.error.message);return result.data;};
const sql=query=>execFileSync('docker',['exec','-i','supabase_db_GOVRP_RESET_QA','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
const [owner,other,manager,admin]=fixtures.people;
for(const person of fixtures.people){const client=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {session}=await checked(client.auth.signInWithPassword({email:person.email,password:person.password}));person.session=session;person.db=client;person.citizenId=sql(`SELECT coalesce(citizen_id::text,'pending') FROM public.profiles WHERE id='${person.id}'`);}
Object.assign(process.env,{VITE_SUPABASE_URL:env.API_URL,VITE_SUPABASE_ANON_KEY:env.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:env.ANON_KEY,SUPABASE_SECRET_KEY:env.SERVICE_ROLE_KEY});
const {build,preview}=await import('vite');
const outDir=`${directory}/general-update-browser-build`;
await build({mode:'qa',logLevel:'silent',define:{'import.meta.env.DEV':'true'},build:{outDir,emptyOutDir:true}});
const htmlPath=`${outDir}/index.html`;writeFileSync(htmlPath,readFileSync(htmlPath,'utf8').replace('connect-src &#39;self&#39; https: wss:','connect-src &#39;self&#39; http://127.0.0.1:54431 ws://127.0.0.1:54431 https: wss:'));
const {default:runtimeHandler}=await import('../api/world-runtime.js');const {default:electionHandler}=await import('../api/elections/[action].js');const {default:avatarHandler}=await import('../api/citizens/avatar.js');const {default:salaryHandler}=await import('../api/salaries/process.js');
const vite=await preview({mode:'qa',logLevel:'silent',build:{outDir},preview:{host:'127.0.0.1',port:3208,strictPort:true},plugins:[{name:'general-update-real-api',configurePreviewServer(server){server.middlewares.use((request,response,next)=>{
 response.status=code=>{response.statusCode=code;return response;};response.json=payload=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify(payload));};
 const path=new URL(request.url,'http://localhost');
 if(path.pathname==='/api/world-runtime')return runtimeHandler(request,response);
 if(path.pathname.startsWith('/api/elections/'))return electionHandler(request,response);
 if(path.pathname==='/api/citizens/avatar')return avatarHandler(request,response);
 if(path.pathname==='/api/salaries/process')return salaryHandler(request,response);
 return next();
});}}]});
const base='http://127.0.0.1:3208',browser=await chromium.launch({headless:true}),pages=[],errors=[];
const open=async(person,width=1366)=>{
 const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();pages.push(page);
 page.on('pageerror',error=>{errors.push(error.message);console.error('PAGE ERROR:',error.message);});
 await page.route('https://*.supabase.co/**',route=>route.abort('blockedbyclient'));
 await page.addInitScript(({session,id,citizenId})=>{sessionStorage.setItem(`checkin_dismissed_${id}:${citizenId}`,'true');localStorage.setItem('sb-127-auth-token',JSON.stringify(session));localStorage.setItem('theme','dark');sessionStorage.setItem(`govrp:tutorial:${id}`,'closed');},{session:person.session,id:person.id,citizenId:person.citizenId});
 return page;
};
const dismiss=async (page,escape=true)=>{for(let n=0;n<5;n++){for(const name of ['Continuar minha jornada','Lembrar mais tarde','Somente essenciais','Pular','Entendi','Fechar todos os avisos']){const button=page.getByRole('button',{name,exact:true});if(await button.isVisible()&&await button.isEnabled())await button.click({timeout:2000}).catch(()=>{});}if(escape)await page.keyboard.press('Escape');await page.waitForTimeout(150);}};
const widths=[320,360,390,430,768,1024,1366,1920];
const checkLayout=async(page,dialog)=>{
 for(const width of widths){await page.setViewportSize({width,height:900});await page.waitForTimeout(160);const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,`Overflow ${size.width} -> ${size.scroll}`);if(dialog){const bounds=await dialog.boundingBox();assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1));}}
};
const original=await checked(service.from('system_settings').select('value').eq('key','service_availability').maybeSingle());
const setMode=mode=>checked(admin.db.from('system_settings').upsert({key:'service_availability',value:{...(original?.value||{}),__site__:{mode,updated_at:new Date().toISOString()}}}));
const createdElections=[];
try{
 const page=await open(owner);await page.goto(`${base}/services/bank?tab=cards&card=${fixtures.card.id}`);await page.waitForTimeout(1500);await dismiss(page);await page.getByRole('button',{name:'Solicitar aumento de limite',exact:true}).first().waitFor({timeout:60000});await dismiss(page);
 await page.getByRole('button',{name:'Solicitar aumento de limite',exact:true}).first().click();const limitDialog=page.getByRole('dialog',{name:'Solicitar aumento de limite'});await limitDialog.waitFor();
 await checkLayout(page,limitDialog);assert.ok(await limitDialog.locator('label svg').count()>=2,'Campos financeiros sem ícones');await page.keyboard.press('Escape');await limitDialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Solicitar aumento de limite'),{},{timeout:2000});console.log('PASS browser: cartão alvo, modal, ícones, foco e oito larguras.');
 const adminPage=await open(admin);await adminPage.goto(`${base}/dashboard`);await adminPage.waitForTimeout(2000);await dismiss(adminPage,false);const selector=adminPage.getByRole('dialog',{name:'Qual dashboard você deseja acessar?'});await selector.waitFor({timeout:60000});await checkLayout(adminPage,selector);await adminPage.setViewportSize({width:1366,height:900});const buttons=selector.locator('button').filter({hasNot:adminPage.locator('.sr-only')});assert.ok(await buttons.count()>=3);console.log('PASS browser: seletor de dashboards responsivo.');
 await adminPage.goto(`${base}/admin-dashboard/settings`);const handle=adminPage.getByRole('button',{name:'Reordenar Usuários',exact:true});await handle.waitFor({timeout:60000});await dismiss(adminPage);const saved=adminPage.waitForResponse(response=>response.url().includes('/rpc/save_admin_dashboard_order')&&response.ok());await handle.focus();await handle.press('ArrowRight');await saved;await adminPage.getByText('Ordem salva para sua conta.',{exact:true}).waitFor();console.log('PASS browser: reordenação por teclado salva no banco.');
 const nav=adminPage.getByRole('navigation',{name:'Seções do Painel de Administração'});
 const dragSections=async touch=>{
  await nav.evaluate(element=>{element.scrollLeft=0;});await adminPage.waitForTimeout(200);
  const before=await checked(admin.db.from('admin_dashboard_preferences').select('section_order').eq('user_id',admin.id).single());
  const handles=nav.getByRole('button',{name:/^Reordenar /});const first=await handles.nth(0).boundingBox(),second=await handles.nth(1).boundingBox();assert.ok(first&&second);
  const start={x:first.x+first.width/2,y:first.y+first.height/2},end={x:second.x+second.width+10,y:start.y};
  const changed=adminPage.waitForResponse(response=>response.url().includes('/rpc/save_admin_dashboard_order')&&response.ok());
  if(touch){const cdp=await adminPage.context().newCDPSession(adminPage);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});for(let n=1;n<=16;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*n/16,y:start.y}]});await adminPage.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await adminPage.mouse.move(start.x,start.y);await adminPage.mouse.down();await adminPage.mouse.move(end.x,end.y,{steps:16});await adminPage.mouse.up();}
  await changed;const after=await checked(admin.db.from('admin_dashboard_preferences').select('section_order').eq('user_id',admin.id).single());assert.notDeepEqual(after.section_order,before.section_order);assert.match(adminPage.url(),/admin-dashboard\/settings/);
 };
 await dragSections(false);await adminPage.setViewportSize({width:430,height:900});await dragSections(true);await adminPage.setViewportSize({width:1366,height:900});console.log('PASS browser: arraste com mouse e toque persiste sem abrir outra seção.');
 await adminPage.getByRole('tab',{name:/Serviços/}).click().catch(()=>{});
 const notice=await checked(service.from('notifications').insert({user_id:admin.id,type:'minister_invitation',content:'QA: convite institucional de teste',link:'/dashboard?tab=invitations',metadata:{invitation_id:randomUUID()}}).select('id').single());
 await adminPage.getByRole('button',{name:'Notificações',exact:true}).first().click();await adminPage.getByText('QA: convite institucional de teste',{exact:true}).click();await adminPage.waitForURL(/dashboard\/citizen\?tab=invitations/);await adminPage.getByRole('heading',{name:/Meus Convites/}).waitFor();assert.equal(await adminPage.getByRole('dialog',{name:'Qual dashboard você deseja acessar?'}).count(),0);console.log('PASS browser: notificação institucional ignora seletor de dashboards para Admin.');
 await service.from('notifications').delete().eq('id',notice.id);
 // Keep a real bank form mounted while the global gate reacts to another session.
 await page.setViewportSize({width:1366,height:900});await page.getByRole('button',{name:'Solicitar aumento de limite',exact:true}).first().click();await limitDialog.getByLabel('Justificativa',{exact:true}).fill('Rascunho preservado durante manutenção em outra sessão.');
 let navigations=0;page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});const navigationCount=navigations;
 await setMode('maintenance');await page.getByRole('heading',{name:'Uma pausa para evoluir'}).waitFor({timeout:20000});assert.equal(navigations,navigationCount);await checkLayout(page);
 const denied=await fetch(`${base}/api/salaries/process`,{method:'POST',headers:{Authorization:`Bearer ${owner.session.access_token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,503);
 await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:true,p_reason:'Liberação temporária para teste de sessão no navegador.'}));await limitDialog.waitFor({timeout:20000});assert.equal(await limitDialog.getByLabel('Justificativa',{exact:true}).inputValue(),'Rascunho preservado durante manutenção em outra sessão.');
 await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:false,p_reason:'Revogação da exceção no navegador para verificar bloqueio.'}));await page.getByRole('heading',{name:'Uma pausa para evoluir'}).waitFor({timeout:20000});await setMode('coming_soon');await page.getByRole('heading',{name:'Um novo capítulo está chegando'}).waitFor({timeout:20000});await setMode('active');await limitDialog.waitFor({timeout:20000});assert.equal(navigations,navigationCount);await page.keyboard.press('Escape');console.log('PASS browser: manutenção, exceção, revogação, em breve e liberação em tempo real, sem perder formulário ou recarregar.');
 // Real elections, candidates and entitlement, exclusively in the isolated QA.
 sql(`INSERT INTO public.documents(user_id,type,document_number,metadata) SELECT '${owner.id}','Título de Eleitor','QA-${randomUUID()}','{}' WHERE NOT EXISTS(SELECT 1 FROM public.documents WHERE user_id='${owner.id}' AND type='Título de Eleitor');`);
 const candidateIds=[];
 for(let n=0;n<4;n++){const id=randomUUID();candidateIds.push(id);sql(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES('${id}','candidate-${id}@example.invalid','{"provider":"email","providers":["email"]}','{}');UPDATE public.profiles SET full_name='QA Candidato ${n}',username='qa${id.replaceAll('-','').slice(0,12)}',character_gender='male',onboarding_completed=true,onboarding_step='completed',role='Cidadão' WHERE id='${id}';`);}
 for(const [index,name] of ['Deputado','Senador','Presidente'].entries()){
  const type=sql(`SELECT id FROM public.election_types WHERE name='${name}' LIMIT 1`);assert.ok(type);
  const election=sql(`INSERT INTO public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,seats_available) VALUES('QA Sequência ${name}','${type}',now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours',now()+interval '4 hours',${name==='Presidente'?'NULL':'1'}) RETURNING id`).split('\n')[0];createdElections.push(election);
  sql(`INSERT INTO public.candidates(election_id,user_id,vice_candidate_id,political_name,status) VALUES('${election}','${candidateIds[index]}',${name==='Presidente'?`'${candidateIds[3]}'`:'NULL'},'QA Candidato ${name}','Approved');UPDATE public.elections SET candidacy_start_date=now()-interval '3 hours',candidacy_end_date=now()-interval '2 hours',voting_start_date=now()-interval '1 hour',voting_end_date=now()+interval '1 day' WHERE id='${election}';`);
 }
 // Acknowledge unrelated opening notices through the real citizen RPC before exercising the ballot itself.
 const openingNotices=await checked(owner.db.from('notifications').select('id').eq('user_id',owner.id).in('type',['election_voting_open','election_candidacy_open']));
 for(const notice of openingNotices)await checked(owner.db.rpc('acknowledge_role_change',{p_notification_id:notice.id}));
 await page.goto(`${base}/services/elections`);await page.waitForTimeout(1200);await dismiss(page);await page.getByRole('button',{name:/^Votar\s/}).click();await page.getByRole('heading',{name:'Deputado',exact:true}).waitFor({timeout:20000});await checkLayout(page);
 await page.getByRole('button',{name:'BRANCO',exact:true}).click();await page.route('**/rest/v1/rpc/cast_ballot',route=>route.abort('internetdisconnected'));await page.getByRole('button',{name:'CONFIRMA',exact:true}).click();await page.getByText('Voto não registrado',{exact:true}).waitFor();assert.equal(await page.getByText('FIM',{exact:true}).count(),0);await page.unroute('**/rest/v1/rpc/cast_ballot');
 const confirm=page.waitForResponse(response=>response.url().includes('/rpc/cast_ballot')&&response.status()===200);await page.getByRole('button',{name:'CONFIRMA',exact:true}).click();await confirm;await page.getByRole('heading',{name:'Senador',exact:true}).waitFor();
 await page.goto(`${base}/services/elections`);await page.waitForTimeout(1200);await dismiss(page);await page.getByRole('button',{name:/^Votar\s/}).click();await page.getByRole('heading',{name:'Senador',exact:true}).waitFor();
 for(const next of ['Presidente','FIM']){await page.getByRole('button',{name:'BRANCO',exact:true}).click();await page.getByRole('button',{name:'CONFIRMA',exact:true}).click();if(next==='FIM')await page.getByText('FIM',{exact:true}).waitFor();else await page.getByRole('heading',{name:next,exact:true}).waitFor();}
 assert.equal(Number(sql(`SELECT count(*) FROM public.votes WHERE voter_id='${owner.id}' AND election_id=ANY(ARRAY[${createdElections.map(id=>`'${id}'::uuid`).join(',')}])`)),3);console.log('PASS browser: três cargos na ordem, falha de rede sem voto falso, retomada no cargo pendente e FIM confirmado.');
 await page.getByRole('button',{name:/^Consultar candidatos\s/}).click();assert.equal(await page.getByRole('region',{name:'Urna eletrônica'}).count(),0);assert.equal(await page.getByText('CONFIRMA',{exact:true}).count(),0);console.log('PASS browser: consulta de candidatos separada da votação.');
 // Official bill text is read from the existing bill, never a fabricated API response.
 sql(`UPDATE public.profiles SET role='Presidente do Senado' WHERE id='${other.id}';`);
 const billId=randomUUID(),votingId=randomUUID(),senate='fedcba09-8765-4321-0987-654321fedcba';
 const fullText=Array.from({length:70},(_,index)=>`Art. ${index+1} — Dispositivo oficial de QA com incisos, parágrafos e conteúdo integral preservado.`).join('\n');
 sql(`INSERT INTO public.bills(id,title,summary,full_text,author_id,house_id,type,status) VALUES('${billId}','QA Projeto integral','Ementa oficial de conferência','${fullText}','${other.id}','${senate}','PL','Em votação');INSERT INTO public.parliament_votings(id,house_id,title,type,related_id,status,end_date,eligible_member_ids,rule_snapshot) SELECT '${votingId}','${senate}','QA Projeto integral','bill','${billId}','active',now()+interval '1 day',ARRAY[id],'{"label":"Regra de QA"}' FROM public.parliament_members WHERE user_id='${other.id}' AND house_id='${senate}' ORDER BY term_start_date DESC LIMIT 1;`);
 const houseNotices=await checked(other.db.from('notifications').select('id').eq('type','parliament_voting_open'));
 for(const notice of houseNotices)await checked(other.db.rpc('acknowledge_parliament_vote_popup',{p_notification_id:notice.id}));
 const chair=await open(other);await chair.goto(`${base}/services/parliament/panel?section=appointments`);await chair.waitForTimeout(1500);await dismiss(chair);await chair.getByRole('tab',{name:'STF e Nomeações Institucionais',exact:true}).waitFor({timeout:60000});await chair.getByRole('heading',{name:'STF e nomeações institucionais',exact:true}).waitFor();
 await chair.getByRole('tab',{name:'Informações',exact:true}).click();await checkLayout(chair);await chair.setViewportSize({width:1366,height:900});
 await chair.getByRole('tab',{name:'Membros',exact:true}).click();await chair.getByText('Encerramento registrado em',{exact:false}).first().waitFor();await checkLayout(chair);await chair.setViewportSize({width:1366,height:900});
 await chair.getByRole('tab',{name:'Votações',exact:true}).click();await chair.getByRole('button',{name:'Ver detalhes',exact:true}).first().click();const billDialog=chair.getByRole('dialog',{name:'QA Projeto integral'});await billDialog.waitFor();assert.ok((await billDialog.innerText()).includes(fullText));await checkLayout(chair,billDialog);assert.equal(Number(sql(`SELECT count(*) FROM public.parliament_voting_votes WHERE voting_id='${votingId}'`)),0);await chair.keyboard.press('Escape');console.log('PASS browser: Presidência do Senado, abas institucionais, membros e texto oficial extenso sem registrar voto.');
 await page.goto(base);await page.waitForTimeout(1200);await dismiss(page);const globe=page.locator('[aria-label="Globo interativo com territórios de países"]');await globe.scrollIntoViewIfNeeded();
 let releaseBrazil;const delayedBrazil=new Promise(resolve=>{releaseBrazil=resolve;});let brazilStarted;const firstRequest=new Promise(resolve=>{brazilStarted=resolve;});
 await page.route('**/rest/v1/country_rp_states*',async route=>{const code=new URL(route.request().url()).searchParams.get('country_code');if(code==='eq.BR'){brazilStarted();await delayedBrazil;await route.continue();}else await route.abort('connectionfailed');});
 await globe.getByRole('button',{name:'Escolher país',exact:true}).click();await globe.getByPlaceholder('Buscar país...').fill('Brasil');await globe.getByRole('option',{name:'Brasil',exact:true}).click();await firstRequest;await globe.getByText('Carregando dados',{exact:true}).waitFor();assert.equal(await globe.locator('dd').evaluateAll(nodes=>nodes.some(node=>/Indisponível/.test(node.textContent))),false);
 await globe.getByRole('button',{name:'Brasil',exact:true}).click();await globe.getByPlaceholder('Buscar país...').fill('Portugal');await globe.getByRole('option',{name:'Portugal',exact:true}).click();releaseBrazil();await globe.getByText('Não foi possível carregar os dados deste país. Tente selecioná-lo novamente.',{exact:true}).waitFor();await page.waitForTimeout(500);assert.equal(await globe.getByRole('button',{name:'Portugal',exact:true}).count(),1);await page.unroute('**/rest/v1/country_rp_states*');console.log('PASS browser: globo mostra carregamento, mantém a nova seleção após resposta atrasada e identifica falha de consulta.');
 assert.deepEqual(errors,[]);console.log('PASS: cenários reais de navegador concluídos.');
}catch(error){if(artifacts){for(let i=0;i<pages.length;i++){await pages[i].screenshot({path:`${artifacts}/general-update-browser-failure-${i}.png`,fullPage:true}).catch(()=>{});console.error(`PAGE ${i}:`,(await pages[i].locator('body').innerText()).slice(0,2500));}}throw error;}
finally{
 await checked(service.from('system_settings').upsert({key:'service_availability',value:original?.value||{}}));
 for(const id of createdElections)sql(`UPDATE public.elections SET archived_at=now() WHERE id='${id}'`);
 await browser.close();await new Promise(resolve=>vite.httpServer.close(resolve));for(const person of fixtures.people)await person.db.auth.signOut();
}
