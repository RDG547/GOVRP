import React, { useEffect, useRef } from 'react';

const HCAPTCHA_SCRIPT_ID = 'govrp-hcaptcha-script';
let scriptPromise;

const loadHCaptcha = () => {
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(HCAPTCHA_SCRIPT_ID);
    const script = existing || document.createElement('script');

    const handleReady = () => {
      if (window.hcaptcha) resolve(window.hcaptcha);
      else reject(new Error('O hCaptcha não ficou disponível.'));
    };

    script.addEventListener('load', handleReady, { once: true });
    script.addEventListener('error', () => reject(new Error('Falha ao carregar o hCaptcha.')), { once: true });

    if (!existing) {
      script.id = HCAPTCHA_SCRIPT_ID;
      script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
};

const HCaptchaChallenge = ({ onVerify, resetKey = 0 }) => {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const siteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY?.trim();

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;
    let mounted = true;

    loadHCaptcha()
      .then((hcaptcha) => {
        if (!mounted || !containerRef.current) return;
        widgetRef.current = hcaptcha.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          size: 'normal',
          callback: (token) => onVerify(token),
          'expired-callback': () => onVerify(''),
          'error-callback': () => onVerify(''),
        });
      })
      .catch(() => onVerify(''));

    return () => {
      mounted = false;
      if (window.hcaptcha && widgetRef.current !== null) {
        try { window.hcaptcha.remove(widgetRef.current); } catch { /* widget já removido */ }
      }
      widgetRef.current = null;
    };
  }, [siteKey, onVerify]);

  useEffect(() => {
    if (window.hcaptcha && widgetRef.current !== null) {
      window.hcaptcha.reset(widgetRef.current);
      onVerify('');
    }
  }, [resetKey, onVerify]);

  if (!siteKey) {
    return null;
  }

  return <div ref={containerRef} className="min-h-[78px] overflow-x-auto" aria-label="Verificação antirrobô" />;
};

export default HCaptchaChallenge;
