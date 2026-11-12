// The economic dashboards share Supabase Realtime subscriptions through useDomainRealtime.
// Postgres RLS remains the authority for every financial row; never broadcast balances.
export const ECONOMY_PUBLIC_TABLES = Object.freeze([
  'economic_state',
  'economic_indicators',
  'economic_sector_snapshots',
  'price_basket_items',
  'economic_bulletins',
  'economic_alerts',
  'economic_policy_decisions',
  'government_finances',
  'investment_options',
  'system_settings',
  'country_rp_states',
  'country_rp_economic_snapshots',
]);

const BUSINESS_TABLES = [
  'businesses', 'business_inventory', 'business_transactions',
  'business_daily_operations', 'business_national_cycles',
  'business_balance_cycles', 'business_employees', 'business_supply_orders',
  'business_supply_contracts', 'national_market_purchases',
  'national_market_stock', 'national_market_consumption',
];

const INVESTMENT_TABLES = [
  'investment_operations', 'investment_portfolio_snapshots',
  'user_investments', 'stock_price_history',
];

const GOVERNMENT_TABLES = [
  'government_projects', 'government_ministries',
  'government_revenues', 'government_expenditures',
];

export function economyRealtimeTablesFor(view, userId) {
  // An unauthenticated visitor never subscribes to private financial records.
  const tables = [...ECONOMY_PUBLIC_TABLES];
  const privateViewer = Boolean(userId);

  if (privateViewer && view === 'citizen') {
    // Personal accounts are filtered by the authenticated user's id.
    tables.push({ table: 'accounts', filter: `user_id=eq.${userId}` });
  }
  if (privateViewer && ['citizen', 'business', 'admin'].includes(view)) {
    // Transaction row visibility belongs to RLS for account participants.
    tables.push('transactions');
  }

  if (privateViewer && ['citizen', 'admin'].includes(view)) {
    tables.push(...INVESTMENT_TABLES);
    tables.push('salary_payments');
  }

  if (privateViewer && ['business', 'admin'].includes(view)) {
    tables.push(...BUSINESS_TABLES);
    // A company account need not belong to the owner's personal user_id.
    // RLS limits visibility of non-personal account changes.
    tables.push('accounts');
  }

  if (privateViewer && ['government', 'admin'].includes(view)) {
    tables.push(...GOVERNMENT_TABLES);
    tables.push('salary_payments');
  }

  if (privateViewer && view === 'centralBank') {
    tables.push('currency_market_states', 'stock_price_history');
  }

  // A single subscription per table+filter keeps the client's channel compact.
  return tables.filter((item, index) => {
    const key = typeof item === 'string' ? item : JSON.stringify(item);
    return tables.findIndex((other) => (typeof other === 'string' ? other : JSON.stringify(other)) === key) === index;
  });
}
