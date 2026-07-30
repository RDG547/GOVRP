const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const formatRealDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'encerrado';

  const hours = Math.floor(milliseconds / HOUR);
  const minutes = Math.floor((milliseconds % HOUR) / MINUTE);
  const seconds = Math.floor((milliseconds % MINUTE) / SECOND);

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  if (minutes > 0) return `${minutes}min ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
};

export const formatJusticeDate = (value, options = {}) => {
  if (!value) return 'Não definido';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data inválida';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: options.dateOnly ? 'medium' : 'short',
    ...(options.dateOnly ? {} : { timeStyle: 'short' }),
  }).format(date);
};

export const calculateRpNow = (settings, realNow = Date.now()) => {
  if (!settings) return null;
  if (settings.is_paused && settings.paused_rp_at) {
    return new Date(settings.paused_rp_at);
  }

  const realEpoch = new Date(settings.rp_epoch_real_at).getTime();
  const gameEpoch = new Date(settings.rp_epoch_game_at).getTime();
  const rpSecondsPerRealSecond = (
    (Number(settings.rp_days_per_year) * 86400)
    / Number(settings.rp_year_real_seconds)
  ) * Number(settings.speed_multiplier || 1);

  return new Date(gameEpoch + ((realNow - realEpoch) * rpSecondsPerRealSecond));
};

export const formatRpDate = (settings, realNow) => {
  const rpNow = calculateRpNow(settings, realNow);
  if (!rpNow) return 'Relógio indisponível';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(rpNow);
};

export const getCountdown = (value, realNow = Date.now()) => {
  if (!value) return null;
  return new Date(value).getTime() - realNow;
};

export const clampProgress = (value) => Math.min(100, Math.max(0, value));

