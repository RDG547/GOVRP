import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, service, request, rpc, cleanup } from './lib/world-test.mjs';
const sql = query => execFileSync('docker', ['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query], {encoding:'utf8'}).trim();
let count=0;
const check=(result,label)=>{assert(result,label);count++;console.log(`✓ ${label}`);};
try {
 const owner=await actor('games-owner','Cidadão'), outsider=await actor('games-outsider','Cidadão');
 for(const family of ['technology','food','transport','quality','sales','logistics','health','finance']) {
  const person=await actor(`games-${family}`,'Cidadão');
  const role=(await request(service.from('business_role_templates').select('*').eq('game_family',family).limit(1)))[0];assert(role, family);
  const b=await request(service.from('businesses').insert({owner_id:owner.id,business_type_id:role.business_type_id,name:`Atividades ${family}`,status:'active',region_code:'SP'}).select('*').single());
  await request(service.from('business_employees').insert({business_id:b.id,profile_id:person.id,name:'Participante',role:role.name,role_template_id:role.id,skill_area:role.skill_area,salary:role.base_weekly_salary,is_npc:false}));
  const session=await rpc(person.client,'start_professional_activity',{p_business_id:b.id});
  check(session.game_family===family && !('answer' in session.challenge),`${family}: função determina tarefa sem revelar resposta`);
  const again=await rpc(person.client,'start_professional_activity',{p_business_id:b.id});check(again.id===session.id,`${family}: retomada preserva atividade em andamento`);
  check(Boolean((await person.client.rpc('finish_professional_activity',{p_session_id:session.id,p_answer:[]})).error),`${family}: execução instantânea é bloqueada`);
  sql(`update public.professional_work_sessions set started_at=now()-interval '11 seconds' where id='${session.id}'`);
  const correct=JSON.parse(sql(`select answer from private.professional_work_answers where session_id='${session.id}'`));
  const answer=session.challenge.mode==='single'?[correct[0]]:correct;
  check(Boolean((await outsider.client.rpc('finish_professional_activity',{p_session_id:session.id,p_answer:answer})).error),`${family}: terceiro não conclui sessão alheia`);
  check(Boolean((await person.client.rpc('finish_professional_activity',{p_session_id:session.id,p_answer:['resposta-forjada']})).error),`${family}: servidor rejeita opção inexistente`);
  const finished=await rpc(person.client,'finish_professional_activity',{p_session_id:session.id,p_answer:answer});
  check(finished.score===100&&finished.experience_earned===20,`${family}: servidor calcula desempenho e experiência`);
  await rpc(person.client,'finish_professional_activity',{p_session_id:session.id,p_answer:[]});
  const xp=await request(service.from('citizen_professional_experience').select('*').eq('profile_id',person.id).single());check(xp.experience===20,`${family}: repetição não duplica experiência`);
  check(Number(sql(`select boost from private.business_daily_effort where business_id='${b.id}' and effort_date=current_date+1`))===.04,`${family}: contribuição melhora a próxima produção diária`);
  check((await request(outsider.client.from('professional_work_sessions').select('id').eq('id',session.id))).length===0,`${family}: RLS preserva sessão privada`);
 }
 check(Boolean((await outsider.client.from('professional_work_sessions').insert({user_id:outsider.id,score:100})).error),'cliente não grava desempenho diretamente');
 console.log(`\n${count} verificações de atividades profissionais aprovadas.`);
} finally { await cleanup(); }
