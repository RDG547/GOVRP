import countryCurrency from 'country-currency';

const WORLD_BANK_INDICATORS = {
  gdp: 'NY.GDP.MKTP.CD',
  growth: 'NY.GDP.MKTP.KD.ZG',
  population: 'SP.POP.TOTL',
};

const profileCache = new Map();
const currencyByCountry = countryCurrency.byCountry();
const currencyOverrides = {
  BG: 'EUR',
  BY: 'BYN',
  HR: 'EUR',
  MR: 'MRU',
  SL: 'SLE',
  ST: 'STN',
  VE: 'VES',
  XK: 'EUR',
  ZW: 'ZWG',
};
const imfCountryCodes = { XKX: 'UVK' };

const fetchJson = async (url, options = {}) => {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...fetchOptions.headers,
      },
    });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ao consultar dados externos (${response.status}).`);
  }

  return response.json();
};

const latestIndicator = (rows, indicatorCode) => {
  const row = rows.find(
    (item) => item.indicator?.id === indicatorCode && item.value !== null,
  );

  return row
    ? { value: Number(row.value), year: row.date }
    : null;
};

const parseDbnomicsSeries = (payload, options = {}) => {
  const { maxYear = Number.POSITIVE_INFINITY, multiplier = 1 } = options;
  const series = payload?.series?.docs?.[0];
  const periods = series?.period ?? [];
  const values = series?.value ?? [];

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = Number(values[index]);
    const year = Number(periods[index]);

    if (Number.isFinite(value) && (!Number.isFinite(year) || year <= maxYear)) {
      return { value: value * multiplier, year: periods[index] };
    }
  }

  return null;
};

const fetchEconomicIndicatorsFallback = async (alpha3) => {
  const fetchSeries = (indicator) => fetchJson(
    `https://api.db.nomics.world/v22/series/WB/WDI/A-${indicator}-${alpha3}?observations=1&metadata=false`,
    { timeoutMs: 8000 },
  ).then(parseDbnomicsSeries);
  const results = await Promise.allSettled([
    fetchSeries(WORLD_BANK_INDICATORS.gdp),
    fetchSeries(WORLD_BANK_INDICATORS.growth),
    fetchSeries(WORLD_BANK_INDICATORS.population),
  ]);
  const [gdp, growth, population] = results.map((result) => (
    result.status === 'fulfilled' ? result.value : null
  ));

  return { gdp, growth, population, updatedAt: null };
};

const fetchImfEconomicIndicators = async (alpha3) => {
  const countryCode = imfCountryCodes[alpha3] ?? alpha3;
  const latestCompletedYear = new Date().getUTCFullYear() - 1;
  const fetchSeries = (series, multiplier = 1) => fetchJson(
    `https://api.db.nomics.world/v22/series/IMF/WEO%3Alatest/${countryCode}.${series}?observations=1&metadata=false`,
    { timeoutMs: 8000 },
  ).then((payload) => parseDbnomicsSeries(payload, {
    maxYear: latestCompletedYear,
    multiplier,
  }));
  const results = await Promise.allSettled([
    fetchSeries('NGDPD.us_dollars', 1_000_000_000),
    fetchSeries('NGDP_RPCH.pcent_change'),
    fetchSeries('LP.persons', 1_000_000),
  ]);
  const [gdp, growth, population] = results.map((result) => (
    result.status === 'fulfilled' ? result.value : null
  ));

  return { gdp, growth, population, updatedAt: null };
};

const mergeEconomicData = (preferred, fallback) => ({
  gdp: preferred?.gdp ?? fallback?.gdp ?? null,
  growth: preferred?.growth ?? fallback?.growth ?? null,
  population: preferred?.population ?? fallback?.population ?? null,
  updatedAt: preferred?.updatedAt ?? fallback?.updatedAt ?? null,
});

const hasMissingEconomicData = (data) => (
  !data?.gdp || !data?.growth || !data?.population
);

const fetchEconomicIndicators = async (alpha3) => {
  const indicators = Object.values(WORLD_BANK_INDICATORS).join(';');
  const url = `https://api.worldbank.org/v2/country/${alpha3}/indicator/${indicators}?source=2&format=json&mrv=5&gapfill=Y&per_page=100`;
  let economicData = null;

  try {
    const payload = await fetchJson(url, { timeoutMs: 4500 });
    const rows = Array.isArray(payload?.[1]) ? payload[1] : [];

    economicData = {
      gdp: latestIndicator(rows, WORLD_BANK_INDICATORS.gdp),
      growth: latestIndicator(rows, WORLD_BANK_INDICATORS.growth),
      population: latestIndicator(rows, WORLD_BANK_INDICATORS.population),
      updatedAt: payload?.[0]?.lastupdated ?? null,
    };
  } catch {
    economicData = null;
  }

  if (hasMissingEconomicData(economicData)) {
    const worldBankFallback = await fetchEconomicIndicatorsFallback(alpha3);
    economicData = mergeEconomicData(economicData, worldBankFallback);
  }

  if (hasMissingEconomicData(economicData)) {
    const imfFallback = await fetchImfEconomicIndicators(alpha3);
    economicData = mergeEconomicData(economicData, imfFallback);
  }

  return economicData;
};

const buildExchangeResult = (currency, rates, date, source) => {
  const localPerUsd = currency === 'USD' ? 1 : (rates.get(currency) ?? null);
  const eurPerUsd = rates.get('EUR') ?? null;
  const localPerEur = currency === 'EUR'
    ? 1
    : (localPerUsd !== null && eurPerUsd ? localPerUsd / eurPerUsd : null);

  return {
    currency,
    usd: localPerUsd,
    eur: localPerEur,
    date,
    source,
  };
};

const fetchExchangeRateFallback = async (currency) => {
  const payload = await fetchJson('https://open.er-api.com/v6/latest/USD');

  if (payload?.result !== 'success') {
    throw new Error('O provedor alternativo de câmbio não respondeu corretamente.');
  }

  const rates = new Map(
    Object.entries(payload.rates ?? {}).map(([code, rate]) => [code, Number(rate)]),
  );
  const date = Number.isFinite(payload.time_last_update_unix)
    ? new Date(payload.time_last_update_unix * 1000).toISOString().slice(0, 10)
    : null;

  return buildExchangeResult(currency, rates, date, 'ExchangeRate-API');
};

const fetchExchangeRates = async (alpha2) => {
  const currency = currencyOverrides[alpha2] ?? currencyByCountry.get(alpha2);

  if (!currency) {
    return {
      currency: null, usd: null, eur: null, date: null, source: null,
    };
  }

  try {
    const requestedQuotes = [...new Set([currency, 'EUR'])]
      .filter((quote) => quote !== 'USD')
      .join(',');
    const rows = requestedQuotes
      ? await fetchJson(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=${requestedQuotes}`)
      : [];
    const rates = new Map(rows.map((row) => [row.quote, Number(row.rate)]));
    const result = buildExchangeResult(currency, rates, rows[0]?.date ?? null, 'Frankfurter');

    if (result.usd === null || result.eur === null) {
      return fetchExchangeRateFallback(currency);
    }

    return result;
  } catch {
    return fetchExchangeRateFallback(currency);
  }
};

const uniqueLabels = (bindings, property) => [
  ...new Set(
    bindings
      .map((binding) => binding[property]?.value)
      .filter(Boolean),
  ),
];

const fetchGovernmentByOffice = async (alpha2, officeProperty) => {
  const query = `
    SELECT ?leader ?leaderLabel ?party ?partyLabel ?partyStart ?ideology ?ideologyLabel
           ?politicalPosition ?politicalPositionLabel
           ?governmentForm ?governmentFormLabel WHERE {
      ?country wdt:P297 "${alpha2}";
               wdt:${officeProperty} ?leader.
      OPTIONAL { ?country wdt:P122 ?governmentForm. }
      OPTIONAL {
        ?leader p:P102 ?partyStatement.
        ?partyStatement ps:P102 ?party.
        FILTER NOT EXISTS {
          ?partyStatement pq:P582 ?partyEnd.
          FILTER(?partyEnd <= NOW())
        }
        OPTIONAL { ?partyStatement pq:P580 ?partyStart. }
        OPTIONAL { ?party wdt:P1142 ?ideology. }
        OPTIONAL { ?party wdt:P1387 ?politicalPosition. }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
    }
    LIMIT 40
  `;
  const params = new URLSearchParams({
    query,
    format: 'json',
    origin: '*',
  });
  const payload = await fetchJson(`https://query.wikidata.org/sparql?${params.toString()}`, {
    headers: { Accept: 'application/sparql-results+json' },
  });
  const bindings = payload?.results?.bindings ?? [];

  if (!bindings.length) return null;

  const datedPartyBindings = bindings.filter((binding) => binding.partyStart?.value);
  const latestPartyStart = datedPartyBindings.reduce((latest, binding) => (
    binding.partyStart.value > latest ? binding.partyStart.value : latest
  ), '');
  const currentPartyBindings = latestPartyStart
    ? datedPartyBindings.filter((binding) => binding.partyStart.value === latestPartyStart)
    : bindings;
  const partyLabels = uniqueLabels(currentPartyBindings, 'partyLabel');
  const partyIdeologies = uniqueLabels(currentPartyBindings, 'ideologyLabel');
  const politicalPositions = uniqueLabels(currentPartyBindings, 'politicalPositionLabel');

  return {
    leader: uniqueLabels(bindings, 'leaderLabel').join(' / ') || null,
    party: partyLabels.join(' / ') || 'Sem filiação partidária ativa registrada',
    ideology: partyIdeologies.slice(0, 3).join(' · ')
      || politicalPositions.slice(0, 2).join(' · ')
      || (partyLabels.length
        ? 'Orientação não catalogada para o partido'
        : 'Não se aplica: governante sem filiação ativa'),
    governmentForm: uniqueLabels(bindings, 'governmentFormLabel').slice(0, 3).join(' · ') || null,
    office: officeProperty === 'P35' ? 'Presidente / chefe de Estado' : 'Chefe de Governo',
  };
};

const fetchGovernment = async (alpha2) => {
  const headOfState = await fetchGovernmentByOffice(alpha2, 'P35');

  return headOfState ?? fetchGovernmentByOffice(alpha2, 'P6');
};

export const loadCountryProfile = ({ alpha2, alpha3 }) => {
  if (!alpha2 || !alpha3) {
    return Promise.resolve({
      economy: null,
      exchange: null,
      government: null,
      unavailable: true,
    });
  }

  const cacheKey = `${alpha2}:${alpha3}`;

  if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);

  const request = Promise.allSettled([
    fetchEconomicIndicators(alpha3),
    fetchExchangeRates(alpha2),
    fetchGovernment(alpha2),
  ]).then(([economy, exchange, government]) => ({
    economy: economy.status === 'fulfilled' ? economy.value : null,
    exchange: exchange.status === 'fulfilled' ? exchange.value : null,
    government: government.status === 'fulfilled' ? government.value : null,
    unavailable: [economy, exchange, government].every((result) => result.status === 'rejected'),
  }));

  profileCache.set(cacheKey, request);

  return request;
};
