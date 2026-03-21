import { createClient } from '@supabase/supabase-js';
import { supabase, supabasePublishableKey, supabaseUrl } from '@/lib/supabaseClient';

export const AUTH_POPUP_MESSAGE_SOURCE = 'govrp-auth-popup';
export const AUTH_POPUP_CLOSED_CODE = 'AUTH_POPUP_CLOSED';
export const AUTH_POPUP_TIMEOUT_CODE = 'AUTH_POPUP_TIMEOUT';

const AUTH_POPUP_BASE_NAME = 'govrp-auth-popup-window';
const AUTH_POPUP_RESULT_KEY_PREFIX = 'govrp-auth-popup-result:';
const AUTH_POPUP_WIDTH = 560;
const AUTH_POPUP_HEIGHT = 720;
const AUTH_POPUP_TIMEOUT_MS = 3 * 60 * 1000;
const POPUP_CLOSE_GRACE_PERIOD_MS = 900;

const supportsPkceOAuth = () =>
  typeof window !== 'undefined' &&
  typeof window.crypto?.subtle?.digest === 'function';

const getOAuthClient = (provider) => {
  if (supportsPkceOAuth()) {
    return {
      client: supabase,
      provider,
      flowType: 'pkce',
    };
  }

  return {
    client: createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false,
        flowType: 'implicit',
      },
    }),
    flowType: 'implicit',
  };
};

const sleep = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const buildPopupAttemptId = () => {
  if (typeof window !== 'undefined' && typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }

  return `popup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const getPopupResultStorageKey = (attemptId) =>
  `${AUTH_POPUP_RESULT_KEY_PREFIX}${attemptId}`;

const createPopupError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

export const isAuthPopupClosedError = (error) =>
  error instanceof Error && error.code === AUTH_POPUP_CLOSED_CODE;

const readStoredPopupResult = (attemptId) => {
  try {
    const rawValue = window.localStorage.getItem(getPopupResultStorageKey(attemptId));

    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue);
  } catch {
    return null;
  }
};

const clearStoredPopupResult = (attemptId) => {
  try {
    window.localStorage.removeItem(getPopupResultStorageKey(attemptId));
  } catch {
    // Ignore storage cleanup failures.
  }
};

const buildPopupFeatures = () => {
  const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
  const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
  const viewportWidth =
    window.innerWidth ?? document.documentElement.clientWidth ?? screen.width;
  const viewportHeight =
    window.innerHeight ?? document.documentElement.clientHeight ?? screen.height;
  const left = Math.max(0, dualScreenLeft + (viewportWidth - AUTH_POPUP_WIDTH) / 2);
  const top = Math.max(0, dualScreenTop + (viewportHeight - AUTH_POPUP_HEIGHT) / 2);

  return [
    `width=${AUTH_POPUP_WIDTH}`,
    `height=${AUTH_POPUP_HEIGHT}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'popup=yes',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
};

const renderPopupShell = (popupWindow, provider) => {
  try {
    popupWindow.document.write(`
      <!doctype html>
      <html lang="pt-BR">
        <head>
          <meta charset="utf-8" />
          <title>Conectando ao ${provider}</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #020817;
              color: #e2e8f0;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }

            .card {
              width: min(100%, 320px);
              padding: 24px;
              border-radius: 20px;
              border: 1px solid rgba(148, 163, 184, 0.18);
              background: rgba(15, 23, 42, 0.82);
              text-align: center;
              box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
            }

            .spinner {
              width: 42px;
              height: 42px;
              margin: 0 auto 16px;
              border-radius: 9999px;
              border: 3px solid rgba(96, 165, 250, 0.25);
              border-top-color: #60a5fa;
              animation: spin 0.9s linear infinite;
            }

            h1 {
              margin: 0 0 8px;
              font-size: 1.1rem;
            }

            p {
              margin: 0;
              color: #94a3b8;
              line-height: 1.5;
            }

            @keyframes spin {
              to {
                transform: rotate(360deg);
              }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="spinner" aria-hidden="true"></div>
            <h1>Conectando ao ${provider}</h1>
            <p>Voce sera redirecionado para concluir a autenticacao com seguranca.</p>
          </div>
        </body>
      </html>
    `);
    popupWindow.document.close();
  } catch {
    // Ignore rendering issues and continue with the OAuth redirect.
  }
};

const openPopup = (provider) => {
  const popupWindow = window.open(
    '',
    `${AUTH_POPUP_BASE_NAME}-${provider}`,
    buildPopupFeatures()
  );

  if (!popupWindow) {
    return null;
  }

  renderPopupShell(popupWindow, provider);
  popupWindow.focus();
  return popupWindow;
};

const waitForPopupMessage = (popupWindow, attemptId) =>
  new Promise((resolve, reject) => {
    let pollTimer;
    let timeoutId;
    let popupClosedAt = null;
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutId);
    };

    const settle = (payload) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      clearStoredPopupResult(attemptId);

      if (!popupWindow.closed) {
        popupWindow.close();
      }

      if (payload.type === 'success') {
        resolve(payload);
        return;
      }

      if (payload.type === 'closed') {
        reject(
          createPopupError(
            payload.error || 'A janela de autenticacao foi fechada antes da conclusao.',
            AUTH_POPUP_CLOSED_CODE
          )
        );
        return;
      }

      reject(
        createPopupError(
          payload.error || 'Nao foi possivel concluir a autenticacao social.',
          payload.code
        )
      );
    };

    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const payload = event.data;

      if (
        !payload ||
        payload.source !== AUTH_POPUP_MESSAGE_SOURCE ||
        payload.attemptId !== attemptId
      ) {
        return;
      }

      settle(payload);
    };

    const handleStorage = (event) => {
      if (
        event.key !== getPopupResultStorageKey(attemptId) ||
        !event.newValue
      ) {
        return;
      }

      try {
        settle(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed storage payloads.
      }
    };

    pollTimer = window.setInterval(() => {
      if (popupWindow.closed) {
        const storedResult = readStoredPopupResult(attemptId);

        if (storedResult) {
          settle(storedResult);
          return;
        }

        if (!popupClosedAt) {
          popupClosedAt = Date.now();
          return;
        }

        if (Date.now() - popupClosedAt >= POPUP_CLOSE_GRACE_PERIOD_MS) {
          settle({
            type: 'closed',
            error: 'A janela de autenticacao foi fechada antes da conclusao.',
          });
        }
      }
    }, 400);

    timeoutId = window.setTimeout(() => {
      settle({
        type: 'error',
        code: AUTH_POPUP_TIMEOUT_CODE,
        error: 'A autenticacao demorou mais do que o esperado. Tente novamente.',
      });
    }, AUTH_POPUP_TIMEOUT_MS);

    const storedResult = readStoredPopupResult(attemptId);

    if (storedResult) {
      settle(storedResult);
      return;
    }

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);
  });

const waitForSessionSync = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (session) {
      return session;
    }

    await sleep(250);
  }

  return null;
};

export const signInWithOAuthPopup = async (provider) => {
  const attemptId = buildPopupAttemptId();
  const popupWindow = openPopup(provider);
  const { client, flowType } = getOAuthClient(provider);

  if (!popupWindow) {
    throw new Error('Nao foi possivel abrir a janela de autenticacao. Verifique o bloqueador de pop-up.');
  }

  clearStoredPopupResult(attemptId);

  const { data, error } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback?popup=1&attemptId=${encodeURIComponent(attemptId)}&provider=${encodeURIComponent(provider)}`,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    popupWindow.close();
    throw error;
  }

  if (!data?.url) {
    popupWindow.close();
    throw new Error('Nao foi possivel iniciar a autenticacao social.');
  }

  popupWindow.location.replace(data.url);
  await waitForPopupMessage(popupWindow, attemptId);

  const session = await waitForSessionSync();

  if (!session) {
    throw new Error(
      flowType === 'implicit'
        ? 'A autenticacao foi concluida, mas a sessao nao sincronizou a tempo no modo alternativo.'
        : 'A autenticacao foi concluida, mas a sessao nao sincronizou a tempo.'
    );
  }

  return session;
};
