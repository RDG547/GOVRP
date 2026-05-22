import { cancelCandidacyHandler } from '../../server/elections/http.js';

export default async function handler(request, response) {
  return cancelCandidacyHandler(request, response);
}
