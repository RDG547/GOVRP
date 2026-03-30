import { checkPixChargeHandler } from '../../server/donations/http.js';

export default async function handler(request, response) {
  return checkPixChargeHandler(request, response);
}
