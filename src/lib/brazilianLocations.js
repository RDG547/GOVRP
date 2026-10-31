export const BRAZIL_STATES = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
].map(([code, name]) => ({ code, name, countryId: 'BR', stateFlag: code }));

const inMemoryCache = new Map();
const inFlight = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const cacheKey = (code) => `govrp:municipalities:v2:${code}`;
export const getStateName = (code) => BRAZIL_STATES.find(state => state.code === code)?.name || '';
const validCities = (cities) => Array.isArray(cities) && cities.length > 0 && cities.every(city => /^\d{7}$/.test(city.code) && typeof city.name === 'string');

async function loadMunicipalities(stateCode) {
  const memory = inMemoryCache.get(stateCode);
  if (memory && Date.now() - memory.savedAt < CACHE_TTL) return memory.cities;
  try {
    const cache = JSON.parse(window.localStorage.getItem(cacheKey(stateCode)) || 'null');
    if (cache && Date.now() - cache.savedAt < CACHE_TTL && validCities(cache.cities)) {
      inMemoryCache.set(stateCode, cache); return cache.cities;
    }
  } catch { /* Storage is optional. */ }
  // IBGE occasionally fails or is blocked on some mobile networks.
  // BrasilAPI is an independent public fallback for the same IBGE codes.
  const sources = [
    { url: `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode}/municipios?orderBy=nome`,
      map: (item) => ({ code: String(item.id), name: item.nome }) },
    { url: `https://brasilapi.com.br/api/ibge/municipios/${stateCode}`,
      map: (item) => ({ code: String(item.codigo_ibge), name: item.nome }) },
  ];
  let lastError;
  for (const source of sources) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(source.url, { signal: controller.signal, cache: 'default' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const cities = (Array.isArray(payload) ? payload : []).map(source.map)
        .filter(city => /^\\d{7}$/.test(city.code) && city.name)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      if (!validCities(cities)) throw new Error('A fonte retornou uma lista inválida.');
      const result = { savedAt: Date.now(), cities };
      inMemoryCache.set(stateCode, result);
      try { window.localStorage.setItem(cacheKey(stateCode), JSON.stringify(result)); } catch { /* optional cache */ }
      return cities;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error('Não foi possível consultar os municípios nas duas fontes disponíveis. Confira sua conexão e toque em Tentar novamente.', { cause: lastError });
}

export function fetchMunicipalitiesByState(stateCode, signal) {
  if (!getStateName(stateCode)) return Promise.reject(new Error('Estado inválido.'));
  if (signal?.aborted) return Promise.reject(new DOMException('Consulta cancelada.', 'AbortError'));
  let pending = inFlight.get(stateCode);
  if (!pending) {
    pending = loadMunicipalities(stateCode).finally(() => inFlight.delete(stateCode));
    inFlight.set(stateCode, pending);
  }
  if (!signal) return pending;
  // One select unmounting must not abort a shared request used by another select.
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Consulta cancelada.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    pending.then(cities => { if (!signal.aborted) resolve(cities); }, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function prefetchMunicipalities(codes = ['RJ', 'SP']) {
  const pending = [...new Set(codes)].filter(getStateName);
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (pending.length) {
      const code = pending.shift();
      try { await fetchMunicipalitiesByState(code); } catch { /* The select provides retry feedback on demand. */ }
    }
  }));
}
