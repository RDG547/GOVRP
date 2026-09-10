import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
export function useOfficialSalaries() {
  const [roles, setRoles] = useState([]), [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await supabase.from('system_settings').select('value').eq('key', 'official_salaries').single();
    if (result.error) setError('Não foi possível consultar a remuneração oficial.');
    else { setRoles(result.data.value.roles || []); setError(''); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useDomainRealtime('official-salaries', 'public', [{ table: 'system_settings', filter: 'key=eq.official_salaries' }], load);
  return { roles, error, refresh: load };
}
export const currentSalary = (role, now = Date.now()) => Date.parse(role.valid_from) > now ? Number(role.previous_amount) : Number(role.amount);
