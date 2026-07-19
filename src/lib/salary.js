import { supabase } from './supabaseClient';
import { fetchWithSessionAuth } from './apiAuth';
import {
  SALARY_TABLE,
  getSalaryInfoByRole,
  getWeeklyPayrollWindowStart,
  resolveSalaryInfoFromRolePool,
  shouldTriggerWeeklySalaryProcessing,
} from './salaryRules';

export {
  SALARY_TABLE,
  getSalaryInfoByRole,
  getWeeklyPayrollWindowStart,
  resolveSalaryInfoFromRolePool,
  shouldTriggerWeeklySalaryProcessing,
};

/**
 * Process salary payments for all eligible officials.
 * This should be called by a cron job every Monday at 09:00 AM.
 * Salaries are deducted from the government balance (cofre da união).
 */
export async function processWeeklySalaries() {
  try {
    const response = await fetchWithSessionAuth('/api/salaries/process', {
      method: 'POST',
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || 'Nao foi possivel processar os salarios.');
    }

    return payload;
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
