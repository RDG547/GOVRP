import assert from 'node:assert/strict';
import process from 'node:process';
import {execFileSync} from 'node:child_process';
const container=process.env.GOVRP_QA_DB_CONTAINER||'supabase_db_GOVRP_RESET_QA';assert.match(container,/^supabase_db_[A-Z0-9_]*QA[A-Z0-9_]*$/);
const query=`BEGIN;
DO $test$ DECLARE actor uuid:=gen_random_uuid();request uuid;BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,'qa-plan-'||actor||'@example.invalid');
 INSERT INTO private.rp_reset_requests(requested_by,scope,user_ids,reason,preview) VALUES(actor,'full_rp','{}'::uuid[],'Verificação de planejamento; nenhuma etapa será executada.','{}') RETURNING id INTO request;
 PERFORM private.plan_controlled_reset(request);
 IF (SELECT count(*) FROM private.reset_catalog() WHERE table_name IN('institutional_terms','judicial_electoral_assignments','police_occurrence_reporters','justice_evidence_uploads') AND strategy='clear' AND backup)<>4 THEN RAISE EXCEPTION 'Catálogo incompleto';END IF;
 IF (SELECT count(*) FROM private.rp_reset_steps WHERE request_id=request AND phase='clearing' AND table_name IN('institutional_terms','judicial_electoral_assignments','police_occurrence_reporters','justice_evidence_uploads'))<>4 THEN RAISE EXCEPTION 'Plano não cobre novos registros';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid IN('public.user_inventory'::regclass,'public.product_ownership_history'::regclass) AND k.contype='f' AND k.conname LIKE '%business_id%' AND private.reset_fk_detachable(k.oid)) THEN RAISE EXCEPTION 'Reset anularia o proprietário obrigatório do inventário';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid='public.institutional_terms'::regclass AND k.confrelid='public.profiles'::regclass AND k.contype='f' AND NOT EXISTS(SELECT 1 FROM private.rp_reset_steps WHERE request_id=request AND phase='clearing' AND table_name='institutional_terms')) THEN RAISE EXCEPTION 'Mandato bloquearia preservação de cidadãos';END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgname='world_generation_barrier' AND tgrelid IN('public.institutional_terms'::regclass,'public.judicial_electoral_assignments'::regclass,'private.police_occurrence_reporters'::regclass,'private.justice_evidence_uploads'::regclass))<>4 THEN RAISE EXCEPTION 'Falta barreira de manutenção';END IF;
 IF position('justice-evidence' in pg_get_functiondef('public.admin_process_reset_batch(uuid,text,uuid)'::regprocedure))=0 THEN RAISE EXCEPTION 'Anexos ausentes do catálogo de arquivos';END IF;
END $test$;ROLLBACK;`;
const output=execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']});assert.match(output,/ROLLBACK/);console.log('PASS: planejamento do reset, inventários, catálogo de anexos e barreiras compatíveis; nenhum reset executado.');
