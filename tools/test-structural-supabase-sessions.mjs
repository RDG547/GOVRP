// Explicitly opt in to the disposable preview. Never seed or mutate production.
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
const config=JSON.parse(readFileSync(process.env.GOVRP_QA_SESSION_CONFIG,'utf8'));
assert.equal(new URL(config.url).hostname,'vsuwizhffoyisklhoule.supabase.co');
const clients=config.users.map(()=>createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}}));
const results=[];const check=(ok,label)=>{assert(ok,label);results.push(label);};
try{
 for(let i=0;i<clients.length;i++){
  const r=await clients[i].auth.signInWithPassword({email:config.users[i].email,password:config.password});
  assert.ifError(r.error);check(r.data.user.id===config.users[i].id,'Independent authenticated session '+i);
 }
 const [admin,citizen]=clients;
 const forbidden=await citizen.rpc('get_economic_structural_diagnostics');
 check(!!forbidden.error,'Citizen cannot read administrator diagnostics');
 const publicData=await citizen.rpc('get_public_economic_dashboard');assert.ifError(publicData.error);
 check(!!publicData.data,'Citizen reads public economy through actual PostgREST');
 for(const name of ['get_economic_admin_dashboard','get_economy_integrity_snapshot','get_economic_structural_diagnostics','get_autonomous_economy_preview','get_population_circulation_status']){
  const r=await admin.rpc(name);assert.ifError(r.error);check(!!r.data,'Admin RPC '+name);
 }
 for(const client of clients){const r=await client.from('economic_state').select('id');assert.ifError(r.error);check(r.data.length===1,'Session can read economic state under RLS');}
 const events=[[],[]];const states=[[],[]];const databaseReady=[false,false];
 const ready=i=>payload=>{if(payload.extension==='postgres_changes'&&payload.status==='ok')databaseReady[i]=true;};
 const channels=clients.map((client,i)=>client.channel('qa-economy-'+i+'-'+Date.now()).on('system',{},ready(i)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'economic_state'},payload=>events[i].push(payload)).subscribe(status=>states[i].push(status)));
 const waitFor=async(predicate,label)=>{const until=Date.now()+45000;while(!predicate()&&Date.now()<until)await new Promise(r=>setTimeout(r,100));if(!predicate())console.error(JSON.stringify({label,states,eventCounts:events.map(x=>x.length)}));check(predicate(),label);};
 await waitFor(()=>states.every(s=>s.includes('SUBSCRIBED')),'Both real Realtime channels subscribe');
 await waitFor(()=>databaseReady.every(Boolean),'Both PostgreSQL subscriptions are ready');
 const unchanged=await admin.rpc('configure_autonomous_economy',{p_enabled:false,p_justification:'Homologação de Realtime: preservar piloto desativado',p_key:crypto.randomUUID()});
 assert.ifError(unchanged.error);
 await waitFor(()=>events.every(x=>x.length>0),'Both sessions receive the committed economic_state update');
 const denied=await citizen.from('economic_state').update({consumer_confidence:99}).eq('id',true).select('id');
 check(!!denied.error||denied.data?.length===0,'Citizen cannot mutate economic state through REST');
 await clients[1].removeChannel(channels[1]);
 await waitFor(()=>!citizen.realtime.isDisconnecting(),'Previous socket closes before reconnection');
 states[1]=[];events[1]=[];databaseReady[1]=false;
 const rejoined=citizen.channel('qa-economy-reconnect-'+Date.now()).on('system',{},ready(1)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'economic_state'},p=>events[1].push(p)).subscribe(s=>states[1].push(s));
 await waitFor(()=>states[1].includes('SUBSCRIBED'),'Citizen can reconnect with an authenticated session');
 await waitFor(()=>databaseReady[1],'Reconnected PostgreSQL subscription is ready');
 const again=await admin.rpc('configure_autonomous_economy',{p_enabled:false,p_justification:'Homologação de reconexão: preservar piloto desativado',p_key:crypto.randomUUID()});assert.ifError(again.error);
 await waitFor(()=>events[1].length>0,'Reconnected session receives the next database update');
 await citizen.removeChannel(rejoined);
 const forbiddenMutation=await citizen.rpc('configure_autonomous_economy',{p_enabled:true,p_justification:'Tentativa negativa de autorização em homologação',p_key:crypto.randomUUID()});
 check(!!forbiddenMutation.error,'Citizen cannot activate autonomous pilot');
 console.log('PASS: '+results.length+' real Supabase authentication/RPC/Realtime checks');
}finally{
 await Promise.all(clients.map(async c=>{await c.removeAllChannels();await c.auth.signOut();}));
 if(process.env.GOVRP_QA_RESULTS_PATH)writeFileSync(process.env.GOVRP_QA_RESULTS_PATH,JSON.stringify({project:new URL(config.url).hostname,checks:results.length,results},null,2));
}

