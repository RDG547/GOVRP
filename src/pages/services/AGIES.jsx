import React, { useCallback, useEffect, useState } from 'react';
import AGIESRestricted from '@/components/AGIESRestricted';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import AGIESPanel from './AGIESPanel';
export default function AGIES() {
 const {user}=useAuth();const [access,setAccess]=useState(null);
 const load=useCallback(async()=>{if(!user?.id){setAccess(false);return;}const r=await supabase.rpc('has_agies_access');setAccess(!r.error&&r.data===true);},[user?.id,user?.admin_development_mode,user?.role]);
 useEffect(()=>{setAccess(null);void load();},[load]);
 useDomainRealtime('agies-access',user?.id,[{table:'profiles',filter:`id=eq.${user?.id}`},'agies_clearances'],load,Boolean(user?.id));
 if(access===null)return <p role="status" className="p-8 text-center">Verificando credencial institucional…</p>;
 return access?<AGIESPanel/>:<AGIESRestricted/>;
}
