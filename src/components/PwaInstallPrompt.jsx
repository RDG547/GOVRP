import React, { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { installPwa, requestPwaInstall, usePwaInstall } from '@/lib/pwaInstall';

const DISMISS_KEY = 'govrp:pwa-install-dismissed-at';
export function PwaInstallAction({ onClick }) {
  const { installed } = usePwaInstall();
  if (installed) return null;
  return <button type="button" className="flex w-full items-center gap-3 rounded-md p-2 text-sm text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { onClick?.(); requestPwaInstall(); }}><Download className="w-5 h-5 shrink-0 text-cyan-400" />Instalar GOVRP</button>;
}
export default function PwaInstallPrompt() {
  const { installed, available } = usePwaInstall();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => { try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 7 * 86400000; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const show = () => setOpen(true); window.addEventListener('govrp:install-app', show); return () => window.removeEventListener('govrp:install-app', show); }, []);
  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* Storage is optional. */ } };
  const install = async () => { setBusy(true); setError(''); try { if (await installPwa()) { setOpen(false); dismiss(); } } catch { setError('Não foi possível iniciar a instalação. Use o menu do seu navegador.'); } finally { setBusy(false); } };
  if (installed) return null;
  return <>
    {available && !dismissed && !open && <aside aria-label="Instalar GOVRP" className="fixed bottom-4 right-4 z-[100] w-[min(360px,calc(100vw-2rem))] rounded-2xl border bg-background p-4 shadow-xl"><button type="button" className="absolute right-2 top-2 p-2 rounded focus-visible:ring-2" aria-label="Fechar convite de instalação" onClick={dismiss}><X className="h-4 w-4" /></button><p className="pr-8 font-semibold">GOVRP no seu dispositivo</p><Button className="mt-3 w-full" onClick={() => setOpen(true)}><Download className="w-4 h-4 mr-2" />Instalar GOVRP</Button></aside>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Instalar GOVRP</DialogTitle><DialogDescription>Acesse o GOVRP pela tela inicial do seu dispositivo.</DialogDescription></DialogHeader>{available ? <Button disabled={busy} onClick={install}><Download className="mr-2 w-4 h-4" />{busy ? 'Abrindo instalação…' : 'Instalar aplicativo'}</Button> : <div className="space-y-3 text-sm"><p>No iPhone ou iPad, abra o GOVRP no Safari, toque em <Share className="inline h-4 w-4" aria-label="Compartilhar" /> Compartilhar e escolha <strong>Adicionar à Tela de Início</strong>.</p><p>Em outros dispositivos, abra o menu do navegador e procure <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>. A opção depende do suporte do navegador.</p></div>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</DialogContent></Dialog>
  </>;
}
