import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { actor, local, service, request, rpc, cleanup } from './lib/world-test.mjs';
process.env.VITE_SUPABASE_URL=local.API_URL;process.env.VITE_SUPABASE_ANON_KEY=local.ANON_KEY;process.env.SUPABASE_SECRET_KEY=local.SECRET_KEY||local.SERVICE_ROLE_KEY;
const sql=input=>execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8'});
let checks=0;const check=(v,label)=>{assert(v,label);checks++;console.log(`✓ ${label}`);};
const invoke=async(handler,person,body)=>{const session=await person.client.auth.getSession();let payload;const response={statusCode:200,setHeader(){},end(text){payload=JSON.parse(text);}};await handler({method:'POST',headers:{authorization:`Bearer ${session.data.session.access_token}`},body},response);return {status:response.statusCode,...payload};};
const makeElection=async(label,vice=false)=>{const type=await request(service.from('election_types').insert({name:label+' Integração '+crypto.randomUUID(),requires_vice_candidate:vice,is_public_vote:false,voting_system:'majoritarian'}).select('id').single());return request(service.from('elections').insert({name:label+' '+crypto.randomUUID(),election_type_id:type.id,candidacy_start_date:new Date(Date.now()-7200000).toISOString(),candidacy_end_date:new Date(Date.now()+3600000).toISOString(),voting_start_date:new Date(Date.now()+7200000).toISOString(),voting_end_date:new Date(Date.now()+10800000).toISOString(),status:'Candidacy'}).select('*').single());};
const electionIds=[];
try {
 const [owner,member,outsider,candidate,vice,challenger,secondVice]=await Promise.all(['brand-founder','brand-member','brand-outsider','independent','independent-vice','conflict','conflict-vice'].map(label=>actor(label)));
 const sources=JSON.parse(readFileSync('public/fonts/brands/sources.json','utf8'));
 check(sources.length===500&&new Set(sources.map(f=>f.key)).size===500,'500 fontes reais únicas, além do padrão GOVRP');
 const families=new Set();for(const font of sources){families.add(font.family);for(const file of font.files)assert.equal(readFileSync('public/fonts/brands/'+file.file).subarray(0,4).toString(),'wOF2');assert(readFileSync('public/fonts/brands/'+font.key+'.license','utf8').length>100);assert.equal(await rpc(owner.client,'valid_brand_font',{p_key:font.key}),true);}
 check(families.size===500,'500 famílias reais com arquivos locais, licenças e allowlist no banco');
 check(!await rpc(owner.client,'valid_brand_font',{p_key:'url(javascript:alert(1))'}),'CSS arbitrário bloqueado pela biblioteca');
 const args={p_name:'Identidade '+owner.handle,p_acronym:owner.handle.slice(-5),p_ideology:'Institucional',p_logo_url:'https://example.invalid/logo.png',p_statute:'Estatuto permanente',p_description:'Teste integrado de identidade',p_orientation:'Centro',p_color:'#445566',p_font_key:'cinzel',p_header_url:'https://example.invalid/banner.png'};
 const party=await rpc(owner.client,'create_political_party',args);assert(party.success);
 let saved=await request(service.from('political_parties').select('*').eq('id',party.party_id).single());
 check(saved.customization.header_url===args.p_header_url&&saved.customization.font_key==='cinzel','criação atômica salva banner opcional, logo e fonte');
 const bad=await outsider.client.rpc('create_political_party',{...args,p_name:'Inválido '+outsider.handle,p_acronym:outsider.handle.slice(-5),p_header_url:'javascript:alert(1)'});
 check(Boolean(bad.error)&&!(await request(service.from('party_members').select('id').eq('user_id',outsider.id))).length,'banner inseguro reverte toda a criação');
 const noBanner=await rpc(outsider.client,'create_political_party',{...args,p_name:'Sem Banner '+outsider.handle,p_acronym:outsider.handle.slice(-5),p_header_url:''});check(noBanner.success,'fundação sem banner permanece permitida');
 const denied=await outsider.client.rpc('update_party_customization',{p_party_id:party.party_id,p_customization:{font_key:'anton'}});check(denied.error||denied.data?.success===false,'terceiro não personaliza partido alheio');
 const affiliation=await rpc(member.client,'request_party_affiliation',{p_party_id:party.party_id});assert(affiliation.success);
 const bill=await request(service.from('bills').insert({title:'Histórico imutável '+crypto.randomUUID(),summary:'Resumo de teste',full_text:'Texto completo preservado',author_id:owner.id,house_id:'a1b2c3d4-e5f6-7890-1234-567890abcdef',type:'PL',status:'Apresentado'}).select('*').single());
 await rpc(owner.client,'update_party_customization',{p_party_id:party.party_id,p_customization:{logo_url:'https://example.invalid/later.png',header_url:'',font_key:'lora',primary_color:'#AABBCC'}});
 const edit=await rpc(owner.client,'update_party_details',{p_party_id:party.party_id,p_name:saved.name,p_acronym:saved.acronym,p_ideology:'Nova ideologia',p_statute:saved.statute,p_owner_id:member.id,p_president_id:member.id,p_vice_president_id:null,p_description:saved.description,p_orientation:saved.orientation});assert(edit.success);
 saved=await request(service.from('political_parties').select('*').eq('id',party.party_id).single());
 check(saved.founder_id===owner.id&&saved.owner_id===member.id,'transferência muda o dono e mantém o fundador original');
 check(saved.logo_url.endsWith('later.png')&&saved.color==='#AABBCC'&&saved.customization.header_url===''&&saved.customization.font_key==='lora','edição institucional preserva personalização e remoção do banner');
 await request(service.from('party_members').delete().eq('party_id',party.party_id).eq('user_id',owner.id));
 await request(service.from('profiles').update({full_name:'Nome atualizado depois do protocolo'}).eq('id',owner.id));
 const historical=await request(service.from('bills').select('*').eq('id',bill.id).single());
 check(JSON.stringify(historical.author_party_snapshot)===JSON.stringify(bill.author_party_snapshot)&&JSON.stringify(historical.author_identity_snapshot)===JSON.stringify(bill.author_identity_snapshot),'nome, foto, cargo e partido históricos sobrevivem à desfiliação');
 check(Boolean((await service.from('political_parties').update({founder_id:member.id}).eq('id',party.party_id)).error),'fundador histórico não pode ser sobrescrito');
 check(Boolean((await service.from('bills').update({author_party_snapshot:{name:'Forjado'}}).eq('id',bill.id)).error),'snapshot parlamentar não pode ser adulterado');
 // Full API path: independent President -> invitation -> vice acceptance -> persisted ballot.
 const {submitPresidentialCandidacyHandler,respondViceCandidacyInvitationHandler}=await import('../server/elections/http.js');
 const e=await makeElection('Presidente',true);electionIds.push(e.id);
 const submission={electionId:e.id,viceCandidateId:vice.id,bio:'Biografia do cidadão independente.',proposals:'Propostas para o governo da nação.',campaignPhotoUrl:'https://example.invalid/candidate.png',electoralNumber:'47'};
 const missing=await invoke(submitPresidentialCandidacyHandler,candidate,{...submission,electoralNumber:''});check(missing.status===400,'API rejeita independente sem número');
 const submitted=await invoke(submitPresidentialCandidacyHandler,candidate,submission);assert.equal(submitted.status,200,JSON.stringify(submitted));
 const invitation=await request(service.from('notifications').select('id').eq('user_id',vice.id).eq('type','vice_candidacy_invitation').single());
 const accepted=await invoke(respondViceCandidacyInvitationHandler,vice,{notificationId:invitation.id,accepted:true});assert.equal(accepted.status,200,JSON.stringify(accepted));
 const ticket=await request(service.from('candidates').select('*').eq('election_id',e.id).single());
 check(ticket.party_id===null&&ticket.electoral_number==='47'&&ticket.identity_snapshot.name==='Teste independent'&&!ticket.identity_snapshot.party,'independente presidencial aceita número sem prefixo e guarda nome oficial sem partido');
 const conflict=await invoke(submitPresidentialCandidacyHandler,challenger,{...submission,viceCandidateId:secondVice.id});check(conflict.status===409&&conflict.error==='Este número já está sendo utilizado nesta eleição.','API explica conflito antes de enviar convite');
 await request(service.from('elections').update({candidacy_end_date:new Date(Date.now()-3600000).toISOString(),voting_start_date:new Date(Date.now()-1800000).toISOString(),status:'Voting'}).eq('id',e.id));
 await request(service.from('candidates').update({status:'Approved'}).eq('id',ticket.id));
 await request(service.from('profiles').update({titulo_eleitor:'QA-'+crypto.randomUUID()}).eq('id',challenger.id));
 const vote=await rpc(challenger.client,'cast_ballot',{p_election_id:e.id,p_number:'47',p_kind:'candidate'});
 check(vote.success&&(await request(service.from('votes').select('candidate_id').eq('election_id',e.id).eq('voter_id',challenger.id).single())).candidate_id===ticket.id,'urna grava voto real no independente pelo número 47');
 for(const [role,digits] of [['Senador',3],['Deputado',4]]) {
  const person=await actor('independent-'+digits),other=await actor('duplicate-'+digits);const election=await makeElection(role);electionIds.push(election.id);
  const data={p_election_id:election.id,p_party_id:null,p_vice_candidate_id:null,p_political_name:'Nome personalizado ignorado',p_bio:'Biografia',p_proposals:'Propostas',p_campaign_photo_url:'https://example.invalid/c.png',p_electoral_number:'4'.repeat(digits)};
  check(Boolean((await person.client.rpc('submit_candidacy',{...data,p_electoral_number:'4'})).error),'backend valida dígitos do cargo '+role);
  check((await rpc(person.client,'submit_candidacy',data)).success,'RPC registra independente para '+role);
  const clash=await other.client.rpc('submit_candidacy',data);check(clash.error?.message==='Este número já está sendo utilizado nesta eleição.','RPC explica duplicidade para '+role);
  check(Boolean((await other.client.rpc('submit_candidacy',{...data,p_party_id:party.party_id,p_electoral_number:'5'.repeat(digits)})).error),'RPC impede candidatura em partido alheio para '+role);
 }
 // Defensive permissions and legacy no-number entry point.
 check(sql("select has_function_privilege('authenticated','public.submit_candidacy(uuid,uuid,uuid,text,text,text,text)','execute');").trim()==='f','assinatura antiga sem número não fica acessível ao cidadão');
 console.log(`${checks} verificações reais de identidade e candidatura aprovadas.`);
} finally {for(const id of electionIds)await service.from('elections').update({status:'Finished',archived_at:new Date().toISOString()}).eq('id',id);await cleanup();}
