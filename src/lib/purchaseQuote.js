// Display only the quote issued by the legal engine; checkout revalidates it.
export function purchaseQuote(item) {
  const quote = item.metadata?.quote || item.quote;
  const quantity = Number(item.quantity || 1);
  if (!quote) return null;
  const levies = (quote.levies || []).filter(levy => levy.payer === 'buyer');
  const fees = levies.filter(levy => levy.kind === 'fee').reduce((sum, levy) => sum + Number(levy.tax_amount), 0);
  return { quantity, base: Number(quote.gross_amount) * quantity, taxes: (Number(quote.buyer_tax) - fees) * quantity, fees: fees * quantity, total: Number(quote.total_debited) * quantity, levies };
}
