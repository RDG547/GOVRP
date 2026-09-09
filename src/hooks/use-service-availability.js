import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchServiceAvailabilitySettings } from '@/lib/serviceCatalog';
import { useDomainRealtime } from './use-domain-realtime';

export function useServiceAvailability() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try { setSettings(await fetchServiceAvailabilitySettings(supabase)); }
    catch (error) { console.warn('Disponibilidade dos serviços:', error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useDomainRealtime('service-availability', 'public', [{ table: 'system_settings', filter: 'key=eq.service_availability' }], refresh);
  return { settings, loading };
}
