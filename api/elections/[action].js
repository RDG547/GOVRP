import {
  cancelCandidacyHandler,
  resignPresidencyHandler,
  respondViceCandidacyInvitationHandler,
  submitPresidentialCandidacyHandler,
  syncElectionOfficesHandler,
} from '../../server/elections/http.js';

const handlers = new Map([
  ['cancel-candidacy', cancelCandidacyHandler],
  ['resign-presidency', resignPresidencyHandler],
  ['respond-vice-invitation', respondViceCandidacyInvitationHandler],
  ['submit-candidacy', submitPresidentialCandidacyHandler],
  ['sync-offices', syncElectionOfficesHandler],
]);

const resolveAction = (request) => {
  const queryAction = Array.isArray(request.query?.action)
    ? request.query.action[0]
    : request.query?.action;
  if (queryAction) return queryAction;

  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  return pathname.split('/').filter(Boolean).at(-1) || '';
};

export default async function handler(request, response) {
  const action = resolveAction(request);
  const actionHandler = handlers.get(action);

  if (!actionHandler) {
    response.status(404).json({ error: 'Rota eleitoral não encontrada.' });
    return;
  }

  return actionHandler(request, response);
}
