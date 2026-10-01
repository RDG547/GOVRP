import { marketplacePolicy } from '@/lib/marketplaceFees';
import React from 'react';
import { formatCurrency } from '@/lib/utils';
export default function ListingCosts({ enterprise: source, business = false, renewal = false }) {
  const enterprise=marketplacePolicy(source,business,renewal);
  if(!enterprise)return <p role="status" className="text-sm">Consultando custos do anúncio…</p>;
  const fee=enterprise.active_listing_fee_enabled?Number(enterprise.active_listing_fee_amount):0;
  return <div className="space-y-1 rounded-xl border p-3 text-sm"><h3 className="font-semibold">Custos do anúncio · {business?'Pessoa Jurídica':'Pessoa Física'}</h3><p>Taxa de anúncio ativo: {fee>0?`${formatCurrency(fee)} / ${enterprise.active_listing_fee_period} dias reais`:'Gratuito'}</p><p>Comissão sobre venda: {enterprise.commission_type==='percentage'?`${enterprise.commission_value}%`:'0%'}</p><p>Taxa fixa por venda: {formatCurrency(Number(enterprise.fixed_sale_fee||0)+(enterprise.commission_type==='fixed'?Number(enterprise.commission_value):0))}</p><p className="text-xs text-muted-foreground">{renewal?'A renovação começa na confirmação. ':'A vigência começa na publicação. '}Não há débito automático na renovação. A comissão e a taxa de venda só são descontadas quando uma venda ocorre.</p></div>;
}
