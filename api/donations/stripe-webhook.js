import { stripeWebhookHandler } from '../../server/donations/http.js';

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  return stripeWebhookHandler(request, response);
}
