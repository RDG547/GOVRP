import { citizenAvatarHandler } from '../../server/citizens/avatar.js';

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  return citizenAvatarHandler(request, response);
}
