import React from 'react';
import { transactionAmounts } from '@/lib/transactionAmounts';
import { formatCurrency } from '@/lib/utils';
export default function TransactionTaxBreakdown({ transaction, receipt = false }) {
  const v = transactionAmounts(transaction);
  if (!v.taxed && !receipt) return null;
  return <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs text-muted-foreground text-left">
    <dt>Valor da operação</dt><dd className="text-right tabular-nums">{formatCurrency(v.gross)}</dd>
    {v.buyerTax > 0 && <><dt>Imposto / taxa do remetente</dt><dd className="text-right tabular-nums">{formatCurrency(v.buyerTax)}</dd></>}
    {v.sellerTax > 0 && <><dt>Imposto retido do vendedor</dt><dd className="text-right tabular-nums">{formatCurrency(v.sellerTax)}</dd></>}
    <dt>Total debitado</dt><dd className="text-right tabular-nums">{formatCurrency(v.total)}</dd>
    <dt>Líquido recebido</dt><dd className="text-right tabular-nums">{formatCurrency(v.net)}</dd>
    {receipt && v.levies.map((levy, index) => <React.Fragment key={`${levy.rule_key}-${index}`}><dt>{levy.name}{levy.nature === 'percentage' ? ` (${Number(levy.rate_snapshot * 100).toLocaleString('pt-BR')}%)` : ''}</dt><dd className="text-right">{formatCurrency(levy.tax_amount)}</dd></React.Fragment>)}
  </dl>;
}
