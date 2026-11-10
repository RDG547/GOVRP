import React, {useCallback, useEffect, useState} from 'react';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {Button} from '@/components/ui/button';

// Frontend can be deployed before the transactional backend migrations.
// Mount feature subscriptions only after the final migration marks them ready.
export default function IntegratedUpdateGate({children}) {
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 const refresh=useCallback(async()=>{
  const {data,error:failure}=await supabase.from('system_settings').select('value').eq('key','integrated_update_version').maybeSingle();
  setError(failure?'Não foi possível consultar a disponibilidade deste serviço.':'');
  if(!failure)setReady(Number(data?.value?.version)>=1);
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 useDomainRealtime('integrated-update-readiness','public',[{table:'system_settings',filter:'key=eq.integrated_update_version'}],refresh,!ready);
 if(ready)return children;
 return <div role="status" className="rounded-xl border p-6 text-sm text-muted-foreground">{error||'Este serviço está sendo atualizado. A página será liberada automaticamente assim que a atualização terminar.'}{error&&<Button variant="outline" onClick={refresh}>Tentar novamente</Button>}</div>;
}
