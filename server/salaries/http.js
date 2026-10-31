import {withWorldRequest,worldServerFetch} from '../world/request.js';
import {assertRealWorldAction,isPlatformAdmin} from '../admin/development.js';
import process from 'node:process';
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

const ensureMethod = (request, response, allowedMethods) => {
  if (handleOptions(request, response)) {
    return false;
  }

  if (!allowedMethods.includes(request.method)) {
    response.setHeader('Allow', `${allowedMethods.join(', ')}, OPTIONS`);
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
      {global:{fetch:worldServerFetch},
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return serverSupabase;
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

const ensureAdminRequester = async (supabase, request) => {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError('Sessao administrativa invalida.', 401);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData?.user?.id) {
    throw createHttpError('Nao foi possivel validar a sessao administrativa.', 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (!await isPlatformAdmin(supabase,authData.user.id)) {
    throw createHttpError('Acesso negado. Somente administradores podem executar esta rotina manualmente.', 403);
  }

  await assertRealWorldAction(supabase,authData.user.id);
  return authData.user;
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

export const processWeeklySalaries = async () => {
  const { data, error } = await getServerSupabase().rpc('process_official_payroll');
  if (error) throw error;
  return data;
};

const raw_processWeeklySalariesHandler = async (request, response) => {
  if (!ensureMethod(request, response, ['GET', 'POST'])) {
    return;
  }

  try {
    const supabase = getServerSupabase();
    await ensureAuthorizedAutomationRequest(supabase, request);
    const payload = await processWeeklySalaries();
    json(response, 200, payload);
  } catch (error) {
    console.error('[salaries:process]', error);
    json(response, error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Não foi possível processar os salários. Nenhum pagamento parcial foi confirmado.',
    });
  }
};

export const processWeeklySalariesHandler=(request,response)=>withWorldRequest(request,()=>raw_processWeeklySalariesHandler(request,response));
