export function marketplacePolicy(enterprise, business = false, renewal = false) {
  if (!enterprise) return null;
  const policy=enterprise.seller_fees?.[business?'PJ':'PF'];
  return policy ? {...enterprise,commission_type:'percentage',commission_value:policy.commission,fixed_sale_fee:policy.fixed,active_listing_fee_enabled:Number(policy[renewal?'renewal':'listing'])>0,active_listing_fee_amount:policy[renewal?'renewal':'listing'],active_listing_fee_period:policy.days} : enterprise;
}
export function marketplacePolicies(enterprise) {
  return Object.fromEntries(['PF','PJ'].map(kind=>{const p=marketplacePolicy(enterprise,kind==='PJ');return [kind,enterprise.seller_fees?.[kind]||{commission:Number(p.commission_value||0),fixed:Number(p.fixed_sale_fee||0),listing:p.active_listing_fee_enabled?Number(p.active_listing_fee_amount):0,renewal:p.active_listing_fee_enabled?Number(p.active_listing_fee_amount):0,days:Number(p.active_listing_fee_period||7)}];}));
}
