import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, service, request, rpc, cleanup } from './lib/world-test.mjs';
const sql=query=>execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
const cashTotal=()=>Number(sql('select (select coalesce(sum(balance),0) from public.accounts)+(select treasury_balance from public.government_finances where id=1)'));
const simulate=id=>sql(`select private.simulate_company_day('${id}',current_date)`);
let n=0;const check=(value,label)=>{assert(value,label);n++;console.log(`✓ ${label}`);};
try{
 const owner=await actor('production-owner','Cidadão'),other=await actor('production-other','Cidadão');
 for(const person of [owner,other]) await request(service.from('accounts').insert({user_id:person.id,account_number:crypto.randomUUID(),balance:1000000}));
 async function company(type,name){const b=await request(service.from('businesses').insert({owner_id:owner.id,business_type_id:type,name,status:'active',region_code:'SP'}).select('*').single());await rpc(owner.client,'contribute_company_capital',{p_business_id:b.id,p_amount:20000,p_idempotency_key:crypto.randomUUID()});const kind=await request(service.from('business_types').select('min_employees').eq('id',type).single());for(let i=0;i<kind.min_employees;i++)await rpc(owner.client,'manage_company_workforce',{p_business_id:b.id,p_action:'hire_npc',p_data:{role_template_id:`${type}:1`,salary:400,level:1},p_idempotency_key:crypto.randomUUID()});return b;}
 const farm=await company('fazenda','Fazenda da cadeia integrada'),mill=await company('moinho','Moinho da cadeia integrada'),bakery=await company('padaria','Padaria da cadeia integrada'),dairy=await company('pecuaria','Leite da cadeia integrada'),cornFarm=await company('agricultura','Milho da cadeia integrada'),solar=await company('solar','Energia da cadeia integrada');
 const before=cashTotal();simulate(farm.id);simulate(cornFarm.id);simulate(solar.id);const afterProduction=cashTotal();check(Math.abs(before-afterProduction)<.01,'produção paga custos sem criar ou destruir dinheiro');
 const grain=await request(service.from('business_inventory').select('*').eq('business_id',farm.id).eq('resource_code','wheat').single());check(grain.quantity>0&&grain.available_for_sale,'fazenda produz trigo real disponível para empresas');
 const buyArgs={p_business_id:mill.id,p_supplier_id:farm.id,p_resource_code:'wheat',p_quantity:20,p_max_unit_price:8,p_idempotency_key:crypto.randomUUID()};
 const [order,duplicate]=await Promise.all([rpc(owner.client,'buy_company_resource',buyArgs),rpc(owner.client,'buy_company_resource',buyArgs)]);check(order.id===duplicate.id,'fornecimento concorrente usa uma única transferência e entrega');
 check((await request(service.from('business_inventory').select('quantity').eq('business_id',mill.id).eq('resource_code','wheat').single())).quantity===20,'moinho recebe exatamente o trigo adquirido');
 check(Math.abs(cashTotal()-before)<.01,'venda B2B conserva dinheiro entre caixas e Tesouro');
 check(Boolean((await other.client.rpc('buy_company_resource',{...buyArgs,p_idempotency_key:crypto.randomUUID()})).error),'terceiro não compra usando caixa alheio');
 async function getInput(business,code,quantity){const supplies=await rpc(owner.client,'get_company_suppliers');const supply=supplies.find(item=>item.resource_code===code&&item.business_id!==business.id&&Number(item.quantity)>=quantity);assert(supply,`Fornecedor real de ${code}`);return rpc(owner.client,'buy_company_resource',{p_business_id:business.id,p_supplier_id:supply.business_id,p_resource_code:code,p_quantity:quantity,p_max_unit_price:supply.unit_price,p_idempotency_key:crypto.randomUUID()});}
 await getInput(mill,'energy',3);simulate(mill.id);
 const flour=await request(service.from('business_inventory').select('*').eq('business_id',mill.id).eq('resource_code','flour').single());check(flour.quantity>0&&flour.quantity<=20,'moinho converte trigo e energia em farinha limitada pelos insumos');
 await getInput(dairy,'corn',30);simulate(dairy.id);
 await rpc(owner.client,'buy_company_resource',{p_business_id:bakery.id,p_supplier_id:mill.id,p_resource_code:'flour',p_quantity:5,p_max_unit_price:16,p_idempotency_key:crypto.randomUUID()});await getInput(bakery,'milk',2);simulate(bakery.id);
 const bread=await request(service.from('business_inventory').select('*').eq('business_id',bakery.id).eq('resource_code','bread').single());check(bread.quantity>0,'padaria produz pães a partir da farinha e do leite adquiridos');
 const quantityBefore=bread.quantity;simulate(bakery.id);check((await request(service.from('business_inventory').select('quantity').eq('business_id',bakery.id).eq('resource_code','bread').single())).quantity===quantityBefore,'reexecução diária não duplica estoque ou custos');
 const pending=(await rpc(owner.client,'get_company_management',{p_business_id:farm.id})).staff.reduce((sum,employee)=>sum+Number(employee.wage_due),0);check(pending>0,'dia trabalhado acumula salário devido');
 const paid=await rpc(owner.client,'pay_company_payroll',{p_business_id:farm.id});check(Math.abs(paid-pending)<.01,'folha transfere o valor acumulado do caixa para trabalhadores');
 check(await rpc(owner.client,'pay_company_payroll',{p_business_id:farm.id})===0,'repetir pagamento não paga duas vezes');
 check(Math.abs(cashTotal()-before)<.01,'cadeia produtiva completa e folha mantêm conservação monetária');
 const empty=await request(service.from('businesses').insert({owner_id:owner.id,business_type_id:'moinho',name:'Moinho sem insumos',status:'active',region_code:'SP'}).select('*').single());await rpc(owner.client,'contribute_company_capital',{p_business_id:empty.id,p_amount:100,p_idempotency_key:crypto.randomUUID()});simulate(empty.id);check((await request(service.from('business_inventory').select('*').eq('business_id',empty.id))).length===0,'empresa sem matéria-prima não produz estoque fictício');
 const balanceBeforeCycle=cashTotal();sql(`update public.businesses set last_fiscal_cycle_at=now()-interval '7 days' where id='${farm.id}';select private.close_company_fiscal_cycle('${farm.id}',now());`);check(Math.abs(cashTotal()-balanceBeforeCycle)<.01,'fechar balanço não credita lucro novamente');
 const cycles=await request(service.from('business_balance_cycles').select('*').eq('business_id',farm.id));check(cycles.length===1&&cycles[0].metadata.profit_is_not_credited_again,'balanço mantém snapshot financeiro imutável');
 const historic=JSON.stringify(cycles[0]);sql(`select private.close_company_fiscal_cycle('${farm.id}',now());`);check(JSON.stringify((await request(service.from('business_balance_cycles').select('*').eq('business_id',farm.id)))[0])===historic,'repetição não altera o histórico do exercício');
 const population=(await rpc(other.client,'get_company_market')).find(item=>item.control_kind==='population');assert(population,'empresa da população à venda');
 const preserved=await request(service.from('businesses').select('id,bank_account_id').eq('id',population.id).single());const cashBeforeSale=(await request(service.from('accounts').select('balance').eq('id',preserved.bank_account_id).single())).balance;
 const acquired=await rpc(other.client,'buy_business_listing',{p_listing_type:'private',p_listing_id:population.id});check(acquired.success,'cidadão adquire empresa da população pelo fluxo de compra existente');
 const final=await request(service.from('businesses').select('*').eq('id',population.id).single());check(final.owner_id===other.id&&final.control_kind==='player'&&final.bank_account_id===preserved.bank_account_id,'aquisição preserva ID e caixa e transfere o controle');
 check((await request(service.from('accounts').select('balance').eq('id',preserved.bank_account_id).single())).balance===cashBeforeSale,'preço da aquisição não é debitado do caixa adquirido');
 check(Boolean((await owner.client.from('businesses').update({market_value:999999999}).eq('id',farm.id)).error),'valor e produção não podem ser manipulados por escrita direta');
 console.log(`\n${n} verificações de cadeia produtiva, conservação monetária, folha, balanços e aquisição aprovadas.`);
}finally{await cleanup();}
