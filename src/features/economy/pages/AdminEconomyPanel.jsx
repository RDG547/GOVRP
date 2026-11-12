import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { runEconomicClose } from '@/lib/economy/api';
import {
  calibrationLabels,
  economicEventLabels,
  formatDate,
  formatCurrency,
  localizeCalibrationValue,
  periodStatusLabels,
  periodTypeLabels,
  runStatusLabels,
  runTypeLabels,
  sourceTableLabels,
} from '@/lib/economy/format';

const AdminEconomyPanel = ({ data, toast, onRefresh }) => {
  const [running, setRunning] = useState(null);

  const closePeriod = async (period) => {
    setRunning(period.id);
    try {
      const result = await runEconomicClose(period);
      toast({
        title: result?.status === 'not_due' ? 'Período ainda não venceu' : 'Fechamento concluído',
        description: result?.status === 'not_due'
          ? 'O motor preservou o calendário oficial e não forçou o fechamento.'
          : 'Indicadores e hashes foram atualizados.',
      });
      await onRefresh();
    } catch (error) {
      toast({ title: 'Fechamento bloqueado', description: error.message, variant: 'destructive' });
    } finally {
      setRunning(null);
    }
  };

  const health = data?.health;
  const ledger = health?.accounting || {};
  const monitoredDifferences = [
    ledger.population_difference,
    ledger.business_daily_revenue_difference,
    ledger.national_weekly_revenue_difference,
    ledger.healthcare_unlogged_amount,
    ledger.healthcare_unlogged_visits,
    ledger.business_daily_mismatch_count,
    ledger.national_weekly_mismatch_count,
    ledger.business_revenue_without_daily_row_count,
  ];
  const monitoredHealthy = monitoredDifferences.every(value => Math.abs(Number(value || 0)) < 0.005);
  const number = value => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      {health && (
        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-5 w-5 text-cyan-300" /> Integridade econômica e contábil
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Diagnóstico somente de leitura. Nenhum saldo, imposto, parâmetro ou preço é alterado.
              Conferido em {formatDate(health.checked_at)}.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Conciliação financeira</p>
              <Badge variant={monitoredHealthy ? 'outline' : 'destructive'}>
                {monitoredHealthy ? 'Sem divergências nos controles auditados' : 'Divergências a investigar'}
              </Badge>
              <p>Diferença na conta demográfica: {formatCurrency(ledger.population_difference)}</p>
              <p>Contas com saldo negativo: {number(health.financial?.negative_accounts)}</p>
              <p>Linhas de estoque empresarial negativas: {number(health.enterprise?.negative_inventory_lines)}</p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Empresas e produção</p>
              <p>Empresas ativas: {number(health.enterprise?.active_businesses)}</p>
              <p>Receita acumulada nas operações diárias: {formatCurrency(health.enterprise?.daily_revenue)}</p>
              <p>Folha provisionada: {formatCurrency(health.enterprise?.daily_payroll_accrued)}</p>
              <p>Custos de insumos: {formatCurrency(health.enterprise?.daily_input_cost)}</p>
              <p>Resultado operacional acumulado: {formatCurrency(health.enterprise?.operating_result)}</p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Mercado Nacional</p>
              <p>Quantidade nos estoques empresariais: {number(health.market?.business_inventory_quantity)}</p>
              <p>Quantidade no estoque físico nacional: {number(health.market?.national_physical_stock)}</p>
              <p>Compras registradas: {number(health.market?.completed_purchases)}</p>
              <p>Operações de consumo populacional: {number(health.market?.population_consumptions)}</p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Lançamentos fiscais</p>
              <p>Estabilizadores macroeconômicos simulados: {formatCurrency(health.fiscal?.macroeconomic_simulation_expenses)}</p>
              <p>Outras despesas registradas: {formatCurrency(health.fiscal?.other_recorded_expenses)}</p>
              <p>Receitas registradas: {formatCurrency(health.fiscal?.recorded_revenues)}</p>
              <p className="text-xs text-muted-foreground">
                Despesa macroeconômica simulada não é necessariamente uma transferência bancária do Tesouro.
              </p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Escala macroeconômica</p>
              <p>PIB anual de referência: {formatCurrency(health.macro?.base_annual_gdp_calibration)}</p>
              <p>Base atual anualizada: {formatCurrency(health.macro?.current_annualized_base_gdp)}</p>
              <p>População-base: {number(health.macro?.population_calibration)}</p>
              <p>População simulada atual: {number(health.macro?.current_population)}</p>
              <p className="text-xs text-muted-foreground">Valores para conferência, sem recalibração automática.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <p className="font-medium">Trabalho, investimentos e alertas</p>
              <p>Pagamentos salariais registrados: {number(health.jobs_investments?.salary_payments)}</p>
              <p>Ativos de renda fixa: {number(health.jobs_investments?.fixed_income_assets)}</p>
              <p>Ações cadastradas: {number(health.jobs_investments?.stock_assets)}</p>
              <p>Históricos de cotação: {number(health.jobs_investments?.stock_prices)}</p>
              <p>Alertas ativos: {number(health.alerts?.active)} · resolvidos: {number(health.alerts?.resolved)}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {data?.periods?.some(period => period.metadata?.causal_economy) && <Card><CardHeader><CardTitle>Fatores da atividade econômica</CardTitle></CardHeader><CardContent className="space-y-4">{data.periods.filter(period=>period.metadata?.causal_economy).slice(0,3).map(period=><div key={period.id} className="rounded-lg border p-3"><p className="mb-2 font-medium">{period.rp_month}/{period.rp_year} · ciclo mensal RP</p><dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries({consumption:'Consumo',investment:'Investimento',government:'Gasto público',exports:'Exportações',imports:'Importações',demand_index:'Demanda agregada',real_growth_factor:'Variação real',selic:'Selic'}).map(([key,label])=><div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{Number(period.metadata.causal_economy[key]).toLocaleString('pt-BR',{maximumFractionDigits:4})}{key==='selic'?'%':' ×'}</dd></div>)}</dl></div>)}</CardContent></Card>}
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-5 w-5 text-cyan-300" /> Execuções do motor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.runs || []).map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
                <div>
                  <p className="font-medium">{runTypeLabels[run.run_type] || 'Execução econômica'}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(run.started_at)}</p>
                </div>
                <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
                  {run.status === 'completed' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                  {runStatusLabels[run.status] || 'Situação desconhecida'}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-5 w-5 text-violet-300" /> Períodos econômicos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.periods || []).slice(0, 15).map((period) => (
              <div key={period.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 p-3">
                <div>
                  <p className="font-medium">
                    {periodTypeLabels[period.period_type] || 'Período'} · {period.rp_year}
                    {period.rp_quarter ? ` T${period.rp_quarter}` : ''}
                    {period.rp_month ? ` M${period.rp_month}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(period.starts_at)} — {formatDate(period.ends_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{periodStatusLabels[period.status] || 'Situação desconhecida'}</Badge>
                  {period.status !== 'closed' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running === period.id}
                      onClick={() => closePeriod(period)}
                    >
                      <RefreshCw className={`mr-1 h-3.5 w-3.5 ${running === period.id ? 'animate-spin' : ''}`} />
                      Fechar se vencido
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Eventos suspeitos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(data?.suspicious_events || []).length ? data.suspicious_events.map((event) => (
              <div key={event.id} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  {economicEventLabels[event.event_type] || 'Evento econômico em análise'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceTableLabels[event.source_table] || 'Origem econômica'}: {event.source_id} · {formatDate(event.created_at)}
                </p>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhum evento suspeito pendente.</p>}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Calibração versionada</CardTitle></CardHeader>
          <CardContent className="max-h-[480px] space-y-2 overflow-auto">
            {(data?.calibrations || []).map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 rounded-lg border border-border/50 p-3 text-sm">
                <div>
                  <p className="font-medium">{calibrationLabels[item.key] || 'Parâmetro econômico'}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <code className="max-w-[50%] whitespace-pre-wrap rounded bg-muted px-2 py-1 text-xs">
                  {JSON.stringify(localizeCalibrationValue(item.value), null, 2)}
                </code>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AdminEconomyPanel;
