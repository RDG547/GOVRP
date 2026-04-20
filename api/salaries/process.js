import { processWeeklySalariesHandler } from '../../server/salaries/http.js';

export default async function handler(request, response) {
  return processWeeklySalariesHandler(request, response);
}
