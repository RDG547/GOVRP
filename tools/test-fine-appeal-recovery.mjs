import assert from 'node:assert/strict';
import {actor,service,request,rpc,cleanup} from './lib/world-test.mjs';
let checks=0;const check=(v,l)=>{assert(v,l);checks++;console.log('✓ '+l);};
try {
 const [citizen,police,judge]=await Promise.all([actor('fine-citizen'),actor('fine-police','Delegado'),actor('fine-judge','Juiz')]);
 await request(service.from('accounts').upsert({user_id:citizen.id,account_number:crypto.randomUUID().slice(0,12),agency_number:'0001',balance:1000},{onConflict:'user_id'}));
 const issued=await rpc(police.client,'issue_fine',{p_user_id:citizen.id,p_reason:'Infração para verificar recurso rejeitado e pagamento.',p_amount:100,p_due_date:new Date(Date.now()+86400000).toISOString()});assert(issued.success);
 const appeal=await rpc(citizen.client,'appeal_fine',{p_fine_id:issued.fine.id,p_reason:'Contestação fundamentada para análise da multa emitida.'});assert(appeal.success);
 await rpc(judge.client,'decide_fine_appeal',{p_appeal_id:appeal.appeal.id,p_approved:false,p_reason:'Mantida a infração após análise do recurso e dos documentos.'});
 check((await request(service.from('police_fines').select('status').eq('id',issued.fine.id).single())).status==='Pendente','recurso rejeitado devolve multa à condição de pagamento');
 check(!(await rpc(citizen.client,'appeal_fine',{p_fine_id:issued.fine.id,p_reason:'Tentativa de repetir um recurso já analisado.'})).success,'recurso analisado não pode ser reapresentado');
 const args={p_fine_id:issued.fine.id,p_reason:'Solicitação de audiência após decisão administrativa fundamentada.',p_preferred_times:[]};
 const [h1,h2]=await Promise.all([rpc(citizen.client,'request_fine_hearing',args),rpc(citizen.client,'request_fine_hearing',args)]);check(h1.id===h2.id,'pedido concorrente de audiência não duplica');
 const paid=await rpc(citizen.client,'pay_fine',{p_fine_id:issued.fine.id});check(paid.success,'multa pode ser paga depois de recurso rejeitado');
 await rpc(citizen.client,'pay_fine',{p_fine_id:issued.fine.id});check((await request(service.from('accounts').select('balance').eq('user_id',citizen.id).single())).balance===900,'repetição do pagamento não debita novamente');
 check(Boolean((await citizen.client.rpc('request_fine_hearing',args)).error),'multa paga não abre nova audiência');
 console.log(`\n${checks} verificações de multas e recursos aprovadas.`);
} finally {await cleanup();}
