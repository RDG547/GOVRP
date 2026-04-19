import { supabase } from './supabaseClient';

/**
 * Public salary table for government officials.
 * Salaries are paid every Monday at 10:00 AM from the Union treasury.
 */
export const SALARY_TABLE = [
  { role: 'Presidente', title: 'Presidente da República', salary: 35000 },
  { role: 'Vice-Presidente', title: 'Vice-Presidente', salary: 24500 },
  { role: 'Deputado', title: 'Deputado Federal', salary: 10500 },
  { role: 'Senador', title: 'Senador', salary: 17500 },
  { role: 'Presidente do Senado', title: 'Presidente do Senado', salary: 24500 },
  { role: 'Presidente da Câmara', title: 'Presidente da Câmara', salary: 21000 },
  { role: 'Ministro', title: 'Ministro de Estado', salary: 17500 },
];

const SALARY_ROLE_PRIORITY = [
  'Presidente',
  'Vice-Presidente',
  'Presidente do Senado',
  'Presidente da Câmara',
  'Ministro',
  'Senador',
  'Deputado',
];

const SALARY_ROLE_ALIASES = {
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

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

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

/**
 * Process salary payments for all eligible officials.
 * This should be called by a cron job every Monday at 10:00 AM.
 * Salaries are deducted from the government balance (cofre da união).
 */
export async function processWeeklySalaries() {
  try {
    const { data, error } = await supabase.rpc('process_weekly_salaries');
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error processing salaries:', error);
    throw error;
  }
}

/**
 * Get the last salary payment date.
 */
export async function getLastPaymentDate() {
  const { data, error } = await supabase
    .from('salary_payments')
    .select('paid_at')
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.error('Error fetching last payment:', error);
    return null;
  }
  return data?.paid_at;
}

export async function getLatestSalaryPayment(userId) {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('salary_payments')
    .select('*')
    .eq('user_id', userId)
    .order('paid_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching latest salary payment:', error);
    return null;
  }

  return data || null;
}

/**
 * Get salary payment history.
 */
export async function getSalaryHistory(userId = null, limit = 20) {
  let query = supabase
    .from('salary_payments')
    .select('*, profile:profiles!salary_payments_user_id_fkey(full_name, username, avatar_url)')
    .order('paid_at', { ascending: false })
    .limit(limit);
  
  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching salary history:', error);
    return [];
  }
  return data;
}

export const getWeeklyPayrollWindowStart = (referenceDate = new Date()) => {
  const reference = new Date(referenceDate);
  const daysSinceMonday = (reference.getDay() + 6) % 7;

  reference.setDate(reference.getDate() - daysSinceMonday);
  reference.setHours(10, 0, 0, 0);

  return reference;
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
