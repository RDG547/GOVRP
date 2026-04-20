import { registerBusinessHandler } from '../../server/businesses/http.js';

export default async function handler(request, response) {
  return registerBusinessHandler(request, response);
}
