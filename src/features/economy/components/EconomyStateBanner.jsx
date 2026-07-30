import React from 'react';
import { Activity, Database, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cycleLabels, formatPercent } from '@/lib/economy/format';

const stateColors = {
  expansion: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  boom: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  recovery: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  overheating: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  slowdown: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  technical_recession: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  recession: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  deep_recession: 'border-red-500/30 bg-red-500/10 text-red-300',
  stagflation: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  stable: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
};

const EconomyStateBanner = ({ state }) => (
  <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/25 p-4 md:grid-cols-3">
    <div className="flex items-center gap-3">
      <Activity className="h-5 w-5 text-cyan-300" />
      <div>
        <p className="text-xs text-muted-foreground">Ciclo econômico</p>
        <Badge variant="outline" className={stateColors[state?.economic_cycle] || stateColors.stable}>
          {cycleLabels[state?.economic_cycle] || 'Calculando'}
        </Badge>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <Users className="h-5 w-5 text-violet-300" />
      <div>
        <p className="text-xs text-muted-foreground">Atividade dos jogadores</p>
        <p className="font-medium capitalize">{state?.player_activity_level?.replace('_', ' ') || '—'}</p>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <Database className="h-5 w-5 text-amber-300" />
      <div>
        <p className="text-xs text-muted-foreground">Composição híbrida</p>
        <p className="font-medium">
          {formatPercent((state?.player_share || 0) * 100)} jogadores ·{' '}
          {formatPercent((state?.simulated_share || 0) * 100)} base
        </p>
      </div>
    </div>
  </div>
);

export default EconomyStateBanner;

