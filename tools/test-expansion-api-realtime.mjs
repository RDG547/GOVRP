import assert from 'node:assert/strict';
import process from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { collectResetAssetReferences } from '../server/admin/reset-worker.js';

const directory = process.env.GOVRP_QA_DIRECTORY;
assert.ok(directory, 'Informe GOVRP_QA_DIRECTORY com as credenciais do ambiente local.');
const env = JSON.parse(readFileSync(`${directory}/qa-credentials.json`));
assert.equal(env.API_URL, 'http://127.0.0.1:54431');
const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP_RESET_QA', 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = async promise => { const result = await promise; if (result.error) throw Error(result.error.message); return result.data; };
const people = [];
for (const name of ['Proprietário', 'Destinatário', 'Diretor']) {
  const email = `expansion-${randomUUID()}@example.invalid`, password = `Govrp!${randomUUID()}aA1`;
  const { user } = await checked(service.auth.admin.createUser({ email, password, email_confirm: true }));
  sql(`UPDATE public.profiles SET full_name='QA ${name}',username='qa${user.id.replaceAll('-', '').slice(0,12)}',character_gender='male',onboarding_completed=true,onboarding_step='completed',tutorial_dont_show_again=true,role='${name === 'Diretor' ? 'Diretor-Geral de Polícia' : 'Cidadão'}' WHERE id='${user.id}'; INSERT INTO public.accounts(user_id,account_kind,account_number,balance) VALUES('${user.id}','personal','QA-${user.id}',10000);`);
  const db = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { session } = await checked(db.auth.signInWithPassword({ email, password }));
  people.push({ id: user.id, email, password, db, session });
}
const [owner, recipient, officer] = people, business = randomUUID(), party = randomUUID();
sql(`INSERT INTO public.businesses(id,owner_id,business_type_id,name,status,control_kind) VALUES('${business}','${owner.id}','agricultura','Empresa E2E integrada','active','player'); UPDATE public.accounts SET balance=5000 WHERE id=(SELECT bank_account_id FROM public.businesses WHERE id='${business}'); INSERT INTO public.political_parties(id,name,acronym,registration_number,owner_id,founder_id,president_id,status,is_active) VALUES('${party}','Partido E2E ${party.slice(0,8)}','Q${party.slice(0,6)}','${party}','${owner.id}','${owner.id}','${owner.id}','Ativo',true);INSERT INTO public.party_treasuries(party_id,balance) VALUES('${party}',1000) ON CONFLICT(party_id) DO UPDATE SET balance=1000; NOTIFY pgrst,'reload schema';`);
const destination = sql(`SELECT id FROM public.accounts WHERE user_id='${owner.id}' AND account_kind='personal'`);
const events = [], channels = [];
for (const [actor, table, filter] of [[owner,'accounts',`id=eq.${destination}`],[recipient,'party_treasury_entries',`party_id=eq.${party}`]]) {
  await actor.db.realtime.setAuth(actor.session.access_token);
  const channel = actor.db.channel(`expansion-${table}-${randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table,filter},value => events.push({ table, value }));
  await new Promise((resolve,reject) => {const timer=setTimeout(()=>reject(Error(`Realtime indisponível: ${table}`)),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}});});channels.push([actor.db,channel]);
}
const totalMoney = () => Number(sql('SELECT (SELECT sum(balance) FROM public.accounts)+(SELECT treasury_balance FROM public.government_finances WHERE id=1)+(SELECT sum(balance) FROM public.party_treasuries)'));
// The disposable Realtime tenant starts CDC lazily. Wait for an authorized
// no-money-change event before measuring cross-session financial delivery.
for(let attempt=0;attempt<20 && !events.some(e=>e.table==='accounts');attempt++) {
 await checked(service.from('accounts').update({updated_at:new Date().toISOString()}).eq('id',destination));
 await new Promise(resolve=>setTimeout(resolve,250));
}
assert.ok(events.some(e=>e.table==='accounts'),'Canal autenticado não ficou pronto para CDC');events.length=0;
console.log('Sessões Realtime conectadas.');
const before = totalMoney(), key = randomUUID();
const request = {p_business_id:business,p_amount:100,p_destination_account_id:destination,p_reason:'Retirada simultânea com revisão e idempotência.',p_idempotency_key:key};
const results = await Promise.all(Array.from({length:8},()=>checked(owner.db.rpc('withdraw_company_cash',request))));
assert.equal(new Set(results.map(r=>r.transaction_id)).size,1);
assert.equal(sql(`SELECT count(*) FROM public.transactions WHERE idempotency_key='${key}'`),'1');
assert.ok((await recipient.db.rpc('withdraw_company_cash',{...request,p_idempotency_key:randomUUID()})).error);
assert.ok((await owner.db.rpc('withdraw_company_cash',{...request,p_amount:101})).error);
const partyKey=randomUUID(), transfer={p_party_id:party,p_recipient_id:recipient.id,p_amount:100,p_reason:'Transferência concorrente registrada publicamente.',p_idempotency_key:partyKey};
const partyResults=await Promise.all(Array.from({length:8},()=>checked(owner.db.rpc('transfer_party_funds',transfer))));
assert.equal(new Set(partyResults.map(r=>r.transaction_id)).size,1);
assert.equal(sql(`SELECT count(*) FROM public.party_treasury_entries WHERE idempotency_key='${partyKey}'`),'1');
assert.equal(totalMoney(),before);
assert.ok((await recipient.db.rpc('transfer_party_funds',{...transfer,p_idempotency_key:randomUUID()})).error);
const until=Date.now()+15000;while(events.length<2&&Date.now()<until) await new Promise(resolve=>setTimeout(resolve,100));
assert.ok(events.some(e=>e.table==='accounts'),'Saldo não propagou via Realtime');assert.ok(events.some(e=>e.table==='party_treasury_entries'),'Extrato partidário não propagou via Realtime');
for(const [db,channel] of channels)await db.removeChannel(channel);

// Run the actual API against local Auth, PostgREST and private Storage.
Object.assign(process.env,{VITE_SUPABASE_URL:env.API_URL,VITE_SUPABASE_ANON_KEY:env.ANON_KEY,VITE_SUPABASE_PUBLISHABLE_KEY:env.ANON_KEY,SUPABASE_SECRET_KEY:env.SERVICE_ROLE_KEY});
const {build,preview}=await import('vite');
// Exercise the compiled application without development HMR or editor plugins.
await build({mode:'qa',logLevel:'silent',define:{'import.meta.env.DEV':'true'},build:{outDir:`${directory}/expansion-browser-build`,emptyOutDir:true}});
const htmlPath=`${directory}/expansion-browser-build/index.html`;
writeFileSync(htmlPath,readFileSync(htmlPath,'utf8').replace('connect-src &#39;self&#39; https: wss:','connect-src &#39;self&#39; http://127.0.0.1:54431 ws://127.0.0.1:54431 https: wss:'));
const {default:filesHandler}=await import('../api/citizens/avatar.js');
const vite=await preview({mode:'qa',logLevel:'silent',build:{outDir:`${directory}/expansion-browser-build`},preview:{host:'127.0.0.1',port:3206,strictPort:true},plugins:[{name:'qa-real-file-api',configurePreviewServer(server){server.middlewares.use((request,response,next)=>{
 const path=new URL(request.url,'http://localhost');
 if(path.pathname==='/api/justice/evidence'){path.pathname='/api/citizens/avatar';path.searchParams.set('kind','evidence');request.url=path.pathname+path.search;return filesHandler(request,response);}
 if(path.pathname==='/api/citizens/avatar')return filesHandler(request,response);return next();
});}}]});
try {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=','base64');
  const upload=await fetch('http://127.0.0.1:3206/api/justice/evidence',{method:'POST',headers:{Authorization:`Bearer ${owner.session.access_token}`,'Content-Type':'image/png','X-Evidence-Filename':encodeURIComponent('nome-do-denunciante.png')},body:png});assert.equal(upload.status,201,await upload.clone().text());const file=await upload.json();
  const report=await checked(owner.db.rpc('create_police_occurrence',{p_title:'Boletim anônimo E2E',p_description:'Relato detalhado de fatos para validar provas privadas e anonimato.',p_occurrence_type:'Outro',p_location:'Local QA',p_occurred_at:new Date().toISOString(),p_anonymous:true,p_priority:'urgent',p_involved_people:[],p_witnesses:[],p_evidence:[{upload_id:file.id}]}));
  const evidence=report.evidence[0];assert.equal(evidence.name,'Anexo 1.png');
  for(const actor of [owner,officer]){
    const response=await fetch(`http://127.0.0.1:3206/api/justice/evidence?id=${evidence.evidence_id}`,{headers:{Authorization:`Bearer ${actor.session.access_token}`}});assert.equal(response.status,200);const signed=await response.json();assert.equal(signed.name,'Anexo 1.png');assert.equal(signed.path,undefined);
    const bytes=Buffer.from(await(await fetch(signed.url)).arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(png).digest('hex'));
  }
  const forbidden=await fetch(`http://127.0.0.1:3206/api/justice/evidence?id=${evidence.evidence_id}`,{headers:{Authorization:`Bearer ${recipient.session.access_token}`}});assert.equal(forbidden.status,403);
  const noSession=await fetch('http://127.0.0.1:3206/api/justice/evidence');assert.equal(noSession.status,401);
  const forged=await fetch('http://127.0.0.1:3206/api/justice/evidence',{method:'POST',headers:{Authorization:`Bearer ${owner.session.access_token}`,'Content-Type':'application/pdf','X-Evidence-Filename':'fake.pdf'},body:png});assert.equal(forged.status,415);
  assert.ok((await owner.db.rpc('register_police_evidence_upload',{p_id:randomUUID(),p_profile_id:owner.id,p_path:'x',p_filename:'x.png',p_mime:'image/png',p_bytes:1,p_sha256:'a'.repeat(64)})).error,'Cliente conseguiu registrar arquivo sem validação do servidor');
  const path=sql(`SELECT path FROM private.justice_evidence_uploads WHERE id='${file.id}'`);
  assert.ok(!(await fetch(`${env.API_URL}/storage/v1/object/public/justice-evidence/${path}`)).ok,'Storage privado ficou público');
  assert.deepEqual(collectResetAssetReferences({schema:'private',table:'justice_evidence_uploads',classification:'A',strategy:'clear',payload_text:JSON.stringify([{path}])}).referenced,[{bucket:'justice-evidence',name:path}]);
  const fixtures={business,party,destination,people:people.map(({id,email,password,session})=>({id,email,password,session})),report};
  writeFileSync(`${directory}/expansion-browser-fixtures.json`,JSON.stringify(fixtures),{mode:0o600});
  if(process.env.GOVRP_QA_BROWSER==='1'){
    const {runExpansionBrowser}=await import('./test-expansion-browser.mjs');await runExpansionBrowser(fixtures,()=>checked(owner.db.rpc('withdraw_company_cash',{p_business_id:business,p_amount:1,p_destination_account_id:destination,p_reason:'Atualização de outra sessão durante edição do formulário.',p_idempotency_key:randomUUID()})));
  }
  console.log('PASS: Auth/REST/Storage reais, anonimato, RLS, 16 solicitações concorrentes, conservação monetária e Realtime entre sessões.');
} finally {await new Promise(resolve=>vite.httpServer.close(resolve));for(const person of people)await person.db.auth.signOut();}
