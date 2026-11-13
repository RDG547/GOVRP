import { adminUpdateUserHandler } from '../../server/admin/http.js';
import { adminBanHandler } from '../../server/security/access.js';

export default async function handler(request, response) {
  if (request.query?.security === 'ban') return adminBanHandler(request, response);
  return adminUpdateUserHandler(request, response);
}
