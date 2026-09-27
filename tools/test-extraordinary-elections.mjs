import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { actor, cleanup, ensureParliamentHouses } from './lib/world-test.mjs';
try {
 await ensureParliamentHouses();
 const [president,chair,deputy,winner,vice,citizen]=await Promise.all(['extra-pres','extra-chair','extra-deputy','extra-winner','extra-vice','extra-citizen'].map(label=>actor(label)));
 const house='a1b2c3d4-e5f6-7890-1234-567890abcdef';
 const output=execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`begin;
 select set_config('govrp.executive_transition','replacing',true);
 update public.government_terms set ended_at=clock_timestamp() where ended_at is null;
 update public.profiles set role='Cidadão',manual_role_override=false where role in ('Presidente','Vice-Presidente');
 update public.parliament_leadership_terms set status='completed',concluded_at=clock_timestamp() where status='active';
 update public.parliament_members set term_end_date=current_date-1;
 select set_config('govrp.executive_transition','',true);
 update public.profiles set role='Deputado',manual_role_override=true where id in ('${chair.id}','${deputy.id}');
 insert into public.parliament_leadership_terms(house_id,member_id,position,status,term_start_date,term_end_date) select '${house}',id,'president','active',current_date,current_date+30 from public.parliament_members where user_id='${chair.id}' and house_id='${house}';
 update public.profiles set role='Presidente',manual_role_override=true,role_assigned_at=clock_timestamp() where id='${president.id}';
 update public.profiles set titulo_eleitor=right(replace(id::text,'-',''),12) where id in ('${chair.id}','${deputy.id}','${citizen.id}');
 do $test$ declare g public.government_terms%rowtype; e uuid; c public.candidates%rowtype; r jsonb; denied boolean; original_end timestamptz; begin
 select * into g from public.government_terms where ended_at is null;
 perform set_config('request.jwt.claim.sub','${president.id}',true);perform public.resign_presidency();
 perform set_config('request.jwt.claim.sub','${chair.id}',true);
 e:=public.call_extraordinary_election();
 if (select election_mode from public.elections where id=e)<>'direct' then raise exception 'Primeira metade não convocou eleição direta';end if;
 if public.call_extraordinary_election()<>e then raise exception 'Convocação duplicada';end if;
 perform set_config('request.jwt.claim.sub','${citizen.id}',true);
 if not public.can_vote_in_election(e) then raise exception 'Cidadão não habilitado na eleição direta';end if;
 -- Isolate the second-half scenario, preserving the first election through a savepoint in this rollback-only test.
 update public.government_terms set term_starts_at=now()-interval '20 days',term_ends_at=now()+interval '10 days',vacancy_at=null,head_id=null,extraordinary_election_id=null where id=g.id;
 perform private.assign_interim_president(g.id,'Cenário de segunda metade');
 perform set_config('request.jwt.claim.sub','${chair.id}',true);
 e:=public.call_extraordinary_election();
 if (select election_mode from public.elections where id=e)<>'indirect' or (select quorum_min_votes from public.elections where id=e)<>2 then raise exception 'Eleitorado ou quórum indireto incorreto';end if;
 select original_term_ends_at into original_end from public.elections where id=e;
 insert into public.candidates(election_id,user_id,vice_candidate_id,political_name,status) values(e,'${winner.id}','${vice.id}','Candidato extraordinário','Approved') returning * into c;
 update public.elections set candidacy_start_date=now()-interval '3 hours',candidacy_end_date=now()-interval '2 hours',voting_start_date=now()-interval '1 hour',voting_end_date=now()+interval '1 hour' where id=e;
 perform set_config('request.jwt.claim.sub','${citizen.id}',true);
 if public.can_vote_in_election(e) then raise exception 'Cidadão incluído na eleição indireta';end if;
 denied:=false;begin perform public.cast_ballot(e,c.electoral_number,'candidate');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Cidadão votou na eleição indireta';end if;
 perform set_config('request.jwt.claim.sub','${chair.id}',true);perform public.cast_ballot(e,c.electoral_number,'candidate');
 savepoint_placeholder
 perform set_config('request.jwt.claim.sub','${deputy.id}',true);perform public.cast_ballot(e,c.electoral_number,'candidate');
 update public.elections set voting_end_date=now()-interval '1 second' where id=e;
 r:=private.settle_election_offices(e);
 if r->>'status'<>'settled' then raise exception 'Eleição não apurada %',r;end if;
 if (select role from public.profiles where id='${winner.id}')<>'Presidente' then raise exception 'Vencedor não tomou posse';end if;
 if (select term_ends_at from public.election_office_assignments where election_id=e and office_role='Presidente')<>original_end then raise exception 'Mandato reiniciou na posse';end if;
 if public.is_acting_president('${chair.id}') or (select role from public.profiles where id='${chair.id}')<>'Deputado' then raise exception 'Fim da interinidade alterou mandato';end if;
 if not (private.settle_election_offices(e)->>'idempotent')::boolean then raise exception 'Apuração não idempotente';end if;
 raise notice 'Eleição direta, indireta, urna, quórum, posse e término original verificados.';
 end $test$;
 -- Rebuild a pre-migration double vacancy from the historical assignment without reactivating its winner.
 select set_config('govrp.executive_transition','replacing',true);
 update public.profiles set role='Cidadão',manual_role_override=true,role_assigned_at=clock_timestamp() where id in ('${winner.id}','${vice.id}');
 update public.government_terms set ended_at=clock_timestamp() where ended_at is null;
 select set_config('govrp.executive_transition','',true);
 ${readFileSync(new URL('../supabase/migrations/20260927042239_legacy_government_continuity.sql',import.meta.url),'utf8').match(/DO \$bootstrap\$[\s\S]*?END \$bootstrap\$;/)[0]}
 do $check$ begin
 if not public.is_acting_president('${chair.id}') then raise exception 'Migração não recuperou interinidade';end if;
 if (select role from public.profiles where id='${winner.id}')<>'Cidadão' then raise exception 'Migração desfez alteração administrativa';end if;
 if (select count(*) from public.government_terms where ended_at is null)<>1 then raise exception 'Migração duplicou governo';end if;
 end $check$;
 rollback;`.replace('savepoint_placeholder',`-- A single vote cannot meet the minimum; settlement records no winner.
 begin
   update public.elections set voting_end_date=now()-interval '1 second' where id=e;
   r:=private.settle_election_offices(e);
   if r->>'status'<>'no_votes' then raise exception 'Quórum insuficiente aceito';end if;
   raise exception 'rollback_quorum_probe' using errcode='ZX001';
 exception when sqlstate 'ZX001' then null;
 end;`)});
 assert(output.includes('ROLLBACK'));console.log('✓ Eleições extraordinárias: fluxo real e isolamento dos eleitorados aprovados.');
} finally { await cleanup(); }
