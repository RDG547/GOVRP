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
  const commission = numeric(m.commission_amount) ?? 0;
  const sent = transaction.direction === 'sent';
  return { commission, gross, buyerTax, sellerTax, total, net, displayed: sent ? total : net, taxed: buyerTax > 0 || sellerTax > 0 || (Array.isArray(m.levies) && m.levies.some(levy => Number(levy.tax_amount) > 0)), sent, levies: Array.isArray(m.levies) ? m.levies : [] };
}

// Prefer immutable per-rule snapshots. Aggregate totals are only a fallback for missing detail.
export function recordedTransactionLevies(transaction) {
  const values = transactionAmounts(transaction);
  const seen = new Set();
  const lines = values.levies.filter((levy, index) => {
    if (!(Number(levy.tax_amount) > 0)) return false;
    const key = levy.rule_key ? `${levy.rule_key}:${levy.version || ''}:${levy.payer || ''}:${levy.tax_amount}` : `legacy-${index}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(levy => ({ ...levy, tax_amount: Number(levy.tax_amount) }));
  for (const [payer, total, name] of [['buyer', values.buyerTax, 'Imposto / taxa do remetente'], ['seller', values.sellerTax, 'Imposto retido do vendedor']]) {
    const detailed = lines.filter(line => line.payer === payer).reduce((sum, line) => sum + line.tax_amount, 0);
    const remainder = Math.round((total - detailed) * 100) / 100;
    if (remainder > 0) lines.push({ rule_key: `historical-${payer}`, name, payer, tax_amount: remainder });
  }
  return lines;
}
