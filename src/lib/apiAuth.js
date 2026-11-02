import {isAdminPreview,ADMIN_PREVIEW_MESSAGE} from './adminPreview';
import { supabase } from './supabaseClient';

const refreshes = new WeakMap();
const refresh = async (client) => {
  if (!refreshes.has(client)) {
    refreshes.set(client, client.auth.refreshSession().finally(() => refreshes.delete(client)));
  }
  const { data, error } = await refreshes.get(client);
  if (error || !data?.session?.access_token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  return data.session;
};

export async function readySession(client = supabase) {
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session?.access_token) throw new Error('Sua sessão expirou. Entre novamente para continuar.');
  if (data.session.expires_at * 1000 <= Date.now() + 45000) return refresh(client);
  return data.session;
}

// Retry only a rejected authentication, never a denied permission or a mutation error.
// The server checks the current database role on every request.
export async function fetchWithSessionAuth(url, options = {}, client = supabase, transport = fetch) {
  if(isAdminPreview()&&!['GET','HEAD','OPTIONS'].includes((options.method||'GET').toUpperCase()))throw new Error(ADMIN_PREVIEW_MESSAGE);
  let session = await readySession(client);
  const send = token => {
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return transport(url, { ...options, headers });
  };
  let response = await send(session.access_token);
  if (response.status === 401) {
    const current = await readySession(client);
    session = current.access_token !== session.access_token ? current : await refresh(client);
    response = await send(session.access_token);
  }
  return response;
}

export const getSessionAccessToken = async () => (await readySession()).access_token;
