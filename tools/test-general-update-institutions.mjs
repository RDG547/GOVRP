import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// All scenarios are fictional and roll back. No linked/hosted database is used.
const sql=`BEGIN;
SELECT set_config('govrp.executive_transition','replacing',true);
UPDATE public.elections SET archived_at=now() WHERE archived_at IS NULL;
CREATE TEMP TABLE update_people(kind text,id uuid);
DO $fixtures$ DECLARE person uuid;kind text;n int;BEGIN
 FOR n IN 1..5 LOOP
  person:=gen_random_uuid();kind:=CASE n WHEN 1 THEN 'voter' WHEN 2 THEN 'senator' ELSE 'candidate'||n END;
  INSERT INTO auth.users(id,email,created_at,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES(person,'qa-general-'||person||'@example.invalid',now()-interval '3 days',now()-interval '2 days','{"provider":"email","providers":["email"]}','{}');
  UPDATE public.profiles SET full_name='QA institucional '||kind,username='qa'||left(replace(person::text,'-',''),12),character_gender='male',onboarding_completed=true,onboarding_step='completed',role='Cidadão' WHERE id=person;
  INSERT INTO update_people VALUES(kind,person);
 END LOOP;
 INSERT INTO public.documents(user_id,type,document_number,metadata) SELECT id,'Título de Eleitor',gen_random_uuid()::text,'{}' FROM update_people u WHERE u.kind='voter';
END $fixtures$;
DO $scenario$ DECLARE voter uuid;senator uuid;e uuid;first_e uuid;senate_e uuid;kind text;result jsonb;candidate uuid;rank integer:=0;member uuid;original_start date;before_end date;
BEGIN
 SELECT id INTO voter FROM update_people WHERE update_people.kind='voter';SELECT id INTO senator FROM update_people WHERE update_people.kind='senator';
 PERFORM set_config('request.jwt.claim.sub',voter::text,true);
 result:=public.get_my_ballot_sequence();IF result->>'active_count'<>'0' OR jsonb_array_length(result->'elections')<>0 THEN RAISE EXCEPTION 'Sequência vazia incorreta';END IF;
 FOREACH kind IN ARRAY ARRAY['Presidente','Senador','Deputado'] LOOP
  INSERT INTO public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,seats_available)
  SELECT 'QA sequência '||kind,id,now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours',now()+interval '4 hours',CASE WHEN kind<>'Presidente' THEN 1 END FROM public.election_types WHERE name=kind RETURNING id INTO e;
  UPDATE public.elections SET candidacy_start_date=now()-interval '3 hours',candidacy_end_date=now()-interval '2 hours',voting_start_date=now()-interval '1 hour',voting_end_date=now()+interval '1 hour' WHERE id=e;
  IF kind='Senador' THEN senate_e:=e;END IF;
  rank:=rank+1;result:=public.get_my_ballot_sequence();IF jsonb_array_length(result->'elections')<>rank THEN RAISE EXCEPTION 'Cargos disponíveis foram pulados';END IF;
 END LOOP;
 result:=public.get_my_ballot_sequence();IF result->'elections'->0->'election_types'->>'name'<>'Deputado' OR result->'elections'->1->'election_types'->>'name'<>'Senador' OR result->'elections'->2->'election_types'->>'name'<>'Presidente' THEN RAISE EXCEPTION 'Ordem de votação inválida';END IF;
 first_e:=(result->'elections'->0->>'id')::uuid;PERFORM public.cast_ballot(first_e,NULL,'blank');
 result:=public.get_my_ballot_sequence();IF result->>'completed'<>'1' OR jsonb_array_length(result->'elections')<>2 OR result->'elections'->0->'election_types'->>'name'<>'Senador' THEN RAISE EXCEPTION 'Retomada não preservou voto anterior';END IF;
 -- The indirect electorate is independent from general eligibility and must be respected.
 UPDATE public.elections SET election_mode='indirect',electorate_ids=ARRAY[]::uuid[] WHERE id=senate_e;
 result:=public.get_my_ballot_sequence();IF jsonb_array_length(result->'elections')<>1 OR result->'unavailable'->0->>'reason'<>'indirect_electorate' THEN RAISE EXCEPTION 'Eleitorado indireto não foi respeitado';END IF;
 -- Seat additions within an elected Senate legislature reuse its actual end,
 -- while an early termination remains untouched and deputy dates stay separate.
 PERFORM set_config('request.jwt.claim.sub','',true);
 INSERT INTO public.election_office_assignments(election_id,profile_id,office_role,term_starts_at,term_ends_at,status)
 VALUES(senate_e,senator,'Senador',current_date-interval '5 days',current_date+interval '20 days','active');
 UPDATE public.profiles SET role='Senador' WHERE id=senator;
 SELECT id,term_start_date INTO member,original_start FROM public.parliament_members WHERE user_id=senator AND house_id='fedcba09-8765-4321-0987-654321fedcba';
 UPDATE public.parliament_members SET term_end_date=current_date+interval '30 days' WHERE id=member;
 IF (SELECT term_end_date FROM public.parliament_members WHERE id=member)<>current_date+20 OR (SELECT term_start_date FROM public.parliament_members WHERE id=member)<>original_start THEN RAISE EXCEPTION 'Prazo da legislatura não preservado';END IF;
 UPDATE public.parliament_members SET term_end_date=current_date-1 WHERE id=member;
 IF (SELECT term_end_date FROM public.parliament_members WHERE id=member)<>current_date-1 THEN RAISE EXCEPTION 'Mandato encerrado foi reativado';END IF;
 RAISE NOTICE 'PASS: zero/um/dois/três cargos, ordem, votos persistidos, retomada, eleitorado indireto e prazo da legislatura sem reativação';
END $scenario$;
ROLLBACK;`;
try{const output=execFileSync('docker',['exec','-i','supabase_db_GOVRP_RESET_QA','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']});assert.match(output,/ROLLBACK/);console.log('Sequência eleitoral e mandatos: integração aprovada, cenário revertido.');}catch(error){console.error(error.stderr?.toString()||error.message);process.exitCode=1;}
