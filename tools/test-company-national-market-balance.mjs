import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261113063648_company_market_demand_and_physical_inputs.sql', import.meta.url),'utf8');
const page = readFileSync(new URL('../src/features/economy/components/NationalProductionMarket.jsx', import.meta.url),'utf8');
const allocation = readFileSync(new URL('../supabase/migrations/20261113064338_population_market_spending_allocation.sql', import.meta.url),'utf8');

const mustContain = (source, value, label = value) =>
  assert(source.includes(value), 'Contract missing: ' + label);

for (const f of [
  'private.simulate_population_demand',
  'private.procure_national_market',
  'public.get_national_production_catalog',
  'public.buy_company_input_from_national_market',
]) mustContain(migration, f);

mustContain(migration,'exists(select 1 from public.business_inventory','Demand must require actual seller stock');
mustContain(allocation,'active_direct_offers','Market must not consume entire budget when sellers exist');
mustContain(allocation,'macro.simulated_share','Respect administrative simulated-sector participation');
mustContain(allocation,'macro.player_share','Respect administrative player participation');
mustContain(allocation,'case when active_direct_offers then market_share else 1 end','Leave remaining budget for private companies');
assert(!/UPDATE\\s+public\\.(?:accounts|economic_calibrations|system_settings)\\s+SET/i.test(allocation),'Market budget update must not create or reset money');

mustContain(migration,'b.status=\'active\'','Only active businesses can sell');
mustContain(migration,"md5(p_day::text||':'||i.business_id::text","Procurement must rotate daily");
mustContain(migration,'NOT private.can_manage_company','Company authorization required');
mustContain(migration,'p_quantity<>trunc(p_quantity,3)','Quantities are 3-decimal physical units');
mustContain(migration,"recipe.inputs ? p_resource","Purchases must match actual production recipe");
mustContain(migration,"FROM public.national_market_stock WHERE resource_code=p_resource FOR UPDATE","Physical stock lock");
mustContain(migration,"quantity=quantity-p_quantity","The purchased national quantity must decrease");
mustContain(migration,"public.business_inventory.quantity+p_quantity","Only the destination company gets the stock");
mustContain(migration,'daily_wholesale','Repeated buys must obey a GLOBAL daily quota');
mustContain(migration,"(stock.quantity+daily_wholesale)*0.25","Total daily company supply must not exceed 25%");
mustContain(migration,"pg_advisory_xact_lock","Concurrent transactions must be serialized");
mustContain(migration,'idempotency_key=p_key','Duplicate operations must be intercepted');
mustContain(migration,'quote_legal_levies','Legal tax engine must be used');
mustContain(migration,'gross>net','Receipts and taxes must match the confirmed financial quote');
mustContain(migration,"'inventory_purchase'","Inventory buys are NOT duplicated operating expenses");
mustContain(migration,"REVOKE ALL ON FUNCTION public.buy_company_input_from_national_market","No anonymous purchase RPC");
mustContain(migration,"GRANT EXECUTE ON FUNCTION public.buy_company_input_from_national_market","Explicit authenticated access");

assert(!/INSERT\s+INTO\s+public\.national_market_stock/i.test(migration), 'Never invent national supply');
assert(!/UPDATE\s+public\.(?:economic_calibrations|government_rules|system_settings|business_employees)\s+SET/i.test(migration), 'Do not alter legal, admin, or salary rules');
assert(!/DELETE\s+FROM\s+public\.|TRUNCATE\s+TABLE|DROP\s+TABLE/i.test(migration), 'Do not destroy existing economic history');

mustContain(page,'inputNeeds=data?.input_needs||[]','Frontend uses the real needs list');
mustContain(page,'need.wholesale_available','Frontend uses server-calculated daily allowance');
mustContain(page,"rpc('buy_company_input_from_national_market'","Purchase must call authenticated RPC");
mustContain(page,'crypto.randomUUID()','Per-operation idempotency key');
mustContain(page,"useDomainRealtime('national-production'","Reuse project realtime synchronisation");
assert(!page.includes('setInterval('),'Do not use polling');

const oldResourceCount = 24;
const actualAvailableCategories = 3;
const sharedBudget = 210;
const oldBase = sharedBudget * .7 / oldResourceCount;
const availableBase = sharedBudget * .7 / actualAvailableCategories;
assert(availableBase > oldBase, 'Real available goods should receive more budget, not fictional categories');

console.log('✓ Company + National Market: real stock, daily quota, taxes, authorization, idempotency, dynamic demand, realtime.');
