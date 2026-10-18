import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {useAuth} from './AuthContext';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
const Context=createContext(null);
export const useInvitations=()=>useContext(Context);
export function InvitationsProvider({children}){
 const {user}=useAuth();const [data,setData]=useState(null),[error,setError]=useState('');const pending=useRef(null),identity=useRef(user?.id);identity.current=user?.id;
 const refresh=useCallback(()=>{if(!user?.id||!user.onboarding_completed)return Promise.resolve(null);if(pending.current?.id===user.id)return pending.current.promise;const id=user.id;const promise=(async()=>{const r=await supabase.rpc('get_my_invitations');if(identity.current!==id)return null;if(r.error){setError('Não foi possível consultar seus convites.');throw r.error;}setError('');setData(r.data);return r.data;})().finally(()=>{if(pending.current?.promise===promise)pending.current=null;});pending.current={id,promise};return promise;},[user?.id,user?.onboarding_completed]);
 useEffect(()=>{setData(null);setError('');void refresh().catch(()=>{});},[refresh]);
 useDomainRealtime('my-invitations',user?.id,[{table:'minister_invitations',filter:`candidate_id=eq.${user?.id}`},{table:'notifications',filter:`user_id=eq.${user?.id}`}],events=>{if(events.some(e=>e.eventType==='SYNC'||e.table==='minister_invitations'||String(e.new?.type||e.old?.type).startsWith('vice_')))void refresh().catch(()=>{});},Boolean(user?.onboarding_completed));
 const count=(data?.items||[]).filter(item=>item.status==='pending'&&(!item.expires_at||Date.parse(item.expires_at)>Date.parse(data.server_now))).length;
 return <Context.Provider value={{data,error,refresh,count}}>{children}</Context.Provider>;
}
