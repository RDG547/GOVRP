import {withWorldRequest,worldServerFetch} from '../world/request.js';
import {assertRealWorldAction,isPlatformAdmin} from './development.js';
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

const ensureMethod = (request, response, expectedMethod) => {
  if (handleOptions(request, response)) {
    return false;
  }

  if (request.method !== expectedMethod) {
    response.setHeader('Allow', `${expectedMethod}, OPTIONS`);
    json(response, 405, { error: 'Método não permitido.' });
    return false;
  }

  return true;
};

const getRequiredServerEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`A variável ${name} não foi configurada no servidor.`);
  }

  return value;
};

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
        reject(new Error('Corpo JSON inválido.'));
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

const normalizeTitles = (titles) => {
  if (!Array.isArray(titles)) {
    return [];
  }

  return [...new Set(titles.map((title) => trimString(title)).filter(Boolean))];
};

const ensureAdminRequester = async (supabase, request) => {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError('Sessão administrativa inválida.', 401);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData?.user?.id) {
    console.warn('[admin:authentication]', { status: authError?.status, code: authError?.code, name: authError?.name });
    const unavailable = authError?.status >= 500 || authError?.name === 'AuthRetryableFetchError';
    throw createHttpError(unavailable ? 'A validação da sessão está temporariamente indisponível. Tente novamente.' : 'Sua sessão expirou. Entre novamente para continuar.', unavailable ? 503 : 401);
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
    throw createHttpError('Acesso negado. Somente administradores podem executar esta ação.', 403);
  }

  await assertRealWorldAction(supabase,authData.user.id);
  return authData.user;
};

const updateUserProfile = async (supabase, payload) => {
  const userId = trimString(payload?.userId);
  const fullName = trimString(payload?.fullName);
  const username = trimString(payload?.username);
  const role = trimString(payload?.role) || 'Cidadão';
  const titles = normalizeTitles(payload?.titles);

  if (!userId) {
    throw createHttpError('Usuário inválido.', 400);
  }

  if (!fullName) {
    throw createHttpError('Informe o nome completo do usuário.', 400);
  }

  if (!username) {
    throw createHttpError('Informe o nome de usuário.', 400);
  }

  // The caller's JWT reaches the existing RPC so authorization, audit attribution,
  // profile changes and institutional records commit in one database transaction.
  const { data, error } = await supabase.rpc('admin_update_user_with_access', {
    p_user_id: userId,
    p_full_name: fullName,
    p_username: username,
    p_role: role,
    p_titles: titles,
    p_platform_admin: typeof payload?.isPlatformAdmin==='boolean'?payload.isPlatformAdmin:null,
  });
  if (error) {
    if (error.code === '23505') throw createHttpError('Este nome de usuário já está em uso.', 409);
    if (error.code === '42501') throw createHttpError('Acesso negado. Somente administradores podem executar esta ação.', 403);
    throw error;
  }
  if (!data?.success) throw createHttpError(data?.message || 'Não foi possível atualizar o usuário.', 400);
  const updatedProfile = data.user;

  return updatedProfile;
};

const raw_adminUpdateUserHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const supabase = getServerSupabase();
    await ensureAdminRequester(supabase, request);
    const body = await readJsonBody(request);
    const requester = createClient(
      getRequiredServerEnv('VITE_SUPABASE_URL'),
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || getRequiredServerEnv('VITE_SUPABASE_ANON_KEY'),
      { global: {fetch:worldServerFetch, headers: { Authorization: `Bearer ${getBearerToken(request)}` } }, auth: { autoRefreshToken: false, persistSession: false } }
    );
    const updatedProfile = await updateUserProfile(requester, body);

    json(response, 200, {
      success: true,
      message: 'Usuário atualizado com sucesso.',
      user: updatedProfile,
    });
  } catch (error) {
    console.error('[admin:update-user]', error);
    json(response, error?.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Não foi possível atualizar o usuário.',
    });
  }
};

export const adminUpdateUserHandler=(request,response)=>withWorldRequest(request,()=>raw_adminUpdateUserHandler(request,response));
