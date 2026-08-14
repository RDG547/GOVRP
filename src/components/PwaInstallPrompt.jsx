import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

const DISMISS_KEY = 'govrp:pwa-install-dismissed-at';
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

const PwaInstallPrompt = () => {
  const [installEvent, setInstallEvent] = useState(null);

  useEffect(() => {
    if (Capacitor.isNativePlatform() || window.matchMedia('(display-mode: standalone)').matches) {
      return undefined;
    }

    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - dismissedAt < DISMISS_FOR_MS) return undefined;

    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const handleInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (!installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };
  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setInstallEvent(null);
  };

  return (
    <aside className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-cyan-400/20 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,.55)] backdrop-blur-xl">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-full p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white"
        aria-label="Fechar convite de instalação"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex gap-3 pr-7">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
          <Download className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-white">Instalar GOV.RP</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Abra como aplicativo e mantenha os recursos essenciais disponíveis mesmo com conexão instável.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={install}
        className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
      >
        Instalar aplicativo
      </button>
    </aside>
  );
};

export default PwaInstallPrompt;
