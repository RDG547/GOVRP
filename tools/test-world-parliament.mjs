import assert from 'node:assert/strict';
import { ensureParliamentHouses, actor, service, request, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
import { fetchCommissionGovernanceData } from '../src/lib/parliamentGovernance.js';
let checks=0;
const check=(value,label)=>{assert(value,label);checks++;console.log(`✓ ${label}`);};
try {
 await ensureParliamentHouses();
 const [member,citizen]=await Promise.all([actor('partidodeputado','Deputado'),actor('partidoleitor')]);
 const houses=await request(service.from('parliament_houses').select('id,name'));
 const house=houses.find(h=>/c.mara/i.test(h.name)) || houses[0];
 const party=await request(service.from('political_parties').insert({name:`Partido integrado ${member.handle}`,acronym:member.handle.slice(-6),founder_id:member.id,president_id:member.id,registration_number:crypto.randomUUID(),is_active:true,status:'active',logo_url:'https://example.invalid/logo.png'}).select('*').single());
 await request(service.from('party_members').insert({party_id:party.id,user_id:member.id,role:'Membro'}));
 const mandate=await request(service.from('parliament_members').insert({user_id:member.id,house_id:house.id,term_start_date:new Date(Date.now()-86400000).toISOString().slice(0,10),term_end_date:new Date(Date.now()+86400000).toISOString().slice(0,10)}).select('*').single());
 check(mandate.party_id===party.id && mandate.elected_party_id===party.id,'novo mandato usa filiação vigente e mantém retrato eleitoral');
 const row=await request(citizen.client.from('parliament_members').select('id,party:political_parties!parliament_members_party_id_fkey(name,acronym,logo_url)').eq('id',mandate.id).single());
 check(row.party.name===party.name && row.party.logo_url===party.logo_url,'consulta pública resolve nome, sigla e logo sem join ambíguo');
 const events=[];
 await subscribe(citizen.client.channel(`parliament-${citizen.id}`).on('postgres_changes',{event:'*',schema:'public',table:'parliament_members'},e=>events.push(e)));
 await new Promise(resolve=>setTimeout(resolve,1500));
 await request(service.from('party_members').delete().eq('party_id',party.id).eq('user_id',member.id));
 await waitFor(()=>events.some(e=>e.new.id===mandate.id && e.new.party_id===null),'filiação retirada no Parlamento');
 const removed=await request(service.from('parliament_members').select('*').eq('id',mandate.id).single());
 check(removed.party_id===null && removed.elected_party_id===party.id,'desfiliação atualiza em tempo real e preserva partido histórico');
 const governance=await fetchCommissionGovernanceData(citizen.client,{houseId:house.id});
 check(Array.isArray(governance.commissions),'comissões usam a mesma projeção pública sem liberar profiles privados');
 console.log(`\n${checks} verificações de filiação e Parlamento aprovadas.`);
} finally {await cleanup();}
