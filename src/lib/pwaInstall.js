import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';

let deferredPrompt = null;
let installed = typeof window !== 'undefined' && (Capacitor.isNativePlatform() || navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches);
let revision = 0;
const listeners = new Set();
const notify = () => { revision++; listeners.forEach(listener => listener()); };
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; notify(); });
  window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = null; notify(); });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', event => { installed = Capacitor.isNativePlatform() || event.matches || navigator.standalone === true; notify(); });
}
export function usePwaInstall() {
  useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => revision, () => 0);
  return { installed, available: Boolean(deferredPrompt) };
}
export function requestPwaInstall() { window.dispatchEvent(new Event('govrp:install-app')); }
export async function installPwa() {
  const prompt = deferredPrompt;
  if (!prompt) return false;
  deferredPrompt = null; notify();
  await prompt.prompt();
  const result = await prompt.userChoice;
  return result.outcome === 'accepted';
}
