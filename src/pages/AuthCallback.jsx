import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabaseClient';
import { AUTH_POPUP_MESSAGE_SOURCE } from '@/lib/oauthPopup';

const getAttemptId = () => {
  const url = new URL(window.location.href);
  return url.searchParams.get('attemptId');
};

const getPopupResultStorageKey = (attemptId) =>
  attemptId ? `govrp-auth-popup-result:${attemptId}` : null;

const sleep = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForAuthSession = async () => {
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

    await sleep(200);
  }

  return null;
};

const getUrlError = () => {
  const url = new URL(window.location.href);
  return url.searchParams.get('error_description') || url.searchParams.get('error');
};

const getHashParams = () => {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  return new URLSearchParams(rawHash);
};

const replaceCallbackUrl = () => {
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('code');
  cleanUrl.searchParams.delete('error');
  cleanUrl.searchParams.delete('error_code');
  cleanUrl.searchParams.delete('error_description');
  cleanUrl.hash = '';
  window.history.replaceState(window.history.state, '', cleanUrl.toString());
};

const postToOpener = (payload) => {
  const attemptId = getAttemptId();

  if (!window.opener || window.opener.closed) {
    return;
  }

  window.opener.postMessage(
    {
      source: AUTH_POPUP_MESSAGE_SOURCE,
      attemptId,
      ...payload,
    },
    window.location.origin
  );
};

const persistPopupResult = (payload) => {
  const attemptId = getAttemptId();
  const storageKey = getPopupResultStorageKey(attemptId);

  if (!storageKey) {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        attemptId,
        ...payload,
      })
    );
  } catch {
    // Ignore storage failures and keep the postMessage fallback.
  }
};

const AuthCallback = () => {
  const [status, setStatus] = useState({
    state: 'loading',
    title: 'Concluindo autenticacao',
    description: 'Estamos confirmando sua sessao com o GOV.RP.',
  });

  useEffect(() => {
    let isMounted = true;

    const closePopupWindow = () => {
      window.close();

      // Browsers that refuse automatic closing will simply keep the fallback UI visible.
      window.setTimeout(() => {
        if (!window.closed) {
          window.close();
        }
      }, 300);
    };

    const resolveCallback = async () => {
      try {
        const urlError = getUrlError();

        if (urlError) {
          throw new Error(urlError);
        }

        const hashParams = getHashParams();
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        let session = null;

        if (accessToken && refreshToken) {
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (error) {
            throw error;
          }

          session = data.session;
          replaceCallbackUrl();
        } else {
          session = await waitForAuthSession();
        }

        if (!session) {
          throw new Error('Nao foi possivel confirmar sua sessao. Tente novamente.');
        }

        if (!isMounted) {
          return;
        }

        setStatus({
          state: 'success',
          title: 'Autenticacao concluida',
          description: 'Voce ja pode voltar para o GOV.RP.',
        });

        const payload = { type: 'success' };
        persistPopupResult(payload);
        postToOpener(payload);
        window.setTimeout(closePopupWindow, 180);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : 'Nao foi possivel concluir a autenticacao social.';

        setStatus({
          state: 'error',
          title: 'Falha na autenticacao',
          description: message,
        });

        const payload = { type: 'error', error: message };
        persistPopupResult(payload);
        postToOpener(payload);
        window.setTimeout(closePopupWindow, 900);
      }
    };

    resolveCallback();

    return () => {
      isMounted = false;
    };
  }, []);

  const isLoading = status.state === 'loading';
  const isSuccess = status.state === 'success';
  const Icon = isLoading ? Loader2 : isSuccess ? ShieldCheck : AlertTriangle;
  const iconClassName = isLoading
    ? 'text-blue-400 animate-spin'
    : isSuccess
      ? 'text-emerald-400'
      : 'text-red-400';

  return (
    <>
      <Helmet>
        <title>Autenticacao - GOV.RP</title>
        <meta
          name="robots"
          content="noindex,nofollow"
        />
      </Helmet>

      <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-slate-950">
        <Card className="w-full max-w-md glass-effect border-white/10">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/5">
              <Icon className={`h-7 w-7 ${iconClassName}`} />
            </div>
            <CardTitle>{status.title}</CardTitle>
            <CardDescription>{status.description}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            Esta janela pode ser fechada automaticamente quando a autenticacao terminar.
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default AuthCallback;
