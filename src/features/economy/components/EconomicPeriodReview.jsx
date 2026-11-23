import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { fetchEconomicPeriodReview } from '@/lib/economy/api';
import { formatCurrency, formatNumber, formatRpPeriod } from '@/lib/economy/format';

export default function EconomicPeriodReview({ periodId }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; }, [periodId]);
  const load = async () => {
    const request = ++sequence.current;
    setLoading(true); setError(null); setReview(null);
    try {
      const result = await fetchEconomicPeriodReview(periodId);
      if (sequence.current === request) setReview(result);
    } catch (failure) {
      if (sequence.current === request) setError(failure.message || 'Não foi possível consultar o período.');
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  };
  return <div className="mt-2 space-y-2">
    <Button variant="outline" size="sm" onClick={load} disabled={loading}>
      {loading ? 'Consultando…' : review ? 'Atualizar prévia de revisão' : 'Consultar prévia de revisão'}
    </Button>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {review && <div className="space-y-3 rounded-lg border border-border/60 p-3 text-xs" role="status">
      <p className="font-medium">{formatRpPeriod(review.period)} · prévia sem alteração de dados</p>
      {review.prospective_policy && <p>Início dos novos períodos completos (UTC RP): meses em {review.prospective_policy.month_from}; trimestres em {review.prospective_policy.quarter_from}; anos em {review.prospective_policy.year_from}.</p>}
      <p>PIB publicado: {formatCurrency(review.published_gdp)} · Revisões pendentes: {formatNumber(review.pending_revisions)}</p>
      <div className="overflow-x-auto"><table className="w-full text-left">
        <caption className="sr-only">Comparação dos limites e eventos do período</caption>
        <thead><tr><th className="p-2">Referência</th><th className="p-2">Início RP (UTC)</th><th className="p-2">Fim RP exclusivo (UTC)</th><th className="p-2">Eventos atuais</th><th className="p-2">PIB pela produção</th></tr></thead>
        <tbody>{[['stored', 'Gravada'], ['canonical', 'Canônica']].map(([key, label]) => <tr key={key} className="border-t border-border/40">
          <td className="p-2">{label}</td><td className="p-2 whitespace-nowrap">{new Date(review[`${key}_bounds`].rp_start).toISOString()}</td>
          <td className="p-2 whitespace-nowrap">{new Date(review[`${key}_bounds`].rp_end).toISOString()}</td>
          <td className="p-2">{formatNumber(review.ledger_comparison[key].event_count)}</td><td className="p-2">{formatCurrency(review.ledger_comparison[key].production_gdp)}</td>
        </tr>)}</tbody>
      </table></div>
      {!!review.children?.length && <p>Períodos integrantes com captura auditável: {review.children.filter(child => child.has_manifest).length}/{review.children.length}.</p>}
      <p className="text-muted-foreground">{review.warning} A correção histórica exige aprovação específica e plano de recuperação.</p>
    </div>}
  </div>;
}
