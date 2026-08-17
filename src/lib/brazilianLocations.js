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
const cacheKey = (stateCode) => `govrp:ibge-municipalities:${stateCode}`;

export const getStateName = (stateCode) =>
  BRAZIL_STATES.find((state) => state.code === stateCode)?.name || '';

export const fetchMunicipalitiesByState = async (stateCode, signal) => {
  if (!getStateName(stateCode)) throw new Error('Estado inválido.');
  if (inMemoryCache.has(stateCode)) return inMemoryCache.get(stateCode);

  try {
    const cached = JSON.parse(window.localStorage.getItem(cacheKey(stateCode)) || 'null');
    if (Array.isArray(cached) && cached.length) {
      inMemoryCache.set(stateCode, cached);
      return cached;
    }
  } catch {
    // Cache is an optimization; invalid or unavailable storage is harmless.
  }

  const response = await fetch(
    `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateCode}/municipios?orderBy=nome`,
    { signal }
  );
  if (!response.ok) throw new Error('Não foi possível carregar os municípios do IBGE.');

  const payload = await response.json();
  const municipalities = payload
    .map((municipality) => ({ code: String(municipality.id), name: municipality.nome }))
    .filter((municipality) => /^\d{7}$/.test(municipality.code) && municipality.name)
    .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));

  if (!municipalities.length) throw new Error('O IBGE não retornou municípios para este estado.');
  inMemoryCache.set(stateCode, municipalities);
  try {
    window.localStorage.setItem(cacheKey(stateCode), JSON.stringify(municipalities));
  } catch {
    // Keep the in-memory result when local storage is unavailable.
  }
  return municipalities;
};

