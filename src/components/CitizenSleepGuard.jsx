import CitizenSleepPanel from './CitizenSleepPanel';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext, useLocation } from 'react-router-dom';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function CitizenSleepGuard() {
  const location = useLocation();
  const historyIndex = useRef(window.history.state?.idx ?? 0);
  useEffect(() => { historyIndex.current = window.history.state?.idx ?? historyIndex.current; }, [location]);
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const { sleeping, act } = useCitizenNeeds();
  const active = useRef(sleeping); active.current = sleeping;
  const pending = useRef(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const methods = {};
    for (const name of ['push', 'replace', 'go']) {
      methods[name] = navigator[name];
      navigator[name] = (...args) => {
        if (!active.current) return methods[name].apply(navigator, args);
        pending.current = () => methods[name].apply(navigator, args);
        setOpen(true);
      };
    }
    // Native back/forward uses the browser's history instead of navigator.go.
    let restoring = false;
    const pop = event => {
      if (restoring) { event.stopImmediatePropagation(); restoring = false; return; }
      if (!active.current) return;
      const targetIndex = event.state?.idx;
      if (!Number.isFinite(targetIndex)) return;
      const delta = targetIndex - historyIndex.current;
      if (!delta) return;
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(-delta);
      pending.current = () => methods.go.call(navigator, delta);
      setOpen(true);
    };
    const unload = event => { if (active.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('popstate', pop, true);
    window.addEventListener('beforeunload', unload);
    return () => { for (const name of Object.keys(methods)) navigator[name] = methods[name]; window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload); };
  }, [navigator]);
  const stay = () => { pending.current = null; setOpen(false); setError(''); };
  const wake = async () => { if (busy) return; setBusy(true); try { await act('wake', null, crypto.randomUUID()); active.current = false; const next = pending.current; stay(); next?.(); } catch { setError('Não foi possível acordar. Tente novamente.'); } finally { setBusy(false); } };
  return <><CitizenSleepPanel immersive/><Dialog open={open} onOpenChange={value => { if (!value && !busy) stay(); }}><DialogContent onInteractOutside={event => event.preventDefault()}><DialogHeader><DialogTitle>Seu cidadão está dormindo</DialogTitle><DialogDescription>Para continuar para outra área, acorde. O descanso recuperado até agora será preservado.</DialogDescription></DialogHeader>{error && <p role="alert">{error}</p>}<div className="flex flex-col gap-2 sm:flex-row"><Button variant="outline" disabled={busy} onClick={stay}>Continuar dormindo</Button><Button disabled={busy} onClick={wake}>{busy ? 'Acordando…' : 'Acordar e continuar'}</Button></div></DialogContent></Dialog></>;
}
