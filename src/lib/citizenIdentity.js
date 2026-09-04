export const CIVIL_NAME_PATTERN = /^[\p{L}](?:[\p{L}\s'’\-]*[\p{L}])?$/u;
export const PUBLIC_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,19}$/;

export const formatCivilName = (value = '') => value
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trimStart()
  .toLocaleLowerCase('pt-BR')
  .replace(/(^|[\s'’\-])(\p{L})/gu, (_, boundary, letter) => `${boundary}${letter.toLocaleUpperCase('pt-BR')}`);

export const isValidCivilName = (value = '') => {
  const normalized = value.trim();
  return normalized.length >= 5 && normalized.length <= 80 && CIVIL_NAME_PATTERN.test(normalized);
};

export const sanitizePublicUsernameInput = (value = '') => value
  .replace(/^@+/, '')
  .replace(/[^A-Za-z0-9._-]/g, '')
  .slice(0, 20);

export const isValidPublicUsername = (value = '') => PUBLIC_USERNAME_PATTERN.test(value);

export const getCatalogAvatarGender = (avatarUrl = '') => {
  if (avatarUrl.includes('GOVRP-masculino-')) return 'male';
  if (avatarUrl.includes('GOVRP-feminino-')) return 'female';
  return null;
};

