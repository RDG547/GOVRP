import { querySections } from './sectionLoader.js';

export const BANK_SECTIONS = ['account', 'transactions', 'investments', 'loans', 'investmentOptions', 'investmentOperations', 'portfolioSnapshots'];
export const CARD_SECTIONS = ['cards', 'invoices', 'cardApplications'];
const sectionsByTable = {
  accounts: ['account'], transactions: ['transactions'], cards: ['cards'],
  credit_card_applications: ['cardApplications'], card_invoices: ['invoices'],
  user_investments: ['investments'], loan_applications: ['loans'],
  investment_options: ['investmentOptions', 'investments', 'investmentOperations'],
  investment_operations: ['investmentOperations'], investment_portfolio_snapshots: ['portfolioSnapshots'],
};
export function bankSectionsForEvents(events, available = BANK_SECTIONS) {
  if (events.some(event => event.eventType === 'SYNC')) return available;
  return [...new Set(events.flatMap(event => sectionsByTable[event.table] || []))].filter(key => available.includes(key));
}

export function fetchBankSections(client, userId, sections = BANK_SECTIONS) {
  const own = table => client.from(table).select('*').eq('user_id', userId);
  return querySections({
    account: async () => {
      const response = await own('accounts').limit(1).maybeSingle();
      if (!response.error && response.data) return response;
      const fallback = await client.rpc('get_my_bank_account');
      return { ...fallback, data: Array.isArray(fallback.data) ? fallback.data[0] || null : fallback.data };
    },
    transactions: () => client.rpc('get_user_transactions', { p_user_id: userId }),
    cards: () => own('cards').order('created_at', { ascending: true }),
    invoices: () => own('card_invoices').order('due_date', { ascending: false }),
    cardApplications: () => own('credit_card_applications').order('created_at', { ascending: false }),
    investments: () => client.from('user_investments').select('*, investment_option:investment_options(*)').eq('user_id', userId).eq('is_active', true),
    loans: () => own('loan_applications').order('created_at', { ascending: false }),
    investmentOptions: async () => {
      const result = await client.from('investment_options').select('*').order('annual_return_rate', { ascending: true });
      return { ...result, data: result.data?.filter(option => option.is_active !== false) };
    },
    investmentOperations: () => client.from('investment_operations').select('*, investment_option:investment_options(name, asset_symbol)').eq('user_id', userId).order('executed_at', { ascending: false }).limit(100),
    portfolioSnapshots: () => own('investment_portfolio_snapshots').order('captured_at', { ascending: true }).limit(120),
  }, sections);
}
