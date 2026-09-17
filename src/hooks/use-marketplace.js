import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
export function useMarketplace() {
  const { user } = useAuth();
  const [enterprise, setEnterprise] = useState(null), [canManage, setCanManage] = useState(false);
  const refresh = useCallback(async () => {
    const [state, access] = await Promise.all([supabase.from('state_enterprises').select('*').eq('service_key','marketplace').maybeSingle(),user?.id ? supabase.rpc('can_manage_marketplace') : Promise.resolve({data:false})]);
    if (!state.error) setEnterprise(state.data); setCanManage(!access.error && Boolean(access.data));
  }, [user?.id]);
  useEffect(() => { refresh(); }, [refresh, user?.role]);
  useDomainRealtime('marketplace', user?.id || 'public', ['state_enterprises','businesses'], refresh);
  return { enterprise, canManage, refresh };
}
