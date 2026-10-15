import {assertRealWorldAction,isPlatformAdmin} from '../admin/development.js';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
let serverSupabase;

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

  await assertRealWorldAction(supabase,authData.user.id);
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

  if (!await isPlatformAdmin(supabase,requester.id)) {
    throw createHttpError('Acesso negado. Somente administradores podem executar esta rotina manualmente.', 403);
  }

  await assertRealWorldAction(supabase,requester.id);
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

export const registerBusinessHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const requester = await ensureAuthenticatedRequester(supabase, request);
    const payload = await readJsonBody(request);
    const businessTypeId = trimString(payload.businessTypeId);
    const companyName = trimString(payload.companyName);
    const description = trimString(payload.description);
    const idempotencyKey = trimString(payload.idempotencyKey) || randomUUID();

    if (!businessTypeId || companyName.length < 5 || description.length < 15) {
      throw createHttpError('Escolha o tipo e informe nome (mínimo de 5 caracteres) e descrição (mínimo de 15 caracteres).', 400);
    }

    const { data: newBusiness, error: registrationError } = await supabase.rpc(
      'register_business_authoritative',
      {
        p_owner_id: requester.id,
        p_business_type_id: businessTypeId,
        p_company_name: companyName,
        p_description: description,
        p_idempotency_key: idempotencyKey,
        p_cnpj_id: payload.cnpjId || null,
        p_brand: payload.brand || {},
      }
    );
    if (registrationError) {
      const messages = {
        BUSINESS_DETAILS_INCOMPLETE: 'Confira o nome e a descrição da empresa.',
        BUSINESS_TYPE_NOT_AVAILABLE: 'Este tipo de empresa não está disponível.',
        BANK_ACCOUNT_REQUIRED: 'Abra sua conta no Banco Nacional antes de criar uma empresa.',
        INSUFFICIENT_BALANCE: 'Seu saldo não cobre a taxa de registro da empresa.',
        INVALID_BUSINESS_LICENSE_FEE: 'A taxa de registro está indisponível. Contate a administração.',
      };
      throw createHttpError(messages[registrationError.message] || registrationError.message || 'Não foi possível registrar a empresa.', 400);
    }

    json(response, 200, {
      success: true,
      business: newBusiness,
      message: `${companyName} foi criada e a taxa de registro foi direcionada ao governo.`,
    });
  } catch (error) {
    console.error('[businesses:register]', error);
    json(response, error.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Nao foi possivel registrar a empresa.',
    });
  }
};

export const processWeeklyBusinessBalances = async () => {
  const { data, error } = await getServerSupabase().rpc('process_company_economy');
  if (error) throw error;
  return { ...data, message: `${data.closed_cycles || 0} balanço(s) fechado(s), com operações e pagamentos persistidos.` };
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
