import SignedProfit from '@/components/business/SignedProfit';
import React from 'react';
import { Building2, Factory, Gauge, Landmark, Receipt, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EconomyCard from '@/features/economy/components/EconomyCard';
import { businessHealthLabels, formatCurrency, formatIndex, formatPercent } from '@/lib/economy/format';

const healthColors = {
  strong: 'bg-emerald-500/15 text-emerald-300',
  stable: 'bg-blue-500/15 text-blue-300',
  attention: 'bg-amber-500/15 text-amber-300',
  distressed: 'bg-rose-500/15 text-rose-300',
  insolvent: 'bg-red-500/15 text-red-300',
};

const recommendationFor = (snapshot, macro) => {
  if (!snapshot) return 'Opere sua empresa para gerar o primeiro diagnóstico setorial.';
  if (snapshot.default_risk > .65) return 'Priorize caixa e renegocie dívidas antes de expandir.';
  if (snapshot.capacity_utilization > 90 && snapshot.demand_index > 105) return 'A demanda justifica avaliar expansão de capacidade.';
  if (snapshot.capacity_utilization < 55) return 'Evite novas contratações até recuperar a utilização da capacidade.';
  if (macro?.selic > 15) return 'Crédito caro: prefira investimentos financiados por lucro retido.';
  return 'Operação equilibrada; acompanhe demanda e custos antes da próxima decisão.';
};

const BusinessEconomyPanel = ({ data }) => {
  const macro = data?.macro || {};
  const businesses = data?.businesses || [];

  if (!businesses.length) {
    return (
      <Card className="border-border/70 bg-card/75">
        <CardContent className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <Building2 className="mb-4 h-10 w-10 text-cyan-300" />
          <h3 className="text-lg font-semibold">Você ainda não possui empresa ativa</h3>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Abra uma empresa no Portal do Empreendedor. A atividade real dela alimentará produção,
            emprego, investimento e PIB setorial.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard label="Selic" value={formatPercent(macro.selic)} detail="custo-base do crédito" icon={Landmark} />
        <EconomyCard label="Confiança empresarial" value={formatIndex(macro.business_confidence)} detail="índice nacional" icon={TrendingUp} accent="text-emerald-300" />
        <EconomyCard label="Crescimento do PIB" value={formatPercent(macro.gdp_growth, true)} detail="trimestre contra trimestre" icon={Factory} accent="text-violet-300" />
        <EconomyCard label="Inflação" value={formatPercent(macro.inflation)} detail="pressão geral de custos" icon={Receipt} accent="text-amber-300" />
      </div>

      <div className="space-y-5">
        {businesses.map(({ business, sector, latest_snapshot: snapshot }) => (
          <Card key={business.id} className="border-border/70 bg-card/75">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Building2 className="h-5 w-5 text-cyan-300" />
                    {business.name}
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">{sector?.name || 'Setor pendente'}</p>
                </div>
                <Badge className={healthColors[snapshot?.health_status] || healthColors.stable}>
                  {businessHealthLabels[snapshot?.health_status] || 'Sem diagnóstico'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl bg-muted/35 p-4">
                  <p className="text-xs text-muted-foreground">Faturamento</p>
                  <p className="mt-1 font-semibold">{formatCurrency(snapshot?.gross_revenue)}</p>
                </div>
                <div className="rounded-xl bg-muted/35 p-4">
                  <p className="text-xs text-muted-foreground">Lucro líquido</p>
                  <p className="mt-1 font-semibold"><SignedProfit value={snapshot?.net_profit}/></p>
                </div>
                <div className="rounded-xl bg-muted/35 p-4">
                  <p className="text-xs text-muted-foreground">Capacidade utilizada</p>
                  <p className="mt-1 font-semibold">{formatPercent(snapshot?.capacity_utilization)}</p>
                </div>
                <div className="rounded-xl bg-muted/35 p-4">
                  <p className="text-xs text-muted-foreground">Demanda do setor</p>
                  <p className="mt-1 font-semibold">{formatIndex(snapshot?.demand_index)}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 p-4 text-sm">
                  <p className="mb-2 flex items-center gap-2 font-medium">
                    <Gauge className="h-4 w-4 text-violet-300" /> Diagnóstico
                  </p>
                  <p className="text-muted-foreground">{recommendationFor(snapshot, macro)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-muted-foreground">Produtividade</p>
                    <p className="font-medium">{formatIndex(snapshot?.productivity_index)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-muted-foreground">Risco de inadimplência</p>
                    <p className="font-medium">{formatPercent((snapshot?.default_risk || 0) * 100)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-muted-foreground">Investimento</p>
                    <p className="font-medium">{formatCurrency(snapshot?.investment)}</p>
                  </div>
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-muted-foreground">Empregos representados</p>
                    <p className="font-medium">{Number(snapshot?.employment || 0).toLocaleString('pt-BR')}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default BusinessEconomyPanel;
