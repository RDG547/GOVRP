import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { normalizeServiceAvailabilitySettings } from '@/lib/serviceCatalog';

const PlatformAccessContext=createContext(null);
export const usePlatformAccess=()=>useContext(PlatformAccessContext);
export function PlatformAccessProvider({children}) {
 const {session}=useAuth(),id=session?.user?.id||'public';
 const [state,setState]=useState({id:null,settings:{},bypass:false,allowed:false,loading:true,error:false});
 const sequence=useRef(0);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;
  const result=await supabase.rpc('get_platform_access');
  if(request!==sequence.current)return;
  if(result.error){console.warn('Disponibilidade da plataforma',result.error.message);setState(current=>({...current,id,bypass:current.id===id&&current.bypass,allowed:current.id===id&&current.allowed,error:true,loading:false}));return;}
  setState({id,settings:normalizeServiceAvailabilitySettings(result.data.settings),bypass:result.data.bypass===true,allowed:result.data.allowed===true,loading:false,error:false});
 },[id]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>void refresh(),30000);return()=>{sequence.current++;clearInterval(timer);};},[refresh]);
 useDomainRealtime('platform-access',id,[{table:'system_settings',filter:'key=eq.service_availability'},...(id!=='public'?[{table:'platform_access_exceptions',filter:`user_id=eq.${id}`}]:[])],refresh);
 return <PlatformAccessContext.Provider value={{...state,loading:state.id!==id||state.loading,bypass:state.id===id&&state.bypass,refresh}}>{children}</PlatformAccessContext.Provider>;
}
