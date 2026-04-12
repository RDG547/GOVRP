import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { resolveParliamentHouseIdFromRole } from '../../src/lib/roleResolution.js';

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

const todayDate = () => new Date().toISOString().slice(0, 10);

const addOneMonth = (dateValue) => {
  const baseDate = new Date(`${dateValue}T00:00:00.000Z`);
  baseDate.setUTCMonth(baseDate.getUTCMonth() + 1);
  return baseDate.toISOString().slice(0, 10);
};

const ensureAdminRequester = async (supabase, request) => {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError('Sessão administrativa inválida.', 401);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData?.user?.id) {
    throw createHttpError('Não foi possível validar a sessão administrativa.', 401);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (profile?.role !== 'Admin') {
    throw createHttpError('Acesso negado. Somente administradores podem executar esta ação.', 403);
  }

  return authData.user;
};

const syncParliamentMembershipForRole = async (supabase, { userId, role }) => {
  const today = todayDate();
  const { data: housesData, error: housesError } = await supabase
    .from('parliament_houses')
    .select('id, name');

  if (housesError) {
    throw housesError;
  }

  const targetHouseId = resolveParliamentHouseIdFromRole(role, housesData || []);
  const { data: activeMemberships, error: membershipsError } = await supabase
    .from('parliament_members')
    .select('id, house_id, term_end_date')
    .eq('user_id', userId)
    .gte('term_end_date', today);

  if (membershipsError) {
    throw membershipsError;
  }

  const memberships = activeMemberships || [];
  const membershipsToExpire = targetHouseId
    ? memberships.filter((membership) => membership.house_id !== targetHouseId)
    : memberships;

  if (membershipsToExpire.length) {
    const { error: expireError } = await supabase
      .from('parliament_members')
      .update({ term_end_date: today })
      .in('id', membershipsToExpire.map((membership) => membership.id));

    if (expireError) {
      throw expireError;
    }
  }

  if (!targetHouseId) {
    return;
  }

  const sameHouseMembership = memberships.find((membership) => membership.house_id === targetHouseId);

  if (sameHouseMembership) {
    return;
  }

  const { error: createMembershipError } = await supabase
    .from('parliament_members')
    .insert({
      user_id: userId,
      house_id: targetHouseId,
      party_id: null,
      term_start_date: today,
      term_end_date: addOneMonth(today),
    });

  if (createMembershipError) {
    throw createMembershipError;
  }
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

  const { data: updatedProfile, error: updateError } = await supabase
    .from('profiles')
    .update({
      full_name: fullName,
      username,
      role,
      titles,
    })
    .eq('id', userId)
    .select('id, full_name, username, role, titles')
    .single();

  if (updateError) {
    if (updateError.code === '23505') {
      throw createHttpError('Este nome de usuário já está em uso.', 409);
    }

    throw updateError;
  }

  await syncParliamentMembershipForRole(supabase, { userId, role });

  return updatedProfile;
};

export const adminUpdateUserHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const supabase = getServerSupabase();
    await ensureAdminRequester(supabase, request);
    const body = await readJsonBody(request);
    const updatedProfile = await updateUserProfile(supabase, body);

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
