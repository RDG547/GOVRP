import React, { useEffect, useRef, useState } from 'react';
// eslint-disable-next-line import/no-unresolved
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export default function PwaUpdateNotice() {
  const registration = useRef(null);
  const updating = useRef(false);
  useEffect(() => { const activated = () => { if (updating.current) window.location.reload(); }; navigator.serviceWorker?.addEventListener('controllerchange', activated); return () => navigator.serviceWorker?.removeEventListener('controllerchange', activated); }, []);
  const { needRefresh: [ready], updateServiceWorker } = useRegisterSW({ onRegisteredSW: (_, value) => { registration.current = value; }, onRegisterError: failure => console.error('Falha ao registrar atualização do aplicativo', failure) });
  useEffect(() => { const check = () => { if (navigator.onLine && document.visibilityState === 'visible') void registration.current?.update().catch(failure => console.error('Falha ao verificar versão do aplicativo', failure)); }; const timer = window.setInterval(check, 60000); document.addEventListener('visibilitychange', check); return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = async () => { setBusy(true); setError(''); try { updating.current = true; await updateServiceWorker(true); } catch (failure) { updating.current = false; console.error('Falha na atualização do aplicativo', failure); setError('Não foi possível atualizar. Confira sua conexão e tente novamente.'); setBusy(false); } };
  return <Dialog open={ready} onOpenChange={() => {}}><DialogContent overlayClassName="z-[199]" hideClose className="max-w-md z-[200]" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>Atualização do GOVRP</DialogTitle><DialogDescription>Uma nova versão do GOVRP está disponível. Atualize para continuar.</DialogDescription></DialogHeader>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={busy} onClick={update}><RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Atualizando GOVRP…' : 'Atualizar GOVRP'}</Button></DialogContent></Dialog>;
}
