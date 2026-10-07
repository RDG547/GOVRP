import React from 'react';
import { formatCurrency } from '@/lib/utils';
import { purchaseQuote } from '@/lib/purchaseQuote';
export function ItemTaxDetails({item}) {
  const quote=purchaseQuote(item);
  if(!quote)return <p role="status" className="text-xs text-muted-foreground">Consultando a composição do preço…</p>;
  return <div className="space-y-1 text-xs text-muted-foreground"><p>Valor dos itens: {formatCurrency(quote.base)}</p>{quote.levies.map((levy,index)=><p key={`${levy.rule_key}-${index}`}>{levy.name}{levy.nature==='percentage'?` (${(Number(levy.rate_snapshot)*100).toLocaleString('pt-BR',{maximumFractionDigits:4})}%)`:''}: {formatCurrency(Number(levy.tax_amount)*quote.quantity)}</p>)}{!quote.levies.length&&<p>Impostos e taxas: {formatCurrency(0)}</p>}<p className="font-medium text-foreground">Total do item: {formatCurrency(quote.total)}</p>{item.product_type==='subscription'&&<p>Assinatura · renovação {item.subscription_interval==='7 days'?'semanal':'mensal'}</p>}</div>;
}
export function PurchaseTotals({items}) {
  const quotes=items.map(purchaseQuote);
  if(quotes.some(item=>!item))return null;
  const sum=key=>quotes.reduce((total,item)=>total+item[key],0);
  return <dl className="space-y-1 border-t pt-3 text-sm">{[['base','Subtotal'],['taxes','Impostos'],['fees','Outras taxas'],['total','Total']].map(([key,label])=><div key={key} className={`flex flex-wrap justify-between gap-2 ${key==='total'?'pt-2 text-lg font-bold':''}`}><dt>{label}</dt><dd>{formatCurrency(sum(key))}</dd></div>)}</dl>;
}
