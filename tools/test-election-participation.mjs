import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {actor,rpc,cleanup} from './lib/world-test.mjs';
try{
 const admin=await actor('participation-admin','Admin'),head=await actor('participation-head'),vice=await actor('participation-vice');
 const result=execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`begin;
 do $test$
 declare eid uuid;cid uuid;topic uuid;uid uuid;roll uuid[]:='{}';i integer;stats jsonb;saved jsonb;notices integer;chapter uuid:='a1b2c3d4-e5f6-7890-1234-567890abcdef';
 begin
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 insert into public.election_types(name,requires_vice_candidate,voting_system) values('Eleição QA participação',true,'majoritarian') returning id into topic;
 insert into public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,status)
 values('Eleição QA participação',topic,now()-interval '2 days',now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours','Candidacy') returning id into eid;
 insert into public.candidates(election_id,user_id,vice_candidate_id,status) values(eid,'${head.id}','${vice.id}','Pendente') returning id into cid;
 perform public.review_electoral_candidacy(cid,true,'Fundamentação administrativa privada que não pode aparecer na notícia.');
 if not exists(select 1 from public.notifications where user_id='${head.id}' and type='candidacy_approved' and metadata->>'candidate_id'=cid::text) then raise exception 'Titular sem notificação';end if;
 if not exists(select 1 from public.notifications where user_id='${vice.id}' and type='candidacy_approved' and metadata->>'candidate_id'=cid::text) then raise exception 'Vice sem notificação';end if;
 update public.candidates set status='Approved' where id=cid;
 select count(*) into notices from public.news_articles where source_event_id=cid::text;
 if notices<>1 then raise exception 'Notícia duplicada: %',notices;end if;
 if exists(select 1 from public.news_articles where source_event_id=cid::text and content like '%Fundamentação administrativa privada%') then raise exception 'Fundamentação privada exposta';end if;
 for i in 1..100 loop
  uid:=gen_random_uuid();roll:=array_append(roll,uid);
  insert into auth.users(id,email,raw_user_meta_data) values(uid,'roll-'||uid||'@govrp.local',jsonb_build_object('full_name','Eleitor QA '||i));
  insert into public.profiles(id,username,full_name) values(uid,'roll'||left(replace(uid::text,'-',''),16),'Eleitor QA '||i) on conflict(id) do nothing;
  update public.profiles set role='Deputado',character_gender='male',onboarding_completed=true,manual_role_override=true,titulo_eleitor=lpad(i::text,12,'0') where id=uid;
  if not exists(select 1 from public.parliament_members where user_id=uid and house_id=chapter) then insert into public.parliament_members(user_id,house_id,term_start_date,term_end_date) values(uid,chapter,current_date,current_date+30);end if;
 end loop;
 update public.elections set election_mode='indirect',electorate_ids=roll,candidacy_end_date=now()-interval '4 hours',voting_start_date=now()-interval '3 hours',voting_end_date=now()+interval '1 hour',status='Voting' where id=eid;
 for i in 1..80 loop
  perform set_config('request.jwt.claim.sub',roll[i]::text,true);
  perform public.cast_ballot(eid,case when i<=70 then (select electoral_number from public.candidates where id=cid) when i>76 then repeat('9',private.election_number_digits(eid)) else null end,case when i<=70 then 'candidate' when i<=76 then 'blank' else 'null' end);
 end loop;
 perform set_config('request.jwt.claim.sub','${admin.id}',true);
 update public.elections set voting_end_date=clock_timestamp()-interval '1 second' where id=eid;
 insert into public.election_settlements(election_id,status,office_role,total_valid_votes,result) values(eid,'settled','Presidente',70,'[]');
 stats:=public.get_election_participation(eid);
 if stats->>'eligible'<>'100' or stats->>'participants'<>'80' or stats->>'valid_votes'<>'70' or stats->>'blank_votes'<>'6' or stats->>'null_votes'<>'4' or stats->>'abstentions'<>'20' then raise exception 'Contagem incorreta: %',stats;end if;
 saved:=stats;
 update public.profiles set titulo_eleitor=null where id=roll[100];
 if public.get_election_participation(eid)<>saved then raise exception 'Resultado histórico recalculado';end if;
 raise notice 'OK 100 eleitores reais: 70 válidos, 6 brancos, 4 nulos e 20 abstenções; snapshot imutável.';
 end $test$;
 rollback;`});
 assert(result.includes('ROLLBACK'));console.log('✓ Chapa notificada; notícia única sem feedback privado; 100 eleitores e apuração real por RPC com snapshot preservado.');
}finally{await cleanup();}
