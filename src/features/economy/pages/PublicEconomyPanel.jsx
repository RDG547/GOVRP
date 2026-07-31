import React, { useMemo } from 'react';
import {
  BarChart3,
  Briefcase,
  CircleDollarSign,
  Gauge,
  Landmark,
  Scale,
  ShoppingBasket,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EconomyCard from '@/features/economy/components/EconomyCard';
import EconomyChart from '@/features/economy/components/EconomyChart';
import EconomyStateBanner from '@/features/economy/components/EconomyStateBanner';
import {
  asNumber,
  formatCurrency,
  formatDate,
  formatIndex,
  formatPercent,
  bulletinTypeLabels,
  severityLabels,
} from '@/lib/economy/format';

const periodLabel = (period) => {
  if (period.period_type === 'month') return `${period.rp_month}/${period.rp_year}`;
  if (period.period_type === 'quarter') return `T${period.rp_quarter}/${period.rp_year}`;
  return `${period.rp_year}`;
};

const PublicEconomyPanel = ({ data }) => {
  const headline = data?.headline || {};
  const state = data?.state || {};

  const gdpHistory = useMemo(() => (data?.history || [])
    .filter((item) => item.period_type === 'quarter' && item.indicators?.gdp_real != null)
    .map((item) => ({
      label: periodLabel(item),
      real: asNumber(item.indicators.gdp_real) / 1_000_000,
      nominal: asNumber(item.indicators.gdp_nominal) / 1_000_000,
    })), [data]);

  const priceHistory = useMemo(() => (data?.history || [])
    .filter((item) => item.period_type === 'month')
    .map((item) => ({
      label: periodLabel(item),
      inflacao: asNumber(item.indicators?.inflation_annual),
      desemprego: asNumber(item.indicators?.unemployment_rate),
    })), [data]);

  return (
    <div className="space-y-6">
      <EconomyStateBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard
          label="PIB real trimestral"
          value={formatCurrency(headline.gdp_real, true)}
          detail="preços constantes"
          trend={headline.gdp_growth_quarterly}
          icon={BarChart3}
        />
        <EconomyCard
          label="Inflação anual"
          value={formatPercent(headline.inflation_annual)}
          detail={`meta de ${formatPercent(state.inflation_target)}`}
          icon={ShoppingBasket}
          accent="text-amber-300"
        />
        <EconomyCard
          label="Desemprego"
          value={formatPercent(headline.unemployment_rate)}
          detail="população economicamente ativa"
          icon={Briefcase}
          accent="text-violet-300"
        />
        <EconomyCard
          label="Taxa Selic"
          value={formatPercent(state.current_selic)}
          detail="ao ano no calendário RP"
          icon={Landmark}
          accent="text-emerald-300"
        />
        <EconomyCard
          label="PIB nominal"
          value={formatCurrency(headline.gdp_nominal, true)}
          detail="preços do período"
          icon={CircleDollarSign}
        />
        <EconomyCard
          label="Dívida / PIB"
          value={formatPercent(headline.debt_to_gdp)}
          detail={`Dívida ${formatCurrency(state.public_debt, true)}`}
          icon={Scale}
          accent="text-rose-300"
        />
        <EconomyCard
          label="Poder de compra"
          value={formatIndex(headline.purchasing_power)}
          detail="índice médio, base 100"
          icon={Gauge}
          accent="text-fuchsia-300"
        />
        <EconomyCard
          label="Confiança empresarial"
          value={formatIndex(state.business_confidence)}
          detail={`Consumidor: ${formatIndex(state.consumer_confidence)}`}
          icon={TrendingUp}
          accent="text-green-300"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <EconomyChart
          title="PIB nominal e real"
          description="R$ milhões por trimestre do RP."
          data={gdpHistory}
          series={[
            { key: 'real', name: 'PIB real', color: '#22d3ee' },
            { key: 'nominal', name: 'PIB nominal', color: '#a78bfa' },
          ]}
          type="area"
        />
        <EconomyChart
          title="Inflação e desemprego"
          description="Variações oficiais nos fechamentos mensais."
          data={priceHistory}
          series={[
            { key: 'inflacao', name: 'Inflação anual', color: '#f59e0b' },
            { key: 'desemprego', name: 'Desemprego', color: '#fb7185' },
          ]}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="text-base">PIB por setor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.sectors || []).length ? data.sectors.map((sector) => {
              const maximum = Math.max(...data.sectors.map((item) => asNumber(item.value_added)), 1);
              const width = Math.max(2, asNumber(sector.value_added) / maximum * 100);
              return (
                <div key={sector.code}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span>{sector.name}</span>
                    <span className="text-muted-foreground">
                      {formatCurrency(sector.value_added, true)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-violet-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            }) : (
              <p className="text-sm text-muted-foreground">
                O primeiro ranking será publicado no fechamento trimestral.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="text-base">Cesta oficial de preços</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.basket || []).slice(0, 8).map((item) => (
              <div key={item.code} className="flex items-center justify-between gap-3 text-sm">
                <span>{item.name}</span>
                <span className="text-right">
                  <span className="font-medium">{formatIndex(item.index)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    peso {formatPercent(item.weight * 100)}
                  </span>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Boletins oficiais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {(data?.bulletins || []).map((bulletin) => (
              <article key={bulletin.id} className="rounded-xl border border-border/60 p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{bulletin.title}</h3>
                  <Badge variant="outline">{bulletinTypeLabels[bulletin.bulletin_type] || 'Boletim econômico'}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{bulletin.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">{formatDate(bulletin.published_at)}</p>
              </article>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Alertas econômicos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(data?.alerts || []).length ? data.alerts.map((alert) => (
              <div key={alert.id} className="rounded-xl border border-border/60 p-4">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="font-medium">{alert.title}</p>
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : 'outline'}>
                    {severityLabels[alert.severity] || 'Atenção'}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{alert.message}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhum alerta econômico ativo.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicEconomyPanel;
