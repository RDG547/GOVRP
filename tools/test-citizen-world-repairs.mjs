import assert from 'node:assert/strict';
import { actor, service, request, rpc, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
import { filterCompatibleParliamentMembers } from '../src/lib/roleResolution.js';
let checks = 0;
const check = (value, label) => { assert(value, label); checks++; console.log(`OK ${label}`); };
try {
 const citizen = await actor('repair-citizen');
 const second = await actor('repair-second');
 const president = await actor('repair-president','Presidente');
 const cert = await rpc(citizen.client,'issue_criminal_clearance_certificate');
 const repeated = await rpc(citizen.client,'issue_criminal_clearance_certificate');
 check(cert.id === repeated.id,'emissão concorrente/repetida retorna o mesmo atestado');
 await request(service.from('documents').update({issued_at:new Date(Date.now()-120000).toISOString()}).eq('id',cert.id));
 const renewed = await rpc(citizen.client,'issue_criminal_clearance_certificate');
 const original = await request(service.from('documents').select('is_valid').eq('id',cert.id).single());
 check(!original.is_valid && renewed.id !== cert.id,'reemissão preserva a versão histórica e mantém um documento válido');
 check(renewed.metadata.result === 'nothing_found','atestado sem condenação mostra nada consta');
 const post = await request(citizen.client.from('posts').insert({user_id:citizen.id,content:'Uma conversa pública para testar respostas.'}).select('*').single());
 const comment = await request(citizen.client.from('comments').insert({user_id:citizen.id,post_id:post.id,content:'Comentário original.'}).select('*').single());
 const reply = await request(second.client.from('comments').insert({user_id:second.id,post_id:post.id,parent_comment_id:comment.id,content:`@${citizen.handle} resposta com menção.`}).select('*').single());
 check((await request(service.from('comments').select('replies_count').eq('id',comment.id).single())).replies_count === 1,'resposta incrementa contador no servidor');
 const notices = await request(citizen.client.from('notifications').select('id').eq('metadata->>comment_id',reply.id));
 check(notices.length === 1,'autor respondido e mencionado recebe só uma notificação');
 await rpc(second.client,'create_repost',{p_post_id:post.id,p_quote_content:'Meu comentário original sobre esta publicação.'});
 const repost = await request(second.client.from('posts').select('*').eq('original_post_id',post.id).eq('user_id',second.id).single());
 await rpc(second.client,'update_post',{p_post_id:repost.id,p_new_content:'Meu comentário editado.'});
 const edited = await request(second.client.from('posts').select('*').eq('id',repost.id).single());
 check(edited.quote_content==='Meu comentário editado.' && edited.content==='repost','edição modifica apenas o comentário do repost');
 check((await request(citizen.client.from('posts').select('content').eq('id',post.id).single())).content===post.content,'texto original de terceiro permanece intacto');
 check((await citizen.client.rpc('update_post',{p_post_id:repost.id,p_new_content:'tentativa'})).error,'outro cidadão não edita repost alheio');
 const houses=await request(service.from('parliament_houses').select('id,name'));
 const chamber=houses.find(h=>/c.mara/i.test(h.name));
 const senate=houses.find(h=>h.id==='fedcba09-8765-4321-0987-654321fedcba') || houses.find(h=>h.id!==chamber.id);
 const voters=[];
 for(const [i,vote] of ['Aprovar','Rejeitar','Abster'].entries()) {
   const deputy=await actor(`repair-deputy-${i}`,'Deputado');
   const member=await rpc(deputy.client,'ensure_current_parliament_member',{p_house_id:chamber.id});
   voters.push({deputy,member,vote});
 }
 const voting=await request(service.from('parliament_votings').insert({house_id:chamber.id,title:'Votação teste de reparos',type:'bill',end_date:new Date(Date.now()+3600000).toISOString()}).select('*').single());
 const events=[];
 await subscribe(second.client.channel(`votes-${second.id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'parliament_voting_votes'},e=>events.push(e)));
 await new Promise(resolve => setTimeout(resolve, 1500));
 for(const {deputy,member,vote} of voters) {
  const result=await rpc(deputy.client,'cast_parliament_vote',{p_voting_id:voting.id,p_member_id:member.id,p_vote:vote});
  check(result.success,`voto ${vote} persiste na Casa correta`);
 }
 await waitFor(()=>events.filter(e=>e.new.voting_id===voting.id).length===3,'três votos em sessão distinta');
 check(true,'votos propagam em tempo real');
 const {deputy,member}=voters[0];
 check(filterCompatibleParliamentMembers([{...member,profile:{id:deputy.id,role:'Deputado',titles:[]}}],null,houses).length===1,'mandato manual aparece sem expor metadata privada do perfil');
 check((await deputy.client.rpc('cast_parliament_vote',{p_voting_id:voting.id,p_member_id:member.id,p_vote:'Aprovar'})).error,'voto repetido bloqueado');
 const foreign=await request(service.from('parliament_votings').insert({house_id:senate.id,title:'Votação do Senado',type:'bill',end_date:new Date(Date.now()+3600000).toISOString()}).select('*').single());
 check((await deputy.client.rpc('cast_parliament_vote',{p_voting_id:foreign.id,p_member_id:member.id,p_vote:'Aprovar'})).error,'deputado não vota no Senado');
 const key=`repair_fee_${crypto.randomUUID().replaceAll('-','')}`;
 await request(service.from('government_rules').insert({rule_key:key,rule_kind:'fee',description:'Tarifa de teste de ajuste executivo',numeric_value:3,definition:{basis:'transfer',nature:'fixed',payer:'buyer',audience:'all'},is_active:true}));
 try {
  const old=await request(service.from('government_rules').select('*').eq('rule_key',key).single());
  check((await citizen.client.rpc('adjust_existing_levy',{p_rule_key:key,p_value:4,p_expected_version:old.version})).error,'cidadão não altera tarifas');
  const result=await rpc(president.client,'adjust_existing_levy',{p_rule_key:key,p_value:4,p_expected_version:old.version});
  check(Number(result.numeric_value)===4 && result.version===old.version+1,'Presidente altera somente valor de tarifa vigente');
  const dou=await request(service.from('dou_entries').select('id').eq('source_id',result.source_id));
  check(dou.length===1,'ajuste executivo publica ato no Diário Oficial');
  check((await president.client.rpc('adjust_existing_levy',{p_rule_key:key,p_value:5,p_expected_version:old.version})).error,'edição com versão antiga é rejeitada');
 } finally { await request(service.from('government_rules').update({is_active:false}).eq('rule_key',key)); }
 console.log(`\n${checks} verificações reais dos reparos aprovadas.`);
} finally { await cleanup(); }
