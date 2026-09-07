export const bankRealtimeTables = (userId) => [
  ...['accounts', 'cards', 'credit_card_applications', 'card_invoices', 'loan_applications',
    'user_investments', 'investment_operations', 'investment_portfolio_snapshots'].map(table => ({ table, filter: `user_id=eq.${userId}` })),
  // These tables are authorized through account/invoice ownership by RLS.
  { table: 'transactions' }, { table: 'card_invoice_items' }, { table: 'investment_options' },
];
