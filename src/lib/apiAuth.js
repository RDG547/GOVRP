import { supabase } from './supabaseClient';

export const getSessionAccessToken = async () => {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!session?.access_token) {
    throw new Error('Sessão autenticada não encontrada.');
  }

  return session.access_token;
};

export const fetchWithSessionAuth = async (input, init = {}) => {
  const accessToken = await getSessionAccessToken();
  const headers = new Headers(init.headers || {});

  headers.set('Authorization', `Bearer ${accessToken}`);

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, {
    ...init,
    headers,
  });
};
