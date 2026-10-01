import assert from 'node:assert/strict';
import {actor,service,request,rpc,cleanup} from './lib/world-test.mjs';
import {marketplacePolicy} from '../src/lib/marketplaceFees.js';
let original,admin;
try {
 admin=await actor('expansion-fees-admin','Admin');const seller=await actor('expansion-fees-seller'),buyer=await actor('expansion-fees-buyer');
 original=await request(service.from('state_enterprises').select('*').eq('service_key','marketplace').single());
 for(const person of [seller,buyer])await request(service.from('accounts').insert({user_id:person.id,account_number:crypto.randomUUID(),balance:100000,agency_number:'0001'}));
 const [activity]=await request(service.from('business_types').select('id').eq('is_active',true).limit(1));
 const company=await request(service.from('businesses').insert({owner_id:seller.id,business_type_id:activity.id,name:'Empresa de taxas PF PJ',status:'active'}).select('*').single());
 await request(service.from('accounts').update({balance:100000}).eq('id',company.bank_account_id));
 const policies={PF:{commission:8,fixed:0,listing:2,renewal:3,days:7},PJ:{commission:4,fixed:0,listing:5,renewal:7,days:7}};
 const args={p_policies:policies,p_publication_mode:'automatic',p_manager_id:null};
 assert((await seller.client.rpc('configure_marketplace_seller_fees',args)).error);
 assert((await admin.client.rpc('configure_marketplace_seller_fees',{...args,p_policies:{PF:{...policies.PF,commission:-1},PJ:policies.PJ}})).error);
 const market=await rpc(admin.client,'configure_marketplace_seller_fees',args);
 assert.equal(marketplacePolicy(market,true).commission_value,4);assert.equal(marketplacePolicy(market,false,true).active_listing_fee_amount,3);
 for(const [kind,business,fee,renewal] of [['PF',null,2,3],['PJ',company.id,5,7]]) {
  const product=await rpc(seller.client,'publish_business_product',{p_product:{p_business_id:business,p_name:'Produto '+kind,p_description:'Oferta para verificar taxas específicas.',p_price:100,p_image_url:'https://example.invalid/offer.png',p_product_type:'one-time',p_subscription_interval:null,p_category:'Outros',p_stock:3,p_promotion_price:null,p_promotion_expires_at:null,p_consumable_effects:{}},p_confirmed_fee:fee,p_period_days:7,p_idempotency_key:crypto.randomUUID()});
  assert.equal(Number(product.listing_fee_snapshot.amount),fee);assert.equal(product.listing_fee_snapshot.seller_type,kind);
  const order=await rpc(buyer.client,'buy_product',{p_product_id:product.id,p_payment_method:'balance',p_card_id:null,p_idempotency_key:crypto.randomUUID()});
  const saved=await request(service.from('commerce_orders').select('commission_amount,commission_snapshot').eq('id',order.order_id).single());
  assert.equal(Number(saved.commission_amount),policies[kind].commission);assert.equal(saved.commission_snapshot.seller_type,kind);
  await request(service.from('products').update({listing_paid_until:new Date(Date.now()-1000).toISOString()}).eq('id',product.id));
  assert((await seller.client.rpc('renew_marketplace_listing',{p_product_id:product.id,p_confirmed_fee:fee,p_period_days:7,p_idempotency_key:crypto.randomUUID()})).error);
  const renewed=await rpc(seller.client,'renew_marketplace_listing',{p_product_id:product.id,p_confirmed_fee:renewal,p_period_days:7,p_idempotency_key:crypto.randomUUID()});assert.equal(Number(renewed.listing_fee_snapshot.amount),renewal);
  console.log(`✓ ${kind}: publicação ${fee}, renovação ${renewal}, comissão ${policies[kind].commission}%, histórico persistido.`);
 }
 console.log('✓ Autoridade, políticas PF/PJ, comissões e confirmações verificadas com contas reais locais.');
} finally {
 if(original&&admin){await rpc(admin.client,'configure_marketplace_fees',{p_percentage:Number(original.commission_value),p_fixed_fee:Number(original.fixed_sale_fee),p_publication_mode:original.publication_mode,p_manager_id:original.manager_id,p_listing_enabled:original.active_listing_fee_enabled,p_listing_amount:Number(original.active_listing_fee_amount),p_period_days:original.active_listing_fee_period});if(original.seller_fees?.PF)await rpc(admin.client,'configure_marketplace_seller_fees',{p_policies:original.seller_fees,p_publication_mode:original.publication_mode,p_manager_id:original.manager_id});}
 await cleanup();
}
