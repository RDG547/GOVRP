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

  return (
    <div className="space-y-6">
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
