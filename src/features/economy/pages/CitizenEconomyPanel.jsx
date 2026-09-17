import { formatLocaleBR } from '@/lib/dateTime';
import React, { useMemo, useState } from 'react';
import { Briefcase, CreditCard, Gauge, PiggyBank, ShoppingCart, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EconomyCard from '@/features/economy/components/EconomyCard';
import EconomyChart from '@/features/economy/components/EconomyChart';
import { updateLaborStatus } from '@/lib/economy/api';
import {
  asNumber,
  formatCurrency,
  formatIndex,
  formatPercent,
  laborLabels,
  povertyStatusLabels,
} from '@/lib/economy/format';

const CitizenEconomyPanel = ({ data, onRefresh, toast }) => {
  const snapshot = data?.latest_snapshot || {};
  const status = data?.status || {};
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    laborStatus: ['self_employed', 'unemployed', 'outside_labor_force', 'retired']
      .includes(status.labor_status) ? status.labor_status : 'outside_labor_force',
    activelySeeking: Boolean(status.actively_seeking),
    availableForWork: status.available_for_work !== false,
  });

  const history = useMemo(() => (data?.history || []).map((item) => ({
    label: formatLocaleBR(new Date(item.ends_at_rp), 'toLocaleDateString', 'pt-BR', { month: 'short', year: '2-digit' }),
    poder: asNumber(item.purchasing_power_index),
    renda: asNumber(item.real_income),
    consumo: asNumber(item.consumption),
  })), [data]);

  const saveStatus = async () => {
    setSaving(true);
    try {
      await updateLaborStatus(form);
      toast({ title: 'Situação econômica atualizada' });
      await onRefresh();
    } catch (error) {
      toast({ title: 'Não foi possível atualizar', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <EconomyCard label="Renda nominal" value={formatCurrency(snapshot.nominal_income)} detail="antes da inflação" icon={Wallet} />
        <EconomyCard label="Renda real" value={formatCurrency(snapshot.real_income)} detail="em poder de compra" icon={Gauge} accent="text-fuchsia-300" />
        <EconomyCard label="Consumo no período" value={formatCurrency(snapshot.consumption)} detail={`Cesta: ${formatCurrency(snapshot.basket_cost)}`} icon={ShoppingCart} accent="text-amber-300" />
        <EconomyCard label="Poupança" value={formatCurrency(snapshot.savings)} detail={`Dívidas: ${formatCurrency(snapshot.debt)}`} icon={PiggyBank} accent="text-emerald-300" />
        <EconomyCard label="Poder de compra" value={formatIndex(snapshot.purchasing_power_index)} detail="índice base 100" icon={Gauge} />
        <EconomyCard label="Renda disponível" value={formatCurrency(snapshot.disposable_income)} detail="após impostos e parcelas" icon={Wallet} />
        <EconomyCard label="Serviço da dívida" value={formatCurrency(snapshot.debt_service)} detail="parcelas e juros" icon={CreditCard} accent="text-rose-300" />
        <EconomyCard label="Confiança pessoal" value={formatIndex(snapshot.consumer_confidence)} detail={povertyStatusLabels[snapshot.poverty_status] || 'Classificação pendente'} icon={Briefcase} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <EconomyChart
          title="Sua economia real"
          description="Evolução de renda, consumo e poder de compra nos meses do RP."
          data={history}
          series={[
            { key: 'poder', name: 'Poder de compra', color: '#22d3ee' },
            { key: 'renda', name: 'Renda real', color: '#a78bfa' },
            { key: 'consumo', name: 'Consumo', color: '#f59e0b' },
          ]}
        />
        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="text-base">Situação no mercado de trabalho</CardTitle>
            <p className="text-sm text-muted-foreground">
              Empregos, empresas e prisão são derivados automaticamente. Você controla apenas estados voluntários.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted/45 p-3 text-sm">
              Atual: <strong>{laborLabels[status.labor_status] || 'Não informado'}</strong>
            </div>
            <div className="space-y-2">
              <Label htmlFor="labor-status">Situação declarada</Label>
              <Select
                value={form.laborStatus}
                onValueChange={(laborStatus) => {
                  setForm((current) => ({
                    ...current,
                    laborStatus,
                    activelySeeking: laborStatus === 'unemployed',
                  }));
                }}
              >
                <SelectTrigger id="labor-status">
                  <SelectValue placeholder="Escolha a situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="self_employed">Autônomo</SelectItem>
                  <SelectItem value="unemployed">Desempregado procurando trabalho</SelectItem>
                  <SelectItem value="outside_labor_force">Fora da força de trabalho</SelectItem>
                  <SelectItem value="retired">Aposentado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.availableForWork}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  availableForWork: event.target.checked,
                }))}
              />
              Disponível para trabalhar
            </label>
            <Button className="w-full" disabled={saving} onClick={saveStatus}>
              {saving ? 'Salvando...' : 'Atualizar situação'}
            </Button>
            <div className="space-y-1 border-t border-border/60 pt-4 text-sm text-muted-foreground">
              <p>Vagas abertas: {formatNumberSafe(data?.opportunities?.open_vacancies)}</p>
              <p>Salário médio: {formatCurrency(data?.opportunities?.average_wage)}</p>
              <p>Inflação: {formatPercent(data?.opportunities?.inflation_annual)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const formatNumberSafe = (value) => asNumber(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export default CitizenEconomyPanel;
