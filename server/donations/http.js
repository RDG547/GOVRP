import { Buffer } from 'node:buffer';
import process from 'node:process';
import Stripe from 'stripe';

const DONATION_MIN_AMOUNT = 5;
const STRIPE_API_VERSION = '2026-02-25.clover';
const PIX_EXPIRATION_SECONDS = 60 * 60;
const ABACATEPAY_API_BASE_URL = 'https://api.abacatepay.com/v2';

let stripeClient;

class PixGatewayError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'PixGatewayError';
    this.statusCode = statusCode;
  }
}

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
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

const normalizeAmount = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error('Informe um valor de doação válido.');
  }

  const rounded = Math.round(parsed * 100) / 100;

  if (rounded < DONATION_MIN_AMOUNT) {
    throw new Error('O valor mínimo para doação é de R$ 5,00.');
  }

  return rounded;
};

const toCents = (amount) => Math.round(amount * 100);

const getRequestOrigin = (request) => {
  const explicitOrigin = request.headers.origin;

  if (explicitOrigin) {
    return explicitOrigin;
  }

  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const host = forwardedHost || request.headers.host;

  if (host) {
    return `${forwardedProto || 'http'}://${host}`;
  }

  return 'http://localhost:3000';
};

const buildAbsoluteUrl = (candidateUrl, fallbackPath, origin) => {
  if (typeof candidateUrl === 'string' && candidateUrl.trim()) {
    try {
      return new URL(candidateUrl, origin).toString();
    } catch {
      // Fallback below.
    }
  }

  return new URL(fallbackPath, origin).toString();
};

const readRequestBody = async (request) => {
  if (request.body && typeof request.body === 'object') {
    return request.body;
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');

  if (!rawBody.trim()) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('O corpo da requisição precisa estar em JSON válido.');
  }
};

const getStripeClient = () => {
  if (!stripeClient) {
    stripeClient = new Stripe(getRequiredServerEnv('STRIPE_SECRET_KEY'), {
      apiVersion: STRIPE_API_VERSION,
    });
  }

  return stripeClient;
};

const normalizeRemoteError = (errorPayload, fallbackMessage) => {
  if (!errorPayload) {
    return fallbackMessage;
  }

  if (typeof errorPayload === 'string') {
    return errorPayload;
  }

  if (Array.isArray(errorPayload)) {
    return errorPayload
      .map((entry) => normalizeRemoteError(entry, ''))
      .filter(Boolean)
      .join(' | ') || fallbackMessage;
  }

  if (typeof errorPayload === 'object') {
    return (
      errorPayload.message ||
      errorPayload.error ||
      errorPayload.details ||
      Object.values(errorPayload)
        .filter((value) => typeof value === 'string')
        .join(' | ') ||
      fallbackMessage
    );
  }

  return fallbackMessage;
};

const callPixGateway = async ({ endpoint, method = 'GET', payload }) => {
  const apiKey = getRequiredServerEnv('ABACATEPAY_API_KEY');
  const response = await fetch(`${ABACATEPAY_API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const rawText = await response.text();
  let parsed;

  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error('O serviço de PIX retornou uma resposta inválida.');
  }

  if (!response.ok || parsed?.success === false || parsed?.error) {
    const fallbackMessage = `O serviço de PIX retornou ${response.status}.`;
    throw new PixGatewayError(normalizeRemoteError(parsed?.error, fallbackMessage), response.status);
  }

  return parsed?.data ?? parsed;
};

const normalizePixCharge = (charge) => ({
  id: charge?.id || '',
  amount: charge?.amount || 0,
  status: charge?.status || 'PENDING',
  brCode: charge?.brCode || '',
  brCodeBase64: charge?.brCodeBase64 || '',
  expiresAt: charge?.expiresAt || null,
  createdAt: charge?.createdAt || null,
  updatedAt: charge?.updatedAt || null,
  devMode: Boolean(charge?.devMode),
  platformFee: charge?.platformFee || 0,
});

const sendUnexpectedError = (response, error) => {
  console.error('[donations]', error);
  json(response, 500, {
    error: error instanceof Error ? error.message : 'Não foi possível processar a solicitação.',
  });
};

const sendPixGatewayError = (response, error, fallbackMessage) => {
  if (error instanceof PixGatewayError) {
    const statusCode = error.statusCode === 401 || error.statusCode === 403 ? 502 : 500;

    json(response, statusCode, {
      error:
        error.statusCode === 401 || error.statusCode === 403
          ? 'A chave da AbacatePay está inválida, inativa ou sem permissão para gerar PIX.'
          : error.message,
    });
    return;
  }

  json(response, 500, { error: fallbackMessage });
};

export const createStripeCheckoutHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const body = await readRequestBody(request);
    const amount = normalizeAmount(body.amount);
    const origin = getRequestOrigin(request);
    const successUrl = buildAbsoluteUrl(body.successUrl, '/support-us?donation=success', origin);
    const cancelUrl = buildAbsoluteUrl(body.cancelUrl, '/donation', origin);
    const userEmail = typeof body.userEmail === 'string' ? body.userEmail.trim() : '';
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const stripe = getStripeClient();

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'pt-BR',
      submit_type: 'donate',
      customer_email: userEmail || undefined,
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'brl',
            unit_amount: toCents(amount),
            product_data: {
              name: 'Doação para GOV.RP',
            },
          },
        },
      ],
      metadata: {
        source: 'govrp-donation',
        amount: amount.toFixed(2),
        userId,
      },
      payment_intent_data: {
        metadata: {
          source: 'govrp-donation',
          amount: amount.toFixed(2),
          userId,
        },
      },
    });

    if (!session.url) {
      throw new Error('A URL do checkout não foi retornada.');
    }

    json(response, 200, {
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    sendUnexpectedError(response, error);
  }
};

export const createPixChargeHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const body = await readRequestBody(request);
    const amount = normalizeAmount(body.amount);
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const userEmail = typeof body.userEmail === 'string' ? body.userEmail.trim() : '';

    const charge = await callPixGateway({
      endpoint: '/transparents/create',
      method: 'POST',
      payload: {
        method: 'PIX',
        data: {
          amount: toCents(amount),
          description: 'Doacao GOV.RP',
          expiresIn: PIX_EXPIRATION_SECONDS,
          externalId: userId ? `govrp-donation-${userId}-${Date.now()}` : undefined,
          metadata: {
            source: 'govrp-donation',
            userId,
            userEmail,
            amount: amount.toFixed(2),
          },
        },
      },
    });

    json(response, 200, {
      charge: normalizePixCharge(charge),
    });
  } catch (error) {
    console.error('[donations:pix-create]', error);
    sendPixGatewayError(
      response,
      error,
      'Não foi possível gerar o código PIX agora. Tente novamente em instantes.'
    );
  }
};

export const checkPixChargeHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'GET')) {
    return;
  }

  try {
    const origin = getRequestOrigin(request);
    const requestUrl = new URL(request.url || '/', origin);
    const chargeId =
      (typeof request.query?.id === 'string' && request.query.id) ||
      requestUrl.searchParams.get('id') ||
      '';

    if (!chargeId) {
      json(response, 400, { error: 'Informe o ID do PIX para consultar o status.' });
      return;
    }

    const status = await callPixGateway({
      endpoint: `/transparents/check?id=${encodeURIComponent(chargeId)}`,
      method: 'GET',
    });

    json(response, 200, {
      status: {
        id: status?.id || chargeId,
        status: status?.status || 'PENDING',
        expiresAt: status?.expiresAt || null,
      },
    });
  } catch (error) {
    console.error('[donations:pix-status]', error);
    sendPixGatewayError(response, error, 'Não foi possível consultar o status do PIX agora.');
  }
};
