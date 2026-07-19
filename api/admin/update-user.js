import { adminUpdateUserHandler } from '../../server/admin/http.js';

export default async function handler(request, response) {
  return adminUpdateUserHandler(request, response);
}
