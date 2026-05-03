import { processWeeklyBusinessBalancesHandler } from '../../server/businesses/http.js';

export default async function handler(request, response) {
  return processWeeklyBusinessBalancesHandler(request, response);
}
