export const isPrisonSentenceActive = (profile) => {
  // A liberação é decidida pelas rotinas do banco, nunca pelo relógio do aparelho.
  return Boolean(profile?.is_imprisoned);
};

export const getPrisonRemainingMs = (releaseDate) => {
  if (!releaseDate) {
    return 0;
  }

  return Math.max(new Date(releaseDate).getTime() - Date.now(), 0);
};

export const formatPrisonCountdown = (releaseDate) => {
  const remainingMs = getPrisonRemainingMs(releaseDate);

  if (remainingMs <= 0) {
    return 'Liberação em andamento';
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }

  parts.push(`${minutes}min`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
};
