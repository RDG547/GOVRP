import { createStripeCheckoutHandler } from '../../server/donations/http.js';

export default async function handler(request, response) {
  return createStripeCheckoutHandler(request, response);
}
