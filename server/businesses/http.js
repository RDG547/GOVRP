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
