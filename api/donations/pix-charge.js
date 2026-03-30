import { createPixChargeHandler } from '../../server/donations/http.js';

export default async function handler(request, response) {
  return createPixChargeHandler(request, response);
}
