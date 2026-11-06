import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const container = process.env.GOVRP_QA_DB_CONTAINER || 'supabase_db_GOVRP_RESET_QA';
assert.match(container, /^supabase_db_[A-Z0-9_]*QA[A-Z0-9_]*$/);
const sql = `BEGIN;
INSERT INTO public.system_settings(key,value) VALUES('official_salaries','{"roles":[{"role":"Deputado","title":"Deputado Federal","amount":10500,"previous_amount":10500,"version":1,"valid_from":"2026-09-09T00:00:00Z"}]}') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.government_rules(rule_key,numeric_value,unit,description,rule_kind,is_active,definition) VALUES('official_salary_'||md5('Deputado'),10500,'BRL','Remuneração de teste','policy',true,jsonb_build_object('operation','official_salary','role','Deputado','audience','all')) ON CONFLICT DO NOTHING;
CREATE TEMP TABLE salary_test_people(id uuid PRIMARY KEY,kind text);
DO $fixtures$ DECLARE person uuid;k text;n int;BEGIN
 FOR n IN 1..8 LOOP
  person:=gen_random_uuid();k:=CASE WHEN n=1 THEN 'president' WHEN n<=4 THEN 'deputy'||n ELSE 'senator'||n END;
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(person,'qa-salary-'||person||'@govrp.local','{"provider":"email","providers":["email"]}','{}');
  UPDATE public.profiles SET full_name='Teste salário '||k,username='qs'||left(replace(person::text,'-',''),12),character_gender='male',onboarding_completed=true,onboarding_step='completed',role=CASE WHEN n=1 THEN 'Presidente' WHEN n=2 THEN 'Presidente da Câmara dos Deputados' WHEN n<=4 THEN 'Deputado' ELSE 'Senador' END WHERE id=person;
  INSERT INTO salary_test_people VALUES(person,k);
 END LOOP;
END $fixtures$;
DO $test$ DECLARE pres uuid;chair uuid;r jsonb;entry jsonb;old numeric;new_amount numeric;b uuid;e uuid;v public.parliament_votings%rowtype;m record;denied boolean;BEGIN
 SELECT id INTO pres FROM salary_test_people WHERE kind='president';SELECT id INTO chair FROM salary_test_people WHERE kind='deputy2';
 SELECT it INTO entry FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')it WHERE s.key='official_salaries' AND it->>'role'='Deputado';
 IF entry IS NULL THEN RAISE EXCEPTION 'Catálogo salarial de QA ausente';END IF;
 old:=(entry->>'amount')::numeric;new_amount:=old+123.45;
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);
 r:=public.propose_official_salary('Deputado',new_amount,(entry->>'version')::int,'Justificativa econômica completa para revisão da remuneração dos parlamentares em exercício.');b:=(r->>'bill_id')::uuid;e:=(r->>'effect_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')it WHERE s.key='official_salaries' AND it->>'role'='Deputado' AND (it->>'amount')::numeric=old) THEN RAISE EXCEPTION 'Proposta alterou salário diretamente';END IF;
 PERFORM set_config('request.jwt.claim.sub',chair::text,true);
 v:=public.start_parliament_bill_voting(b,'a1b2c3d4-e5f6-7890-1234-567890abcdef','Votação do reajuste salarial');
 FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(v.eligible_member_ids) LOOP
  PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,'Aprovar');
 END LOOP;
 IF (SELECT status FROM public.bills WHERE id=b)<>'Em votação (2ª Casa)' THEN RAISE EXCEPTION 'Aprovação na Câmara não encaminhou ao Senado';END IF;
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);denied:=false;
 BEGIN PERFORM public.update_bill_status(b,'Sancionado');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Sanção pulou o Senado';END IF;
 SELECT * INTO v FROM public.parliament_votings WHERE related_id=b AND house_id='fedcba09-8765-4321-0987-654321fedcba' AND status='active';
 IF v.id IS NULL THEN RAISE EXCEPTION 'Votação do Senado não foi criada';END IF;
 FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(v.eligible_member_ids) LOOP
  PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,'Aprovar');
 END LOOP;
 IF (SELECT status FROM public.bills WHERE id=b)<>'Aguardando sanção presidencial' THEN RAISE EXCEPTION 'Aprovação no Senado não encaminhou ao Executivo';END IF;
 PERFORM set_config('request.jwt.claim.sub',pres::text,true);PERFORM public.update_bill_status(b,'Sancionado');
 IF NOT EXISTS(SELECT 1 FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')it WHERE s.key='official_salaries' AND it->>'role'='Deputado' AND (it->>'amount')::numeric=new_amount AND it->>'legal_source_id'=b::text) THEN RAISE EXCEPTION 'Lei não alterou a fonte salarial';END IF;
 IF (SELECT status FROM public.law_effects WHERE id=e)<>'active' OR NOT EXISTS(SELECT 1 FROM public.dou_entries WHERE source_id=b) THEN RAISE EXCEPTION 'Efeito ou publicação oficial ausente';END IF;
 denied:=false;BEGIN PERFORM private.validate_legal_measure('policy',jsonb_build_object('kind','policy','action','change','rule_key','official_salary_'||md5('Deputado'),'value',1,'definition',jsonb_build_object('operation','official_salary','role','Deputado')),'decree');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Decreto recebeu competência para alterar salários';END IF;
 RAISE NOTICE 'PASS: proposta, Câmara, Senado, bloqueio de atalhos, sanção, efeito real, Diário Oficial';
END $test$;
ROLLBACK;`;
try {
  const variants = [sql, sql.replace("em exercício.');b:=", "em exercício.',clock_timestamp()+interval '1 day');b:=").replace("IF NOT EXISTS(SELECT 1 FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')it WHERE s.key='official_salaries' AND it->>'role'='Deputado' AND (it->>'amount')::numeric=new_amount", "IF (SELECT status FROM public.law_effects WHERE id=e)<>'scheduled' THEN RAISE EXCEPTION 'Vigência futura foi antecipada';END IF;\n IF EXISTS(SELECT 1 FROM public.system_settings st CROSS JOIN LATERAL jsonb_array_elements(st.value->'roles')it WHERE st.key='official_salaries' AND it->>'role'='Deputado' AND (it->>'amount')::numeric<>old) THEN RAISE EXCEPTION 'Lei futura alterou remuneração antes do prazo';END IF;\n UPDATE public.law_effects SET valid_from=clock_timestamp()-interval '1 second' WHERE id=e;PERFORM public.process_due_legal_effects();\n IF NOT EXISTS(SELECT 1 FROM public.system_settings s CROSS JOIN LATERAL jsonb_array_elements(s.value->'roles')it WHERE s.key='official_salaries' AND it->>'role'='Deputado' AND (it->>'amount')::numeric=new_amount")];
 for (const scenario of variants) {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: scenario, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /ROLLBACK/);
 }
 console.log('Tramitação salarial bicameral e vigência verificadas no QA.');
} catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
