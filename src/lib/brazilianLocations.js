export const BRAZIL_STATES = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
].map(([code, name]) => ({ code, name }));

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode}/municipios?orderBy=nome`, { signal: controller.signal });
    if (!response.ok) throw new Error('Não foi possível carregar os municípios. Tente selecionar o estado novamente.');
    const payload = await response.json();
    const cities = payload.map(city => ({ code: String(city.id), name: city.nome }))
      .filter(city => /^\d{7}$/.test(city.code) && city.name)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!validCities(cities)) throw new Error('Nenhum município encontrado para este estado. Tente novamente.');
    const cache = { savedAt: Date.now(), cities };
    inMemoryCache.set(stateCode, cache);
    try { window.localStorage.setItem(cacheKey(stateCode), JSON.stringify(cache)); } catch { /* Use memory cache. */ }
    return cities;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('O carregamento dos municípios demorou. Selecione o estado novamente para tentar.');
    throw error;
  } finally { clearTimeout(timeout); }
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

export async function prefetchMunicipalities(codes = ['SP', 'RJ', 'MG', 'BA', 'AM', 'RS', 'PR', 'GO', 'PE', 'PA']) {
  const pending = [...new Set(codes)].filter(getStateName);
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (pending.length) {
      const code = pending.shift();
      try { await fetchMunicipalitiesByState(code); } catch { /* The select provides retry feedback on demand. */ }
    }
  }));
}
