import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { economyRealtimeTablesFor, ECONOMY_PUBLIC_TABLES } from '../src/lib/economy/realtime-tables.js';

const names = (view, id) => economyRealtimeTablesFor(view, id)
  .map(value => typeof value === 'string' ? value : value.table);

const guest = names('public', null);
assert.deepEqual(guest, ECONOMY_PUBLIC_TABLES);
assert(!guest.includes('accounts'), 'A public screen must not subscribe to account balances');
assert(!guest.includes('transactions'), 'A public screen must not subscribe to private transactions');

const anonymousBusiness = names('business', null);
assert(!anonymousBusiness.includes('business_transactions'), 'Anonymous viewers must not subscribe to private company transactions');

const citizenId = '00000000-0000-4000-8000-000000000001';
const citizen = economyRealtimeTablesFor('citizen', citizenId);
assert(citizen.some(item => item.table === 'accounts' && item.filter === `user_id=eq.${citizenId}`));
assert(citizen.some(item => item === 'transactions'));
assert(citizen.some(item => item === 'salary_payments'));

const enterprise = names('business', citizenId);
for (const table of ['business_inventory', 'business_daily_operations', 'business_transactions', 'national_market_purchases', 'accounts']) {
  assert(enterprise.includes(table), `Business view missing ${table}`);
}

const government = names('government', citizenId);
for (const table of ['government_revenues', 'government_expenditures', 'government_projects', 'salary_payments']) {
  assert(government.includes(table), `Government view missing ${table}`);
}

const centralBank = names('centralBank', citizenId);
assert(centralBank.includes('currency_market_states'));
assert(centralBank.includes('stock_price_history'));

const admin = economyRealtimeTablesFor('admin', citizenId);
const keys = admin.map(item => JSON.stringify(item));
assert.equal(new Set(keys).size, keys.length, 'Duplicated channel filters');

const dashboardSource = readFileSync(new URL('../src/features/economy/components/EmbeddedEconomyPanel.jsx', import.meta.url),'utf8');
assert.match(dashboardSource,/useDomainRealtime\(/);
assert.match(dashboardSource,/useQueuedRefresh\(/);
assert(!dashboardSource.includes('setInterval('), 'No permanent economic polling loops');

const migration = readFileSync(new URL('../supabase/migrations/20261112141838_economy_realtime_publication_alert_lifecycle.sql', import.meta.url),'utf8');
for (const keyword of ['government_revenues', 'government_expenditures', 'salary_payments', 'reconcile_economic_alert_status']) {
  assert(migration.includes(keyword), `Missing migration contract: ${keyword}`);
}
assert(!/UPDATE public\.(accounts|government_finances|economic_calibrations)/i.test(migration),'Economic migration may not rewrite balances or calibrations');

console.log('✓ Economy: realtime scopes, reconnect foundation, publication and audit contracts');
