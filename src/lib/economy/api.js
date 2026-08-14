import { supabase } from '@/lib/supabaseClient';
import { composeNationalEconomyDashboard } from '@/lib/countryRpEconomy';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const fetchPublicEconomy = async () => {
  const [dashboardResult, rpStateResult, snapshotsResult] = await Promise.all([
    supabase.rpc('get_public_economic_dashboard'),
    supabase
      .from('country_rp_states')
      .select('country_code, is_playable, economic_current, player_share, simulated_share, reference_snapshot_at, updated_at')
      .eq('country_code', 'BR')
      .maybeSingle(),
    supabase
      .from('country_rp_economic_snapshots')
      .select('revision, economic_state, recorded_at')
      .eq('country_code', 'BR')
      .order('recorded_at', { ascending: false })
      .limit(120),
  ]);

  const dashboard = unwrap(dashboardResult);
  const rpState = rpStateResult.error ? null : rpStateResult.data;
  const snapshots = snapshotsResult.error ? [] : snapshotsResult.data;

  return composeNationalEconomyDashboard({ dashboard, rpState, snapshots });
};

export const fetchCitizenEconomy = async () =>
  unwrap(await supabase.rpc('get_citizen_economic_dashboard'));

export const fetchBusinessEconomy = async () =>
  unwrap(await supabase.rpc('get_business_economic_dashboard'));

export const fetchGovernmentEconomy = async () =>
  unwrap(await supabase.rpc('get_presidential_economic_dashboard'));

export const fetchCentralBankEconomy = async () =>
  unwrap(await supabase.rpc('get_central_bank_dashboard'));

export const fetchAdminEconomy = async () =>
  unwrap(await supabase.rpc('get_economic_admin_dashboard'));

export const simulatePolicy = async (policyType, newValue) =>
  unwrap(await supabase.rpc('simulate_economic_policy', {
    p_policy_type: policyType,
    p_new_value: Number(newValue),
  }));

export const applyPolicy = async ({
  policyType,
  newValue,
  justification,
  marketExpectation,
}) =>
  unwrap(await supabase.rpc('apply_policy_decision', {
    p_policy_type: policyType,
    p_new_value: Number(newValue),
    p_justification: justification,
    p_market_expectation: marketExpectation === '' || marketExpectation == null
      ? null
      : Number(marketExpectation),
    p_effective_at_rp: null,
  }));

export const updateLaborStatus = async ({
  laborStatus,
  activelySeeking,
  availableForWork,
}) =>
  unwrap(await supabase.rpc('update_citizen_labor_status', {
    p_labor_status: laborStatus,
    p_actively_seeking: activelySeeking,
    p_available_for_work: availableForWork,
  }));

export const runEconomicClose = async (period) => {
  const rpcName = {
    month: 'close_economic_month',
    quarter: 'close_economic_quarter',
    year: 'close_economic_year',
  }[period.period_type];

  if (!rpcName) throw new Error('Tipo de período econômico inválido.');
  return unwrap(await supabase.rpc(rpcName, {
    p_period_id: period.id,
    p_force: false,
  }));
};

export const updateCalibration = async ({ key, value, justification }) =>
  unwrap(await supabase.rpc('update_economic_calibration', {
    p_key: key,
    p_value: value,
    p_justification: justification,
  }));
