import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {actor,cleanup,ensureParliamentHouses} from './lib/world-test.mjs';
try{
 await ensureParliamentHouses();const deputies=await Promise.all(Array.from({length:12},(_,i)=>actor(`quorum-dep-${i}`)));const senators=await Promise.all(Array.from({length:6},(_,i)=>actor(`quorum-sen-${i}`)));
 const house='a1b2c3d4-e5f6-7890-1234-567890abcdef',senate='fedcba09-8765-4321-0987-654321fedcba';
 const ids=list=>list.map(x=>`'${x.id}'`).join(',');
 const output=execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{encoding:'utf8',input:`BEGIN;
 UPDATE public.parliament_leadership_terms SET status='completed',concluded_at=clock_timestamp() WHERE status='active';
 UPDATE public.parliament_members SET term_end_date=current_date-1;
 UPDATE public.profiles SET role='Deputado',manual_role_override=true WHERE id IN(${ids(deputies)});
 UPDATE public.profiles SET role='Senador',manual_role_override=true WHERE id IN(${ids(senators)});
 INSERT INTO public.parliament_leadership_terms(house_id,member_id,position,status,term_start_date,term_end_date) SELECT '${house}',id,'president','active',current_date,current_date+30 FROM public.parliament_members WHERE user_id='${deputies[0].id}' AND house_id='${house}' AND term_end_date>=current_date;
 DO $test$ DECLARE b public.bills%rowtype; v public.parliament_votings%rowtype; second public.parliament_votings%rowtype; m record; n int; all_members uuid[]; result jsonb;
 BEGIN
 INSERT INTO public.bills(title,summary,full_text,author_id,house_id,type,status) VALUES('PL com seis votos favoráveis e cinco contrários','Ementa para testar maioria simples','Art. 1º. Projeto legislativo de teste integrado.','${deputies[1].id}','${house}','PL','Em tramitação') RETURNING * INTO b;
 PERFORM set_config('request.jwt.claim.sub','${deputies[0].id}',true);v:=public.start_parliament_bill_voting(b.id,'${house}',b.title);
 IF cardinality(v.eligible_member_ids)<>11 OR (v.rule_snapshot->>'house_members')::int<>12 THEN RAISE EXCEPTION 'Eleitorado ordinário ou composição incorretos';END IF;
 n:=0;FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(v.eligible_member_ids) ORDER BY id LOOP
  n:=n+1;PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,CASE WHEN n<=6 THEN 'Aprovar' ELSE 'Rejeitar' END);
 END LOOP;
 IF NOT (SELECT (pv.result->>'approved')::boolean FROM public.parliament_votings pv WHERE pv.id=v.id) THEN RAISE EXCEPTION 'PL de 6 a 5 não foi aprovado';END IF;
 RAISE NOTICE 'PL 6 × 5 aprovado com presença suficiente; Presidência fora do voto ordinário.';
 UPDATE public.parliament_members SET term_end_date=current_date-1 WHERE user_id IN('${deputies[10].id}','${deputies[11].id}') AND house_id='${house}';
 INSERT INTO public.bills(title,summary,full_text,author_id,house_id,type,status) VALUES('PEC exige sete entre dez integrantes','Ementa para testar arredondamento constitucional','Art. 1º. Proposta constitucional de teste.','${deputies[1].id}','${house}','PEC','Em tramitação') RETURNING * INTO b;
 PERFORM set_config('request.jwt.claim.sub','${deputies[0].id}',true);v:=public.start_parliament_bill_voting(b.id,'${house}',b.title);
 IF cardinality(v.eligible_member_ids)<>10 OR (v.rule_snapshot->>'house_members')::int<>10 THEN RAISE EXCEPTION 'Presidência excluída do quórum constitucional';END IF;
 all_members:=v.eligible_member_ids;
 n:=0;FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(all_members) ORDER BY id LOOP
  n:=n+1;PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,CASE WHEN n<=6 THEN 'Aprovar' WHEN n<=8 THEN 'Rejeitar' ELSE 'Abster' END);
 END LOOP;
 SELECT pv.result INTO result FROM public.parliament_votings pv WHERE pv.id=v.id;
 IF (result->>'approved')::boolean OR (result->>'required')::int<>7 THEN RAISE EXCEPTION 'PEC com seis entre dez foi aprovada ou arredondamento incorreto: %',result;END IF;
 RAISE NOTICE 'PEC 6/10 rejeitada; abstenções não são votos favoráveis e exigência é sete.';
 INSERT INTO public.bills(title,summary,full_text,author_id,house_id,type,status) VALUES('PEC bicameral com quórum integral','Ementa para testar aprovação nas duas Casas','Art. 1º. Proposta constitucional de teste bicameral.','${deputies[1].id}','${house}','PEC','Em tramitação') RETURNING * INTO b;
 PERFORM set_config('request.jwt.claim.sub','${deputies[0].id}',true);v:=public.start_parliament_bill_voting(b.id,'${house}',b.title);
 n:=0;FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(v.eligible_member_ids) ORDER BY id LOOP
  n:=n+1;PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,CASE WHEN n<=7 THEN 'Aprovar' ELSE 'Abster' END);
 END LOOP;
 SELECT * INTO second FROM public.parliament_votings WHERE related_id=b.id AND house_id='${senate}' ORDER BY created_at DESC LIMIT 1;
 IF second.id IS NULL OR (SELECT status FROM public.bills WHERE id=b.id)<>'Em votação (2ª Casa)' THEN RAISE EXCEPTION 'Primeira Casa encerrou PEC sem tramitação bicameral';END IF;
 n:=0;FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(second.eligible_member_ids) ORDER BY id LOOP
  n:=n+1;PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(second.id,m.id,CASE WHEN n<=4 THEN 'Aprovar' ELSE 'Rejeitar' END);
 END LOOP;
 IF (SELECT status FROM public.bills WHERE id=b.id)<>'Aguardando promulgação presidencial' OR (SELECT (pv.result->>'required')::int FROM public.parliament_votings pv WHERE pv.id=second.id)<>4 THEN RAISE EXCEPTION 'PEC não foi aprovada nas duas Casas com exigências próprias';END IF;
 RAISE NOTICE 'PEC aprovada com 7/10 e 4/6; a primeira Casa não equivale à aprovação final.';
 INSERT INTO public.bills(title,summary,full_text,author_id,house_id,type,status) VALUES('PEC mantém denominador após saída de membro','Ementa de teste para composição histórica','Art. 1º. Teste de estabilidade do quórum constitucional.','${deputies[1].id}','${house}','PEC','Em tramitação') RETURNING * INTO b;
 PERFORM set_config('request.jwt.claim.sub','${deputies[0].id}',true);v:=public.start_parliament_bill_voting(b.id,'${house}',b.title);
 UPDATE public.parliament_members SET term_end_date=current_date-1 WHERE id=v.eligible_member_ids[10];
 n:=0;FOR m IN SELECT * FROM public.parliament_members WHERE id=ANY(v.eligible_member_ids) AND term_end_date>=current_date ORDER BY id LOOP
  n:=n+1;PERFORM set_config('request.jwt.claim.sub',m.user_id::text,true);PERFORM public.cast_parliament_vote(v.id,m.id,CASE WHEN n<=6 THEN 'Aprovar' ELSE 'Rejeitar' END);
 END LOOP;
 UPDATE public.parliament_votings SET end_date=clock_timestamp()-interval '1 second' WHERE id=v.id;
 result:=private.finalize_bill_voting(v.id);
 IF (result->>'approved')::boolean OR (SELECT (pv.result->>'required')::int FROM public.parliament_votings pv WHERE pv.id=v.id)<>7 THEN RAISE EXCEPTION 'Saída de membro reduziu indevidamente o denominador constitucional';END IF;
 RAISE NOTICE 'Saída posterior de parlamentar preserva composição e quórum registrados na abertura.';
 END $test$;
 ROLLBACK;`});
 assert(output.includes('ROLLBACK'));console.log('✓ PL 6×5, PEC 7/10, Senado 4/6, abstenções, Presidência e saída posterior verificados no PostgreSQL real.');
}finally{await cleanup();}
