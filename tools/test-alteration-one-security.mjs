import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, service, request, rpc, cleanup } from './lib/world-test.mjs';
let checks=0;const check=(value,label)=>{assert(value,label);checks++;console.log(`OK ${label}`);};
try{
 const admin=await actor('alteration-sec-admin','Admin'), citizen=await actor('alteration-sec-citizen'), voter=await actor('alteration-sec-voter');
 const type=await request(service.from('election_types').select('id').eq('name','Deputado').single());
 const output=execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`begin;
 do $checks$ declare e uuid; c uuid; party uuid; entry uuid; a uuid; original_votes int; denied boolean; snapshot jsonb; original_time timestamptz;
 begin
  insert into public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status)
  values('Candidatura auditada','${type.id}',now()-interval '3 hours',now()-interval '2 hours',now()+interval '1 day',now()+interval '2 days','scheduled') returning id into e;
  insert into public.candidates(election_id,user_id,political_name,status) values(e,'${citizen.id}','Candidato auditado','Approved') returning id into c;
  insert into public.votes(election_id,voter_id,candidate_id,ballot_kind) values(e,'${voter.id}',c,'candidate');
  perform set_config('request.jwt.claim.sub','${citizen.id}',true);
  denied:=false;begin perform public.admin_manage_candidacy(c,'delete'); exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Cidadão excluiu candidatura';end if;
  perform set_config('request.jwt.claim.sub','${admin.id}',true);
  perform public.admin_manage_candidacy(c,'delete');perform public.admin_manage_candidacy(c,'delete');
  if not exists(select 1 from public.candidates where id=c and removed_at is not null and status='Withdrawn') then raise exception 'Exclusão não persistiu';end if;
  if not exists(select 1 from public.votes where candidate_id=c) then raise exception 'Exclusão apagou voto histórico';end if;
  denied:=false;begin update public.candidates set status='Approved' where id=c;exception when others then denied:=true;end;
  if not denied then raise exception 'Candidatura excluída reativada';end if;
  insert into public.political_parties(name,acronym,registration_number,founder_id,owner_id,status) values('Partido Preservado','PPR'||substr(gen_random_uuid()::text,1,3),gen_random_uuid()::text,'${citizen.id}','${citizen.id}','Em fundação') returning id into party;
  insert into public.party_members(party_id,user_id,role) values(party,'${citizen.id}','Dono');
  insert into public.accounts(user_id,account_number,agency_number,balance) values('${voter.id}',gen_random_uuid()::text,'0001',1000) returning id into a;
  perform set_config('request.jwt.claim.sub','${voter.id}',true);perform public.donate_to_party(party,500,gen_random_uuid());
  perform set_config('request.jwt.claim.sub','${admin.id}',true);
  denied:=false;begin perform public.admin_permanently_delete_party(party);exception when others then denied:=true;end;
  if not denied then raise exception 'Partido ativo excluído';end if;
  update public.candidates set party_id=party,electoral_number=null where id=c;
  perform public.admin_close_party(party);
  perform set_config('request.jwt.claim.sub','${citizen.id}',true);
  denied:=false;begin perform public.admin_permanently_delete_party(party);exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Cidadão excluiu partido';end if;
  perform set_config('request.jwt.claim.sub','${admin.id}',true);
  perform public.admin_permanently_delete_party(party);perform public.admin_permanently_delete_party(party);
  if exists(select 1 from public.political_parties where id=party) then raise exception 'Partido não foi excluído';end if;
  if not exists(select 1 from public.party_treasuries where party_id=party and balance=500 and archived_at is not null and party_snapshot->>'name'='Partido Preservado') then raise exception 'Saldo/história apagados';end if;
  if not exists(select 1 from public.party_treasury_entries where party_id=party and amount=500) then raise exception 'Extrato apagado';end if;
  if not exists(select 1 from public.candidates where id=c and party_id is null and party_snapshot->>'name'='Partido Preservado') then raise exception 'Histórico eleitoral apagado';end if;
  if not exists(select 1 from public.party_history where party_id is null and party_snapshot->>'id'=party::text) then raise exception 'História partidária apagada';end if;
 end $checks$;
 rollback;`});
 check(output.includes('ROLLBACK'),'RPCs reais: autorização Admin, exclusão idempotente, votos, saldo, doações e histórico conservados');
 for(const name of ['admin_manage_candidacy','admin_permanently_delete_party']){
  const args=name==='admin_manage_candidacy'?{p_candidate_id:crypto.randomUUID(),p_action:'delete'}:{p_party_id:crypto.randomUUID()};
  const result=await citizen.client.rpc(name,args);check(result.error?.code==='42501',`${name}: usuário comum bloqueado pelo backend`);
 }
 // Complete subscribed table set has SELECT policies and belongs to Realtime.
 const {PARLIAMENT_REALTIME_TABLES}=await import('../src/lib/parliamentRealtime.js');
 const missing=execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-Atc',`select t from unnest(array[${PARLIAMENT_REALTIME_TABLES.map(t=>`'${t}'`).join(',')}]) t where not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename=t) or not has_table_privilege('authenticated','public.'||t,'select');`],{encoding:'utf8'}).trim();check(!missing,`Todas as ${PARLIAMENT_REALTIME_TABLES.length} tabelas do canal parlamentar publicadas e legíveis`);
 console.log(`${checks} cenários de integridade e segurança aprovados.`);
}finally{await cleanup();}
