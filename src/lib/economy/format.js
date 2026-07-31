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

export const activityLevelLabels = {
  very_low: 'Muito baixa',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  very_high: 'Muito alta',
};

export const povertyStatusLabels = {
  not_classified: 'Não classificado',
  extreme_poverty: 'Extrema pobreza',
  poverty: 'Pobreza',
  vulnerable: 'Vulnerável',
  middle_income: 'Renda média',
  high_income: 'Renda alta',
};

export const businessHealthLabels = {
  strong: 'Forte',
  stable: 'Estável',
  attention: 'Em atenção',
  distressed: 'Em dificuldade',
  insolvent: 'Insolvente',
};

export const fiscalRiskLabels = {
  low: 'baixo',
  moderate: 'moderado',
  high: 'alto',
  critical: 'crítico',
};

export const projectStatusLabels = {
  proposed: 'Proposto',
  analysis: 'Em análise',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  planned: 'Planejado',
  in_progress: 'Em andamento',
  paused: 'Pausado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const policyStatusLabels = {
  draft: 'Rascunho',
  announced: 'Anunciada',
  scheduled: 'Agendada',
  active: 'Ativa',
  effective: 'Em vigor',
  in_effect: 'Em vigor',
  completed: 'Concluída',
  expired: 'Encerrada',
  cancelled: 'Cancelada',
  revoked: 'Revogada',
  superseded: 'Substituída',
};

export const runTypeLabels = {
  operational: 'Processamento operacional',
  monthly_close: 'Fechamento mensal',
  quarterly_close: 'Fechamento trimestral',
  annual_close: 'Fechamento anual',
  rebuild: 'Recálculo econômico',
  forecast: 'Projeção econômica',
};

export const runStatusLabels = {
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou',
  skipped: 'Ignorada',
  cancelled: 'Cancelada',
};

export const periodTypeLabels = {
  month: 'Mês',
  quarter: 'Trimestre',
  year: 'Ano',
};

export const periodStatusLabels = {
  scheduled: 'Agendado',
  open: 'Aberto',
  closing: 'Em fechamento',
  closed: 'Fechado',
  reopened: 'Reaberto',
  failed: 'Falhou',
};

export const bulletinTypeLabels = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  annual: 'Anual',
  fiscal: 'Fiscal',
  labor: 'Mercado de trabalho',
  monetary: 'Monetário',
  alert: 'Alerta',
};

export const severityLabels = {
  info: 'Informativo',
  warning: 'Atenção',
  critical: 'Crítico',
};

export const economicEventLabels = {
  product_purchase: 'Compra de produto',
  service_purchase: 'Contratação de serviço',
  business_revenue: 'Receita empresarial',
  business_expense: 'Despesa empresarial',
  employee_hired: 'Contratação de funcionário',
  employee_dismissed: 'Demissão de funcionário',
  salary_paid: 'Salário pago',
  tax_paid: 'Imposto pago',
  investment_created: 'Investimento realizado',
  loan_created: 'Empréstimo contratado',
  government_revenue: 'Receita pública',
  government_expenditure: 'Despesa pública',
  state_enterprise_result: 'Resultado de estatal',
  economic_shock: 'Choque econômico',
  correction: 'Correção contábil',
};

export const sourceTableLabels = {
  transactions: 'Transações',
  accounts: 'Contas',
  businesses: 'Empresas',
  business_transactions: 'Transações empresariais',
  business_employees: 'Funcionários de empresas',
  salary_payments: 'Pagamentos de salários',
  loans: 'Empréstimos',
  loan_applications: 'Solicitações de empréstimo',
  user_investments: 'Investimentos dos cidadãos',
  user_services: 'Serviços contratados',
  government_finances: 'Finanças públicas',
  state_enterprises: 'Empresas estatais',
  products: 'Produtos',
  economic_events: 'Eventos econômicos',
};

export const scenarioMetricLabels = {
  credit_percent: 'Crédito',
  consumption_percent: 'Consumo',
  investment_percent: 'Investimento',
  output_percent: 'Atividade econômica',
  inflation_points: 'Inflação',
  employment_percent: 'Emprego',
  consumer_confidence: 'Confiança do consumidor',
  business_confidence: 'Confiança empresarial',
  debt_cost_points: 'Custo da dívida',
  revenue_percent: 'Arrecadação',
  gdp_growth_delta: 'Variação do crescimento do PIB',
  inflation_delta: 'Variação da inflação',
  unemployment_delta: 'Variação do desemprego',
  consumption_delta: 'Variação do consumo',
  investment_delta: 'Variação do investimento',
  credit_delta: 'Variação do crédito',
  debt_delta: 'Variação da dívida',
  public_debt_delta: 'Variação da dívida pública',
  fiscal_result_delta: 'Variação do resultado fiscal',
  confidence_delta: 'Variação da confiança',
  purchasing_power_delta: 'Variação do poder de compra',
};

export const calibrationLabels = {
  baseline_annual_gdp: 'PIB anual de referência',
  baseline_population: 'População de referência',
  baseline_average_wage: 'Salário médio de referência',
  baseline_unemployment_rate: 'Desemprego de referência',
  baseline_cpi: 'Índice de preços de referência',
  inflation_target: 'Meta de inflação',
  default_selic: 'Taxa Selic inicial',
  player_representativity_factor: 'Fator de representatividade dos jogadores',
  max_event_share_quarter_gdp: 'Impacto máximo por evento no PIB trimestral',
  reconciliation_tolerance: 'Tolerância de reconciliação do PIB',
  recession_minimum_decline: 'Queda mínima para recessão técnica',
  debt_limit_ratio: 'Limite prudencial da dívida',
  confidence_smoothing: 'Suavização dos índices de confiança',
  price_adjustment_speed: 'Velocidade de ajuste dos preços',
  interest_rate_sensitivity: 'Sensibilidade aos juros',
  demand_elasticity: 'Elasticidade da demanda',
  marginal_propensity_to_consume: 'Propensão marginal ao consumo',
  marginal_propensity_to_save: 'Propensão marginal à poupança',
  simulated_share_levels: 'Participação simulada por atividade',
  activity_thresholds: 'Faixas de atividade dos jogadores',
  fiscal_multipliers: 'Multiplicadores fiscais',
  engine_limits: 'Limites do motor econômico',
  engine_version: 'Versão do motor econômico',
};

const nestedCalibrationLabels = {
  very_low: 'Muito baixa',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  very_high: 'Muito alta',
  infrastructure: 'Infraestrutura',
  education: 'Educação',
  health: 'Saúde',
  social_assistance: 'Assistência social',
  defense: 'Defesa',
  technology: 'Tecnologia',
  administration: 'Administração',
  immediate: 'Imediato',
  future: 'Futuro',
  max_selic_change: 'Alteração máxima da Selic',
  max_tax_change: 'Alteração máxima de impostos',
  max_confidence_step: 'Variação máxima da confiança',
  max_price_step: 'Variação máxima dos preços',
  max_debt_step_ratio: 'Variação máxima da dívida',
};

export const localizeCalibrationValue = (value) => {
  if (Array.isArray(value)) return value.map(localizeCalibrationValue);
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((accumulator, [key, entry]) => {
    accumulator[nestedCalibrationLabels[key] || key] = localizeCalibrationValue(entry);
    return accumulator;
  }, {});
};

export const formatEconomicLabel = (value, labels = {}) => {
  if (value == null || value === '') return '—';
  const key = String(value);
  return labels[key]
    || activityLevelLabels[key]
    || cycleLabels[key]
    || runStatusLabels[key]
    || periodStatusLabels[key]
    || severityLabels[key]
    || key;
};

export const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
