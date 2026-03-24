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
