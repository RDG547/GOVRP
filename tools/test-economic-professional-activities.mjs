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
  const catalog=await rpc(person.client,'get_professional_activities',{p_business_id:b.id});
  check(catalog.catalog.length===3&&new Set(catalog.catalog.map(item=>item.execution_mode)).size===3&&catalog.used_today===1,`${family}: catálogo tem três modos e contador diário persistido`);
  const timed=await rpc(person.client,'start_professional_activity',{p_business_id:b.id,p_activity_key:'routine'});
  check(timed.execution_mode==='timed'&&timed.challenge.mode==='timed'&&timed.duration_seconds>=30,`${family}: próxima atividade inicia sem cooldown e usa duração do servidor`);
  check(Boolean((await person.client.rpc('finish_professional_activity',{p_session_id:timed.id,p_answer:[]})).error),`${family}: cronômetro não pode ser burlado pelo cliente`);
  sql(`update public.professional_work_sessions set started_at=now()-interval '120 seconds' where id='${timed.id}'`);
  const timedResult=await rpc(person.client,'finish_professional_activity',{p_session_id:timed.id,p_answer:[]});
  check(timedResult.score===100&&timedResult.experience_earned===20,`${family}: tarefa por tempo credita XP somente ao concluir`);
  const hybrid=await rpc(person.client,'start_professional_activity',{p_business_id:b.id,p_activity_key:'focus'});
  const draft=hybrid.challenge.mode==='order'?hybrid.challenge.options.map(item=>item.id):[hybrid.challenge.options[0].id];
  check(Boolean((await outsider.client.rpc('save_professional_activity_draft',{p_session_id:hybrid.id,p_answer:draft})).error),`${family}: terceiro não altera respostas salvas`);
  await rpc(person.client,'save_professional_activity_draft',{p_session_id:hybrid.id,p_answer:draft});
  const resumed=(await rpc(person.client,'get_professional_activities',{p_business_id:b.id})).active;
  check(resumed.id===hybrid.id&&resumed.started_at===hybrid.started_at&&JSON.stringify(resumed.draft_answer)===JSON.stringify(draft),`${family}: saída e retorno preservam resposta e início do cronômetro`);
  sql(`update public.professional_work_sessions set started_at=now()-interval '120 seconds' where id='${hybrid.id}'`);
  const hybridAnswer=JSON.parse(sql(`select answer from private.professional_work_answers where session_id='${hybrid.id}'`));
  await rpc(person.client,'finish_professional_activity',{p_session_id:hybrid.id,p_answer:hybridAnswer});
  for(let i=0;i<2;i++){
   const task=await rpc(person.client,'start_professional_activity',{p_business_id:b.id,p_activity_key:'routine'});
   sql(`update public.professional_work_sessions set started_at=now()-interval '120 seconds' where id='${task.id}'`);
   await rpc(person.client,'finish_professional_activity',{p_session_id:task.id,p_answer:[]});
  }
  check((await rpc(person.client,'get_professional_activities',{p_business_id:b.id})).used_today===5&&Boolean((await person.client.rpc('start_professional_activity',{p_business_id:b.id,p_activity_key:'routine'})).error),`${family}: servidor limita a cinco atividades por dia`);
  check((await request(service.from('citizen_professional_experience').select('*').eq('profile_id',person.id).single())).experience===100,`${family}: cinco conclusões geram exatamente 100 XP`);

 }
 check(Boolean((await outsider.client.from('professional_work_sessions').insert({user_id:outsider.id,score:100})).error),'cliente não grava desempenho diretamente');
 console.log(`\n${count} verificações de atividades profissionais aprovadas.`);
} finally { await cleanup(); }
