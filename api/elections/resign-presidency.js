import { resignPresidencyHandler } from '../../server/elections/http.js';

export default async function handler(request, response) {
  return resignPresidencyHandler(request, response);
}
