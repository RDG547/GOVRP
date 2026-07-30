const currency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
});

const percent = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export const formatCurrency = (value, compact = false) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return (compact ? compactCurrency : currency).format(parsed);
};

export const formatNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? number.format(parsed) : '—';
};

export const formatPercent = (value, signed = false) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  const prefix = signed && parsed > 0 ? '+' : '';
  return `${prefix}${percent.format(parsed)}%`;
};

export const formatIndex = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? number.format(parsed) : '—';
};

export const formatRpPeriod = (period) => {
  if (!period) return 'Período indisponível';
  if (period.period_type === 'month') return `${period.rp_month}/${period.rp_year}`;
  if (period.period_type === 'quarter') return `${period.rp_quarter}º tri. ${period.rp_year}`;
  return `Ano ${period.rp_year}`;
};

export const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
};

export const cycleLabels = {
  stable: 'Estável',
  expansion: 'Expansão',
  boom: 'Boom',
  overheating: 'Superaquecimento',
  slowdown: 'Desaceleração',
  technical_recession: 'Recessão técnica',
  recession: 'Recessão',
  deep_recession: 'Recessão profunda',
  stagflation: 'Estagflação',
  recovery: 'Recuperação',
};

export const laborLabels = {
  private_employee: 'Empregado privado',
  public_employee: 'Empregado público',
  entrepreneur: 'Empresário',
  self_employed: 'Autônomo',
  unemployed: 'Desempregado procurando trabalho',
  outside_labor_force: 'Fora da força de trabalho',
  retired: 'Aposentado',
  imprisoned: 'Preso',
  temporarily_unable: 'Temporariamente incapacitado',
};

export const policyLabels = {
  selic: 'Taxa Selic',
  inflation_target: 'Meta de inflação',
  consumption_tax: 'Imposto sobre consumo',
  corporate_tax: 'Imposto sobre empresas',
  income_tax: 'Imposto de renda',
  payroll_tax: 'Encargos sobre salários',
  minimum_wage: 'Salário mínimo',
  public_spending: 'Gasto público',
};

export const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

