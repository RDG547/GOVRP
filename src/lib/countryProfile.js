import countryCurrency from 'country-currency';

const WORLD_BANK_INDICATORS = {
  gdp: 'NY.GDP.MKTP.CD',
  growth: 'NY.GDP.MKTP.KD.ZG',
  inflation: 'FP.CPI.TOTL.ZG',
  unemployment: 'SL.UEM.TOTL.ZS',
  population: 'SP.POP.TOTL',
  area: 'AG.SRF.TOTL.K2',
};

const ECONOMIC_FIELDS = Object.keys(WORLD_BANK_INDICATORS);
const PROFILE_CACHE_TTL_MS = 15 * 60 * 1000;
const profileCache = new Map();
let regimeDatasetPromise = null;
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

const fetchText = async (url, options = {}) => {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Falha ao consultar dados externos (${response.status}).`);
  }

  return response.text();
};

const REGIME_LABELS = {
  0: 'Autocracia fechada',
  1: 'Autocracia eleitoral',
  2: 'Democracia eleitoral',
  3: 'Democracia liberal',
};

const fetchRegimeDataset = () => {
  if (regimeDatasetPromise) return regimeDatasetPromise;

  regimeDatasetPromise = fetchText(
    'https://ourworldindata.org/grapher/political-regime.csv?csvType=filtered&tab=table&time=latest',
    { timeoutMs: 10000 },
  ).then((csv) => {
    const rows = csv.trim().split(/\r?\n/).slice(1);

    return new Map(rows.map((row) => {
      const columns = row.split(',');
      const alpha3 = columns.at(-3);
      const year = columns.at(-2);
      const score = Number(columns.at(-1));

      return [alpha3, {
        label: REGIME_LABELS[score] ?? 'Classificação não catalogada',
        score,
        year,
        source: 'V-Dem/Our World in Data',
      }];
    }));
  }).catch((error) => {
    regimeDatasetPromise = null;
    throw error;
  });

  return regimeDatasetPromise;
};

const fetchRegimeClassification = async (alpha3) => {
  const dataset = await fetchRegimeDataset();
  return dataset.get(alpha3) ?? null;
};

const latestIndicator = (rows, indicatorCode, source = 'Banco Mundial') => {
  const row = rows.find(
    (item) => item.indicator?.id === indicatorCode && item.value !== null,
  );

  return row
    ? { value: Number(row.value), year: row.date, source }
    : null;
};

const parseDbnomicsSeries = (payload, options = {}) => {
  const {
    maxYear = Number.POSITIVE_INFINITY,
    multiplier = 1,
    source = 'DBnomics',
  } = options;
  const series = payload?.series?.docs?.[0];
  const periods = series?.period ?? [];
  const values = series?.value ?? [];

  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = Number(values[index]);
    const year = Number(periods[index]);

    if (Number.isFinite(value) && (!Number.isFinite(year) || year <= maxYear)) {
      return { value: value * multiplier, year: periods[index], source };
    }
  }

  return null;
};

const fetchEconomicIndicatorsFallback = async (alpha3) => {
  const fetchSeries = (indicator) => fetchJson(
    `https://api.db.nomics.world/v22/series/WB/WDI/A-${indicator}-${alpha3}?observations=1&metadata=false`,
    { timeoutMs: 8000 },
  ).then((payload) => parseDbnomicsSeries(payload, {
    source: 'Banco Mundial via DBnomics',
  }));
  const results = await Promise.allSettled(
    ECONOMIC_FIELDS.map((field) => fetchSeries(WORLD_BANK_INDICATORS[field])),
  );
  const values = results.map((result) => (
    result.status === 'fulfilled' ? result.value : null
  ));

  return {
    ...Object.fromEntries(ECONOMIC_FIELDS.map((field, index) => [field, values[index]])),
    updatedAt: null,
  };
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
    source: 'FMI/WEO via DBnomics',
  }));
  const results = await Promise.allSettled([
    fetchSeries('NGDPD.us_dollars', 1_000_000_000),
    fetchSeries('NGDP_RPCH.pcent_change'),
    fetchSeries('PCPIPCH.pcent_change'),
    fetchSeries('LUR.pcent'),
    fetchSeries('LP.persons', 1_000_000),
  ]);
  const [gdp, growth, inflation, unemployment, population] = results.map((result) => (
    result.status === 'fulfilled' ? result.value : null
  ));

  return {
    gdp,
    growth,
    inflation,
    unemployment,
    population,
    area: null,
    updatedAt: null,
  };
};

const mergeEconomicData = (preferred, fallback) => ({
  ...Object.fromEntries(ECONOMIC_FIELDS.map((field) => [
    field,
    preferred?.[field] ?? fallback?.[field] ?? null,
  ])),
  updatedAt: preferred?.updatedAt ?? fallback?.updatedAt ?? null,
  providers: [...new Set([
    ...(preferred?.providers ?? []),
    ...(fallback?.providers ?? []),
  ])],
});

const hasMissingEconomicData = (data) => (
  ECONOMIC_FIELDS.some((field) => data?.[field] == null)
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
      inflation: latestIndicator(rows, WORLD_BANK_INDICATORS.inflation),
      unemployment: latestIndicator(rows, WORLD_BANK_INDICATORS.unemployment),
      population: latestIndicator(rows, WORLD_BANK_INDICATORS.population),
      area: latestIndicator(rows, WORLD_BANK_INDICATORS.area),
      updatedAt: payload?.[0]?.lastupdated ?? null,
      providers: ['Banco Mundial'],
    };
  } catch {
    economicData = null;
  }

  if (hasMissingEconomicData(economicData)) {
    const worldBankFallback = await fetchEconomicIndicatorsFallback(alpha3);
    worldBankFallback.providers = ['Banco Mundial via DBnomics'];
    economicData = mergeEconomicData(economicData, worldBankFallback);
  }

  if (hasMissingEconomicData(economicData)) {
    const imfFallback = await fetchImfEconomicIndicators(alpha3);
    imfFallback.providers = ['FMI/WEO via DBnomics'];
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

const wikidataEntityId = (value) => value?.split('/').pop() || null;

const compactWikiValue = (value) => {
  if (!value) return null;

  let cleanValue = value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref\b[^/>]*\/>/gi, ' ')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[(?:https?:\/\/\S+)\s+([^\]]+)\]/g, '$1')
    .replace(/<br\s*\/?\s*>/gi, ' · ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/'{2,}/g, '');

  for (let iteration = 0; iteration < 5; iteration += 1) {
    cleanValue = cleanValue.replace(/\{\{[^{}|]+\|([^{}]*)\}\}/g, '$1');
  }

  return cleanValue
    .replace(/\{\{|\}\}/g, ' ')
    .replace(/^\s*[*#;:]\s*/gm, '')
    .replace(/\s*\n\s*/g, ' · ')
    .replace(/\s*\|·?\s*/g, ' · ')
    .replace(/\s*·\s*(?:·\s*)+/g, ' · ')
    .replace(/\s+/g, ' ')
    .replace(/^[·\s]+|[·\s]+$/g, '')
    .trim()
    || null;
};

const extractWikiInfoboxField = (wikitext, fieldNames) => {
  if (!wikitext) return null;

  const fieldPattern = fieldNames.join('|');
  const expression = new RegExp(
    `\\n\\s*\\|\\s*(?:${fieldPattern})\\s*=([\\s\\S]*?)(?=\\n\\s*\\|\\s*[a-zA-Z_ ]+\\s*=|\\n\\s*\\}\\})`,
    'i',
  );

  return compactWikiValue(wikitext.match(expression)?.[1]);
};

const fetchWikipediaInfobox = async (entityId) => {
  if (!entityId) return null;

  const entityPayload = await fetchJson(
    `https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`,
    { timeoutMs: 6500 },
  );
  const sitelinks = entityPayload?.entities?.[entityId]?.sitelinks ?? {};
  const sitelink = sitelinks.ptwiki
    ? { language: 'pt', title: sitelinks.ptwiki.title }
    : (sitelinks.enwiki ? { language: 'en', title: sitelinks.enwiki.title } : null);

  if (!sitelink) return null;

  const params = new URLSearchParams({
    action: 'parse',
    page: sitelink.title,
    prop: 'wikitext',
    format: 'json',
    origin: '*',
  });
  const payload = await fetchJson(
    `https://${sitelink.language}.wikipedia.org/w/api.php?${params.toString()}`,
    { timeoutMs: 6500 },
  );
  const wikitext = payload?.parse?.wikitext?.['*'] ?? '';

  return {
    party: extractWikiInfoboxField(wikitext, [
      'partido',
      'partido_político',
      'party',
      'political_party',
    ]),
    ideology: extractWikiInfoboxField(wikitext, ['ideologia', 'ideology']),
    source: `Wikipedia (${sitelink.language})`,
  };
};

const fetchGovernmentByOffice = async (alpha2, officeProperty) => {
  const query = `
    SELECT ?leader ?leaderLabel ?party ?partyLabel ?partyStart ?ideology ?ideologyLabel
           ?politicalPosition ?politicalPositionLabel ?leaderIdeology ?leaderIdeologyLabel
           ?leaderPosition ?leaderPositionLabel
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
      OPTIONAL { ?leader wdt:P1142 ?leaderIdeology. }
      OPTIONAL { ?leader wdt:P1387 ?leaderPosition. }
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
  const undatedPartyBindings = bindings.filter(
    (binding) => binding.party?.value && !binding.partyStart?.value,
  );
  const latestPartyStart = datedPartyBindings.reduce((latest, binding) => (
    binding.partyStart.value > latest ? binding.partyStart.value : latest
  ), '');
  const currentPartyBindings = latestPartyStart
    ? [
        ...datedPartyBindings.filter((binding) => binding.partyStart.value === latestPartyStart),
        ...undatedPartyBindings,
      ]
    : bindings;
  const partyLabels = uniqueLabels(currentPartyBindings, 'partyLabel');
  const partyIdeologies = uniqueLabels(currentPartyBindings, 'ideologyLabel');
  const politicalPositions = uniqueLabels(currentPartyBindings, 'politicalPositionLabel');
  const leaderIdeologies = uniqueLabels(bindings, 'leaderIdeologyLabel');
  const leaderPositions = uniqueLabels(bindings, 'leaderPositionLabel');
  const leaderEntityId = wikidataEntityId(bindings[0]?.leader?.value);
  const partyEntityIds = [
    ...new Set(currentPartyBindings
      .map((binding) => wikidataEntityId(binding.party?.value))
      .filter(Boolean)),
  ];

  return {
    leader: uniqueLabels(bindings, 'leaderLabel').join(' / ') || null,
    party: partyLabels.join(' / ') || null,
    ideology: partyIdeologies.slice(0, 3).join(' · ')
      || politicalPositions.slice(0, 2).join(' · ')
      || leaderIdeologies.slice(0, 3).join(' · ')
      || leaderPositions.slice(0, 2).join(' · ')
      || null,
    governmentForm: uniqueLabels(bindings, 'governmentFormLabel').slice(0, 3).join(' · ') || null,
    office: officeProperty === 'P35' ? 'Presidente / chefe de Estado' : 'Chefe de Governo',
    leaderEntityId,
    partyEntityIds,
    source: 'Wikidata',
  };
};

const enrichGovernmentFromWikipedia = async (government) => {
  if (!government || (government.party && government.ideology)) return government;

  const entityIds = [...(government.partyEntityIds ?? []), government.leaderEntityId]
    .filter(Boolean);
  const results = await Promise.allSettled(entityIds.map(fetchWikipediaInfobox));
  const references = results
    .filter((result) => result.status === 'fulfilled' && result.value)
    .map((result) => result.value);
  const partyReference = references.find((reference) => reference.party);
  const ideologyReference = references.find((reference) => reference.ideology);

  return {
    ...government,
    party: government.party || partyReference?.party || null,
    ideology: government.ideology || ideologyReference?.ideology || null,
    source: references.length ? 'Wikidata/Wikipedia' : government.source,
  };
};

const fetchGovernment = async (alpha2) => {
  const [headOfStateResult, headOfGovernmentResult] = await Promise.allSettled([
    fetchGovernmentByOffice(alpha2, 'P35'),
    fetchGovernmentByOffice(alpha2, 'P6'),
  ]);
  const headOfState = headOfStateResult.status === 'fulfilled' ? headOfStateResult.value : null;
  const headOfGovernment = headOfGovernmentResult.status === 'fulfilled'
    ? headOfGovernmentResult.value
    : null;
  const primary = headOfState ?? headOfGovernment;

  if (!primary) return null;

  const partySource = primary.party
    ? primary
    : (headOfGovernment?.party ? headOfGovernment : null);
  const enriched = await enrichGovernmentFromWikipedia({
    ...primary,
    party: partySource?.party || null,
    ideology: partySource?.ideology || primary.ideology || null,
  });

  return {
    ...enriched,
    party: enriched.party || 'Independente / sem filiação partidária atual',
    partyLabel: partySource && partySource !== primary
      ? 'Partido do governo'
      : 'Partido do governante',
    ideology: enriched.ideology || 'Orientação não catalogada nas fontes consultadas',
  };
};

export const loadCountryProfile = ({ alpha2, alpha3, force = false }) => {
  if (!alpha2 || !alpha3) {
    return Promise.resolve({
      economy: null,
      exchange: null,
      government: null,
      regime: null,
      unavailable: true,
    });
  }

  const cacheKey = `${alpha2}:${alpha3}`;

  if (force) profileCache.delete(cacheKey);
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.request;

  const request = Promise.allSettled([
    fetchEconomicIndicators(alpha3),
    fetchExchangeRates(alpha2),
    fetchGovernment(alpha2),
    fetchRegimeClassification(alpha3),
  ]).then(([economy, exchange, government, regime]) => ({
    economy: economy.status === 'fulfilled' ? economy.value : null,
    exchange: exchange.status === 'fulfilled' ? exchange.value : null,
    government: government.status === 'fulfilled' ? government.value : null,
    regime: regime.status === 'fulfilled' ? regime.value : null,
    unavailable: [economy, exchange, government, regime]
      .every((result) => result.status === 'rejected'),
  }));

  profileCache.set(cacheKey, {
    request,
    expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
  });

  return request;
};

let countryBasics=null,countryBasicsRequest=null;
export function preloadCountryBasics(){
 if(countryBasics)return Promise.resolve(countryBasics);
 if(!countryBasicsRequest)countryBasicsRequest=fetch('/maps/country-basics.json').then(r=>{if(!r.ok)throw new Error('country-basics');return r.json();}).then(data=>{countryBasics=data.countries;return countryBasics;}).catch(error=>{countryBasicsRequest=null;throw error;});
 return countryBasicsRequest;
}
export function getCountryBasics(alpha2){const b=countryBasics?.[alpha2];return b?{capital:b.capital,economy:{population:b.population},unavailable:false}:null;}
