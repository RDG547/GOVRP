import React from 'react';
import { AlertTriangle, Factory, CalendarClock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, formatRpPeriod } from '@/lib/economy/format';
import { closeStatusMessage } from '@/lib/economy/period-status';
import EconomicPeriodReview from './EconomicPeriodReview';
import AutonomousEconomyControl from './AutonomousEconomyControl';

export default function StructuralEconomyStatus({ data, preview, error, onChanged }) {
  if (error) return <Card className="border-amber-500/30"><CardContent className="pt-5 text-sm" role="status">
    Diagnóstico estrutural indisponível: {error}. Os demais indicadores continuam disponíveis.
  </CardContent></Card>;
  if (!data) return null;
  const shortages = (data.supply || []).filter(row => row.missing_supplier || Number(row.available_stock) < Number(row.required_daily));
  const divergences = (data.historical_divergences || []).filter(row => Math.abs(Number(row.difference)) > .01 || row.contained_months !== 3);
  const blocked = (data.periods || []).filter(row => row.readiness?.status?.startsWith('blocked_'));
  return <Card className="border-border/70 bg-card/75">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Factory className="h-5 w-5 text-cyan-300" />
      Abastecimento e integridade dos períodos
    </CardTitle><p className="text-xs text-muted-foreground">
      Calendário macroeconômico em UTC. Produção por dia real; folha semanal. Capacidades são potenciais, sujeitas a pessoal, caixa e insumos.
    </p></CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(data.companies || []).map(row => <div key={`${row.control_kind}:${row.status}`} className="rounded-xl border border-border/60 p-3 text-sm">
          <p>{row.control_kind === 'population' ? 'Empresas NPC' : 'Empresas de jogadores'} · {row.status === 'active' ? 'ativas' : row.status}</p>
          <p className="text-xl font-semibold">{formatNumber(row.count)}</p>
        </div>)}
        <div className="rounded-xl border border-border/60 p-3 text-sm"><p>Revisões pendentes por eventos atrasados</p><p className="text-xl font-semibold">{formatNumber(data.pending_revisions)}</p></div>
        <div className="rounded-xl border border-border/60 p-3 text-sm"><p>Poupança transacional da população</p><p className="font-semibold">{formatCurrency(preview?.population_savings)}</p></div>
      </div>
      <details className="rounded-xl border border-border/60 p-4" open={blocked.length > 0}>
        <summary className="cursor-pointer font-medium"><CalendarClock className="mr-2 inline h-4 w-4" />Fechamentos bloqueados ({blocked.length})</summary>
        <ul className="mt-3 space-y-2 text-sm">{blocked.map(row => <li key={row.id}>
          {formatRpPeriod(row)}: {closeStatusMessage(row.readiness?.status).description}
          <EconomicPeriodReview periodId={row.id} />
        </li>)}</ul>
        {!blocked.length && <p className="mt-3 text-sm text-muted-foreground">Nenhum bloqueio nos períodos consultados.</p>}
      </details>
      <details className="rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer font-medium">Gargalos de abastecimento ({shortages.length})</summary>
        <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Necessidade diária potencial e estoque livre por recurso</caption>
          <thead><tr className="border-b"><th className="p-2">Recurso</th><th className="p-2">Necessidade/dia</th><th className="p-2">Estoque livre</th><th className="p-2">Fornecedores com estoque</th></tr></thead>
          <tbody>{shortages.map(row => <tr key={row.resource_code} className="border-b border-border/40">
            <td className="p-2">{row.resource_name}</td><td className="p-2">{formatNumber(row.required_daily)}</td>
            <td className="p-2">{formatNumber(row.available_stock)}</td><td className="p-2">{formatNumber(row.supplier_count)}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
      <details className="rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer font-medium"><AlertTriangle className="mr-2 inline h-4 w-4" />Histórico que exige revisão ({divergences.length})</summary>
        <p className="my-3 text-xs text-muted-foreground">Comparação de leitura. Diferenças não são revisões aprovadas do PIB.</p>
        <ul className="space-y-3 text-sm">{divergences.map(row => <li key={row.id}>
          <p className="font-medium">{row.rp_year}/T{row.rp_quarter} · {row.contained_months} meses completamente contidos</p>
          <p>Publicado: {formatCurrency(row.published_gdp)} · Eventos atuais: {formatCurrency(row.current_gdp)}</p>
          <p>Diferença: {formatCurrency(row.difference)}</p>
          <EconomicPeriodReview periodId={row.id} />
        </li>)}</ul>
      </details>
      <div className="rounded-xl border border-border/60 p-4 text-sm">
        <p className="mb-2 font-medium">Empresas autônomas <Badge variant="outline">{preview?.config?.enabled ? 'Piloto ativado' : 'Aguardando homologação'}</Badge></p>
        <p>{preview?.candidates?.length || 0} oportunidades com margem potencial positiva; a demanda efetiva não é garantida.</p>
        <p className="mt-2 text-xs text-muted-foreground">Entradas usam poupança finita, preservam uma reserva de consumo e respeitam exigências de registro. Não há aporte automático do Tesouro.</p>
        <AutonomousEconomyControl preview={preview} onChanged={onChanged} />
      </div>
      {!!preview?.sector_viability?.length && <details className="rounded-xl border border-border/60 p-4">
        <summary className="cursor-pointer font-medium">Viabilidade por setor ({preview.sector_viability.length} tipos)</summary>
        <p className="my-3 text-xs text-muted-foreground">Estimativa com equipe mínima, infraestrutura regional e insumos tributados. Pressupõe venda integral; a demanda não é garantida.</p>
        <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs">
          <caption className="sr-only">Custos e ponto de equilíbrio dos tipos empresariais</caption>
          <thead><tr><th className="p-2">Atividade</th><th className="p-2">Custos/dia</th><th className="p-2">Vendas líquidas/dia</th><th className="p-2">Utilização de equilíbrio</th></tr></thead>
          <tbody>{preview.sector_viability.map(row => <tr key={row.business_type_id} className="border-t border-border/40">
            <td className="p-2">{row.name}</td><td className="p-2">{formatCurrency(row.estimated_daily_cost)}</td><td className="p-2">{formatCurrency(row.estimated_daily_net_sales)}</td>
            <td className="p-2">{row.break_even_utilization == null ? 'Sem margem variável' : `${formatNumber(row.break_even_utilization)}%`}</td>
          </tr>)}</tbody>
        </table></div>
      </details>}
      <div className="rounded-xl border border-border/60 p-4 text-sm">
        <p className="font-medium">Conciliação fiscal</p>
        <p>Dívida macroeconômica: {formatCurrency(data.fiscal?.simulated_debt)}</p>
        <p>Tesouro operacional: {formatCurrency(data.fiscal?.operational_treasury)}</p>
        <p>Ativos financeiros nacionais: {formatCurrency(data.fiscal?.national_assets)}</p>
        <p className="mt-2 text-xs text-muted-foreground">Tributos estimados sobre a atividade simulada e arrecadação transacional são conciliados no fechamento. Estimativas nacionais não representam dinheiro disponível no banco.</p>
        {!!data.fiscal?.months?.length && <div className="mt-3 overflow-auto"><table className="w-full text-left text-xs">
          <caption className="sr-only">Conciliação fiscal mensal</caption>
          <thead><tr><th className="p-2">Mês RP</th><th className="p-2">Tributos estimados</th><th className="p-2">Consumo público simulado</th><th className="p-2">Receitas operacionais</th></tr></thead>
          <tbody>{data.fiscal.months.map(month => <tr key={`${month.rp_year}-${month.rp_month}`} className="border-t border-border/40">
            <td className="p-2">{month.rp_month}/{month.rp_year}</td><td className="p-2">{formatCurrency(month.estimated_tax)}</td>
            <td className="p-2">{formatCurrency(month.government_consumption)}</td><td className="p-2">{formatCurrency(month.operational_revenue)}</td>
          </tr>)}</tbody>
        </table></div>}
        {!data.fiscal?.months?.length && <p className="mt-2 text-xs text-muted-foreground">Aguardando o primeiro mês completo do modelo prospectivo.</p>}
      </div>
    </CardContent>
  </Card>;
}
