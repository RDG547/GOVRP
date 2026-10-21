import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {actor,service,request,rpc,cleanup} from './lib/world-test.mjs';
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'});
try{
 const [person,president,vice,employer]=await Promise.all([actor('charges-docs'),actor('work-pres','Presidente'),actor('work-vice','Vice-Presidente'),actor('work-employer')]);
 const account=await request(service.from('accounts').insert({user_id:person.id,account_number:crypto.randomUUID(),balance:10000}).select('*').single());
 const card=await request(service.from('cards').insert({user_id:person.id,account_id:account.id,brand:'visa',type:'credit',card_type:'credit',card_number:'4'+String(Math.floor(Math.random()*1e15)).padStart(15,'0'),card_holder_name:'Juros registrados',cvv:'123',expiry_date:'12/30',card_limit:10000}).select('*').single());
 const invoice=await request(service.from('card_invoices').insert({user_id:person.id,card_id:card.id,closing_date:'2026-10-01',due_date:'2026-10-10',amount:0}).select('*').single());await request(service.from('card_invoice_items').insert({invoice_id:invoice.id,description:'Compra documentada',amount:1000}));
 await rpc(service,'close_due_invoices');await rpc(service,'close_due_invoices');
 const items=await rpc(person.client,'get_invoice_items',{p_invoice_id:invoice.id}),charge=items.find(i=>i.charge_type==='financing_interest');
 assert(charge&&charge.entry_kind==='interest'&&charge.base_amount===1000&&charge.rate_snapshot>0&&charge.charge_rule_snapshot.policy_key==='credit_card_revolving_rate');assert.equal(items.filter(i=>i.charge_type==='financing_interest').length,1);
 let row=await request(service.from('card_invoices').select('*').eq('id',invoice.id).single());assert.equal(row.amount,1000+charge.amount);assert.equal(row.interest_amount,charge.amount);
 sql(`select private.reconcile_card_history('${card.id}');select private.reconcile_card_history('${card.id}');`);row=await request(service.from('card_invoices').select('*').eq('id',invoice.id).single());assert.equal(row.amount,1000+charge.amount);
 const paid=await rpc(person.client,'pay_card_invoice',{p_invoice_id:invoice.id,p_pay_full:true,p_amount_to_pay:row.amount,p_idempotency_key:crypto.randomUUID()});assert(paid.success);await rpc(service,'close_due_invoices');row=await request(service.from('card_invoices').select('*').eq('id',invoice.id).single());assert.equal(row.amount,0);assert.equal(row.status,'paid');assert.equal((await rpc(person.client,'get_invoice_items',{p_invoice_id:invoice.id})).find(i=>i.id===charge.id).rate_snapshot,charge.rate_snapshot);
 console.log('✓ Juros aparecem como lançamento com data, taxa, base e regra; fechamento e conciliação repetidos não duplicam; quitação preserva o histórico e não gera dívida nova.');
 const pdoc=await request(service.from('documents').insert({user_id:president.id,type:'CTD',document_number:crypto.randomUUID(),metadata:{}}).select('*').single()),vdoc=await request(service.from('documents').insert({user_id:vice.id,type:'CTD',document_number:crypto.randomUUID(),metadata:{}}).select('*').single());
 const election=(await request(service.from('elections').select('id').limit(1)))[0];assert(election,'Teste institucional exige calendário local já migrado.');
 const result=sql(`BEGIN;
 INSERT INTO public.election_office_assignments(election_id,profile_id,office_role,votes_received,term_starts_at,term_ends_at,status) VALUES('${election.id}','${president.id}','Presidente',10,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','active'),('${election.id}','${vice.id}','Vice-Presidente',10,clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','active');
 DO $test$ DECLARE d jsonb; BEGIN
 SELECT metadata INTO d FROM public.documents WHERE id='${pdoc.id}';
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'institutional_appointments') value WHERE value->>'role'='Presidente da República' AND value->>'type'='Mandato Eletivo' AND (value->>'active')::boolean) THEN RAISE EXCEPTION 'Presidente sem mandato na CTD'; END IF;
 SELECT metadata INTO d FROM public.documents WHERE id='${vdoc.id}';
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'institutional_appointments') value WHERE value->>'role'='Vice-Presidente da República' AND value->>'type'='Mandato Eletivo' AND (value->>'active')::boolean) THEN RAISE EXCEPTION 'Vice sem mandato na CTD'; END IF;
 END $test$;
 UPDATE public.election_office_assignments SET status='expired',ended_at=clock_timestamp() WHERE profile_id IN('${president.id}','${vice.id}');
 UPDATE public.profiles SET role='Cidadão',role_assigned_at=clock_timestamp() WHERE id IN('${president.id}','${vice.id}');
 DO $test$ DECLARE d jsonb; BEGIN SELECT metadata INTO d FROM public.documents WHERE id='${pdoc.id}';IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d->'institutional_appointments') value WHERE value->>'role'='Presidente da República' AND NOT (value->>'active')::boolean AND value->>'ended_at' IS NOT NULL) THEN RAISE EXCEPTION 'Mandato encerrado perdeu histórico'; END IF; END $test$;
 ROLLBACK;`);assert(result.includes('ROLLBACK'));
 const company=await request(service.from('businesses').insert({owner_id:employer.id,business_type_id:'software',name:'Contratos e remuneração '+crypto.randomUUID().slice(0,8),status:'active',region_code:'SP'}).select('*').single());const doc=await request(service.from('documents').insert({user_id:person.id,type:'CTD',document_number:crypto.randomUUID(),metadata:{}}).select('*').single());
 await request(service.from('business_employees').insert({business_id:company.id,profile_id:person.id,name:'Pessoa trabalhadora',role:'Desenvolvimento',role_template_id:'software:1',salary:350,is_npc:false}));const employment=(await request(service.from('documents').select('metadata').eq('id',doc.id).single())).metadata.employment_contracts[0];assert.equal(employment.salary,350);assert.equal(employment.company,company.name);
 console.log('✓ Presidente/Vice usam mandato eletivo real, encerramento preserva histórico e emprego empresarial continua exibindo salário e contratação.');
}finally{await cleanup();}
