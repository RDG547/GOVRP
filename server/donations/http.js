import {withWorldRequest,worldServerFetch} from '../world/request.js';
import {assertRealWorldAction} from '../admin/development.js';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const DONATION_MIN_AMOUNT = 5;
const STRIPE_API_VERSION = '2026-02-25.clover';
const PIX_EXPIRATION_SECONDS = 60 * 60;
const ABACATEPAY_API_BASE_URL = 'https://api.abacatepay.com/v2';

let stripeClient;
let supabaseAdminClient;

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

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

const getSupabaseAdmin = () => {
  if (!supabaseAdminClient) {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.trim();
    const secret = process.env.SUPABASE_SECRET_KEY?.trim();
    if (!url || !secret) throw new Error('Configuração interna de persistência indisponível.');
    supabaseAdminClient = createClient(url, secret, {global:{fetch:worldServerFetch},
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdminClient;
};

const authenticateRequest = async (request) => {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new HttpError('Faça login novamente para continuar.', 401);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError('Sessão inválida ou expirada.', 401);
  await assertRealWorldAction(admin,data.user.id);
  return { admin, user: data.user };
};

const getIdempotencyKey = (request) => {
  const value = request.headers['idempotency-key'] || request.headers['x-idempotency-key'];
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError('Identificador idempotente inválido.', 400);
  }
  return value;
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
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  json(response, statusCode, { error: statusCode < 500 ? error.message : 'Não foi possível processar a solicitação agora.' });
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

const raw_createStripeCheckoutHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const { admin, user } = await authenticateRequest(request);
    const idempotencyKey = getIdempotencyKey(request);
    const body = await readRequestBody(request);
    const amount = normalizeAmount(body.amount);
    const origin = getRequestOrigin(request);
    const successUrl = buildAbsoluteUrl(body.successUrl, '/support-us?donation=success', origin);
    const cancelUrl = buildAbsoluteUrl(body.cancelUrl, '/donation', origin);
    const stripe = getStripeClient();

    const { data: existingDonation } = await admin.from('donations').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existingDonation && existingDonation.donor_id !== user.id) throw new HttpError('Operação idempotente pertence a outra sessão.', 409);
    if (existingDonation && Number(existingDonation.amount) !== amount) throw new HttpError('A mesma chave idempotente não pode ser reutilizada com outro valor.', 409);
    if (existingDonation?.checkout_url) {
      json(response, 200, { checkoutUrl: existingDonation.checkout_url, sessionId: existingDonation.gateway_reference, donationCode: existingDonation.donation_code });
      return;
    }

    let donation = existingDonation;
    if (!donation) {
      const { data, error } = await admin.from('donations').insert({ donor_id: user.id, amount, payment_method: 'card', gateway: 'stripe', idempotency_key: idempotencyKey }).select().single();
      if (error) throw error;
      donation = data;
    } else if (donation.donor_id !== user.id) {
      throw new HttpError('Operação idempotente pertence a outra sessão.', 409);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'pt-BR',
      submit_type: 'donate',
      customer_email: user.email || undefined,
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
        userId: user.id,
        donationId: donation.id,
      },
      payment_intent_data: {
        metadata: {
          source: 'govrp-donation',
          amount: amount.toFixed(2),
          userId: user.id,
          donationId: donation.id,
        },
      },
    }, { idempotencyKey });

    if (!session.url) {
      throw new Error('A URL do checkout não foi retornada.');
    }

    const { error: updateError } = await admin.from('donations').update({ gateway_reference: session.id, payment_intent_id: session.payment_intent || null, checkout_url: session.url, status: 'processing' }).eq('id', donation.id);
    if (updateError) throw updateError;

    json(response, 200, {
      checkoutUrl: session.url,
      sessionId: session.id,
      donationCode: donation.donation_code,
    });
  } catch (error) {
    sendUnexpectedError(response, error);
  }
};

const raw_createPixChargeHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const { admin, user } = await authenticateRequest(request);
    const idempotencyKey = getIdempotencyKey(request);
    const body = await readRequestBody(request);
    const amount = normalizeAmount(body.amount);

    const { data: existingDonation } = await admin.from('donations').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existingDonation && existingDonation.donor_id !== user.id) throw new HttpError('Operação idempotente pertence a outra sessão.', 409);
    if (existingDonation && Number(existingDonation.amount) !== amount) throw new HttpError('A mesma chave idempotente não pode ser reutilizada com outro valor.', 409);
    if (existingDonation?.gateway_reference) {
      const charge = await callPixGateway({ endpoint: `/transparents/check?id=${encodeURIComponent(existingDonation.gateway_reference)}`, method: 'GET' });
      json(response, 200, { charge: normalizePixCharge(charge), donationCode: existingDonation.donation_code });
      return;
    }

    let donation = existingDonation;
    if (!donation) {
      const { data, error } = await admin.from('donations').insert({ donor_id: user.id, amount, payment_method: 'pix', gateway: 'abacatepay', idempotency_key: idempotencyKey }).select().single();
      if (error) throw error;
      donation = data;
    }

    const charge = await callPixGateway({
      endpoint: '/transparents/create',
      method: 'POST',
      payload: {
        method: 'PIX',
        data: {
          amount: toCents(amount),
          description: 'Doacao GOV.RP',
          expiresIn: PIX_EXPIRATION_SECONDS,
          externalId: donation.id,
          metadata: {
            source: 'govrp-donation',
            userId: user.id,
            userEmail: user.email || '',
            donationId: donation.id,
            amount: amount.toFixed(2),
          },
        },
      },
    });

    const normalizedCharge = normalizePixCharge(charge);
    const { error: updateError } = await admin.from('donations').update({ gateway_reference: normalizedCharge.id, status: 'processing', metadata: normalizedCharge }).eq('id', donation.id);
    if (updateError) throw updateError;

    json(response, 200, {
      charge: normalizedCharge,
      donationCode: donation.donation_code,
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

const raw_checkPixChargeHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'GET')) {
    return;
  }

  try {
    const { admin, user } = await authenticateRequest(request);
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

    const { data: donation, error: donationError } = await admin.from('donations').select('*').eq('gateway_reference', chargeId).eq('donor_id', user.id).maybeSingle();
    if (donationError || !donation) throw new HttpError('PIX não encontrado para esta conta.', 404);

    const status = await callPixGateway({
      endpoint: `/transparents/check?id=${encodeURIComponent(chargeId)}`,
      method: 'GET',
    });

    const mappedStatus = { PAID: 'paid', EXPIRED: 'expired', CANCELLED: 'cancelled', REFUNDED: 'refunded', PENDING: 'processing' }[status?.status] || 'processing';
    await admin.from('donations').update({ status: mappedStatus, paid_at: mappedStatus === 'paid' ? new Date().toISOString() : donation.paid_at, refunded_at: mappedStatus === 'refunded' ? new Date().toISOString() : donation.refunded_at, metadata: { ...donation.metadata, ...normalizePixCharge(status) } }).eq('id', donation.id);

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

const readRawRequestBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const raw_stripeWebhookHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) return;
  try {
    const stripe = getStripeClient();
    const admin = getSupabaseAdmin();
    const signature = request.headers['stripe-signature'];
    if (!signature) throw new HttpError('Assinatura Stripe ausente.', 400);
    const event = stripe.webhooks.constructEvent(await readRawRequestBody(request), signature, getRequiredServerEnv('STRIPE_WEBHOOK_SECRET'));
    const { data: previousEvent, error: previousEventError } = await admin
      .from('donation_webhook_events')
      .select('event_id')
      .eq('gateway', 'stripe')
      .eq('event_id', event.id)
      .maybeSingle();
    if (previousEventError) throw previousEventError;
    if (previousEvent) { json(response, 200, { received: true, duplicate: true }); return; }

    const object = event.data.object;
    let donationId = object.metadata?.donationId;
    if (!donationId && typeof object.payment_intent === 'string') {
      const { data: matchedDonation } = await admin
        .from('donations')
        .select('id')
        .eq('payment_intent_id', object.payment_intent)
        .maybeSingle();
      donationId = matchedDonation?.id;
    }
    if (donationId) {
      const { data: persistedDonation } = await admin
        .from('donations')
        .select('metadata')
        .eq('id', donationId)
        .maybeSingle();
      const changes = {
        metadata: {
          ...(persistedDonation?.metadata || {}),
          stripeEventId: event.id,
          stripeEventType: event.type,
        },
      };
      if (['checkout.session.completed', 'payment_intent.succeeded'].includes(event.type)) Object.assign(changes, { status: 'paid', paid_at: new Date(event.created * 1000).toISOString(), payment_intent_id: object.payment_intent || object.id });
      if (event.type === 'checkout.session.expired') changes.status = 'expired';
      if (event.type === 'payment_intent.payment_failed') changes.status = 'failed';
      if (event.type === 'charge.refunded') Object.assign(changes, { status: 'refunded', refunded_at: new Date(event.created * 1000).toISOString() });
      const { error: donationUpdateError } = await admin.from('donations').update(changes).eq('id', donationId);
      if (donationUpdateError) throw donationUpdateError;
    }
    const { error: eventError } = await admin.from('donation_webhook_events').insert({ gateway: 'stripe', event_id: event.id, event_type: event.type, payload: event.data.object });
    if (eventError && eventError.code !== '23505') throw eventError;
    json(response, 200, { received: true });
  } catch (error) {
    console.error('[donations:stripe-webhook]', error);
    json(response, error instanceof HttpError ? error.statusCode : 400, { error: 'Webhook inválido.' });
  }
};

export const createStripeCheckoutHandler=(request,response)=>withWorldRequest(request,()=>raw_createStripeCheckoutHandler(request,response));
export const createPixChargeHandler=(request,response)=>withWorldRequest(request,()=>raw_createPixChargeHandler(request,response));
export const checkPixChargeHandler=(request,response)=>withWorldRequest(request,()=>raw_checkPixChargeHandler(request,response));
export const stripeWebhookHandler=(request,response)=>withWorldRequest(request,()=>raw_stripeWebhookHandler(request,response));
