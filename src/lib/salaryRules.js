export const SALARY_TIMEZONE = 'America/Sao_Paulo';
export const WEEKLY_SALARY_PAYMENT_HOUR = 9;

export const SALARY_TABLE = [
  { role: 'Presidente', title: 'Presidente da República', salary: 35000 },
  { role: 'Vice-Presidente', title: 'Vice-Presidente', salary: 24500 },
  { role: 'Deputado', title: 'Deputado Federal', salary: 10500 },
  { role: 'Senador', title: 'Senador', salary: 17500 },
  { role: 'Presidente do Senado', title: 'Presidente do Senado', salary: 24500 },
  { role: 'Presidente da Câmara', title: 'Presidente da Câmara', salary: 21000 },
  { role: 'Presidente do Banco Nacional', title: 'Presidente do Banco Nacional', salary: 21000 },
  { role: 'Promotor', title: 'Promotor de Justiça', salary: 14000 },
  { role: 'Ministro', title: 'Ministro de Estado', salary: 17500 },
];

export const SALARY_ROLE_PRIORITY = [
  'Presidente',
  'Vice-Presidente',
  'Presidente do Senado',
  'Presidente da Câmara',
  'Presidente do Banco Nacional',
  'Ministro',
  'Senador',
  'Promotor',
  'Deputado',
];

export const SALARY_ROLE_ALIASES = {
  'Presidente da Camara': 'Presidente da Câmara',
  'Presidente da Câmara dos Deputados': 'Presidente da Câmara',
  'Vice-Presidente da Câmara dos Deputados': 'Deputado',
  'Vice-Presidente do Senado': 'Senador',
  'Vice-Presidente do Senado Federal': 'Senador',
};

const SALARY_INFO_BY_ROLE = SALARY_TABLE.reduce((accumulator, item) => {
  accumulator[item.role] = item;
  return accumulator;
}, {});

const WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

const getZonedParts = (referenceDate = new Date(), timeZone = SALARY_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(referenceDate);

  const read = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
    second: Number(read('second')),
    weekday: WEEKDAY_INDEX[read('weekday')] ?? 0,
  };
};

const getTimeZoneOffsetMinutes = (referenceDate = new Date(), timeZone = SALARY_TIMEZONE) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  }).formatToParts(referenceDate);
  const offsetLabel = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT+0';
  const [, sign = '+', hourPart = '0', minutePart = '0'] =
    offsetLabel.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/) || [];
  const direction = sign === '-' ? -1 : 1;

  return direction * (Number(hourPart) * 60 + Number(minutePart));
};

const zonedDateTimeToUtcDate = (
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = SALARY_TIMEZONE
) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
};

export const normalizeSalaryRole = (role = '') => {
  if (!role) {
    return null;
  }

  return SALARY_ROLE_ALIASES[role] || (SALARY_INFO_BY_ROLE[role] ? role : null);
};

export const getSalaryInfoByRole = (role = '') => {
  const normalizedRole = normalizeSalaryRole(role);
  return normalizedRole ? SALARY_INFO_BY_ROLE[normalizedRole] || null : null;
};

export const resolveSalaryInfoFromRolePool = (rolePool = []) => {
  const normalizedRolePool = dedupe(rolePool.map((role) => normalizeSalaryRole(role)).filter(Boolean));
  const salaryRole = SALARY_ROLE_PRIORITY.find((role) => normalizedRolePool.includes(role));

  if (!salaryRole) {
    return null;
  }

  return SALARY_INFO_BY_ROLE[salaryRole] || null;
};

export const getWeeklyPayrollWindowStart = (referenceDate = new Date()) => {
  const zonedParts = getZonedParts(referenceDate);
  const mondayDate = new Date(Date.UTC(zonedParts.year, zonedParts.month - 1, zonedParts.day));
  const daysSinceMonday = (zonedParts.weekday + 6) % 7;

  mondayDate.setUTCDate(mondayDate.getUTCDate() - daysSinceMonday);

  let payrollWindowStart = zonedDateTimeToUtcDate({
    year: mondayDate.getUTCFullYear(),
    month: mondayDate.getUTCMonth() + 1,
    day: mondayDate.getUTCDate(),
    hour: WEEKLY_SALARY_PAYMENT_HOUR,
    minute: 0,
    second: 0,
  });

  if (referenceDate.getTime() < payrollWindowStart.getTime()) {
    mondayDate.setUTCDate(mondayDate.getUTCDate() - 7);
    payrollWindowStart = zonedDateTimeToUtcDate({
      year: mondayDate.getUTCFullYear(),
      month: mondayDate.getUTCMonth() + 1,
      day: mondayDate.getUTCDate(),
      hour: WEEKLY_SALARY_PAYMENT_HOUR,
      minute: 0,
      second: 0,
    });
  }

  return payrollWindowStart;
};

export const shouldTriggerWeeklySalaryProcessing = (lastPaymentDate, referenceDate = new Date()) => {
  const currentPayrollWindowStart = getWeeklyPayrollWindowStart(referenceDate);

  if (referenceDate.getTime() < currentPayrollWindowStart.getTime()) {
    return false;
  }

  if (!lastPaymentDate) {
    return true;
  }

  const lastPaymentTimestamp = new Date(lastPaymentDate).getTime();

  if (Number.isNaN(lastPaymentTimestamp)) {
    return true;
  }

  return lastPaymentTimestamp < currentPayrollWindowStart.getTime();
};
