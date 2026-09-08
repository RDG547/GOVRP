const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
// Only recorded values and the known historical operation shape are used here.
// In particular, there is no import of current tax rates.
export function transactionAmounts(transaction) {
  const m = transaction.metadata || {};
  const amount = numeric(transaction.amount) ?? 0;
  const purchase = ['purchase', 'purchase_card'].includes(transaction.type);
  const gross = numeric(m.gross_amount) ?? numeric(m.base_price) ?? amount;
  const buyerTax = numeric(m.buyer_tax) ?? numeric(m.consumption_tax) ?? (transaction.type === 'transfer' ? numeric(m.tax_amount) ?? 0 : 0);
  const sellerTax = numeric(m.seller_tax) ?? numeric(m.corporate_tax) ?? 0;
  const total = numeric(m.total_debited) ?? (purchase ? amount : transaction.type === 'transfer' ? amount + buyerTax : amount);
  const net = numeric(m.net_amount) ?? numeric(m.seller_net) ?? (purchase ? gross - sellerTax : amount);
  const sent = transaction.direction === 'sent';
  return { gross, buyerTax, sellerTax, total, net, displayed: sent ? total : net, taxed: buyerTax > 0 || sellerTax > 0, sent, levies: Array.isArray(m.levies) ? m.levies : [] };
}
