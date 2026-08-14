import React, { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

export const COOKIE_CONSENT_EVENT = 'govrp:cookie-consent';

const analyticsAllowed = () => {
  try {
    return window.localStorage.getItem('cookie_consent') === 'all';
  } catch {
    return false;
  }
};

const ConsentAwareAnalytics = () => {
  const [allowed, setAllowed] = useState(analyticsAllowed);

  useEffect(() => {
    const refresh = () => setAllowed(analyticsAllowed());
    window.addEventListener(COOKIE_CONSENT_EVENT, refresh);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, refresh);
  }, []);

  return allowed ? <Analytics /> : null;
};

export default ConsentAwareAnalytics;
