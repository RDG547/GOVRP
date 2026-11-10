import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';

// Explicitly allow only this disposable branch; never infer production URLs.
const url=process.env.GOVRP_QA_URL;
assert.equal(url,'https://vlmahouerzqnvkwopuhf.supabase.co','Select the isolated QA branch explicitly');
const key=process.env.GOVRP_QA_PUBLISHABLE_KEY;
assert(key&&process.env.GOVRP_QA_ACTORS_FILE&&process.env.GOVRP_QA_STATE_FILE);
const actors=JSON.parse(fs.readFileSync(process.env.GOVRP_QA_ACTORS_FILE,'utf8'));
const anon=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function ok(request){const {data,error}=await request;if(error)throw Error(error.message);return data;}
const runtime=await ok(anon.rpc('get_world_runtime'));
const generation=runtime.generation_id;
assert(generation,'World generation missing');
const clients={};
for(const a of actors){const c=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{'x-govrp-world-generation':generation}}});await ok(c.auth.signInWithPassword({email:a.email,password:a.password}));clients[a.kind]=c;}
const {admin,citizen,other}=clients;
const rpc=(client,name,args)=>ok(client.rpc(name,args));
const stateFile=process.env.GOVRP_QA_STATE_FILE;
const channels=[];
async function listen(client,name,spec){const events=[];const ch=client.channel(name).on('postgres_changes',spec,p=>events.push(p));channels.push([client,ch]);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`Realtime subscribe timeout: ${name}`)),12000);ch.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'){clearTimeout(timer);reject(Error(`Realtime subscribe failed: ${name}`));}});});return events;}
async function eventually(test,label){const end=Date.now()+12000;while(Date.now()<end){if(test())return;await new Promise(r=>setTimeout(r,150));}assert.fail(label);}
try{
 if(process.argv[2]==='prepare'){
  const publishedEvents=await listen(citizen,'qa-public-competitions',{event:'*',schema:'public',table:'public_competitions'});
  assert((await anon.from('public_competitions').select('*')).error,'Anonymous table access');
  assert((await citizen.from('national_market_stock').insert({resource_code:'milk',quantity:999})).error,'Client forged stock');
  assert((await citizen.rpc('configure_national_reference',{p_resource:'milk',p_price:1,p_daily:1,p_days:1,p_automatic:false,p_version:1})).error,'Citizen changed prices');
  const now=Date.now(),date=delta=>new Date(now+delta).toISOString();
  const id=await rpc(admin,'save_public_competition',{p_id:null,p_expected_version:null,p_data:{name:'Concurso de Promotor — QA integrado',role:'Promotor',vacancies:1,notice_url:'https://example.invalid/edital.pdf',forms_url:'https://forms.gle/qa',registration_starts_at:date(-3600000),registration_ends_at:date(3600000),exam_starts_at:date(7200000),exam_ends_at:date(10800000)}});
  assert.equal((await ok(citizen.from('public_competitions').select('id').eq('id',id))).length,0,'Draft leaked through RLS');
  assert((await citizen.rpc('get_public_competition_admin',{p_id:id})).error,'Citizen read exam configuration');
  await rpc(admin,'transition_public_competition',{p_id:id,p_expected_version:1,p_status:'published'});
  await eventually(()=>publishedEvents.some(e=>e.new?.id===id&&e.new.status==='published'),'Published competition not received by another session');
  assert(!JSON.stringify(publishedEvents).includes('forms.gle'),'Exam URL leaked over realtime');
  const ids=await Promise.all(Array.from({length:8},()=>rpc(citizen,'register_public_competition',{p_id:id})));
  assert.equal(new Set(ids).size,1,'Concurrent enrollment duplicated');
  const otherApplication=await rpc(other,'register_public_competition',{p_id:id});
  assert.equal((await ok(citizen.from('public_competition_applications').select('*').eq('competition_id',id))).length,1,'Applicant can read others');
  assert((await citizen.rpc('get_public_competition_exam',{p_id:id})).error,'Early exam access');
  const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const pdfPath=`qa-${crypto.randomUUID()}.pdf`;
  await ok(admin.storage.from('public-competitions').upload(pdfPath,pdf,{contentType:'application/pdf'}));
  const pdfUrl=admin.storage.from('public-competitions').getPublicUrl(pdfPath).data.publicUrl;
  const response=await fetch(pdfUrl);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);
  assert((await citizen.storage.from('public-competitions').upload(`forbidden-${crypto.randomUUID()}.pdf`,pdf,{contentType:'application/pdf'})).error,'Citizen uploaded official PDF');
  fs.writeFileSync(stateFile,JSON.stringify({id,application:ids[0],otherApplication,pdfUrl,pdfPath}));
  console.log('PASS: HTTP auth/RLS, protected draft/exam, eight concurrent enrollments, cross-session realtime publication, official PDF upload/read and upload authorization.');
 }else if(process.argv[2]==='decide'){
  const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const changes=await listen(citizen,'qa-application-decision',{event:'UPDATE',schema:'public',table:'public_competition_applications',filter:`id=eq.${s.application}`});
  const notices=await listen(citizen,'qa-notice-decision',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${actors.find(a=>a.kind==='citizen').id}`});
  const args=id=>({p_application_id:id,p_approve:true,p_identity_confirmed:true,p_criteria_confirmed:true,p_reason:'Identidade e todos os critérios conferidos no ambiente de QA.'});
  const results=await Promise.all([admin.rpc('decide_public_competition',args(s.application)),admin.rpc('decide_public_competition',args(s.otherApplication))]);
  assert.equal(results.filter(r=>!r.error).length,1,'Concurrent decisions exceeded one vacancy');
  const winner=results[0].error?s.otherApplication:s.application,loser=winner===s.application?s.otherApplication:s.application;
  await rpc(admin,'decide_public_competition',args(winner));
  await rpc(admin,'decide_public_competition',{...args(loser),p_approve:false,p_criteria_confirmed:false,p_reason:'Vaga única preenchida; classificação insuficiente no teste.'});
  await eventually(()=>changes.length>0,'Application decision missing from realtime');
  if(winner===s.application)await eventually(()=>notices.some(e=>e.new?.metadata?.competition_approved),'Approval notification missing from realtime');
  const {version}=await ok(admin.from('public_competitions').select('version').eq('id',s.id).single());
  await rpc(admin,'transition_public_competition',{p_id:s.id,p_expected_version:version,p_status:'results',p_results_url:s.pdfUrl});
  const winnerClient=winner===s.application?citizen:other;
  assert.equal(await rpc(winnerClient,'justice_has_role',{p_roles:['Promotor']}),true);
  assert.equal((await ok(winnerClient.from('public_careers').select('*').eq('application_id',winner))).length,1);
  assert((await winnerClient.rpc('get_public_competition_exam',{p_id:s.id})).error,'Closed exam access');
  s.winner=winner;fs.writeFileSync(stateFile,JSON.stringify(s));
  console.log('PASS: concurrent vacancy enforcement, retry idempotency, realtime application/notification, result PDF, career RLS and judicial permission through HTTP.');
 }else if(process.argv[2]==='market'){
  const refEvents=await listen(citizen,'qa-national-prices',{event:'UPDATE',schema:'public',table:'national_market_references'});
  const stockEvents=await listen(citizen,'qa-national-stock',{event:'*',schema:'public',table:'national_market_stock'});
  const b=process.env.GOVRP_QA_BUSINESS;assert(b,'QA supplier fixture required');
  const catalogue=await rpc(admin,'get_national_production_catalog');
  const ref=catalogue.references.find(r=>r.resource_code==='milk');
  const args={p_resource:'milk',p_price:6,p_daily:Number(ref.per_capita_daily),p_days:ref.reserve_days,p_automatic:false,p_version:ref.version};
  const changes=await Promise.all([admin.rpc('configure_national_reference',args),admin.rpc('configure_national_reference',{...args,p_price:6.5})]);
  assert.equal(changes.filter(r=>!r.error).length,1,'Stale reference edit was accepted');
  await eventually(()=>refEvents.length>0,'Price update missing from another session');
  const fundKey=crypto.randomUUID();
  await Promise.all(Array.from({length:4},()=>rpc(admin,'fund_national_market',{p_amount:5000,p_key:fundKey})));
  assert.equal(Number((await rpc(admin,'get_national_production_catalog')).budget),5000,'Concurrent funding duplicated');
  const saleKey=crypto.randomUUID();
  const receipts=await Promise.all(Array.from({length:8},()=>rpc(citizen,'sell_national_production',{p_business:b,p_resource:'milk',p_key:saleKey})));
  assert.equal(new Set(receipts.map(r=>r.id)).size,1,'Concurrent payment duplicated');
  assert.equal(Number(receipts[0].quantity),100);
  await eventually(()=>stockEvents.some(e=>e.new?.resource_code==='milk'&&Number(e.new.quantity)===100),'Stock update missing from realtime');
  const after=await rpc(citizen,'get_national_production_catalog',{p_business:b});
  assert.equal(after.purchases.length,1);assert.equal(Number(after.offers.find(o=>o.resource_code==='milk').quantity),0);
  const remaining=Number(after.budget);assert(remaining>=0&&remaining<5000);
  // Reconnect and reconcile authoritative state after changes in another session.
  for(const [client,ch]of channels)await client.removeChannel(ch);channels.length=0;
  await eventually(()=>!citizen.realtime.isDisconnecting(),'Socket did not finish disconnecting');
  citizen.realtime.connect();
  await listen(citizen,'qa-national-reconnected',{event:'UPDATE',schema:'public',table:'national_market_references'});
  assert.equal(Number((await rpc(citizen,'get_national_production_catalog')).budget),remaining);
  console.log('PASS: concurrent reference versions, four funding retries, eight sale retries, single payment, stock transfer, cross-session price/stock realtime and reconnect reconciliation.');
 }else throw Error('Choose prepare, decide or market');
}finally{for(const [client,ch]of channels)await client.removeChannel(ch);for(const c of Object.values(clients))await c.auth.signOut({scope:'local'});}
