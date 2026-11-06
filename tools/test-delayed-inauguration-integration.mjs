import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const container = process.env.GOVRP_QA_DB_CONTAINER || 'supabase_db_GOVRP_RESET_QA';
assert.match(container, /^supabase_db_[A-Z0-9_]*QA[A-Z0-9_]*$/);
const sql = `BEGIN;
CREATE TEMP TABLE inauguration_test_people(id uuid PRIMARY KEY,kind text);
DO $fixtures$ DECLARE person uuid;k text;n int;BEGIN
 FOR n IN 1..6 LOOP
  person:=gen_random_uuid();k:=CASE n WHEN 1 THEN 'old_president' WHEN 2 THEN 'Presidente' WHEN 3 THEN 'Vice-Presidente' WHEN 4 THEN 'Deputado' WHEN 5 THEN 'Senador' ELSE 'voter' END;
  INSERT INTO auth.users(id,email,email_confirmed_at,created_at,raw_app_meta_data,raw_user_meta_data) VALUES(person,'qa-inauguration-'||person||'@govrp.local',now()-interval '5 days',now()-interval '10 days','{"provider":"email","providers":["email"]}','{}');
  UPDATE public.profiles SET full_name='Teste posse '||k,username='qi'||left(replace(person::text,'-',''),12),created_at=now()-interval '10 days',character_gender='male',onboarding_completed=true,onboarding_step='completed',titulo_eleitor='QA'||left(person::text,8),role=CASE WHEN n=1 THEN 'Presidente' ELSE 'Cidadão' END WHERE id=person;
  INSERT INTO public.documents(user_id,type,document_number,is_valid,issued_at) VALUES(person,'Título de Eleitor','QA-'||person,true,now()-interval '4 days');
  INSERT INTO inauguration_test_people VALUES(person,k);
 END LOOP;
END $fixtures$;
DO $test$ DECLARE elected uuid;vice uuid;voter uuid;old_pres uuid;e public.elections%rowtype;c public.candidates%rowtype;t record;r jsonb;a public.election_office_assignments%rowtype;member uuid;n int;BEGIN
 SELECT id INTO voter FROM inauguration_test_people WHERE kind='voter';SELECT id INTO vice FROM inauguration_test_people WHERE kind='Vice-Presidente';SELECT id INTO old_pres FROM inauguration_test_people WHERE kind='old_president';
 FOR t IN SELECT * FROM public.election_types WHERE name IN('Deputado','Senador','Presidente') ORDER BY CASE name WHEN 'Presidente' THEN 2 ELSE 1 END,name LOOP
  SELECT id INTO elected FROM inauguration_test_people WHERE kind=t.name;
  INSERT INTO public.elections(name,election_type_id,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date,seats_available)
  VALUES('Eleição de teste: '||t.name,t.id,now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours',now()+interval '4 hours',CASE WHEN t.name<>'Presidente' THEN 1 END) RETURNING * INTO e;
  INSERT INTO public.candidates(election_id,user_id,vice_candidate_id,political_name,status) VALUES(e.id,elected,CASE WHEN t.name='Presidente' THEN vice END,'Nome de teste','Approved') RETURNING * INTO c;
  UPDATE public.elections SET candidacy_start_date=now()-interval '3 hours',candidacy_end_date=now()-interval '2 hours',voting_start_date=now()-interval '1 hour',voting_end_date=now()+interval '1 hour' WHERE id=e.id;
  PERFORM set_config('request.jwt.claim.sub',voter::text,true);PERFORM public.cast_ballot(e.id,c.electoral_number,'candidate');
  UPDATE public.elections SET voting_end_date=clock_timestamp()-interval '1 second' WHERE id=e.id RETURNING * INTO e;
  r:=private.settle_election_offices(e.id);
  IF r->>'status'<>'settled' THEN RAISE EXCEPTION 'Apuração não foi concluída: %',r;END IF;
  SELECT * INTO a FROM public.election_office_assignments WHERE election_id=e.id AND profile_id=elected;
  IF a.status<>'pending' OR a.term_starts_at<>e.voting_end_date+interval '24 hours' THEN RAISE EXCEPTION 'A posse não respeita o prazo de 24 horas';END IF;
  IF (SELECT role FROM public.profiles WHERE id=elected)<>'Cidadão' THEN RAISE EXCEPTION 'Apuração concedeu cargo antecipado';END IF;
  IF t.name='Presidente' AND (SELECT role FROM public.profiles WHERE id=old_pres)<>'Presidente' THEN RAISE EXCEPTION 'Apuração removeu Presidente antes da posse';END IF;
  PERFORM private.activate_due_elected_offices();
  IF (SELECT role FROM public.profiles WHERE id=elected)<>'Cidadão' THEN RAISE EXCEPTION 'Rotina de calendário antecipou a posse';END IF;
  -- Simulate crossing the server deadline without sleeping for a real day.
  UPDATE public.election_office_assignments SET term_starts_at=clock_timestamp()-interval '1 second' WHERE election_id=e.id AND status='pending';
  PERFORM private.activate_due_elected_offices();
  IF (SELECT role FROM public.profiles WHERE id=elected)<>t.name THEN RAISE EXCEPTION 'Mandato não foi ativado após o prazo';END IF;
  IF t.name IN('Deputado','Senador') AND NOT EXISTS(SELECT 1 FROM public.parliament_members WHERE user_id=elected AND term_end_date>=current_date) THEN RAISE EXCEPTION 'Posse não criou o vínculo parlamentar';END IF;
  IF t.name='Presidente' AND ((SELECT role FROM public.profiles WHERE id=vice)<>'Vice-Presidente' OR (SELECT role FROM public.profiles WHERE id=old_pres)<>'Cidadão') THEN RAISE EXCEPTION 'Transição presidencial ou vice inválidos';END IF;
  PERFORM private.activate_due_elected_offices();
  IF (SELECT count(*) FROM public.notifications WHERE user_id=elected AND type IN('office_awarded','role_changed') AND metadata->>'assignment_id'=a.id::text)<>1 THEN RAISE EXCEPTION 'Posse não foi idempotente: cargo %, notificações %',t.name,(SELECT jsonb_agg(jsonb_build_object('type',type,'metadata',metadata)) FROM public.notifications WHERE user_id=elected AND metadata->>'assignment_id'=a.id::text);END IF;
 END LOOP;
 RAISE NOTICE 'PASS: apuração real, prazo de 24 horas, bloqueio de posse antecipada, três cargos, vice, sucessão e idempotência';
END $test$;
ROLLBACK;`;
try {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /ROLLBACK/); console.log('Posse de deputados, senadores, presidente e vice após 24 horas: integração aprovada no QA.');
} catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
