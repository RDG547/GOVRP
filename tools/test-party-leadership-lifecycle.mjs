import assert from 'node:assert/strict';
import {actor,service,request,rpc,subscribe,waitFor,cleanup} from './lib/world-test.mjs';
let checks=0;const check=(v,l)=>{assert(v,l);checks++;console.log('✓ '+l);};
try {
 const [founder,president,vice,outsider]=await Promise.all([actor('party-owner'),actor('party-president'),actor('party-vice'),actor('party-outsider')]);
 const created=await rpc(founder.client,'create_political_party',{p_name:`Partido Civil ${crypto.randomUUID().slice(0,8)}`,p_acronym:`C${crypto.randomUUID().slice(0,4)}`,p_ideology:'Centro',p_logo_url:'https://example.invalid/logo.png',p_statute:'Estatuto com regras para liderança e participação.',p_description:'Partido para validar liderança e histórico.',p_orientation:'Centro'});assert(created.success);const party=created.party_id;
 const initialParty=await request(service.from('political_parties').select('owner_id,president_id,founder_id').eq('id',party).single());check(initialParty.owner_id===founder.id&&initialParty.founder_id===founder.id&&initialParty.president_id===null,'fundador recebe propriedade; presidência permanece disponível para nomeação');
 const welcome=await request(founder.client.from('notifications').select('*').eq('type','party_founded').eq('metadata->>party_id',party).single());
 check(!welcome.metadata.celebration_seen_at,'fundação mantém orientação pendente para sessão seguinte');await rpc(founder.client,'acknowledge_party_welcome',{p_notification_id:welcome.id});check(!await rpc(founder.client,'acknowledge_party_welcome',{p_notification_id:welcome.id}),'confirmação da orientação não se repete');
 await request(service.from('party_members').insert([{party_id:party,user_id:president.id,role:'Membro'},{party_id:party,user_id:vice.id,role:'Membro'}]));
 check(Boolean((await outsider.client.rpc('set_party_leadership',{p_party_id:party,p_member_id:president.id,p_role:'Presidente'})).error),'terceiro não nomeia liderança');
 const events=[];await subscribe(president.client.channel(`party-${party}`).on('postgres_changes',{event:'*',schema:'public',table:'notifications',filter:`user_id=eq.${president.id}`},e=>events.push(e)));await new Promise(r=>setTimeout(r,1800));
 assert((await rpc(founder.client,'set_party_leadership',{p_party_id:party,p_member_id:president.id,p_role:'Presidente'})).success);
 await waitFor(()=>events.some(e=>e.new?.type==='party_role_changed'),'cargo partidário notifica online');check(true,'nomeação chega em tempo real ao novo presidente');
 check(!(await rpc(president.client,'set_party_leadership',{p_party_id:party,p_member_id:vice.id,p_role:'Dono'})).success,'presidência não transfere propriedade do dono');
 assert((await rpc(president.client,'set_party_leadership',{p_party_id:party,p_member_id:vice.id,p_role:'Vice-Presidente'})).success);
 assert((await rpc(founder.client,'set_party_leadership',{p_party_id:party,p_member_id:president.id,p_role:'Dono'})).success);
 assert((await rpc(founder.client,'disaffiliate_from_party',{p_party_id:party})).success);
 let row=await request(service.from('political_parties').select('*').eq('id',party).single());check(row.founder_id===founder.id&&row.owner_id===president.id,'transferência e saída preservam fundador histórico');
 assert((await rpc(vice.client,'disaffiliate_from_party',{p_party_id:party})).success);assert((await rpc(president.client,'disaffiliate_from_party',{p_party_id:party})).success);
 row=await request(service.from('political_parties').select('*').eq('id',party).single());check(row.status==='Encerrado'&&!row.is_active&&!row.owner_id&&row.founder_id===founder.id,'último integrante encerra partido sem apagar história');
 check(!(await request(service.from('party_members').select('id').eq('party_id',party))).length,'partido encerrado não mantém membros ou propriedade ativa');
 console.log(`\n${checks} verificações do ciclo partidário aprovadas.`);
}finally{await cleanup();}
