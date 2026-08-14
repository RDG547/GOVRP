import { Capacitor } from '@capacitor/core';

export const NATIVE_URL_SCHEME = 'br.com.govrp.app';

export const getAppRedirectUrl = (pathname) => {
  const normalizedPath = `/${String(pathname || '').replace(/^\/+/, '')}`;

  if (Capacitor.isNativePlatform()) {
    return `${NATIVE_URL_SCHEME}://${normalizedPath.slice(1)}`;
  }

  return `${window.location.origin}${normalizedPath}`;
};

export const getRouteFromNativeUrl = (rawUrl) => {
  try {
    const url = new URL(rawUrl);
    const route = `/${[url.host, url.pathname].join('/').replace(/\/{2,}/g, '/').replace(/^\/+/, '')}`;
    return route.length > 1 ? route.replace(/\/$/, '') : route;
  } catch {
    return null;
  }
};
