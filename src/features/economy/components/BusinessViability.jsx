import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchEconomicSectorViability } from '@/lib/economy/api';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/economy/format';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useAuth } from '@/contexts/AuthContext';

export default function BusinessViability({ businessId }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const active = useRef(false);
  useEffect(() => { setData(null); setError(null); active.current = false; return () => { sequence.current += 1; }; }, [businessId, user?.id]);
  const load = async () => {
    if (!user?.id) return;
    active.current = true;
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const result = await fetchEconomicSectorViability(businessId);
      if (request === sequence.current) setData(result);
    } catch (failure) {
      if (request === sequence.current) setError(failure.message || 'Estimativa indisponível.');
    } finally { if (request === sequence.current) setLoading(false); }
  };
  useDomainRealtime('business-viability', user?.id, ['government_rules', 'business_types', 'business_recipes', 'economic_regions', 'business_inventory'], () => { if (active.current) load(); }, Boolean(user?.id));
  return <div className="mt-4 space-y-3 rounded-xl border border-border/60 p-4 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Viabilidade setorial</p>
      <Button variant="outline" size="sm" onClick={load} disabled={loading || !user?.id}>{loading ? 'Calculando…' : data ? 'Atualizar estimativa' : 'Consultar estimativa'}</Button>
    </div>
    {error && <p className="text-destructive" role="alert">{error}</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <p>Produção potencial/dia<br /><strong>{formatNumber(data.daily_output)}</strong></p>
        <p>Custos por dia<br /><strong>{formatCurrency(data.estimated_daily_cost)}</strong></p>
        <p>Vendas líquidas potenciais/dia<br /><strong>{formatCurrency(data.estimated_daily_net_sales)}</strong></p>
        <p>Utilização para equilíbrio<br /><strong>{formatPercent(data.break_even_utilization)}</strong></p>
      </div>
      {!!data.inputs?.length && <p>Insumos com tributos: {formatCurrency(data.input_daily_cost)}/dia. {data.inputs_available ? 'Há oferta disponível na consulta.' : 'O abastecimento atual é insuficiente para a capacidade estimada.'}</p>}
      {data.estimated_daily_margin <= 0 && <p className="text-amber-300">Nas condições de referência, a venda de toda a produção ainda não cobre os custos estimados. Revise preço, pessoal, produtividade e insumos.</p>}
      <p>Preço estimado para a oferta da empresa: <strong>{formatCurrency(data.suggested_unit_price)}</strong> por unidade. A aceitação pelo consumidor depende da concorrência e da renda disponível.</p>
      <p className="text-xs text-muted-foreground">{data.note} Valores por dia real; despesas diárias são distribuídas entre os meses do RP por competência.</p>
    </>}
  </div>;
}
