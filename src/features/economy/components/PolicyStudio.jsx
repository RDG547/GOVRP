import React, { useState } from 'react';
import { Calculator, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyPolicy, simulatePolicy } from '@/lib/economy/api';
import { policyLabels } from '@/lib/economy/format';

const DEFAULT_POLICIES = [
  'selic',
  'inflation_target',
  'consumption_tax',
  'corporate_tax',
  'income_tax',
  'payroll_tax',
  'minimum_wage',
  'public_spending',
];

const Scenario = ({ title, value, tone }) => (
  <div className={`rounded-xl border p-4 ${tone}`}>
    <p className="mb-3 font-medium">{title}</p>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      {Object.entries(value || {})
        .filter(([key, entry]) => typeof entry === 'number' && !['previous_value', 'new_value', 'confidence'].includes(key))
        .slice(0, 8)
        .map(([key, entry]) => (
          <div key={key}>
            <p className="text-muted-foreground">{key.replaceAll('_', ' ')}</p>
            <p className="font-medium">{entry > 0 ? '+' : ''}{entry.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</p>
          </div>
        ))}
    </div>
  </div>
);

const PolicyStudio = ({ toast, onApplied, allowedPolicies = DEFAULT_POLICIES }) => {
  const [form, setForm] = useState({
    policyType: allowedPolicies[0],
    newValue: '',
    marketExpectation: '',
    justification: '',
  });
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const simulate = async () => {
    if (form.newValue === '') return;
    setLoading(true);
    try {
      setSimulation(await simulatePolicy(form.policyType, form.newValue));
    } catch (error) {
      toast({ title: 'Simulação indisponível', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!simulation || form.justification.trim().length < 20) {
      toast({
        title: 'Complete a simulação e a justificativa',
        description: 'A justificativa precisa ter ao menos 20 caracteres.',
        variant: 'destructive',
      });
      return;
    }
    setApplying(true);
    try {
      await applyPolicy(form);
      toast({ title: 'Decisão econômica registrada', description: 'Os efeitos serão transmitidos gradualmente.' });
      setSimulation(null);
      setForm((current) => ({ ...current, newValue: '', marketExpectation: '', justification: '' }));
      await onApplied?.();
    } catch (error) {
      toast({ title: 'Decisão bloqueada', description: error.message, variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card className="border-border/70 bg-card/75">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="h-5 w-5 text-cyan-300" />
          Simulador de políticas
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Projeções são cenários com incerteza, não garantias. A confirmação gera efeitos com defasagem.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="policy-type">Política</Label>
            <select
              id="policy-type"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.policyType}
              onChange={(event) => {
                setForm((current) => ({ ...current, policyType: event.target.value }));
                setSimulation(null);
              }}
            >
              {allowedPolicies.map((policy) => (
                <option key={policy} value={policy}>{policyLabels[policy] || policy}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="policy-value">Novo valor</Label>
            <Input
              id="policy-value"
              type="number"
              step="0.01"
              value={form.newValue}
              onChange={(event) => {
                setForm((current) => ({ ...current, newValue: event.target.value }));
                setSimulation(null);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="market-expectation">Expectativa do mercado</Label>
            <Input
              id="market-expectation"
              type="number"
              step="0.01"
              value={form.marketExpectation}
              onChange={(event) => setForm((current) => ({
                ...current,
                marketExpectation: event.target.value,
              }))}
            />
          </div>
        </div>
        <Button variant="outline" onClick={simulate} disabled={loading || form.newValue === ''}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calculator className="mr-2 h-4 w-4" />}
          Gerar três cenários
        </Button>

        {simulation ? (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Scenario title="Otimista" value={simulation.optimistic} tone="border-emerald-500/25 bg-emerald-500/5" />
              <Scenario title="Cenário-base" value={simulation.base} tone="border-cyan-500/25 bg-cyan-500/5" />
              <Scenario title="Pessimista" value={simulation.pessimistic} tone="border-rose-500/25 bg-rose-500/5" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policy-justification">Justificativa oficial</Label>
              <textarea
                id="policy-justification"
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Explique a decisão, o diagnóstico e os riscos considerados..."
                value={form.justification}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  justification: event.target.value,
                }))}
              />
            </div>
            <Button onClick={apply} disabled={applying}>
              {applying
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Confirmar decisão
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default PolicyStudio;

