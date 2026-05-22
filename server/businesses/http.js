import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { getWeeklyPayrollWindowStart } from '../../src/lib/salaryRules.js';
import {
  annualPercentToMonthlyPercent,
  DEFAULT_ECONOMIC_POLICY,
  ECONOMIC_POLICY_SETTINGS_KEY,
  normalizeEconomicPolicy,
} from '../../src/lib/economicPolicy.js';

let serverSupabase;

const BUSINESS_ECONOMICS = {
  banco: { revenueBase: 72000, costBase: 56000, minEmployees: 10, volatility: 0.34 },
  construtora: { revenueBase: 64000, costBase: 52000, minEmployees: 15, volatility: 0.3 },
  fabrica: { revenueBase: 76000, costBase: 61000, minEmployees: 20, volatility: 0.32 },
  loja: { revenueBase: 26000, costBase: 20500, minEmployees: 3, volatility: 0.22 },
  transportadora: { revenueBase: 43000, costBase: 35000, minEmployees: 8, volatility: 0.26 },
  consultoria: { revenueBase: 23000, costBase: 17500, minEmployees: 2, volatility: 0.2 },
  seguranca: { revenueBase: 39000, costBase: 33000, minEmployees: 12, volatility: 0.28 },
  distribuidora: { revenueBase: 50000, costBase: 40500, minEmployees: 8, volatility: 0.26 },
};

const DEFAULT_BUSINESS_ECONOMICS = {
  revenueBase: 28000,
  costBase: 22500,
  minEmployees: 4,
  volatility: 0.24,
};

const STATE_ENTERPRISE_ECONOMICS = {
  'Banco Nacional': { revenueBase: 95000, costBase: 78000, volatility: 0.2 },
  Internet: { revenueBase: 88000, costBase: 69000, volatility: 0.22 },
  Telefonia: { revenueBase: 76000, costBase: 61000, volatility: 0.22 },
  'Energia Elétrica': { revenueBase: 118000, costBase: 96000, volatility: 0.2 },
  Água: { revenueBase: 82000, costBase: 68000, volatility: 0.18 },
  Gás: { revenueBase: 70000, costBase: 57500, volatility: 0.22 },
  Outros: { revenueBase: 52000, costBase: 43000, volatility: 0.24 },
};

const BUSINESS_BALANCE_NOTIFICATION_TYPE = 'business_balance';
const STATE_ENTERPRISE_SETTINGS_KEY = 'enterprise_costs';
const BASIC_SERVICE_PRICES_SETTINGS_KEY = 'basic_service_prices';
const WEEKS_PER_MONTH = 4.345;
const SERVICE_PRICE_KEYS_BY_TYPE = {
  Internet: {
    'Básico': 'Internet_Básico',
    Ultra: 'Internet_Ultra',
    Mega: 'Internet_Mega',
  },
  Telefonia: {
    'Básico': 'Telefonia_Básico',
    'Intermediário': 'Telefonia_Intermediário',
    Premium: 'Telefonia_Premium',
  },
  'Energia Elétrica': {
    default: 'Energia Elétrica',
  },
  Água: {
    default: 'Água',
  },
  Gás: {
    default: 'Gás',
  },
};

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

const randomBetween = (min, max) => min + Math.random() * (max - min);

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

const normalizeStatus = (status = '') => `${status || ''}`.trim().toLowerCase();

const getWeeklyEquivalent = (monthlyValue = 0) => roundMoney(Number(monthlyValue || 0) / WEEKS_PER_MONTH);

const getEconomicModifiers = (economicPolicy = DEFAULT_ECONOMIC_POLICY) => {
  const normalizedEconomicPolicy = normalizeEconomicPolicy(economicPolicy);
  const selicMonthlyRate = annualPercentToMonthlyPercent(normalizedEconomicPolicy.selic_rate);

  return {
    selicMonthlyRate,
    demandMultiplier: Math.max(0.88, 1 - selicMonthlyRate * 0.02),
    costMultiplier: 1 + selicMonthlyRate * 0.015,
  };
};

const sumConfiguredCosts = (costs = {}) =>
  roundMoney(
    Object.values(costs || {}).reduce((sum, value) => sum + Number(value || 0), 0)
  );

const resolveServicePriceKey = ({ serviceType, planName = '' }) => {
  const mapping = SERVICE_PRICE_KEYS_BY_TYPE[serviceType];

  if (!mapping) {
    return null;
  }

  return mapping[planName] || mapping.default || null;
};

const isPrivateBusinessEligible = (business) => {
  const status = normalizeStatus(business?.status || 'active');
  return Boolean(business?.id && business?.owner_id && !['suspended', 'inactive', 'closed'].includes(status));
};

const resolveBusinessEconomics = (businessTypeId) =>
  BUSINESS_ECONOMICS[businessTypeId] || DEFAULT_BUSINESS_ECONOMICS;

const resolveStateEnterpriseEconomics = (sector) =>
  STATE_ENTERPRISE_ECONOMICS[sector] || STATE_ENTERPRISE_ECONOMICS.Outros;

const calculateBalanceResult = (
  { revenueBase, costBase, minEmployees = 1, volatility = 0.24 },
  employees = 1,
  recordedRevenue = 0,
  modifiers = {}
) => {
  const workforceMultiplier = Math.max(0.75, Number(employees || 0) / Math.max(1, minEmployees));
  const demandMultiplier = Number.isFinite(modifiers.demandMultiplier) ? modifiers.demandMultiplier : 1;
  const costMultiplier = Number.isFinite(modifiers.costMultiplier) ? modifiers.costMultiplier : 1;
  const revenueSeed = Number(recordedRevenue || 0) > 0
    ? Number(recordedRevenue || 0)
    : revenueBase * workforceMultiplier;
  const grossRevenue = roundMoney(revenueSeed * demandMultiplier * randomBetween(1 - volatility, 1 + volatility));
  const operatingCost = roundMoney(costBase * workforceMultiplier * costMultiplier * randomBetween(0.9, 1.14));
  const netResult = roundMoney(grossRevenue - operatingCost);

  return {
    grossRevenue,
    operatingCost,
    netResult,
    resultType: netResult >= 0 ? 'profit' : 'loss',
  };
};

const calculateStateEnterpriseBalanceResult = ({
  enterprise,
  enterpriseCosts = {},
  basicServicePrices = {},
  userServices = [],
  economicModifiers = {},
}) => {
  const relevantServices = (userServices || []).filter((service) => service.service_type === enterprise.sector);
  const configuredEnterpriseCosts = enterpriseCosts?.[enterprise.id] || {};
  const configuredWeeklyCost = getWeeklyEquivalent(sumConfiguredCosts(configuredEnterpriseCosts));

  if (relevantServices.length) {
    const grossRevenue = roundMoney(
      relevantServices.reduce((sum, service) => {
        const priceKey = resolveServicePriceKey({
          serviceType: service.service_type,
          planName: service.plan_name,
        });
        const configuredPrice = priceKey ? Number(basicServicePrices?.[priceKey]) : Number.NaN;
        const appliedPrice = Number.isFinite(configuredPrice) ? configuredPrice : Number(service.price || 0);

        return sum + Math.max(0, appliedPrice);
      }, 0) * (economicModifiers.demandMultiplier || 1)
    );
    const fallbackEconomics = resolveStateEnterpriseEconomics(enterprise.sector);
    const operatingCostSeed = configuredWeeklyCost > 0
      ? configuredWeeklyCost
      : getWeeklyEquivalent(fallbackEconomics.costBase);
    const operatingCost = roundMoney(
      operatingCostSeed * (economicModifiers.costMultiplier || 1) * randomBetween(0.98, 1.08)
    );
    const netResult = roundMoney(grossRevenue - operatingCost);
    const zeroPriceContracts = relevantServices.filter((service) => {
      const priceKey = resolveServicePriceKey({ serviceType: service.service_type, planName: service.plan_name });
      const configuredPrice = priceKey ? Number(basicServicePrices?.[priceKey]) : Number.NaN;
      const appliedPrice = Number.isFinite(configuredPrice) ? configuredPrice : Number(service.price || 0);
      return appliedPrice <= 0;
    }).length;

    return {
      grossRevenue,
      operatingCost,
      netResult,
      resultType: netResult >= 0 ? 'profit' : 'loss',
      activeContracts: relevantServices.length,
      subsidyCost: Math.max(0, operatingCost - grossRevenue),
      zeroPriceContracts,
      source: 'service_subscriptions',
    };
  }

  const fallbackResult = calculateBalanceResult(
    resolveStateEnterpriseEconomics(enterprise.sector),
    1,
    0,
    economicModifiers
  );

  return {
    ...fallbackResult,
    activeContracts: 0,
    subsidyCost: 0,
    zeroPriceContracts: 0,
    source: 'state_economics_model',
  };
};

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

const handleOptions = (request, response) => {
  if (request.method !== 'OPTIONS') {
    return false;
  }

  response.statusCode = 204;
  response.end();
  return true;
};

const ensureMethod = (request, response, expectedMethod) => {
  if (handleOptions(request, response)) {
    return false;
  }

  if (request.method !== expectedMethod) {
    response.setHeader('Allow', `${expectedMethod}, OPTIONS`);
    json(response, 405, { error: 'Metodo nao permitido.' });
    return false;
  }

  return true;
};

const getRequiredServerEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`A variavel ${name} nao foi configurada no servidor.`);
  }

  return value;
};

const getOptionalServerEnv = (name) => process.env[name]?.trim() || '';

const getServerSupabase = () => {
  if (!serverSupabase) {
    serverSupabase = createClient(
      getRequiredServerEnv('VITE_SUPABASE_URL'),
      getRequiredServerEnv('SUPABASE_SECRET_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return serverSupabase;
};

const readJsonBody = async (request) => {
  if (request.body && typeof request.body === 'object') {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return request.body.trim() ? JSON.parse(request.body) : {};
  }

  return await new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk;
    });

    request.on('end', () => {
      if (!rawBody.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error('Corpo JSON invalido.'));
      }
    });

    request.on('error', reject);
  });
};

const getBearerToken = (request) => {
  const authorization = request.headers?.authorization || request.headers?.Authorization;

  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authorization.slice(7).trim();
};

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');

const ensureAuthenticatedRequester = async (supabase, request) => {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError('Sessao invalida.', 401);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData?.user?.id) {
    throw createHttpError('Nao foi possivel validar a sessao do usuario.', 401);
  }

  return authData.user;
};

const ensureAdminRequester = async (supabase, request) => {
  const requester = await ensureAuthenticatedRequester(supabase, request);

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', requester.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (profile?.role !== 'Admin') {
    throw createHttpError('Acesso negado. Somente administradores podem executar esta rotina manualmente.', 403);
  }

  return requester;
};

const ensureAuthorizedAutomationRequest = async (supabase, request) => {
  const cronSecret = getOptionalServerEnv('CRON_SECRET');
  const token = getBearerToken(request);

  if (cronSecret && token === cronSecret) {
    return { type: 'cron' };
  }

  if (!token) {
    throw createHttpError(
      cronSecret
        ? 'Rotina automatica exige autenticacao do cron ou sessao administrativa.'
        : 'Sessao administrativa invalida.',
      401
    );
  }

  const admin = await ensureAdminRequester(supabase, request);
  return { type: 'admin', userId: admin.id };
};

const fetchProcessedBalanceIds = async (supabase, cycleStartIso) => {
  const { data, error } = await supabase
    .from('business_balance_cycles')
    .select('business_id, state_enterprise_id')
    .eq('cycle_start_at', cycleStartIso);

  if (error) {
    throw error;
  }

  return {
    businessIds: new Set((data || []).map((row) => row.business_id).filter(Boolean)),
    stateEnterpriseIds: new Set((data || []).map((row) => row.state_enterprise_id).filter(Boolean)),
  };
};

const fetchAccountsByUserId = async (supabase, userIds) => {
  if (!userIds.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('id, user_id, balance')
    .in('user_id', userIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((accumulator, account) => {
    accumulator[account.user_id] = account;
    return accumulator;
  }, {});
};

const updateAccountBalance = async (supabase, accountId, delta) => {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('balance')
    .eq('id', accountId)
    .maybeSingle();

  if (accountError) {
    throw accountError;
  }

  const { error: updateError } = await supabase
    .from('accounts')
    .update({
      balance: roundMoney(Number(account?.balance || 0) + delta),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (updateError) {
    throw updateError;
  }
};

const insertBusinessBalanceNotification = async (supabase, { business, cycle, cycleStartIso }) => {
  const netResult = Number(cycle.net_result || 0);
  const isProfit = netResult >= 0;

  const { error } = await supabase.from('notifications').insert({
    user_id: business.owner_id,
    type: BUSINESS_BALANCE_NOTIFICATION_TYPE,
    content: `${business.name} ${isProfit ? 'fechou o ciclo com lucro' : 'fechou o ciclo com prejuizo'} de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(netResult))}.`,
    link: '/services/entrepreneur-portal',
    is_read: false,
    metadata: {
      popup_pending: true,
      popup_shown_at: null,
      cycle_id: cycle.id,
      cycle_start_at: cycleStartIso,
      business_id: business.id,
      business_name: business.name,
      result_type: cycle.result_type,
      gross_revenue: cycle.gross_revenue,
      operating_cost: cycle.operating_cost,
      net_result: cycle.net_result,
    },
  });

  if (error) {
    throw error;
  }
};

const processPrivateBusinessBalance = async (supabase, { business, account, cycleStartIso, economicPolicy }) => {
  if (!account?.id) {
    return { processed: false, skippedReason: 'missing_account' };
  }

  const economicModifiers = getEconomicModifiers(economicPolicy);
  const result = calculateBalanceResult(
    resolveBusinessEconomics(business.business_type_id),
    business.employees,
    business.monthly_revenue,
    economicModifiers
  );

  await updateAccountBalance(supabase, account.id, result.netResult);

  const { data: cycle, error: cycleError } = await supabase
    .from('business_balance_cycles')
    .insert({
      business_id: business.id,
      owner_id: business.owner_id,
      account_id: account.id,
      cycle_start_at: cycleStartIso,
      gross_revenue: result.grossRevenue,
      operating_cost: result.operatingCost,
      net_result: result.netResult,
      result_type: result.resultType,
      metadata: {
        business_type_id: business.business_type_id,
        status: business.status,
        employees: business.employees,
        source: 'private_business',
        selic_monthly_rate: economicModifiers.selicMonthlyRate,
      },
    })
    .select('id, gross_revenue, operating_cost, net_result, result_type')
    .single();

  if (cycleError) {
    throw cycleError;
  }

  const transactionAmount = Math.abs(result.netResult);
  if (transactionAmount > 0) {
    const { error: bankTransactionError } = await supabase.from('transactions').insert({
      from_account_id: result.netResult < 0 ? account.id : null,
      to_account_id: result.netResult >= 0 ? account.id : null,
      amount: transactionAmount,
      type: result.netResult >= 0 ? 'business_profit' : 'business_loss',
      description: `${result.netResult >= 0 ? 'Lucro' : 'Prejuizo'} do ciclo da empresa: ${business.name}`,
      created_at: new Date().toISOString(),
      metadata: {
        business_id: business.id,
        business_balance_cycle_id: cycle.id,
        cycle_start_at: cycleStartIso,
      },
    });

    if (bankTransactionError) {
      throw bankTransactionError;
    }
  }

  const { error: businessTransactionError } = await supabase.from('business_transactions').insert({
    business_id: business.id,
    type: result.netResult >= 0 ? 'annual_profit' : 'annual_loss',
    amount: result.netResult,
    description: `${result.netResult >= 0 ? 'Lucro' : 'Prejuizo'} do ciclo processado automaticamente.`,
  });

  if (businessTransactionError) {
    console.error('[businesses:balance:business_transactions]', businessTransactionError);
  }

  await insertBusinessBalanceNotification(supabase, { business, cycle, cycleStartIso });

  return {
    processed: true,
    netResult: result.netResult,
  };
};

const processStateEnterpriseBalance = async (
  supabase,
  { enterprise, finance, cycleStartIso, enterpriseCosts, basicServicePrices, userServices, economicPolicy }
) => {
  if (!finance?.id) {
    return { processed: false, skippedReason: 'missing_government_finance' };
  }

  const economicModifiers = getEconomicModifiers(economicPolicy);
  const result = calculateStateEnterpriseBalanceResult({
    enterprise,
    enterpriseCosts,
    basicServicePrices,
    userServices,
    economicModifiers,
  });

  const { data: latestFinance, error: financeError } = await supabase
    .from('government_finances')
    .select('treasury_balance')
    .eq('id', finance.id)
    .maybeSingle();

  if (financeError) {
    throw financeError;
  }

  const { error: updateFinanceError } = await supabase
    .from('government_finances')
    .update({
      treasury_balance: roundMoney(Number(latestFinance?.treasury_balance || 0) + result.netResult),
      updated_at: new Date().toISOString(),
    })
    .eq('id', finance.id);

  if (updateFinanceError) {
    throw updateFinanceError;
  }

  const { data: cycle, error: cycleError } = await supabase
    .from('business_balance_cycles')
    .insert({
      state_enterprise_id: enterprise.id,
      cycle_start_at: cycleStartIso,
      gross_revenue: result.grossRevenue,
      operating_cost: result.operatingCost,
      net_result: result.netResult,
      result_type: result.resultType,
      metadata: {
        sector: enterprise.sector,
        source: 'state_enterprise',
        balance_source: result.source,
        active_contracts: result.activeContracts,
        subsidy_cost: result.subsidyCost,
        zero_price_contracts: result.zeroPriceContracts,
        selic_monthly_rate: economicModifiers.selicMonthlyRate,
      },
    })
    .select('id')
    .single();

  if (cycleError) {
    throw cycleError;
  }

  const transactionAmount = Math.abs(result.netResult);
  if (transactionAmount > 0) {
    const { error: transactionError } = await supabase.from('transactions').insert({
      from_account_id: null,
      to_account_id: null,
      amount: transactionAmount,
      type: result.netResult >= 0 ? 'state_enterprise_profit' : 'state_enterprise_loss',
      description: `${result.netResult >= 0 ? 'Lucro' : 'Prejuizo'} do ciclo da estatal: ${enterprise.name}${result.subsidyCost > 0 ? ' (com subsídio operacional)' : ''}`,
      created_at: new Date().toISOString(),
      metadata: {
        state_enterprise_id: enterprise.id,
        business_balance_cycle_id: cycle.id,
        cycle_start_at: cycleStartIso,
        treasury_delta: result.netResult,
        subsidy_cost: result.subsidyCost,
        active_contracts: result.activeContracts,
        zero_price_contracts: result.zeroPriceContracts,
      },
    });

    if (transactionError) {
      throw transactionError;
    }
  }

  return {
    processed: true,
    netResult: result.netResult,
  };
};

export const registerBusinessHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();
  let createdBusiness = null;
  let accountSnapshot = null;
  let financeSnapshot = null;

  try {
    const requester = await ensureAuthenticatedRequester(supabase, request);
    const payload = await readJsonBody(request);
    const businessTypeId = trimString(payload.businessTypeId);
    const companyName = trimString(payload.companyName);
    const description = trimString(payload.description);
    const minEmployees = Number(payload.minEmployees || 0);
    const registrationFee = Number(payload.registrationFee || 0);

    if (!businessTypeId || !companyName || !description) {
      throw createHttpError('Dados da empresa incompletos.', 400);
    }

    if (!Number.isFinite(registrationFee) || registrationFee <= 0) {
      throw createHttpError('Taxa de registro invalida.', 400);
    }

    const [{ data: account, error: accountError }, { data: finance, error: financeError }] = await Promise.all([
      supabase.from('accounts').select('id, balance').eq('user_id', requester.id).maybeSingle(),
      supabase
        .from('government_finances')
        .select('id, treasury_balance')
        .order('updated_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (accountError) {
      throw accountError;
    }

    if (financeError) {
      throw financeError;
    }

    if (!account?.id) {
      throw createHttpError('Voce precisa possuir conta bancaria para registrar uma empresa.', 400);
    }

    if (!finance?.id) {
      throw createHttpError('Nao foi possivel localizar as financas do governo.', 500);
    }

    if (Number(account.balance || 0) < registrationFee) {
      throw createHttpError('Saldo insuficiente para pagar a taxa de registro da empresa.', 400);
    }

    accountSnapshot = account;
    financeSnapshot = finance;

    const { data: newBusiness, error: insertBusinessError } = await supabase
      .from('businesses')
      .insert({
        owner_id: requester.id,
        business_type_id: businessTypeId,
        name: companyName,
        description,
        status: 'pending',
        employees: minEmployees,
        monthly_revenue: 0,
      })
      .select('id, owner_id, business_type_id, name, description, status, employees, monthly_revenue, created_at')
      .single();

    if (insertBusinessError) {
      throw insertBusinessError;
    }

    createdBusiness = newBusiness;

    const { error: debitAccountError } = await supabase
      .from('accounts')
      .update({
        balance: Number(account.balance || 0) - registrationFee,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    if (debitAccountError) {
      throw debitAccountError;
    }

    const { error: creditTreasuryError } = await supabase
      .from('government_finances')
      .update({
        treasury_balance: Number(finance.treasury_balance || 0) + registrationFee,
        updated_at: new Date().toISOString(),
      })
      .eq('id', finance.id);

    if (creditTreasuryError) {
      throw creditTreasuryError;
    }

    const [{ error: businessTransactionError }, { error: bankTransactionError }] = await Promise.all([
      supabase.from('business_transactions').insert({
        business_id: newBusiness.id,
        type: 'registration',
        amount: -registrationFee,
        description: `Taxa de registro: ${companyName}`,
      }),
      supabase.from('transactions').insert({
        from_account_id: account.id,
        to_account_id: null,
        amount: registrationFee,
        type: 'service_fee',
        description: `Taxa de registro empresarial: ${companyName}`,
        created_at: new Date().toISOString(),
        metadata: {
          business_id: newBusiness.id,
          business_type_id: businessTypeId,
          fee_type: 'business_registration',
          treasury_credit: true,
        },
      }),
    ]);

    if (businessTransactionError) {
      throw businessTransactionError;
    }

    if (bankTransactionError) {
      throw bankTransactionError;
    }

    json(response, 200, {
      success: true,
      business: createdBusiness,
      message: `${companyName} foi criada e a taxa de registro foi direcionada ao governo.`,
    });
  } catch (error) {
    if (createdBusiness?.id && accountSnapshot?.id && financeSnapshot?.id) {
      await Promise.allSettled([
        supabase.from('businesses').delete().eq('id', createdBusiness.id),
        supabase
          .from('accounts')
          .update({
            balance: Number(accountSnapshot.balance || 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', accountSnapshot.id),
        supabase
          .from('government_finances')
          .update({
            treasury_balance: Number(financeSnapshot.treasury_balance || 0),
            updated_at: new Date().toISOString(),
          })
          .eq('id', financeSnapshot.id),
      ]);
    }

    console.error('[businesses:register]', error);
    json(response, error.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Nao foi possivel registrar a empresa.',
    });
  }
};

export const processWeeklyBusinessBalances = async () => {
  const supabase = getServerSupabase();
  const cycleWindowStart = getWeeklyPayrollWindowStart(new Date());
  const cycleStartIso = cycleWindowStart.toISOString();
  const processedIds = await fetchProcessedBalanceIds(supabase, cycleStartIso);

  const [
    { data: businesses, error: businessesError },
    { data: stateEnterprises, error: stateEnterprisesError },
    { data: governmentFinance, error: financeError },
    { data: settingsRows, error: settingsError },
    { data: userServices, error: userServicesError },
  ] = await Promise.all([
    supabase
      .from('businesses')
      .select('id, owner_id, business_type_id, name, status, employees, monthly_revenue')
      .not('owner_id', 'is', null),
    supabase
      .from('state_enterprises')
      .select('id, name, sector, is_active, is_privatized, privatization_status')
      .eq('is_active', true)
      .or('is_privatized.eq.false,is_privatized.is.null'),
    supabase
      .from('government_finances')
      .select('id, treasury_balance')
      .order('updated_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('system_settings')
      .select('key, value')
      .in('key', [STATE_ENTERPRISE_SETTINGS_KEY, BASIC_SERVICE_PRICES_SETTINGS_KEY, ECONOMIC_POLICY_SETTINGS_KEY]),
    supabase
      .from('user_services')
      .select('service_type, plan_name, price')
      .in('service_type', Object.keys(SERVICE_PRICE_KEYS_BY_TYPE)),
  ]);

  if (businessesError) {
    throw businessesError;
  }

  if (stateEnterprisesError) {
    throw stateEnterprisesError;
  }

  if (financeError) {
    throw financeError;
  }

  if (settingsError) {
    throw settingsError;
  }

  if (userServicesError) {
    throw userServicesError;
  }

  const settingsMap = (settingsRows || []).reduce((accumulator, row) => {
    accumulator[row.key] = row.value;
    return accumulator;
  }, {});
  const enterpriseCosts = settingsMap[STATE_ENTERPRISE_SETTINGS_KEY] || {};
  const basicServicePrices = settingsMap[BASIC_SERVICE_PRICES_SETTINGS_KEY] || {};
  const economicPolicy = normalizeEconomicPolicy(settingsMap[ECONOMIC_POLICY_SETTINGS_KEY]);

  const privateBusinesses = (businesses || [])
    .filter(isPrivateBusinessEligible)
    .filter((business) => !processedIds.businessIds.has(business.id));
  const activeStateEnterprises = (stateEnterprises || [])
    .filter((enterprise) => !processedIds.stateEnterpriseIds.has(enterprise.id));
  const ownerIds = dedupe(privateBusinesses.map((business) => business.owner_id));
  const accountsByUserId = await fetchAccountsByUserId(supabase, ownerIds);

  let processedPrivateCount = 0;
  let processedStateCount = 0;
  let skippedPrivateCount = 0;
  let totalPrivateNetResult = 0;
  let totalStateNetResult = 0;

  for (const business of privateBusinesses) {
    const result = await processPrivateBusinessBalance(supabase, {
      business,
      account: accountsByUserId[business.owner_id],
      cycleStartIso,
      economicPolicy,
    });

    if (result.processed) {
      processedPrivateCount += 1;
      totalPrivateNetResult += Number(result.netResult || 0);
    } else {
      skippedPrivateCount += 1;
    }
  }

  for (const enterprise of activeStateEnterprises) {
    const result = await processStateEnterpriseBalance(supabase, {
      enterprise,
      finance: governmentFinance,
      cycleStartIso,
      enterpriseCosts,
      basicServicePrices,
      userServices,
      economicPolicy,
    });

    if (result.processed) {
      processedStateCount += 1;
      totalStateNetResult += Number(result.netResult || 0);
    }
  }

  return {
    success: true,
    message: `${processedPrivateCount + processedStateCount} balanco(s) empresarial(is) processado(s).`,
    processedPrivateCount,
    processedStateCount,
    skippedPrivateCount,
    totalPrivateNetResult: roundMoney(totalPrivateNetResult),
    totalStateNetResult: roundMoney(totalStateNetResult),
    cycleWindowStart: cycleStartIso,
  };
};

export const processWeeklyBusinessBalancesHandler = async (request, response) => {
  if (!ensureMethod(request, response, ['GET', 'POST'])) {
    return;
  }

  try {
    const supabase = getServerSupabase();
    await ensureAuthorizedAutomationRequest(supabase, request);
    const payload = await processWeeklyBusinessBalances();
    json(response, 200, payload);
  } catch (error) {
    console.error('[businesses:balances]', error);
    json(response, error.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Nao foi possivel processar os balancos empresariais.',
    });
  }
};
