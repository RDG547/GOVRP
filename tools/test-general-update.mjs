import assert from 'node:assert/strict';
import process from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const directory=process.env.GOVRP_QA_DIRECTORY;
assert.ok(directory,'Informe GOVRP_QA_DIRECTORY do ambiente isolado.');
const env=JSON.parse(readFileSync(`${directory}/qa-credentials.json`));
assert.equal(env.API_URL,'http://127.0.0.1:54431','Esta suíte só executa no QA local.');
const sql=query=>execFileSync('docker',['exec','-i','supabase_db_GOVRP_RESET_QA','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',maxBuffer:4*1024*1024}).trim();
const checked=async promise=>{const result=await promise;if(result.error)throw Error(result.error.message);return result.data;};
const service=createClient(env.API_URL,env.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let count=0;const check=(condition,label)=>{assert.ok(condition,label);count++;console.log(`PASS: ${label}`);};
const people=[];
for(const [name,role] of [['Titular','Cidadão'],['Terceiro','Cidadão'],['Analista','Presidente do Banco Nacional'],['Administrador','Admin']]){
 const email=`general-${randomUUID()}@example.invalid`,password=`GOVRP!${randomUUID()}Aa1`;
 const {user}=await checked(service.auth.admin.createUser({email,password,email_confirm:true}));
 sql(`UPDATE auth.users SET created_at=now()-interval '3 days',email_confirmed_at=now()-interval '2 days' WHERE id='${user.id}';UPDATE public.profiles SET full_name='QA ${name}',username='qa${user.id.replaceAll('-','').slice(0,12)}',character_gender='male',onboarding_completed=true,onboarding_step='completed',tutorial_dont_show_again=true,role='${role}' WHERE id='${user.id}';INSERT INTO public.accounts(user_id,account_kind,account_number,balance,currency_balances) VALUES('${user.id}','personal','QA-${user.id}',10000,'{"USD":100,"JPY":1000}');`);
 const db=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {session}=await checked(db.auth.signInWithPassword({email,password}));people.push({id:user.id,email,password,db,session});
}
const [owner,other,manager,admin]=people;
const card=await checked(service.from('cards').insert({user_id:owner.id,account_id:sql(`SELECT id FROM public.accounts WHERE user_id='${owner.id}' AND account_kind='personal'`),card_number:`4${Date.now()}12`,card_holder_name:'QA TITULAR',expiry_date:'12/30',cvv:'123',type:'credit',card_type:'credit',brand:'visa',card_limit:1000,used_limit:0}).select('*').single());
const request={p_card_id:card.id,p_requested_limit:2000,p_justification:'Pedido fundamentado de aumento de limite para validação.'};
check(Boolean((await owner.db.from('cards').update({card_limit:9000000}).eq('id',card.id)).error),'titular não altera o próprio limite por escrita direta');
check(Boolean((await owner.db.rpc('set_bank_card_limit',{p_card_id:card.id,p_new_limit:9000000})).error),'cidadão não executa ajuste institucional de limite por RPC');
const requests=await Promise.all(Array.from({length:6},()=>checked(owner.db.rpc('request_card_limit_increase',request))));
check(new Set(requests.map(item=>item.application_id)).size===1,'pedidos concorrentes do mesmo aumento geram uma única pendência');
const application=requests[0].application_id;
check(Boolean((await other.db.rpc('request_card_limit_increase',request)).error),'terceiro não solicita aumento para cartão alheio');
check(Boolean((await owner.db.rpc('request_card_limit_increase',{...request,p_requested_limit:1000})).error),'limite solicitado deve superar o atual');
check(Boolean((await owner.db.rpc('request_card_limit_increase',{...request,p_requested_limit:3000})).error),'pedidos conflitantes ficam bloqueados');
check(Boolean((await owner.db.from('credit_card_applications').insert({user_id:owner.id,brand:'visa',status:'Pendente',requested_limit:9000000})).error),'escrita direta na fila financeira é negada');
await checked(manager.db.rpc('approve_credit_card_application',{p_application_id:application,p_card_limit:1800,p_brand:'visa'}));
await checked(manager.db.rpc('approve_credit_card_application',{p_application_id:application,p_card_limit:1800,p_brand:'visa'}));
check(Number(sql(`SELECT card_limit FROM public.cards WHERE id='${card.id}'`))===1800,'aprovação aplica o limite ao mesmo cartão');
check(Number(sql(`SELECT count(*) FROM public.cards WHERE user_id='${owner.id}'`))===1,'aprovação de aumento não emite outro cartão');
check(Number(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${owner.id}' AND type='bank_card_limit_changed' AND metadata->>'card_id'='${card.id}'`))===1,'reprocessamento não duplica aviso de mudança de limite');
await checked(service.from('cards').update({card_limit:1900}).eq('id',card.id));await checked(service.from('cards').update({card_limit:1900}).eq('id',card.id));
check(Number(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${owner.id}' AND type='bank_card_limit_changed' AND metadata->>'card_id'='${card.id}'`))===2,'alteração por outra origem também notifica; valor igual não notifica');
const rejected=await checked(owner.db.rpc('request_card_limit_increase',{...request,p_requested_limit:2500}));await checked(manager.db.rpc('reject_credit_card_application',{p_application_id:rejected.application_id,p_feedback:'Pedido rejeitado para testar a preservação do limite.'}));
check(Number(sql(`SELECT card_limit FROM public.cards WHERE id='${card.id}'`))===1900,'rejeição mantém limite e gera decisão persistida');
const managersCard=await checked(service.from('cards').insert({...Object.fromEntries(Object.entries(card).filter(([key])=>!['id','created_at'].includes(key))),user_id:manager.id,account_id:sql(`SELECT id FROM public.accounts WHERE user_id='${manager.id}' AND account_kind='personal'`),card_number:`5${Date.now()}12`}).select('*').single());
const selfRequest=await checked(manager.db.rpc('request_card_limit_increase',{...request,p_card_id:managersCard.id,p_requested_limit:2500}));
check(Boolean((await manager.db.rpc('approve_credit_card_application',{p_application_id:selfRequest.application_id,p_card_limit:2500,p_brand:'visa'})).error),'analista não aprova o próprio aumento');

const adminCard=await checked(service.from('cards').insert({...Object.fromEntries(Object.entries(card).filter(([key])=>!['id','created_at'].includes(key))),user_id:admin.id,account_id:sql(`SELECT id FROM public.accounts WHERE user_id='${admin.id}' AND account_kind='personal'`),card_number:`6${Date.now()}12`}).select('*').single());
const adminRequest=await checked(admin.db.rpc('request_card_limit_increase',{p_card_id:adminCard.id,p_requested_limit:2500,p_justification:''}));
check(Number(sql(`SELECT count(*) FROM public.credit_card_applications WHERE id='${adminRequest.application_id}' AND justification=''`))===1,'pedido de aumento sem justificativa é aceito e persistido');
const adminApproved=await checked(admin.db.rpc('approve_credit_card_application',{p_application_id:adminRequest.application_id,p_card_limit:2250,p_brand:'visa'}));
check(adminApproved.success===true&&Number(sql(`SELECT card_limit FROM public.cards WHERE id='${adminCard.id}'`))===2250,'Admin analisa o próprio pedido e aplica o limite mediante auditoria');
const adminRejectionRequest=await checked(admin.db.rpc('request_card_limit_increase',{p_card_id:adminCard.id,p_requested_limit:2800,p_justification:null}));
const adminRejected=await checked(admin.db.rpc('reject_credit_card_application',{p_application_id:adminRejectionRequest.application_id,p_feedback:null}));
check(adminRejected.success===true&&Number(sql(`SELECT card_limit FROM public.cards WHERE id='${adminCard.id}'`))===2250,'Admin rejeita o próprio pedido sem alterar o limite');
check(Number(sql(`SELECT count(*) FROM public.economic_audit_log WHERE action='card_limit_request_reviewed' AND entity_id IN ('${adminRequest.application_id}','${adminRejectionRequest.application_id}') AND new_data->>'admin_self_review'='true'`))===2,'exceções administrativas são auditadas individualmente');

const beforeWallet=await checked(admin.db.rpc('admin_get_wallet_balances',{p_user_id:owner.id}));
const adjustment={p_user_id:owner.id,p_currency_code:'USD',p_amount:50,p_action:'add',p_reason:'Ajuste justificado da carteira em moeda estrangeira.',p_operation_key:randomUUID()};
const changes=await Promise.all(Array.from({length:8},()=>checked(admin.db.rpc('admin_adjust_wallet_balance',adjustment))));
check(new Set(changes.map(row=>row.transaction_id)).size===1,'confirmação concorrente de saldo gera um único lançamento');
const wallet=await checked(admin.db.rpc('admin_get_wallet_balances',{p_user_id:owner.id}));
check(wallet.BRL===beforeWallet.BRL&&wallet.currencies.find(row=>row.code==='USD').balance===150,'ajuste em USD não altera a carteira em BRL');
check(Boolean((await admin.db.rpc('admin_adjust_wallet_balance',{...adjustment,p_amount:200,p_action:'remove',p_operation_key:randomUUID()})).error),'retirada sem saldo na moeda é negada');
check(Boolean((await admin.db.rpc('admin_adjust_wallet_balance',{...adjustment,p_currency_code:'JPY',p_amount:1.5,p_operation_key:randomUUID()})).error),'JPY respeita precisão inteira');
check(Boolean((await other.db.rpc('admin_adjust_wallet_balance',adjustment)).error),'cidadão comum não ajusta saldos');
check(Boolean((await admin.db.rpc('admin_adjust_wallet_balance',{...adjustment,p_amount:60})).error),'chave repetida com outro valor não pode ser reaproveitada');
await checked(admin.db.rpc('admin_adjust_wallet_balance',{...adjustment,p_amount:20,p_action:'remove',p_operation_key:randomUUID()}));
const afterWithdrawal=await checked(admin.db.rpc('admin_get_wallet_balances',{p_user_id:owner.id}));
check(afterWithdrawal.BRL===beforeWallet.BRL&&afterWithdrawal.currencies.find(row=>row.code==='USD').balance===130,'retirada válida em USD persiste sem converter ou alterar BRL');
check(Boolean((await admin.db.rpc('admin_adjust_wallet_balance',{...adjustment,p_currency_code:'XYZ',p_operation_key:randomUUID()})).error),'moeda não suportada não pode ser criada por ajuste');
const transaction=await checked(owner.db.rpc('get_user_transactions',{p_user_id:owner.id}));
check(transaction.some(row=>row.id===changes[0].transaction_id&&row.metadata.currency==='USD'),'extrato preserva a moeda original do ajuste');
const invoice=await checked(service.from('card_invoices').insert({user_id:owner.id,card_id:card.id,closing_date:'2026-11-01',due_date:'2026-11-02',amount:0,status:'open'}).select('*').single());
await checked(service.from('card_invoice_items').insert({invoice_id:invoice.id,description:'Compra QA com juros posteriores',amount:100,entry_kind:'charge'}));
sql('SELECT public.close_due_invoices();SELECT public.close_due_invoices();');
const items=await checked(owner.db.rpc('get_invoice_items',{p_invoice_id:invoice.id}));const interest=items.filter(item=>item.entry_kind==='interest');
check(interest.length===1&&interest[0].base_amount===100&&interest[0].rate_snapshot>0,'juros lançados uma vez na própria fatura, com base e taxa históricas');
const events=[];await owner.db.realtime.setAuth(owner.session.access_token);
const channel=owner.db.channel(`platform-${randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'platform_access_exceptions',filter:`user_id=eq.${owner.id}`},event=>events.push(event));
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Canal de exceções não conectou')),15000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}});});
// The disposable Realtime tenant starts CDC lazily; establish delivery before measuring the transition.
for(let attempt=0;attempt<30&&!events.length;attempt++){await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:true,p_reason:'Preparação da assinatura Realtime no ambiente de teste.'}));await new Promise(resolve=>setTimeout(resolve,500));}
check(events.length>0,'assinatura Realtime privada recebe eventos autorizados');
await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:false,p_reason:'Encerramento da preparação do canal Realtime.'}));events.length=0;
const original=await checked(service.from('system_settings').select('value').eq('key','service_availability').maybeSingle());
try{
 await Promise.all([
  checked(admin.db.rpc('admin_set_service_availability',{p_changes:{'/services/bank':{mode:'maintenance'}}})),
  checked(admin.db.rpc('admin_set_service_availability',{p_changes:{'/services/health':{mode:'coming_soon'}}})),
 ]);
 const concurrentSettings=await checked(owner.db.rpc('get_platform_access'));
 check(concurrentSettings.settings['/services/bank'].mode==='maintenance'&&concurrentSettings.settings['/services/health'].mode==='coming_soon','edições administrativas concorrentes preservam serviços diferentes');
 check(Boolean((await owner.db.rpc('admin_set_service_availability',{p_changes:{__site__:{mode:'active'}}})).error),'cidadão não altera a disponibilidade por RPC');
 await checked(service.from('system_settings').upsert({key:'service_availability',value:original?.value||{}}));
 await checked(admin.db.from('system_settings').upsert({key:'service_availability',value:{...(original?.value||{}),__site__:{mode:'maintenance',updated_at:new Date().toISOString()}}}));
 check((await checked(owner.db.rpc('get_platform_access'))).allowed===false,'manutenção bloqueia usuário comum no backend');
 check(Boolean((await owner.db.from('accounts').select('*')).error),'URL direta do Data API não contorna a manutenção');
 check(Boolean((await owner.db.rpc('get_user_transactions',{p_user_id:owner.id})).error),'RPC financeiro também fica bloqueado durante manutenção');
 await checked(admin.db.rpc('set_admin_development_mode',{p_mode:'simulate',p_simulated_role:'Cidadão',p_execute_real:false}));
 check((await checked(admin.db.rpc('get_platform_access'))).bypass===true,'administrador preserva acesso mesmo simulando Cidadão');
 await checked(admin.db.rpc('set_admin_development_mode',{p_mode:'normal',p_execute_real:false}));
 await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:true,p_reason:'Acesso excepcional concedido para validar o novo fluxo.'}));
 check((await checked(owner.db.rpc('get_platform_access'))).allowed===true,'exceção persistida libera somente a conta selecionada');
 check((await checked(other.db.rpc('get_platform_access'))).allowed===false,'exceção não libera outros usuários');
 check(Boolean((await owner.db.rpc('admin_set_platform_exception',{p_user_id:other.id,p_allowed:true,p_reason:'Tentativa indevida de conceder acesso.'})).error),'exceção não concede privilégios administrativos');
 await checked(owner.db.from('accounts').select('balance').eq('user_id',owner.id));
 await checked(admin.db.rpc('admin_set_platform_exception',{p_user_id:owner.id,p_allowed:false,p_reason:'Acesso excepcional revogado após a verificação.'}));
 check((await checked(owner.db.rpc('get_platform_access'))).allowed===false,'revogação vale imediatamente para a sessão existente');
 for(let retry=0;retry<50&&!events.length;retry++)await new Promise(resolve=>setTimeout(resolve,200));check(events.length>0,'concessão e revogação chegam à conta por Realtime');
 const login=createClient(env.API_URL,env.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});check(!(await login.auth.signInWithPassword({email:admin.email,password:admin.password})).error,'login do administrador continua disponível durante manutenção');await login.auth.signOut();
}finally{await checked(service.from('system_settings').upsert({key:'service_availability',value:original?.value||{}}));await owner.db.removeChannel(channel);}
await checked(admin.db.rpc('save_admin_dashboard_order',{p_order:['settings','users','whatsapp']}));
check((await checked(admin.db.from('admin_dashboard_preferences').select('section_order').eq('user_id',admin.id).single())).section_order[0]==='settings','ordem do painel é persistida por administrador');
check(Boolean((await owner.db.rpc('save_admin_dashboard_order',{p_order:['users']})).error),'ordem administrativa protegida contra outros usuários');
check((await checked(owner.db.from('admin_dashboard_preferences').select('*'))).length===0,'outros usuários não leem a preferência do administrador');
const invite=await checked(admin.db.rpc('admin_add_whatsapp_group_invite',{p_link:'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV'}));
check(invite.status==='pending','informar convite não apresenta grupo como conectado');
check(Boolean((await admin.db.rpc('admin_add_whatsapp_group_invite',{p_link:'https://example.com/ABCDEFGHIJKLMNOPQRSTUV'})).error),'links externos não são aceitos como convite');
check(Boolean((await other.db.rpc('admin_add_whatsapp_group_invite',{p_link:'https://chat.whatsapp.com/ABCDEFGHIJKLMNOPQRSTUV'})).error),'somente administrador cadastra grupos do bot');
check((await checked(other.db.from('whatsapp_bot_group_invitations').select('*'))).length===0,'convites privados não vazam para cidadãos');
writeFileSync(`${directory}/general-update-fixtures.json`,JSON.stringify({people:people.map(({db,...person})=>person),card,application,invoice}),{mode:0o600});
console.log(`${count} verificações integradas aprovadas no QA isolado.`);
for(const person of people)await person.db.auth.signOut();
