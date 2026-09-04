const COUNTRY_BASE_CURRENCIES = {
  BR: 'BRL',
  US: 'USD',
  JP: 'JPY',
  PT: 'EUR',
};

export const getCitizenCountryCode = (citizen) => (
  citizen?.residence_country_code || citizen?.country_code || 'BR'
).toUpperCase();

export const getCitizenBaseCurrency = (citizen) => (
  COUNTRY_BASE_CURRENCIES[getCitizenCountryCode(citizen)] || 'BRL'
);

export const getExchangePair = (currency, baseCurrency) => (
  `${String(currency || '').toUpperCase()}/${String(baseCurrency || '').toUpperCase()}`
);

export const calculateExchangeVariation = (currentValue, referenceValue) => {
  const current = Number(currentValue);
  const reference = Number(referenceValue);
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference <= 0) return 0;
  return ((current - reference) / reference) * 100;
};

export const getExchangeTrend = (variation, stableThreshold = 0.01) => {
  const numericVariation = Number(variation || 0);
  if (Math.abs(numericVariation) < stableThreshold) return 'stable';
  return numericVariation > 0 ? 'up' : 'down';
};

export const formatExchangeRate = (value, baseCurrency) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: baseCurrency,
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
}).format(Number(value || 0));

