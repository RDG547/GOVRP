export const ECONOMIC_POLICY_SETTINGS_KEY = 'economic_policy';

export const DEFAULT_ECONOMIC_POLICY = {
  selic_rate: 10.5,
};

const roundRate = (value) => Math.round(Number(value || 0) * 100) / 100;

const toSafeRate = (value, fallback = 0) => {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return roundRate(fallback);
  }

  return roundRate(Math.max(0, numericValue));
};

export const normalizeEconomicPolicy = (value = {}) => {
  const safeValue = value && typeof value === 'object' ? value : {};

  return {
    ...DEFAULT_ECONOMIC_POLICY,
    ...safeValue,
    selic_rate: Number.isFinite(Number(safeValue.selic_rate)) ? roundRate(Math.max(-20, Math.min(100, Number(safeValue.selic_rate)))) : DEFAULT_ECONOMIC_POLICY.selic_rate,
  };
};

export const annualPercentToMonthlyPercent = (annualRate = 0) => {
  const normalizedAnnualRate = Math.max(-20, Math.min(100, Number(annualRate || 0))) / 100;

  if (!Number.isFinite(normalizedAnnualRate) || normalizedAnnualRate === 0) {
    return 0;
  }

  return roundRate((Math.pow(1 + normalizedAnnualRate, 1 / 12) - 1) * 100);
};

const resolveSpread = ({ rawValue, spreadKey, rateKey, selicMonthlyRate, fallbackRate = 0 }) => {
  const explicitSpread = Number(rawValue?.[spreadKey]);

  if (Number.isFinite(explicitSpread)) {
    return toSafeRate(explicitSpread);
  }

  const storedRate = Number(rawValue?.[rateKey]);
  const referenceRate = Number.isFinite(storedRate) ? storedRate : fallbackRate;

  return toSafeRate(referenceRate - selicMonthlyRate);
};

export const normalizeBankPolicyForEconomicPolicy = (
  value = {},
  economicPolicy = DEFAULT_ECONOMIC_POLICY,
  defaults = {}
) => {
  const safeValue = value && typeof value === 'object' ? value : {};
  const normalizedEconomicPolicy = normalizeEconomicPolicy(economicPolicy);
  const selicMonthlyRate = annualPercentToMonthlyPercent(normalizedEconomicPolicy.selic_rate);
  const basePolicy = {
    ...defaults,
    ...safeValue,
  };

  const loanInterestSpread = resolveSpread({
    rawValue: basePolicy,
    spreadKey: 'loan_interest_spread',
    rateKey: 'loan_interest_rate',
    selicMonthlyRate,
    fallbackRate: defaults.loan_interest_rate,
  });
  const creditCardRevolvingSpread = resolveSpread({
    rawValue: basePolicy,
    spreadKey: 'credit_card_revolving_spread',
    rateKey: 'credit_card_revolving_rate',
    selicMonthlyRate,
    fallbackRate: defaults.credit_card_revolving_rate,
  });
  const governmentDebtInterestSpread = resolveSpread({
    rawValue: basePolicy,
    spreadKey: 'government_debt_interest_spread',
    rateKey: 'government_debt_interest_rate',
    selicMonthlyRate,
    fallbackRate: defaults.government_debt_interest_rate,
  });

  return {
    ...basePolicy,
    loan_interest_spread: loanInterestSpread,
    credit_card_revolving_spread: creditCardRevolvingSpread,
    government_debt_interest_spread: governmentDebtInterestSpread,
    loan_interest_rate: roundRate(selicMonthlyRate + loanInterestSpread),
    credit_card_revolving_rate: roundRate(selicMonthlyRate + creditCardRevolvingSpread),
    government_debt_interest_rate: roundRate(selicMonthlyRate + governmentDebtInterestSpread),
  };
};

export const buildInvestmentAnnualRate = (selicRate = 0, riskLevel = 'medium') => {
  const normalizedSelic = normalizeEconomicPolicy({ selic_rate: selicRate }).selic_rate;
  const multipliers = {
    low: 0.9,
    medium: 1.05,
    high: 1.2,
    'very-high': 1.35,
  };
  const premiums = {
    low: -0.4,
    medium: 0.8,
    high: 2.2,
    'very-high': 4.5,
  };
  const annualPercent = Math.max(
    -95,
    normalizedSelic * (multipliers[riskLevel] || multipliers.medium) + (premiums[riskLevel] || 0)
  );

  return roundRate(annualPercent / 100);
};

export const getEconomicPressureLabel = (selicRate = 0) => {
  const normalizedSelic = normalizeEconomicPolicy({ selic_rate: selicRate }).selic_rate;

  if (normalizedSelic >= 14) {
    return 'Aperto monetário elevado: crédito mais caro e maior custo financeiro para governo e setor privado.';
  }

  if (normalizedSelic >= 9) {
    return 'Política monetária contracionista moderada: desacelera o crédito e melhora o retorno de renda fixa.';
  }

  if (normalizedSelic >= 6) {
    return 'Política monetária neutra: equilíbrio entre crédito, consumo e remuneração financeira.';
  }

  return 'Política monetária estimulativa: crédito mais barato, consumo incentivado e menor retorno em aplicações conservadoras.';
};
