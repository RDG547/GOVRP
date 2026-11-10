import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, service, request, rpc, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
import { getProfileRolePool, resolvePrimaryRole } from '../src/lib/roleResolution.js';
import { internalElectionPhase } from '../src/lib/parliamentGovernance.js';
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input});
const chamber='a1b2c3d4-e5f6-7890-1234-567890abcdef';
let partyIds=[];
try {
 const admin=await actor('identity-admin','Admin'),owner=await actor('identity-owner'),vice=await actor('identity-vice'),outsider=await actor('identity-outsider');
 const deputy=await actor('identity-deputy','Deputado'),senator=await actor('identity-senator','Senador');
 const formationCandidates=await Promise.all([0,1,2,3].map(i=>actor(`identity-formation-minister-${i}`)));
 for(const role of ['Deputado','Senador','Presidente da Câmara dos Deputados','Vice-Presidente do Senado Federal'])assert.equal(resolvePrimaryRole({role}),role);
 assert(getProfileRolePool({role:'Presidente da Câmara dos Deputados'}).includes('Deputado'));
 assert(!getProfileRolePool({role:'Cidadão',titles:['Deputado']}).includes('Deputado'));
 const phases={status:'open',start_at:new Date(1000).toISOString(),nomination_end_at:new Date(2000).toISOString(),voting_start_at:new Date(3000).toISOString(),end_at:new Date(4000).toISOString()};
 assert.deepEqual([0,1500,2500,3500,4500].map(time=>internalElectionPhase(phases,time)),['Agendada','Candidaturas abertas','Aguardando votação','Votação aberta','Encerrada']);
 console.log('OK cargos públicos, capacidades da Mesa, títulos sem autoridade e cinco fases com relógio');
 const makeParty=async(person,color)=>{const result=await rpc(person.client,'create_political_party',{p_name:`Partido Identidade ${person.handle}`,p_acronym:person.handle.slice(-5),p_ideology:'Teste integrado',p_logo_url:'https://example.invalid/party.png',p_statute:'Estatuto de teste',p_description:'Integração real',p_orientation:'Centro',p_color:color});assert(result.success);partyIds.push(result.party_id);return request(service.from('political_parties').select('*').eq('id',result.party_id).single());};
 const p=await makeParty(owner,'#123456'),vp=await makeParty(vice,'#FEDCBA');
 const updates=[];await subscribe(outsider.client.channel(`color-${p.id}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'political_parties',filter:`id=eq.${p.id}`},event=>updates.push(event.new)));
 await new Promise(resolve=>setTimeout(resolve,1500));
 await rpc(owner.client,'set_party_color',{p_party_id:p.id,p_color:'#ABCDEF'});
 await waitFor(()=>updates.some(row=>row.color==='#ABCDEF'),'cor partidária na outra sessão');
 assert((await outsider.client.rpc('set_party_color',{p_party_id:p.id,p_color:'#000000'})).error);
 const forbiddenCustomization=await outsider.client.rpc('update_party_customization',{p_party_id:p.id,p_customization:{primary_color:'#000000'}});assert(forbiddenCustomization.error||forbiddenCustomization.data?.success===false);
 assert((await owner.client.rpc('set_party_color',{p_party_id:p.id,p_color:'red'})).error);
 assert((await outsider.client.rpc('admin_delete_election',{p_election_id:crypto.randomUUID(),p_confirm_history:true})).error);
 assert((await outsider.client.rpc('schedule_leadership_election',{p_house_id:chamber,p_position:'president',p_start_at:new Date().toISOString(),p_nomination_end_at:new Date(Date.now()+100000).toISOString(),p_voting_start_at:new Date(Date.now()+200000).toISOString(),p_end_at:new Date(Date.now()+300000).toISOString()})).error);
 console.log('OK criação e cor em Realtime, HEX inválido e tentativas não autorizadas bloqueadas pelo backend');
 const output=sql(`begin;
 do $test$ declare e uuid; c uuid; original jsonb; candidate_row public.candidates%rowtype; member uuid; other_member uuid; leadership uuid; nomination uuid; f jsonb; fid uuid; result jsonb; denied boolean; bill uuid; voting uuid; notices integer; vote_role text; topic uuid; house uuid:='${chamber}';
 begin
 -- Every institutional mutation here is rolled back, including shared Mesa and cabinet fixtures.
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 update public.profiles set role='Presidente da Câmara dos Deputados',role_assigned_at=clock_timestamp() where id='${deputy.id}';
 select id into member from public.parliament_members where user_id='${deputy.id}' and house_id=house;
 if member is null or not exists(select 1 from public.parliament_leadership_terms where member_id=member and status='active') then raise exception 'Nomeação não criou mandato e Mesa';end if;
 update public.profiles set role='Deputado' where id='${deputy.id}';
 if exists(select 1 from public.parliament_leadership_terms where member_id=member and status='active') then raise exception 'Saída não encerrou Mesa';end if;
 if public.get_active_parliament_member_id('${deputy.id}',house) is null then raise exception 'Saída da Mesa perdeu mandato';end if;
 update public.parliament_leadership_elections set status='cancelled' where house_id=house and status='open';
 perform set_config('request.jwt.claim.sub','${deputy.id}',true);
 result:=public.schedule_leadership_election(house,'vice_president',clock_timestamp(),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',clock_timestamp()+interval '3 hours');leadership:=(result->>'election_id')::uuid;
 perform public.nominate_leadership_candidate(leadership,member,null);
 select id into nomination from public.parliament_leadership_candidates where election_id=leadership and member_id=member;
 if nomination is null then raise exception 'Manifesto opcional não aceito';end if;
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 denied:=false;begin perform public.nominate_leadership_candidate(leadership,member,'');exception when others then denied:=true;end;if not denied then raise exception 'Admin indicou terceiro';end if;
 perform set_config('request.jwt.claim.sub','${senator.id}',true);
 denied:=false;begin perform public.nominate_leadership_candidate(leadership,member,'');exception when others then denied:=true;end;if not denied then raise exception 'Senador indicou deputado';end if;
 perform set_config('request.jwt.claim.sub','${deputy.id}',true);
 update public.parliament_leadership_elections set start_at=now()-interval '2 hours',nomination_end_at=now()-interval '1 hour' where id=leadership;
 denied:=false;begin perform public.cast_leadership_vote(leadership,nomination);exception when others then denied:=true;end;if not denied then raise exception 'Voto no intervalo indevido';end if;
 update public.parliament_leadership_elections set voting_start_at=now()-interval '30 minutes' where id=leadership;
 perform public.cast_leadership_vote(leadership,nomination);
 raise notice 'OK Mesa por cargo, renúncia da Mesa, candidatura própria sem manifesto, separação de Casas e intervalo de votação';
 -- Presidential formation is explicit, resumable and tied to each accession.
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 update public.profiles set role='Presidente',role_assigned_at=clock_timestamp() where id='${outsider.id}';
 perform set_config('request.jwt.claim.sub','${outsider.id}',true);f:=public.get_presidential_formation();fid:=(f->>'id')::uuid;
 if f->>'status'<>'in_progress' or (public.get_presidential_formation()->>'id')::uuid<>fid then raise exception 'Formação não retomada';end if;
 -- Strategic offices and invitations do not count toward the three ministers.
 update public.executive_office_definitions set required_for_formation=false;
 f:=public.get_presidential_formation();
 if (f->>'required_ministers')::integer<>3 or (f->>'remaining')::integer<>3 or f->>'completed_at' is not null then raise exception 'A regra inicial nao exige tres ministros empossados';end if;
 denied:=false;begin perform public.complete_presidential_formation();exception when others then denied:=true;end;
 if not denied then raise exception 'Formacao concluida sem ministros';end if;
 for notices in 0..2 loop
   select name into vote_role from public.government_ministries where is_active order by name offset notices limit 1;
   perform set_config('request.jwt.claim.sub','${outsider.id}',true);
   result:=to_jsonb(public.appoint_minister((array['${formationCandidates[0].id}','${formationCandidates[1].id}','${formationCandidates[2].id}']::uuid[])[notices+1],vote_role));
   if result->>'success'<>'true' then raise exception 'Convite de ministro nao criado';end if;
   -- Convite pendente ainda nao corresponde a posse.
   f:=public.get_presidential_formation();if (f->>'appointed_ministers')::integer<>notices then raise exception 'Convite foi contado como posse';end if;
   perform set_config('request.jwt.claim.sub',(array['${formationCandidates[0].id}','${formationCandidates[1].id}','${formationCandidates[2].id}']::text[])[notices+1],true);
   perform public.respond_minister_invitation((result->'invitation'->>'id')::uuid,true);
   perform set_config('request.jwt.claim.sub','${outsider.id}',true);
   f:=public.get_presidential_formation();
   if (f->>'appointed_ministers')::integer<>notices+1 then raise exception 'Posse nao atualizou a formacao';end if;
 end loop;
 if (f->>'remaining')::integer<>0 then raise exception 'Tres ministros nao liberaram a conclusao';end if;
 perform public.complete_presidential_formation();if public.get_presidential_formation()->>'status'<>'completed' then raise exception 'Conclusao nao persistiu';end if;
 -- Um convite adicional recusado nao deve reabrir a formacao finalizada.
 select name into vote_role from public.government_ministries where is_active order by name offset 3 limit 1;
 result:=to_jsonb(public.appoint_minister('${formationCandidates[3].id}',vote_role));
 perform set_config('request.jwt.claim.sub','${formationCandidates[3].id}',true);
 perform public.respond_minister_invitation((result->'invitation'->>'id')::uuid,false);
 perform set_config('request.jwt.claim.sub','${outsider.id}',true);
 if (public.get_presidential_formation()->>'status')<>'completed' then raise exception 'Convite adicional reabriu a formacao';end if;
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 update public.profiles set role_assigned_at=clock_timestamp()+interval '1 second' where id='${outsider.id}';
 perform set_config('request.jwt.claim.sub','${outsider.id}',true);f:=public.get_presidential_formation();if (f->>'id')::uuid=fid or f->>'completed_at' is not null then raise exception 'Nova posse reutilizou formação';end if;
 raise notice 'OK formação persistente: retomada, conclusão explícita e nova posse';
 -- Each person in the ticket has their own party and immutable identity.
 insert into public.election_types(name,requires_vice_candidate,voting_system) values('Presidencial identidade '||gen_random_uuid(),true,'majoritarian') returning id into topic;
 insert into public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status) values('Identidade integrada',topic,now()-interval '1 day',now()+interval '1 day',now()+interval '2 days',now()+interval '3 days','Candidacy') returning id into e;
 insert into public.candidates(election_id,user_id,vice_candidate_id,party_id,political_name,status,campaign_photo_url,electoral_number) values(e,'${owner.id}','${vice.id}','${p.id}','Nome inventado','Approved','https://example.invalid/campaign.png','${p.electoral_number}') returning * into candidate_row;c:=candidate_row.id;original:=candidate_row.identity_snapshot;
 if candidate_row.political_name<>'Teste identity-owner' or candidate_row.vice_identity_snapshot->'party'->>'id'<>'${vp.id}' or candidate_row.identity_snapshot->'party'->>'id'<>'${p.id}' then raise exception 'Identidade da chapa incorreta';end if;
 update public.profiles set full_name='Nome posterior' where id='${owner.id}';
 update public.political_parties set color='#FFFFFF' where id='${p.id}';
 if (select identity_snapshot->'party'->>'color' from public.candidates where id=c)<>'#FFFFFF' or (select identity_snapshot->>'name' from public.candidates where id=c)<>original->>'name' then raise exception 'Atualização pré-votação alterou identidade civil ou não propagou cor';end if;
 denied:=false;begin update public.candidates set political_name='Nome personalizado' where id=c;exception when others then denied:=true;end;if not denied then raise exception 'Nome manual permitido';end if;
 if not exists(select 1 from jsonb_array_elements(public.get_electoral_candidate_identities(e)) x where x->'vice'->'party'->>'id'='${vp.id}') then raise exception 'Projeção pública incorreta';end if;
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 denied:=false;begin perform public.admin_delete_election(e,false);exception when others then denied:=true;end;if not denied then raise exception 'Histórico apagado sem confirmação';end if;
 result:=public.admin_delete_election(e,true);if not (result->>'archived')::boolean or not exists(select 1 from public.candidates where id=c) then raise exception 'Arquivo não preservado';end if;
 insert into public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status) values('Agenda vazia',topic,now()+interval '1 day',now()+interval '2 days',now()+interval '3 days',now()+interval '4 days','Scheduled') returning id into e;
 perform public.admin_delete_election(e,false);if exists(select 1 from public.elections where id=e) then raise exception 'Agenda vazia não excluída';end if;
 raise notice 'OK nome oficial, dois partidos e cores, snapshots históricos, projeção pública, exclusão e arquivamento';
 -- All six vote/outcome combinations; a non-voter receives no result notification.
 for notices in 1..6 loop
  insert into public.bills(title,summary,house_id,author_id,status,type) values('Voto personalizado','Verificação de notificações por participação.',house,'${deputy.id}','Em votação','PL') returning id into bill;
  insert into public.parliament_votings(house_id,title,type,related_id,end_date) values(house,'Voto personalizado','bill',bill,now()-interval '1 second') returning id into voting;
  vote_role:=case (notices-1)%3 when 0 then 'Aprovar' when 1 then 'Rejeitar' else 'Abster' end;
  insert into public.parliament_voting_votes(voting_id,member_id,vote) values(voting,member,vote_role);
  -- Vote counts determine the outcome; add existing eligible members' votes.
  insert into public.parliament_voting_votes(voting_id,member_id,vote)
  select voting,m.id,case when notices<=3 then 'Aprovar' else 'Rejeitar' end from public.parliament_members m where m.house_id=house and m.id<>member and m.id=public.get_active_parliament_member_id(m.user_id,house);
  perform public.finalize_bill_voting(voting);perform public.finalize_bill_voting(voting);
  if (select count(*) from public.notifications where user_id='${deputy.id}' and type='parliament_voting_result' and metadata->>'voting_id'=voting::text)<>1 then raise exception 'Resultado duplicado/ausente';end if;
  if not exists(select 1 from public.notifications where user_id='${deputy.id}' and type='parliament_voting_result' and metadata->>'voting_id'=voting::text and metadata->>'vote'=vote_role and metadata->>'tone'=case when vote_role='Abster' then 'neutral' when (vote_role='Aprovar')=(metadata->>'approved')::boolean then 'positive' else 'institutional' end) then raise exception 'Tom do voto incorreto';end if;
  if exists(select 1 from public.notifications where user_id='${outsider.id}' and type='parliament_voting_result' and metadata->>'voting_id'=voting::text) then raise exception 'Não votante notificado';end if;
 end loop;
 raise notice 'OK notificações personalizadas, abstenção neutra, não votantes excluídos e idempotência';
 end $test$;
 rollback;`);
 assert(output.includes('ROLLBACK'));
 // A closed party keeps its historical identifiers; names and acronyms remain reserved.
 assert((await rpc(owner.client,'disaffiliate_from_party',{p_party_id:p.id})).success);
 let blockedDuplicate=false;
 try {
   const recreated=await rpc(owner.client,'create_political_party',{p_name:p.name,p_acronym:p.acronym,p_ideology:'Refundação',p_logo_url:'https://example.invalid/logo.png',p_statute:'Estatuto',p_description:'Novo partido',p_orientation:'Centro',p_color:'#224466'});
   blockedDuplicate=!recreated?.success;
 } catch (_error) {
   blockedDuplicate=true;
 }
 assert(blockedDuplicate,'Nome e sigla de partido encerrado continuam exclusivos.');
 assert.equal((await request(service.from('political_parties').select('status').eq('id',p.id).single())).status,'Encerrado');
 console.log('OK partido encerrado mantém nome e sigla reservados');
 console.log('Integração institucional e eleitoral concluída com RPCs, transações PostgreSQL e Realtime reais.');
} finally { for(const id of partyIds)await service.from('political_parties').update({status:'Encerrado',is_active:false,owner_id:null,president_id:null,vice_president_id:null}).eq('id',id);await cleanup(); }
