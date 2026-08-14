import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { getRouteFromNativeUrl } from '@/lib/nativeLinks';
import { supabase } from '@/lib/supabaseClient';

const openInternalRoute = (pathname) => {
  window.history.pushState(window.history.state, '', pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const restoreRecoverySession = async (rawUrl) => {
  const url = new URL(rawUrl);
  const code = url.searchParams.get('code');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
  }
};

const NativeRuntime = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;

    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#020713' }).catch(() => {});
    SplashScreen.hide().catch(() => {});

    let appStateListener;
    let appUrlListener;
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) window.dispatchEvent(new Event('govrp:resume'));
    }).then((listener) => {
      appStateListener = listener;
    });

    App.addListener('appUrlOpen', async ({ url }) => {
      const route = getRouteFromNativeUrl(url);

      if (route !== '/update-password') return;

      try {
        await restoreRecoverySession(url);
        await Browser.close().catch(() => {});
        openInternalRoute('/update-password');
      } catch {
        openInternalRoute('/forgot-password');
      }
    }).then((listener) => {
      appUrlListener = listener;
    });

    return () => {
      appStateListener?.remove();
      appUrlListener?.remove();
    };
  }, []);

  return null;
};

export default NativeRuntime;
