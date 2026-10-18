import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {actor,service,request,rpc,cleanup} from './lib/world-test.mjs';
const sql=query=>execFileSync('docker',['exec','supabase_db_GOVRP','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',query],{encoding:'utf8'}).trim();
let n=0;const check=(condition,label)=>{assert(condition,label);console.log('✓ '+label);n++;};
try{
 const owner=await actor('launch-stock-owner'),buyer=await actor('launch-stock-buyer'),other=await actor('launch-stock-other');
 for(const p of [owner,buyer,other])await request(service.from('accounts').insert({user_id:p.id,account_number:crypto.randomUUID(),balance:1000000}));
 const company=await request(service.from('businesses').insert({owner_id:owner.id,business_type_id:'fazenda',name:'Estoque compartilhado de validação',status:'active',region_code:'SP'}).select('*').single());
 await rpc(owner.client,'contribute_company_capital',{p_business_id:company.id,p_amount:20000,p_idempotency_key:crypto.randomUUID()});
 await request(service.from('business_inventory').insert({business_id:company.id,resource_code:'wheat',quantity:3,unit_cost:1,selling_price:8,available_for_sale:true}));
 const quote=await rpc(owner.client,'get_company_resource_listing_quote',{p_business_id:company.id,p_resource_code:'wheat'}),key=crypto.randomUUID();
 const args={p_business_id:company.id,p_resource_code:'wheat',p_price:8,p_confirmed_fee:quote.amount,p_period_days:quote.days||7,p_idempotency_key:key};
 check(Boolean((await other.client.rpc('publish_company_resource_listing',args)).error),'terceiro não publica o estoque alheio');
 const id=await rpc(owner.client,'publish_company_resource_listing',args);
 check(await rpc(owner.client,'publish_company_resource_listing',args)===id,'publicação repetida reutiliza o mesmo anúncio e confirmação');
 let listing=await request(service.from('products').select('*').eq('id',id).single());check(listing.stock===3&&listing.resource_code==='wheat','anúncio representa exatamente o estoque físico');
 // Moderation is an independent existing workflow, so this local fixture grants
 // approval before exercising checkout rather than bypassing it in the RPC.
 await request(service.from('products').update({listing_status:'active'}).eq('id',id));
 const purchaseKey=crypto.randomUUID();const purchase={p_product_id:id,p_payment_method:'balance',p_card_id:null,p_idempotency_key:purchaseKey};
 const pair=await Promise.all([rpc(buyer.client,'buy_product',purchase),rpc(buyer.client,'buy_product',purchase)]);check(pair[0].order_id===pair[1].order_id,'compra concorrente com a mesma chave gera uma única entrega');
 const stock=()=>request(service.from('business_inventory').select('quantity').eq('business_id',company.id).eq('resource_code','wheat').single());
 check(Number((await stock()).quantity)===2,'compra no Negócios Livre desconta uma unidade do estoque empresarial');
 check((await request(service.from('products').select('stock').eq('id',id).single())).stock===2,'quantidade do anúncio acompanha a compra sem segunda reserva');
 check(Boolean((await service.from('products').update({stock:999}).eq('id',id)).error),'inflação manual de quantidade é bloqueada até para caminhos de serviço');
 await request(service.from('business_inventory').update({quantity:1}).eq('business_id',company.id).eq('resource_code','wheat'));
 const orders=await Promise.allSettled([rpc(buyer.client,'buy_product',{...purchase,p_idempotency_key:crypto.randomUUID()}),rpc(other.client,'buy_product',{...purchase,p_idempotency_key:crypto.randomUUID()})]);
 check(orders.filter(r=>r.status==='fulfilled'&&r.value.success).length===1,'dois compradores disputando a última unidade não vendem estoque inexistente');
 check(Number((await stock()).quantity)===0&&(await request(service.from('products').select('stock').eq('id',id).single())).stock===0,'última venda zera as duas visualizações da mesma fonte');
 sql(`begin;insert into public.business_balance_cycles(business_id,cycle_start_at,gross_revenue,net_result,metadata) values('${company.id}',now()-interval '28 days',100,10,'{}'),('${company.id}',now()-interval '21 days',200,50,'{}'),('${company.id}',now()-interval '14 days',50,-20,'{}'),('${company.id}',now()-interval '7 days',50,-20,'{}');commit;`);
 const cycles=await request(service.from('business_balance_cycles').select('metadata').eq('business_id',company.id).order('cycle_start_at'));
 check(cycles[0].metadata.growth.status==='first_period','primeiro exercício não inventa comparação anterior');
 check(cycles[1].metadata.growth.status==='growth'&&cycles[1].metadata.growth.score_percent>0,'crescimento é calculado com os snapshots do exercício');
 check(cycles[2].metadata.growth.status==='retraction'&&cycles[2].metadata.growth.score_percent<0,'queda de receita e lucro produz retração real');
 check(cycles[3].metadata.growth.status==='stable','períodos equivalentes indicam estabilidade');
 console.log(`${n} verificações de estoque compartilhado, concorrência e balanço aprovadas.`);
}finally{await cleanup();}
