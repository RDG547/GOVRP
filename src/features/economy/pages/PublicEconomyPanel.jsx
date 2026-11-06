import React from 'react';
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

  const historyChart = (key, label, color, divisor = 1) => <EconomyChart embedded title="Histórico oficial" description={divisor === 1_000_000 ? 'Valores em milhões, preservados em cada registro.' : 'Observações persistidas; períodos sem registro não são estimados.'} data={(data?.history || []).filter(item => item.indicators?.[key] != null).map(item => ({ label: periodLabel(item), value: Number(item.indicators[key]) / divisor }))} series={[{ key: 'value', name: label, color }]} height={170} />;

  return (
    <div className="space-y-6">
      <EconomyStateBanner state={state} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <EconomyCard label="PIB nominal em dólares" value={headline.gdp_total != null ? formatUsdCurrency(headline.gdp_total,true) : 'Sem referência em USD'} detail="Produção nominal em BRL dividida pelo câmbio oficial do mesmo registro" icon={BarChart3}>{historyChart('gdp_total','PIB nominal USD','#22d3ee',1_000_000)}</EconomyCard>
        <EconomyCard label="PIB nominal em reais" value={headline.gdp_nominal != null ? formatCurrency(headline.gdp_nominal,true) : 'Sem referência em BRL'} detail="Produção a preços correntes; o câmbio não altera este valor" icon={Factory} accent="text-emerald-300">{historyChart('gdp_nominal','PIB nominal BRL','#22c55e',1_000_000)}</EconomyCard>
        <EconomyCard label="PIB real em reais" value={headline.gdp_real != null ? formatCurrency(headline.gdp_real,true) : 'Sem referência de PIB real'} detail="Produção corrigida pela inflação" icon={BarChart3} accent="text-violet-300">{historyChart('gdp_real','PIB real BRL','#a78bfa',1_000_000)}</EconomyCard>
        <EconomyCard label="Crescimento do PIB" value={formatPercent(headline.gdp_growth_year_over_year ?? headline.gdp_growth_quarterly,true)} detail={headline.gdp_growth_year_over_year != null ? 'Acumulado em 12 meses' : 'Variação trimestral'} icon={TrendingUp}>{historyChart(headline.gdp_growth_year_over_year != null ? 'gdp_growth_year_over_year' : 'gdp_growth_quarterly','Crescimento (%)','#22d3ee')}</EconomyCard>
        <EconomyCard label="Inflação anual" value={formatPercent(headline.inflation_annual)} detail={`Meta de ${formatPercent(state.inflation_target)}`} icon={ShoppingBasket} accent="text-amber-300">{historyChart('inflation_annual','Inflação (%)','#f59e0b')}</EconomyCard>
        <EconomyCard label="Desemprego" value={formatPercent(headline.unemployment_rate)} detail="População economicamente ativa" icon={Briefcase} accent="text-violet-300">{historyChart('unemployment_rate','Desemprego (%)','#fb7185')}</EconomyCard>
        <EconomyCard label="Câmbio com o dólar" value={formatCurrency(state.exchange_rate)} detail="Reais por US$ 1" icon={CircleDollarSign} accent="text-green-300">{historyChart('exchange_usd','USD/BRL','#22c55e')}</EconomyCard>
        <EconomyCard label="Câmbio com o euro" value={formatCurrency(state.exchange_eur)} detail="Reais por € 1" icon={CircleDollarSign} accent="text-blue-300">{historyChart('exchange_eur','EUR/BRL','#60a5fa')}</EconomyCard>
        <EconomyCard label="Taxa Selic" value={formatPercent(state.current_selic)} detail="Ao ano no calendário RP" icon={Landmark} accent="text-emerald-300">{historyChart('current_selic','Selic (%)','#34d399')}</EconomyCard>
        <EconomyCard label="Poder de compra" value={formatIndex(headline.purchasing_power)} detail="Índice médio, base 100" icon={Gauge} accent="text-fuchsia-300">{historyChart('purchasing_power','Poder de compra','#e879f9')}</EconomyCard>
        <EconomyCard label="Confiança empresarial" value={formatIndex(state.business_confidence)} detail={`Consumidor: ${formatIndex(state.consumer_confidence)}`} icon={TrendingUp} accent="text-green-300">{historyChart('business_confidence','Confiança empresarial','#4ade80')}</EconomyCard>
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
              const sectorValue = sector.gdp_usd ?? sector.value_added;
              const maximum = Math.max(...data.sectors.map((item) => (
                asNumber(item.gdp_usd ?? item.value_added)
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
