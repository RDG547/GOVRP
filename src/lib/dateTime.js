export const GOVRP_TIME_ZONE = 'America/Sao_Paulo';

const parseDate = (value) => {
  if (value == null || value === '') return null;
  // Calendar dates have no time zone. Noon UTC keeps their calendar day when displayed in Brasília.
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatTimeBR = (value, options = {}) => {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...options, timeZone: GOVRP_TIME_ZONE }).format(date) : 'Horário não disponível';
};

// Preserve number/currency formatting while giving every Date the same world clock.
export const formatLocaleBR = (value, method, locales = 'pt-BR', options = {}) => {
  if (!(value instanceof Date)) return value[method](locales, options);
  if (Number.isNaN(value.getTime())) return 'Data não disponível';
  return value[method](locales, { ...options, timeZone: GOVRP_TIME_ZONE });
};

export const toBrasiliaInput = (value) => {
  const date = parseDate(value);
  if (!date) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: GOVRP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};

export const fromBrasiliaInput = (value) => {
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value || '')) {
    const absolute = parseDate(value);
    return absolute ? absolute.toISOString() : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) return null;
  // Resolve the IANA offset for the selected instant, including historical DST.
  const target = Date.parse(`${value}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    const represented = Date.parse(`${toBrasiliaInput(new Date(instant))}:00Z`);
    instant += target - represented;
  }
  const result = new Date(instant);
  return toBrasiliaInput(result) === value ? result.toISOString() : null;
};

export const formatDateTimeBR = (
  value,
  { timeZone = GOVRP_TIME_ZONE, fallback = 'Data não disponível' } = {}
) => {
  const date = parseDate(value);
  if (!date) return fallback;

  const parts = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || '';

  return `${part('day')}/${part('month')}/${part('year')} às ${part('hour')}:${part('minute')}:${part('second')}`;
};

export const formatDateBR = (
  value,
  { timeZone = GOVRP_TIME_ZONE, fallback = 'Data não disponível', long = false } = {}
) => {
  const date = parseDate(value);
  if (!date) return fallback;

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: long ? 'long' : '2-digit',
    year: 'numeric',
    timeZone,
  }).format(date);
};
