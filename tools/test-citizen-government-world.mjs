import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ensureParliamentHouses, actor, service, request, rpc, cleanup } from './lib/world-test.mjs';
let checks=0;
const check=(value,label)=>{assert(value,label);checks++;console.log(`OK ${label}`);};
const sql=query=>execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
let originalGovernance, originalMix, createdElection;
try {
 await ensureParliamentHouses();
 const citizen=await actor('government-citizen'); const president=await actor('government-president','Presidente');const admin=await actor('government-admin','Admin');
 originalGovernance=await request(service.from('system_settings').select('*').eq('key','executive_governance').maybeSingle());
 originalMix=await request(service.from('economic_state').select('metadata,player_share,simulated_share').eq('id',true).single());
 await request(service.from('system_settings').upsert({key:'executive_governance',value:{...(originalGovernance?.value||{}),specialAppointments:{}}}));
 const initial=await rpc(president.client,'get_presidential_formation');
 check(initial && initial.offices.length===3 && initial.remaining>=3,'Presidente recebe formação persistente com três chefias obrigatórias');
 check((await rpc(president.client,'get_presidential_formation')).id===initial.id,'nova sessão retoma a mesma formação');
 check(Boolean((await citizen.client.rpc('manage_executive_appointment',{p_office_key:'federal_police_director',p_user_id:citizen.id})).error),'cidadão comum não nomeia chefias');
 for(const office of initial.offices) {
   const appointed=await actor(`government-${office.office_key}`);
   await rpc(president.client,'manage_executive_appointment',{p_office_key:office.office_key,p_user_id:appointed.id,p_note:'Nomeação integrada de teste.'});
   const profile=await request(service.from('profiles').select('role').eq('id',appointed.id).single());
   check(profile.role===office.role_label,`nomeação concede ${office.role_label}`);
   const notices=await request(appointed.client.from('notifications').select('*').eq('type','role_changed').eq('metadata->>new_role',office.role_label));
   check(notices.length===1 && !notices[0].metadata.popup_shown_at,'nomeado recebe evento persistente disponível offline');
   const permission=office.office_key==='federal_police_director'?'Delegado':office.office_key==='armed_forces_commander'?'Militar':'Agente Secreto';
   check(await rpc(appointed.client,'justice_has_role',{p_roles:[permission]}),'chefia recebe suas capacidades institucionais no backend');
 }
 const formed=await rpc(president.client,'get_presidential_formation');
 check(formed.remaining===initial.remaining-3,'formação avança com as nomeações sem depender da interface');
 check(Boolean((await president.client.from('system_settings').update({value:{specialAppointments:{}}}).eq('key','executive_governance')).error),'escrita direta não contorna nomeações auditadas');
 const policeBefore=await request(service.from('system_settings').select('value').eq('key','executive_governance').single());
 const policeId=policeBefore.value.specialAppointments.federal_police_director.user_id;
 await rpc(president.client,'manage_executive_appointment',{p_office_key:'federal_police_director',p_user_id:null});
 check((await request(service.from('profiles').select('role').eq('id',policeId).single())).role==='Cidadão','exoneração remove chefia e restaura cargo anterior');
 check(Boolean((await citizen.client.rpc('configure_economic_mix',{p_player_share:.37})).error),'apenas Admin configura pesos econômicos');
 const mix=await rpc(admin.client,'configure_economic_mix',{p_player_share:.37});
 check(mix.player_share===.37 && mix.simulated_share===.63,'controle econômico persiste 37% e 63%');
 sql('select economy_private.update_activity_mix()');
 check((await request(service.from('economic_state').select('player_share').eq('id',true).single())).player_share===.37,'próximo ciclo respeita o peso configurado');
 const deputy=await actor('government-deputy','Deputado');
 const house=(await request(service.from('parliament_houses').select('*'))).find(h=>/c.mara/i.test(h.name));
 const member=await rpc(deputy.client,'ensure_current_parliament_member',{p_house_id:house.id});
 // The fixture must not collide with an unrelated local election.
 const existing=await request(service.from('parliament_leadership_elections').select('id').eq('house_id',house.id).eq('status','open'));
 check(existing.length===0,'Casa de teste não possui disputa concorrente');
 const election=await rpc(deputy.client,'create_leadership_election',{p_house_id:house.id,p_position:'president',p_description:'Eleição interna integrada',p_duration_hours:1});createdElection=election.election_id;
 check(Boolean(createdElection),'parlamentar ativo abre disputa mesmo sem Mesa Diretora');
 await rpc(deputy.client,'nominate_leadership_candidate',{p_election_id:createdElection,p_member_id:member.id,p_manifesto:'Programa de trabalho da Casa.'});
 const candidate=await request(service.from('parliament_leadership_candidates').select('id').eq('election_id',createdElection).single());
 check(Boolean((await deputy.client.rpc('cast_leadership_vote',{p_election_id:createdElection,p_candidate_id:candidate.id})).error),'votação aguarda encerramento das candidaturas');
 sql(`update public.parliament_leadership_elections set nomination_end_at=now()-interval '1 second' where id='${createdElection}'`);
 check(Boolean((await deputy.client.rpc('nominate_leadership_candidate',{p_election_id:createdElection,p_member_id:member.id})).error),'candidatura não é alterada durante votação');
 await rpc(deputy.client,'cast_leadership_vote',{p_election_id:createdElection,p_candidate_id:candidate.id});
 check(Boolean((await deputy.client.rpc('cast_leadership_vote',{p_election_id:createdElection,p_candidate_id:candidate.id})).error),'cada parlamentar vota uma única vez');
 check(Boolean((await citizen.client.rpc('cast_leadership_vote',{p_election_id:createdElection,p_candidate_id:candidate.id})).error),'cidadão sem mandato não vota na Mesa');
 sql(`update public.parliament_leadership_elections set end_at=now()-interval '1 millisecond' where id='${createdElection}'`);
 check(Boolean((await deputy.client.rpc('cast_leadership_vote',{p_election_id:createdElection,p_candidate_id:candidate.id})).error),'prazo encerrado bloqueia novos votos');
 sql('select private.process_due_leadership_elections()');
 const result=await request(service.from('parliament_leadership_elections').select('*').eq('id',createdElection).single());
 check(result.status==='closed' && result.winner_member_id===member.id,'apuração automática persiste vencedor sem intervenção administrativa');
 check((await request(service.from('profiles').select('role').eq('id',deputy.id).single())).role==='Presidente da Câmara dos Deputados','posse usa cargo canônico da Câmara');
 const terms=await request(service.from('parliament_leadership_terms').select('id').eq('elected_by_election_id',createdElection));
 sql('select private.process_due_leadership_elections()');
 check((await request(service.from('parliament_leadership_terms').select('id').eq('elected_by_election_id',createdElection))).length===terms.length,'reprocessamento não duplica mandato');
 console.log(`\n${checks} verificações reais de governo, nomeações e Mesa aprovadas.`);
} finally {
 if(originalGovernance)await request(service.from('system_settings').upsert(originalGovernance));
 if(originalMix){await request(service.from('economic_state').update(originalMix).eq('id',true));sql('select economy_private.update_activity_mix()');}
 if(createdElection) await request(service.from('parliament_leadership_elections').update({status:'cancelled'}).eq('id',createdElection).eq('status','open'));
 await cleanup();
}
