import {getWorldRuntime} from '@/lib/worldRuntime';
import { sleepProgress } from '@/lib/citizenSleep';
import CitizenSleepGuard from '@/components/CitizenSleepGuard';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';

const CitizenNeedsContext = createContext(null);
const mergeNeeds = (current, next) => current?.updated_at && next?.updated_at && Date.parse(next.updated_at) < Date.parse(current.updated_at) ? current : { ...current, ...next };
export const useCitizenNeeds = () => useContext(CitizenNeedsContext);
export function CitizenNeedsProvider({ children }) {
  const { user } = useAuth();
  const [needs, setNeeds] = useState(null);
  const [error, setError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now());
  const clockOffset = useRef(0);
  useEffect(() => { if (!needs?.sleep_started_at) return; const timer = setInterval(() => setClockNow(Date.now()), 1000); return () => clearInterval(timer); }, [needs?.sleep_started_at]);
  const busy = useRef(false);
  const activeId = useRef(user?.id); activeId.current = user?.id;
  const refresh = useCallback(async () => {
    if (!user?.onboarding_completed || getWorldRuntime()?.maintenance || busy.current) return;
    busy.current = true;
    try {
      const result = await supabase.rpc('get_citizen_needs');
      if (activeId.current !== user.id) return;
      if (result.error) throw result.error;
      if (result.data?.server_now) clockOffset.current = Date.parse(result.data.server_now) - Date.now();
      setClockNow(Date.now()); setNeeds(current => mergeNeeds(current, result.data)); setError('');
    } catch (failure) { console.warn('Estado do cidadão:', failure.message); setError('Não foi possível consultar suas necessidades.'); }
    finally { busy.current = false; }
  }, [user?.id, user?.onboarding_completed]);
  useEffect(() => {
    setNeeds(null); void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 60000);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [refresh]);
  useDomainRealtime('citizen-needs', user?.id, [{ table: 'citizen_needs', filter: `user_id=eq.${user?.id}` }], changes => {
    for (const change of changes) if (change.new?.user_id === user?.id) setNeeds(current => mergeNeeds(current, change.new));
  }, Boolean(user?.onboarding_completed));
  const act = useCallback(async (action, referenceId, key) => {
    if(getWorldRuntime()?.maintenance)throw new Error('O universo está em manutenção. Aguarde a reabertura.');
    const { data, error: failure } = await supabase.rpc('citizen_need_action', { p_action: action, p_reference_id: referenceId, p_idempotency_key: key });
    if (failure) throw failure;
    if (data?.server_now) clockOffset.current = Date.parse(data.server_now) - Date.now();
    setClockNow(Date.now()); setNeeds(current => mergeNeeds(current, data));
    return data;
  }, []);
  const progress = sleepProgress(needs, clockNow + clockOffset.current);
  useEffect(() => { if (needs?.sleep_started_at && !progress.sleeping) void refresh(); }, [needs?.sleep_started_at, progress.sleeping, refresh]);
  const displayNeeds = needs?.sleep_started_at ? { ...needs, sleep: progress.value } : needs;
  return <CitizenNeedsContext.Provider value={{ needs: displayNeeds, sleeping: progress.sleeping, remainingSleep: progress.remaining, error, refresh, act }}><CitizenSleepGuard />{children}</CitizenNeedsContext.Provider>;
}
