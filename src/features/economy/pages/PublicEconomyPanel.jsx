import React, { useMemo } from 'react';
import {
  BarChart3,
  BadgeDollarSign,
  Briefcase,
  Building2,
  Bus,
  CircleDollarSign,
  Cpu,
  Factory,
  Gauge,
  Gamepad2,
  Gem,
  GraduationCap,
  HardHat,
  HeartPulse,
  Home,
  Landmark,
  MoreHorizontal,
  Palmtree,
  RadioTower,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Tractor,
  TrendingUp,
  Truck,
  Utensils,
  Zap,
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
  formatUsdCurrency,
  bulletinTypeLabels,
  severityLabels,
} from '@/lib/economy/format';

const periodLabel = (period) => {
  if (period.label) return period.label;
  if (period.period_type === 'month') return `${period.rp_month}/${period.rp_year}`;
  if (period.period_type === 'quarter') return `T${period.rp_quarter}/${period.rp_year}`;
  return `${period.rp_year}`;
};

const normalizeLabel = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR');

const sectorIconByName = new Map([
  ['industria', Factory],
  ['comercio', ShoppingCart],
  ['administracao publica', Landmark],
  ['agropecuaria', Tractor],
  ['servicos financeiros', BadgeDollarSign],
  ['saude', HeartPulse],
  ['construcao', HardHat],
  ['tecnologia', Cpu],
  ['transporte e logistica', Truck],
  ['petroleo e mineracao', Gem],
  ['educacao', GraduationCap],
  ['servicos profissionais', Briefcase],
  ['energia', Zap],
  ['outros servicos', MoreHorizontal],
  ['imobiliario', Building2],
  ['telecomunicacoes', RadioTower],
  ['turismo e lazer', Palmtree],
]);

const basketIconByName = new Map([
  ['alimentacao', Utensils],
  ['moradia', Home],
  ['transporte', Bus],
  ['saude', HeartPulse],
  ['educacao', GraduationCap],
  ['lazer', Gamepad2],
  ['vestuario', Shirt],
  ['energia', Zap],
]);

const iconFor = (mapping, name, fallback) => mapping.get(normalizeLabel(name)) || fallback;

const PublicEconomyPanel = ({ data }) => {
  const headline = data?.headline || {};
  const state = data?.state || {};

  const gdpHistory = useMemo(() => (data?.history || [])
    .filter((item) => item.indicators?.gdp_total != null || item.indicators?.gdp_real != null)
    .map((item) => ({
      label: periodLabel(item),
      gdp: asNumber(item.indicators.gdp_total ?? item.indicators.gdp_real) / 1_000_000,
    })), [data]);

  const priceHistory = useMemo(() => (data?.history || [])
    .filter((item) => (
      item.indicators?.inflation_annual != null
      || item.indicators?.unemployment_rate != null
    ))
    .map((item) => ({
      label: periodLabel(item),
      inflacao: asNumber(item.indicators?.inflation_annual),
      desemprego: asNumber(item.indicators?.unemployment_rate),
    })), [data]);

  const exchangeHistory = useMemo(() => (data?.history || [])
    .filter((item) => (
      item.indicators?.exchange_usd != null
      || item.indicators?.exchange_eur != null
    ))
    .map((item) => ({
      label: periodLabel(item),
      usd: asNumber(item.indicators?.exchange_usd),
      eur: asNumber(item.indicators?.exchange_eur),
    })), [data]);

  return (
    <div className="space-y-6">
      <EconomyStateBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard
          label="PIB total"
          value={formatUsdCurrency(headline.gdp_total ?? headline.gdp_nominal, true)}
          detail={state.country_rp_active ? 'estado nacional do GOV.RP em dólares' : 'valor em dólares'}
          icon={BarChart3}
        />
        <EconomyCard
          label="Crescimento do PIB"
          value={formatPercent(
            headline.gdp_growth_year_over_year ?? headline.gdp_growth_quarterly,
            true,
          )}
          detail={headline.gdp_growth_year_over_year != null ? 'acumulado em 12 meses' : 'variação trimestral'}
          icon={TrendingUp}
          accent="text-cyan-300"
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
          label="Câmbio com o dólar"
          value={formatCurrency(state.exchange_rate)}
          detail="por US$ 1"
          icon={CircleDollarSign}
          accent="text-green-300"
        />
        <EconomyCard
          label="Câmbio com o euro"
          value={formatCurrency(state.exchange_eur)}
          detail="por € 1"
          icon={CircleDollarSign}
          accent="text-blue-300"
        />
        <EconomyCard
          label="Taxa Selic"
          value={formatPercent(state.current_selic)}
          detail="ao ano no calendário RP"
          icon={Landmark}
          accent="text-emerald-300"
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
          title="Evolução do PIB nacional"
          description="US$ milhões desde o início do estado atual do RP."
          data={gdpHistory}
          series={[
            { key: 'gdp', name: 'PIB total', color: '#22d3ee' },
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
        <EconomyChart
          title="Evolução do câmbio"
          description="Valores oficiais persistidos em cada atualização do estado econômico."
          data={exchangeHistory}
          series={[
            { key: 'usd', name: 'USD/BRL', color: '#22c55e' },
            { key: 'eur', name: 'EUR/BRL', color: '#60a5fa' },
          ]}
          type="area"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="text-base">PIB por setor</CardTitle>
            <p className="text-xs text-muted-foreground">
              Participação setorial calculada sobre o mesmo PIB total do Panorama nacional.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {(data?.sectors || []).length ? data.sectors.map((sector) => {
              const sectorValue = sector.real_value_added ?? sector.value_added;
              const maximum = Math.max(...data.sectors.map((item) => (
                asNumber(item.real_value_added ?? item.value_added)
              )), 1);
              const width = Math.max(2, asNumber(sectorValue) / maximum * 100);
              const SectorIcon = iconFor(sectorIconByName, sector.name, BarChart3);
              return (
                <div key={sector.code}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
                        <SectorIcon className="h-4 w-4" />
                      </span>
                      <span className="truncate">{sector.name}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {formatUsdCurrency(sectorValue, true)}
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
            {(data?.basket || []).slice(0, 8).map((item) => {
              const BasketIcon = iconFor(basketIconByName, item.name, ShoppingBasket);
              return (
              <div key={item.code} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
                    <BasketIcon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="text-right">
                  <span className="font-medium">{formatIndex(item.index)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    peso {formatPercent(item.weight * 100)}
                  </span>
                </span>
              </div>
              );
            })}
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
