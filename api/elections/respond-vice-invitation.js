import { respondViceCandidacyInvitationHandler } from '../../server/elections/http.js';

export default async function handler(request, response) {
  return respondViceCandidacyInvitationHandler(request, response);
}
