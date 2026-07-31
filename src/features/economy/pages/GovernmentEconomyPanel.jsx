import React from 'react';
import { BadgeDollarSign, Building2, Landmark, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EconomyCard from '@/features/economy/components/EconomyCard';
import PolicyStudio from '@/features/economy/components/PolicyStudio';
import {
  fiscalRiskLabels,
  formatCurrency,
  formatDate,
  formatPercent,
  policyLabels,
  policyStatusLabels,
  projectStatusLabels,
} from '@/lib/economy/format';

const GovernmentEconomyPanel = ({ data, toast, onRefresh }) => {
  const fiscal = data?.fiscal || {};
  const treasury = data?.treasury || {};
  const projects = data?.projects || [];
  const policies = data?.policies || [];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard label="Receita tributária" value={formatCurrency(fiscal.tax_revenue, true)} detail="último período fiscal" icon={BadgeDollarSign} />
        <EconomyCard label="Resultado primário" value={formatCurrency(fiscal.primary_result, true)} detail="antes dos juros" icon={Landmark} accent="text-emerald-300" />
        <EconomyCard label="Dívida / PIB" value={formatPercent(fiscal.debt_to_gdp)} detail={fiscal.fiscal_risk ? `Risco ${fiscalRiskLabels[fiscal.fiscal_risk] || 'não classificado'}` : 'Aguardando fechamento'} icon={Scale} accent="text-rose-300" />
        <EconomyCard label="Reservas do Tesouro" value={formatCurrency(treasury.treasury_balance, true)} detail={`Juros: ${formatCurrency(fiscal.debt_interest, true)}`} icon={Building2} accent="text-violet-300" />
      </div>

      <PolicyStudio toast={toast} onApplied={onRefresh} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Projetos governamentais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {projects.length ? projects.map((project) => (
              <div key={project.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{project.ministry}</p>
                  </div>
                  <Badge variant="outline">{projectStatusLabels[project.status] || 'Situação pendente'}</Badge>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.min(100, project.progress)}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>{project.progress.toLocaleString('pt-BR')}% concluído</span>
                  <span>{formatCurrency(project.spent_amount, true)} / {formatCurrency(project.approved_budget, true)}</span>
                </div>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhum projeto econômico foi proposto.</p>}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="text-base">Consequências das decisões</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {policies.length ? policies.map((policy) => (
              <div key={policy.id} className="rounded-xl border border-border/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{policyLabels[policy.policy_type] || policy.policy_type}</p>
                  <Badge>{policyStatusLabels[policy.status] || 'Situação pendente'}</Badge>
                </div>
                <p className="mt-1 text-sm">
                  {policy.previous_value?.toLocaleString('pt-BR')} → {policy.new_value?.toLocaleString('pt-BR')}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{policy.justification}</p>
                <p className="mt-2 text-xs text-muted-foreground">{formatDate(policy.announced_at_real)}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">Nenhuma decisão econômica registrada.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default GovernmentEconomyPanel;
