import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';

const CitizenNeedsContext = createContext(null);
export const useCitizenNeeds = () => useContext(CitizenNeedsContext);
export function CitizenNeedsProvider({ children }) {
  const { user } = useAuth();
  const [needs, setNeeds] = useState(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const activeId = useRef(user?.id); activeId.current = user?.id;
  const refresh = useCallback(async () => {
    if (!user?.onboarding_completed || busy.current) return;
    busy.current = true;
    try {
      const result = await supabase.rpc('get_citizen_needs');
      if (activeId.current !== user.id) return;
      if (result.error) throw result.error;
      setNeeds(result.data); setError('');
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
    for (const change of changes) if (change.new?.user_id === user?.id) setNeeds(current => ({ ...current, ...change.new }));
  }, Boolean(user?.onboarding_completed));
  const act = useCallback(async (action, referenceId, key) => {
    const { data, error: failure } = await supabase.rpc('citizen_need_action', { p_action: action, p_reference_id: referenceId, p_idempotency_key: key });
    if (failure) throw failure;
    setNeeds(current => ({ ...current, ...data }));
    return data;
  }, []);
  return <CitizenNeedsContext.Provider value={{ needs, error, refresh, act }}>{children}</CitizenNeedsContext.Provider>;
}
