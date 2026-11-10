import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
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

const GOVERNMENT_FISCAL_POLICIES = [
  'consumption_tax', 'corporate_tax', 'income_tax', 'payroll_tax',
  'minimum_wage', 'public_spending',
];
const READABLE_MONETARY_POLICIES = ['selic', 'inflation_target'];

const GovernmentEconomyPanel = ({ data, toast, onRefresh }) => {
  const { user } = useAuth();
  const [ministry, setMinistry] = useState(null);
  const [ministryLoaded, setMinistryLoaded] = useState(false);
  const [currentRates, setCurrentRates] = useState(null);
  const [economyPortfolio, setEconomyPortfolio] = useState(false);
  const isAdmin = user?.is_platform_admin === true || user?.role === 'Admin';
  const executiveRoles = [user?.role, ...(user?.effective_roles || [])];
  const executive = executiveRoles.includes('Presidente') || isAdmin;

  useEffect(() => {
    let active = true;
    if (!user?.id || executive) {
      setMinistry(null);
      setEconomyPortfolio(false);
      setMinistryLoaded(true);
      return;
    }
    setMinistryLoaded(false);
    void Promise.all([
      supabase.from('ministers').select('ministry,status').eq('user_id',user.id)
        .eq('status','active').limit(1).maybeSingle(),
      supabase.rpc('current_minister_has_portfolio', { p_ministry_name: 'Ministério da Economia' }),
    ]).then(([appointmentResult, portfolioResult]) => {
      if (!active) return;
      if (appointmentResult.error) console.warn('ministry-portfolio', appointmentResult.error);
      if (portfolioResult.error) console.warn('merged-economy-portfolio', portfolioResult.error);
      setMinistry(appointmentResult.error ? null : appointmentResult.data?.ministry || null);
      setEconomyPortfolio(!portfolioResult.error && portfolioResult.data === true);
      setMinistryLoaded(true);
    }).catch(error => {
      if (!active) return;
      console.warn('economy-portfolio-check', error);
      setMinistry(null);
      setEconomyPortfolio(false);
      setMinistryLoaded(true);
    });
    return () => { active = false; };
  }, [user?.id, executive]);

  useEffect(() => {
    let active = true;
    void supabase.from('economic_state').select('current_selic,inflation_target,updated_at')
      .eq('id',true).maybeSingle()
      .then(({ data: state, error }) => {
        if (!active) return;
        if (error) console.warn('economy-current-policy', error);
        setCurrentRates(error ? null : state);
      });
    return () => { active = false; };
  }, [data]);

  const canDecideFiscal = executive || ministry === 'Ministério da Economia' || economyPortfolio;
  const canDecideMonetary = executive;
  const allowedPolicies = useMemo(() => [
    ...(canDecideMonetary ? READABLE_MONETARY_POLICIES : []),
    ...(canDecideFiscal ? GOVERNMENT_FISCAL_POLICIES : []),
  ], [canDecideFiscal, canDecideMonetary]);

  const latestByPolicy = useMemo(() => {
    const found = new Map();
    (data?.policies || []).forEach((policy) => {
      if (!found.has(policy.policy_type) && ['effective','announced'].includes(policy.status)) {
        found.set(policy.policy_type, policy);
      }
    });
    return found;
  }, [data?.policies]);

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

      <Card className="border-border/70 bg-card/75">
        <CardHeader>
          <CardTitle className="text-base">Políticas e parâmetros atuais</CardTitle>
          <p className="text-sm text-muted-foreground">
            Acompanhamento dos parâmetros monetários e das últimas decisões fiscais registradas.
            A Selic e a meta de inflação pertencem à autoridade monetária, não ao ministro da Economia.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[...READABLE_MONETARY_POLICIES, ...GOVERNMENT_FISCAL_POLICIES].map((policy) => {
            const recorded = latestByPolicy.get(policy);
            const stateValue = policy === 'selic' ? currentRates?.current_selic
              : policy === 'inflation_target' ? currentRates?.inflation_target : null;
            const value = stateValue == null ? recorded?.new_value : stateValue;
            return <div key={policy} className="rounded-xl border border-border/60 bg-background/30 p-3">
              <p className="text-sm font-medium">{policyLabels[policy] || policy}</p>
              <p className="mt-2 text-xl font-semibold">{value == null ? 'Não informado' :
                (['minimum_wage','public_spending'].includes(policy) ? formatCurrency(value) : formatPercent(value))}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stateValue != null ? 'Parâmetro atual do motor econômico'
                  : recorded ? (recorded.status === 'announced' ? 'Última decisão anunciada' : 'Última decisão efetiva registrada')
                  : 'Sem decisão efetiva no histórico consultado'}
              </p>
            </div>;
          })}
        </CardContent>
      </Card>

      {ministryLoaded && allowedPolicies.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {executive ? 'Gestão econômica do Governo.'
              : 'Ministério da Economia: você pode decidir políticas fiscais. As políticas monetárias são apenas para consulta.'}
          </p>
          <PolicyStudio toast={toast} onApplied={onRefresh} allowedPolicies={allowedPolicies} />
        </>
      ) : (
        <p className="rounded-lg border border-border/60 bg-card/50 p-4 text-sm text-muted-foreground">
          {ministryLoaded
            ? 'Este painel permite acompanhar a economia. Ações de política fiscal exigem a titularidade ativa do Ministério da Economia ou a Presidência.'
            : 'Verificando suas competências ministeriais...'}
        </p>
      )}

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
