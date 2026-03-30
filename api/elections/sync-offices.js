import { syncElectionOfficesHandler } from '../../server/elections/http.js';

export default async function handler(request, response) {
  return syncElectionOfficesHandler(request, response);
}
