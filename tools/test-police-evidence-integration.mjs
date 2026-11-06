import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateEvidence, EVIDENCE_LIMIT } from '../server/justice/evidence.js';
const container = process.env.GOVRP_QA_DB_CONTAINER || 'supabase_db_GOVRP_RESET_QA';
assert.match(container, /^supabase_db_[A-Z0-9_]*QA[A-Z0-9_]*$/);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=', 'base64');
assert.equal((await validateEvidence(png, 'prova.png', 'image/png')).mime, 'image/png');
assert.equal((await validateEvidence(Buffer.from('Relato de fatos verificáveis.'), 'relato.txt', 'text/plain')).mime, 'text/plain');
for (const [body, name, mime] of [[png, 'disfarce.pdf', 'application/pdf'], [Buffer.from('<script>alert(1)</script>'), 'script.txt', 'text/plain'], [Buffer.from('MZexecutavel'), 'arquivo.exe', 'application/octet-stream'], [Buffer.alloc(EVIDENCE_LIMIT + 1), 'grande.png', 'image/png']]) {
  await assert.rejects(validateEvidence(body, name, mime), error => [413, 415].includes(error.statusCode));
}
const sql = `BEGIN;
CREATE TEMP TABLE police_test_people(id uuid PRIMARY KEY,kind text);GRANT SELECT ON police_test_people TO authenticated;
DO $fixtures$ DECLARE person uuid;k text;n int;BEGIN
 FOR n IN 1..3 LOOP
  person:=gen_random_uuid();k:=CASE n WHEN 1 THEN 'reporter' WHEN 2 THEN 'officer' ELSE 'outsider' END;
  INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data) VALUES(person,'qa-police-'||person||'@govrp.local','{"provider":"email","providers":["email"]}','{}');
  UPDATE public.profiles SET full_name='Teste BO '||k,username='qb'||left(replace(person::text,'-',''),12),character_gender='male',onboarding_completed=true,onboarding_step='completed',role=CASE WHEN n=2 THEN 'Diretor-Geral de Polícia' ELSE 'Cidadão' END WHERE id=person;
  INSERT INTO police_test_people VALUES(person,k);
 END LOOP;
END $fixtures$;
DO $test$ DECLARE reporter uuid;officer uuid;outsider uuid;u uuid:=gen_random_uuid();o public.police_occurrences%rowtype;identified public.police_occurrences%rowtype;r jsonb;e uuid;denied boolean;record_id uuid;BEGIN
 SELECT id INTO reporter FROM police_test_people WHERE kind='reporter';SELECT id INTO officer FROM police_test_people WHERE kind='officer';SELECT id INTO outsider FROM police_test_people WHERE kind='outsider';
 PERFORM public.register_police_evidence_upload(u,reporter,u::text||'/prova.png','prova.png','image/png',100,repeat('a',64));
 PERFORM set_config('request.jwt.claim.sub',reporter::text,true);
 o:=public.create_police_occurrence('Relato anônimo de teste','Descrição suficientemente detalhada dos fatos para o boletim.','Outro','Local RP',now(),true,'urgent',jsonb_build_array(jsonb_build_object('profile_id',outsider,'name','Nome adulterado','kind','suspect')),'[]',jsonb_build_array(jsonb_build_object('upload_id',u)));
 IF o.reported_by IS NOT NULL OR o.user_id IS NOT NULL THEN RAISE EXCEPTION 'Identidade vazou no BO anônimo';END IF;
 IF o.involved_people->0->>'name'<>'Teste BO outsider' THEN RAISE EXCEPTION 'Snapshot de cidadão foi controlado pelo cliente';END IF;
 IF EXISTS(SELECT 1 FROM public.justice_audit_log WHERE entity_id=o.id AND (actor_id IS NOT NULL OR actor_role IS NOT NULL OR ip_hash IS NOT NULL)) THEN RAISE EXCEPTION 'Identidade anônima vazou na auditoria';END IF;
 r:=public.get_my_police_occurrences_page();
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'items')it WHERE it->>'id'=o.id::text) THEN RAISE EXCEPTION 'Autor perdeu acompanhamento anônimo';END IF;
 e:=(o.evidence->0->>'evidence_id')::uuid;
 IF (SELECT submitted_by FROM public.case_evidence WHERE id=e) IS NOT NULL THEN RAISE EXCEPTION 'Prova revelou denunciante';END IF;
 r:=public.get_police_evidence_file(e);IF r->>'name'<>'Anexo 1.png' THEN RAISE EXCEPTION 'Autor não acessa seu anexo';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);denied:=false;
 BEGIN PERFORM public.get_police_evidence_file(e);
 UPDATE public.police_occurrences SET status='Em análise',triage_notes='Nota interna que não pode chegar ao denunciante.' WHERE id=o.id;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=reporter AND type='justice_occurrence_updated' AND metadata->>'occurrence_id'=o.id::text) THEN RAISE EXCEPTION 'Autor anônimo não recebeu atualização privada do BO';END IF;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Terceiro acessou arquivo privado';END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.case_evidence WHERE id=e) THEN RAISE EXCEPTION 'RLS expôs prova a terceiro';END IF;
 EXECUTE 'RESET ROLE';
 IF has_table_privilege('authenticated','private.justice_evidence_uploads','SELECT') OR has_table_privilege('authenticated','private.police_occurrence_reporters','SELECT') THEN RAISE EXCEPTION 'Identidades privadas expostas';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',officer::text,true);
 IF public.get_occurrence_reporter(o.id) IS NOT NULL THEN RAISE EXCEPTION 'Diretor recebeu identidade anônima';END IF;
 PERFORM public.get_police_evidence_file(e);
 UPDATE public.police_occurrences SET status='Em análise',triage_notes='Nota interna que não pode chegar ao denunciante.' WHERE id=o.id;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=reporter AND type='justice_occurrence_updated' AND metadata->>'occurrence_id'=o.id::text) THEN RAISE EXCEPTION 'Autor anônimo não recebeu atualização privada do BO';END IF;
 IF NOT public.justice_has_role(ARRAY['Delegado']) THEN RAISE EXCEPTION 'Diretor perdeu competência de investigação';END IF;
 PERFORM set_config('request.jwt.claim.sub',reporter::text,true);
 identified:=public.create_police_occurrence('Boletim identificado','Descrição detalhada e identificada dos fatos para a Polícia.','Outro',NULL,now(),false,'low');
 PERFORM set_config('request.jwt.claim.sub',officer::text,true);
 IF public.get_occurrence_reporter(identified.id)->>'id'<>reporter::text THEN RAISE EXCEPTION 'Comunicante identificado não foi exibido';END IF;
 PERFORM set_config('request.jwt.claim.sub',reporter::text,true);
 IF (public.issue_criminal_clearance_certificate()).metadata->>'result'<>'nothing_found' THEN RAISE EXCEPTION 'BO sem condenação gerou antecedente';END IF;
 INSERT INTO public.criminal_records(user_id,crime,sentence_details,judge_id,is_active,record_status) VALUES(reporter,'Crime de teste','Registro fictício para validar atualização do atestado.',officer,true,'conviction') RETURNING id INTO record_id;
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE user_id=reporter AND type='Atestado de Antecedentes' AND is_valid AND metadata->>'result'='positive' AND jsonb_array_length(metadata->'records')=1) THEN RAISE EXCEPTION 'Condenação não atualizou o atestado persistido';END IF;
 UPDATE public.criminal_records SET record_status='annulled',is_active=false WHERE id=record_id;
 IF EXISTS(SELECT 1 FROM public.documents WHERE user_id=reporter AND type='Atestado de Antecedentes' AND is_valid AND metadata->>'result'<>'nothing_found') THEN RAISE EXCEPTION 'Anulação manteve antecedente no DIC';END IF;
 RAISE NOTICE 'PASS: anonimato, autoria privada, seleção estruturada, anexos, controle de acesso, hierarquia e atestado';
END $test$;
ROLLBACK;`;
try {
  const output = execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(output, /ROLLBACK/); console.log('BO, privacidade e validação real de arquivos: integração aprovada no QA.');
} catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
