import React from 'react';
import { Activity, CreditCard, Landmark, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EconomyCard from '@/features/economy/components/EconomyCard';
import PolicyStudio from '@/features/economy/components/PolicyStudio';
import { formatDate, formatIndex, formatPercent } from '@/lib/economy/format';

const CentralBankEconomyPanel = ({ data, toast, onRefresh }) => {
  const state = data?.state || {};
  const inflation = data?.inflation || {};
  const credit = data?.credit || {};

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard label="Selic atual" value={formatPercent(state.current_selic)} detail="taxa básica" icon={Landmark} />
        <EconomyCard label="Inflação anual" value={formatPercent(inflation.annual)} detail={`Meta: ${formatPercent(state.inflation_target)}`} icon={Target} accent="text-amber-300" />
        <EconomyCard label="Inadimplência familiar" value={formatPercent(credit.default_rate)} detail={`Empresas: ${formatPercent(credit.business_default_rate)}`} icon={CreditCard} accent="text-rose-300" />
        <EconomyCard label="Atividade econômica" value={state.economic_cycle?.replaceAll('_', ' ') || '—'} detail={`Confiança: ${formatIndex(state.business_confidence)}`} icon={Activity} accent="text-violet-300" />
      </div>

      <PolicyStudio
        toast={toast}
        onApplied={onRefresh}
        allowedPolicies={['selic', 'inflation_target']}
      />

      <Card className="border-border/70 bg-card/75">
        <CardHeader><CardTitle className="text-base">Reuniões monetárias</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(data?.meetings || []).length ? data.meetings.map((meeting) => (
            <div key={meeting.id} className="grid gap-2 rounded-xl border border-border/60 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Reunião</p>
                <p className="font-medium">#{meeting.meeting_number}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Data RP</p>
                <p className="font-medium">{formatDate(meeting.scheduled_at_real)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Expectativa</p>
                <p className="font-medium">{formatPercent(meeting.market_expectation)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Decisão</p>
                <p className="font-medium">{formatPercent(meeting.decided_selic)}</p>
              </div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">
              O calendário monetário será preenchido quando a primeira reunião for convocada.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CentralBankEconomyPanel;

