import { submitPresidentialCandidacyHandler } from '../../server/elections/http.js';

export default async function handler(request, response) {
  return submitPresidentialCandidacyHandler(request, response);
}
