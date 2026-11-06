import { evidenceHandler } from '../../server/justice/evidence.js';
import { citizenAvatarHandler } from '../../server/citizens/avatar.js';

export const config = { api: { bodyParser: false } };

export default async function handler(request, response) {
  if (new URL(request.url, 'http://localhost').searchParams.get('kind') === 'evidence') return evidenceHandler(request, response);
  return citizenAvatarHandler(request, response);
}
