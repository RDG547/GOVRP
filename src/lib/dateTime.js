export const GOVRP_TIME_ZONE = 'America/Sao_Paulo';

const parseDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

