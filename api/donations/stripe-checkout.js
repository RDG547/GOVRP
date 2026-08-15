import {
  createStripeCheckoutHandler,
  stripeWebhookHandler,
} from '../../server/donations/http.js';

// Desabilitar o parser preserva o corpo bruto exigido pela validação da
// assinatura do webhook. O checkout já faz seu próprio parse de JSON.
export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (request.headers['stripe-signature']) {
    return stripeWebhookHandler(request, response);
  }

  return createStripeCheckoutHandler(request, response);
}
