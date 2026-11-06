import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// This suite never discovers or connects to the linked production database.
const container = process.env.GOVRP_QA_DB_CONTAINER || 'supabase_db_GOVRP_RESET_QA';
assert.match(container, /^supabase_db_[A-Z0-9_]*QA[A-Z0-9_]*$/);
const sql = `BEGIN;
SELECT set_config('govrp.executive_transition','replacing',true);
SELECT set_config('request.headers',jsonb_build_object('x-govrp-world-generation',(SELECT value->>'generation_id' FROM public.system_settings WHERE key='world_runtime'))::text,true);
CREATE TEMP TABLE institutional_test_people(id uuid PRIMARY KEY,kind text);
DO $fixtures$ DECLARE person uuid;kind text;n int;BEGIN
 FOR n IN 1..6 LOOP
  person:=gen_random_uuid();kind:=CASE n WHEN 1 THEN 'president' WHEN 2 THEN 'nominee' WHEN 3 THEN 'senator1' WHEN 4 THEN 'senator2' WHEN 5 THEN 'senator3' ELSE 'outsider' END;
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(person,'qa-institution-'||person||'@govrp.local','{"provider":"email","providers":["email"]}','{}');
  UPDATE public.profiles SET full_name='Teste institucional '||kind,username='qa'||left(replace(person::text,'-',''),12),character_gender='male',onboarding_completed=true,onboarding_step='completed',role=CASE WHEN n=1 THEN 'Presidente' WHEN n IN(3,4,5) THEN 'Senador' ELSE 'Cidadão' END,manual_role_override=false WHERE id=person;
  INSERT INTO institutional_test_people VALUES(person,kind);
 END LOOP;
 INSERT INTO public.government_terms(head_id,original_president_id,term_starts_at,term_ends_at,source)
 SELECT id,id,clock_timestamp(),clock_timestamp()+interval '28 days','admin' FROM institutional_test_people tp WHERE tp.kind='president';
END $fixtures$;
DO $test$ DECLARE pres uuid;candidate uuid;outsider uuid;i uuid;r jsonb;v uuid;t uuid;member uuid;s record;denied boolean;extra uuid;en uuid;imp uuid;n int;before_count int;BEGIN
 SELECT id INTO pres FROM institutional_test_people WHERE kind='president';SELECT id INTO candidate FROM institutional_test_people WHERE kind='nominee';SELECT id INTO outsider FROM institutional_test_people WHERE kind='outsider';
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);
 denied:=false;BEGIN PERFORM public.manage_executive_appointment('electoral_portal_president',candidate,'Nomeação vedada de autoridade eleitoral.');EXCEPTION WHEN OTHERS THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Presidente nomeou autoridade eleitoral fora do rodízio';END IF;
 r:=public.manage_executive_appointment('supreme_court_1',candidate,'Indicação de teste');i:=(r->'invitation'->>'id')::uuid;
 IF i IS NULL OR (SELECT role FROM public.profiles WHERE id=candidate)<>'Cidadão' THEN RAISE EXCEPTION 'Indicação concedeu cargo prematuramente';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);denied:=false;
 BEGIN PERFORM public.respond_minister_invitation(i,true);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Aceite de terceiro permitido';END IF;
 PERFORM set_config('request.jwt.claim.sub',candidate::text,true);r:=public.respond_minister_invitation(i,true);
 IF (SELECT role FROM public.profiles WHERE id=candidate)<>'Cidadão' OR (SELECT institutional_stage FROM public.minister_invitations WHERE id=i)<>'hearing' THEN RAISE EXCEPTION 'Aceite pulou sabatina/Senado';END IF;
 PERFORM public.manage_judicial_hearing(i,'answer','Comprometo-me com a independência e o devido processo legal.');
 SELECT id INTO member FROM institutional_test_people WHERE kind='senator1';PERFORM set_config('request.jwt.claim.sub',member::text,true);
 PERFORM public.manage_judicial_hearing(i,'question','Como será preservada a independência funcional da magistratura?');
 -- Opening the vote is reserved for the house chair; create a test-only chair
 -- through the same primary role used by the existing parliament workflow.
 UPDATE public.profiles SET role='Presidente do Senado' WHERE id=member;
 r:=public.manage_judicial_hearing(i,'open_vote','');v:=(r->>'voting_id')::uuid;
 IF v IS NULL THEN RAISE EXCEPTION 'Votação não foi aberta';END IF;
 FOR s IN SELECT m.id,m.user_id FROM public.parliament_members m JOIN institutional_test_people tp ON tp.id=m.user_id WHERE tp.kind LIKE 'senator%' ORDER BY tp.kind LOOP
  PERFORM set_config('request.jwt.claim.sub',s.user_id::text,true);PERFORM public.cast_parliament_vote(v,s.id,'Aprovar');
 END LOOP;
 SELECT id INTO t FROM public.institutional_terms WHERE invitation_id=i AND status='active';
 IF t IS NULL OR (SELECT role FROM public.profiles WHERE id=candidate)<>'Juiz' THEN RAISE EXCEPTION 'Aprovação não deu posse';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.institutional_terms WHERE id=t AND ends_at BETWEEN starts_at+interval '2 months'-interval '1 second' AND starts_at+interval '2 months'+interval '1 second') THEN RAISE EXCEPTION 'Prazo do mandato incorreto';END IF;
 PERFORM private.finish_institutional_vote(v);
 IF (SELECT count(*) FROM public.institutional_terms WHERE invitation_id=i)<>1 THEN RAISE EXCEPTION 'Posse duplicada';END IF;
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);denied:=false;
 BEGIN PERFORM public.manage_executive_appointment('supreme_court_1',NULL,'Exoneração indevida');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Presidente exonerou mandato independente';END IF;

 -- Fill the remaining real seats through the administrative path, never a
 -- parallel registry. A sixth judge must fail without disturbing the five.
 PERFORM set_config('request.jwt.claim.sub','',true);
 FOR n IN 1..5 LOOP
  extra:=gen_random_uuid();
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(extra,'qa-seat-'||extra||'@govrp.local','{}','{}');
  IF n<=4 THEN UPDATE public.profiles SET role='Juiz' WHERE id=extra;
  ELSE denied:=false;BEGIN UPDATE public.profiles SET role='Juiz' WHERE id=extra;EXCEPTION WHEN OTHERS THEN denied:=true;END;IF NOT denied THEN RAISE EXCEPTION 'Sexto ministro foi permitido';END IF;END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.institutional_terms WHERE status='active' AND office_key LIKE 'supreme_court_%')<>5 THEN RAISE EXCEPTION 'Limite de cinco vagas inconsistente';END IF;
 -- A judicial chair keeps the same individual mandate.
 UPDATE public.profiles SET role='Presidente do STF' WHERE id=candidate;
 IF NOT EXISTS(SELECT 1 FROM public.institutional_terms WHERE id=t AND status='active') THEN RAISE EXCEPTION 'Mesa do STF reiniciou mandato';END IF;
 UPDATE public.profiles SET role='Juiz' WHERE id=candidate;
 -- Overlapping windows rotate distinct pairs; repeated maintenance is inert.
 INSERT INTO public.elections(name,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date) VALUES('Janela institucional QA',now()+interval '1 day',now()+interval '2 days',now()+interval '3 days',now()+interval '4 days') RETURNING id INTO en;
 INSERT INTO public.elections(name,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date) VALUES('Janela sobreposta QA',now()+interval '1 day',now()+interval '2 days',now()+interval '4 days',now()+interval '5 days');
 PERFORM private.maintain_institutional_calendar();
 IF (SELECT count(*) FROM public.judicial_electoral_assignments WHERE en=ANY(election_ids) AND ended_at IS NULL)<>2 THEN RAISE EXCEPTION 'Janela não designou dois juízes';END IF;
 IF EXISTS(SELECT 1 FROM public.judicial_electoral_assignments a JOIN public.judicial_electoral_assignments b ON a.id<>b.id AND a.term_id=b.term_id AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at WHERE a.ended_at IS NULL AND b.ended_at IS NULL) THEN RAISE EXCEPTION 'Juiz acumulou janelas sobrepostas';END IF;
 SELECT count(*) INTO before_count FROM public.judicial_electoral_assignments;PERFORM private.maintain_institutional_calendar();
 IF (SELECT count(*) FROM public.judicial_electoral_assignments)<>before_count THEN RAISE EXCEPTION 'Rodízio duplicado';END IF;
 -- Actual responsibility proceeding: defense, 24h minimum, two-thirds vote.
 SELECT it.id,it.profile_id INTO s FROM public.institutional_terms it WHERE it.status='active' AND it.id<>t ORDER BY it.id LIMIT 1;
 SELECT id INTO member FROM institutional_test_people WHERE kind='senator1';PERFORM set_config('request.jwt.claim.sub',member::text,true);
 r:=public.manage_judicial_impeachment('open',s.id,NULL,'Fundamentação verificável para o processo de responsabilidade.',jsonb_build_array('Prova fictícia identificada de QA'));imp:=(r->>'case_id')::uuid;
 denied:=false;BEGIN PERFORM public.manage_judicial_impeachment('open_vote',NULL,imp,'Deliberação fundamentada após ampla defesa.');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Votação ignorou prazo de defesa';END IF;
 PERFORM set_config('request.jwt.claim.sub',s.profile_id::text,true);PERFORM public.manage_judicial_impeachment('defense',NULL,imp,'Defesa apresentada com contraditório e todos os fundamentos.');
 UPDATE public.public_integrity_cases SET defense_deadline_at=now()-interval '1 second' WHERE id=imp;
 PERFORM set_config('request.jwt.claim.sub',member::text,true);r:=public.manage_judicial_impeachment('open_vote',NULL,imp,'Deliberação fundamentada após ampla defesa.');v:=(r->>'voting_id')::uuid;
 FOR s IN SELECT m.id,m.user_id FROM public.parliament_members m JOIN institutional_test_people tp ON tp.id=m.user_id WHERE tp.kind LIKE 'senator%' ORDER BY tp.kind LOOP
  PERFORM set_config('request.jwt.claim.sub',s.user_id::text,true);PERFORM public.cast_parliament_vote(v,s.id,'Aprovar');
 END LOOP;
 IF (SELECT status FROM public.public_integrity_cases WHERE id=imp)<>'convicted' OR (SELECT status FROM public.institutional_terms WHERE id=(SELECT institutional_term_id FROM public.public_integrity_cases WHERE id=imp))<>'removed' THEN RAISE EXCEPTION 'Decisão do Senado não abriu vaga';END IF;
 -- Individual expiry does not depend on the president's government cycle.
 PERFORM set_config('request.jwt.claim.sub','',true);
 SELECT it.id INTO extra FROM public.institutional_terms it WHERE it.status='active' AND it.id<>t ORDER BY it.id LIMIT 1;
 UPDATE public.institutional_terms SET starts_at=now()-interval '3 months',ends_at=now()-interval '1 second' WHERE id=extra;
 PERFORM private.maintain_institutional_calendar();IF (SELECT status FROM public.institutional_terms WHERE id=extra)<>'expired' THEN RAISE EXCEPTION 'Mandato não expirou automaticamente';END IF;
 -- Prosecutor accepts the independent invitation without a Senate vote.
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);r:=public.manage_executive_appointment('public_prosecutor',outsider,'Indicação ao Ministério Público.');i:=(r->'invitation'->>'id')::uuid;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);PERFORM public.respond_minister_invitation(i,true);
 IF (SELECT role FROM public.profiles WHERE id=outsider)<>'Promotor' THEN RAISE EXCEPTION 'Aceite do Promotor não deu posse';END IF;
 PERFORM set_config('request.jwt.claim.sub',candidate::text,true);r:=public.resign_judicial_term(t,'Renúncia voluntária no teste de integração.');
 IF (SELECT status FROM public.institutional_terms WHERE id=t)<>'resigned' OR (SELECT role FROM public.profiles WHERE id=candidate)<>'Cidadão' THEN RAISE EXCEPTION 'Renúncia não abriu vaga';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=pres AND type='institutional_vacancy' AND metadata->>'institutional_source'=t::text) THEN RAISE EXCEPTION 'Vacância não notificou Presidente';END IF;

 -- Rejected nominations must publish the actual result without granting office.
 extra:=gen_random_uuid();PERFORM set_config('request.jwt.claim.sub','',true);INSERT INTO auth.users(id,email) VALUES(extra,'qa-rejected-'||extra||'@example.invalid');UPDATE public.profiles SET full_name='Pessoa indicada QA',character_gender='male',onboarding_completed=true,onboarding_step='completed' WHERE id=extra;
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);r:=public.manage_executive_appointment('supreme_court_1',extra,'Indicação para testar rejeição.');i:=(r->'invitation'->>'id')::uuid;
 PERFORM set_config('request.jwt.claim.sub',extra::text,true);PERFORM public.respond_minister_invitation(i,true);PERFORM public.manage_judicial_hearing(i,'answer','Manifestação do indicado no teste de rejeição.');
 SELECT id INTO member FROM institutional_test_people WHERE kind='senator1';PERFORM set_config('request.jwt.claim.sub',member::text,true);PERFORM public.manage_judicial_hearing(i,'question','Pergunta fundamentada sobre o exercício da magistratura.');r:=public.manage_judicial_hearing(i,'open_vote','');v:=(r->>'voting_id')::uuid;
 FOR s IN SELECT m.id,m.user_id FROM public.parliament_members m JOIN institutional_test_people tp ON tp.id=m.user_id WHERE tp.kind LIKE 'senator%' LOOP
  PERFORM set_config('request.jwt.claim.sub',s.user_id::text,true);PERFORM public.cast_parliament_vote(v,s.id,'Rejeitar');
 END LOOP;
 IF (SELECT role FROM public.profiles WHERE id=extra)<>'Cidadão' OR EXISTS(SELECT 1 FROM public.institutional_terms WHERE profile_id=extra) OR NOT EXISTS(SELECT 1 FROM public.news_articles WHERE source_event_type='judicial_appointment_rejected' AND source_event_id=i::text) THEN RAISE EXCEPTION 'Rejeição concedeu cargo ou notícia incorreta';END IF;
 RAISE NOTICE 'PASS: indicação, aceite protegido, sabatina, votação, posse, idempotência, mandato independente, renúncia, vacância';
END $test$;
ROLLBACK;`;
try {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /ROLLBACK/); console.log('Integração institucional concluída no banco QA; cenário revertido.');
} catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
