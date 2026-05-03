import { fetchWithSessionAuth } from './apiAuth';
import { supabase } from './supabaseClient';
import {
  getWeeklyPayrollWindowStart,
  shouldTriggerWeeklySalaryProcessing,
} from './salaryRules';

export const BUSINESS_BALANCE_NOTIFICATION_TYPE = 'business_balance';

export const shouldTriggerWeeklyBusinessBalanceProcessing = shouldTriggerWeeklySalaryProcessing;

export { getWeeklyPayrollWindowStart };

export async function processWeeklyBusinessBalances() {
  const response = await fetchWithSessionAuth('/api/businesses/process-balances', {
    method: 'POST',
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || 'Nao foi possivel processar os balancos empresariais.');
  }

  return payload;
}

export async function getLastBusinessBalanceDate() {
  const { data, error } = await supabase
    .from('business_balance_cycles')
    .select('processed_at')
    .order('processed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Erro ao buscar ultimo balanco empresarial:', error);
    return null;
  }

  return data?.processed_at || null;
}

export async function userHasBusinesses(userId) {
  if (!userId) {
    return false;
  }

  const { count, error } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId);

  if (error) {
    console.error('Erro ao verificar empresas do usuario:', error);
    return false;
  }

  return Number(count || 0) > 0;
}
