import React,{createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {ShieldPlus} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {usePublicProfileChanges} from '@/hooks/use-public-profile-changes';
const Context=createContext(null);
export function XIdentityProvider({children}){
 const ids=useRef(new Map()),timer=useRef(),alive=useRef(true);const [badges,setBadges]=useState({});
 const refresh=useCallback(()=>{clearTimeout(timer.current);timer.current=setTimeout(async()=>{const values=[...ids.current.keys()];for(let start=0;start<values.length;start+=100){const r=await supabase.rpc('get_public_admin_badges',{p_ids:values.slice(start,start+100)});if(!r.error&&alive.current)setBadges(current=>({...current,...Object.fromEntries((r.data||[]).map(row=>[row.user_id,row.is_admin]))}));}},40);},[]);
 const register=useCallback(id=>{if(!id)return()=>{};ids.current.set(id,(ids.current.get(id)||0)+1);refresh();return()=>{const count=(ids.current.get(id)||1)-1;if(count)ids.current.set(id,count);else ids.current.delete(id);};},[refresh]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);};},[]);
 usePublicProfileChanges(refresh);
 return <Context.Provider value={{register,badges}}>{children}</Context.Provider>;
}
export function AdminIdentity({userId}){
 const context=useContext(Context);const register=context?.register;
 useEffect(()=>register?.(userId),[register,userId]);
 return context?.badges[userId]?<span role="img" aria-label="Administrador da plataforma" title="Administrador da plataforma" className="ml-1 inline-flex align-middle text-violet-400"><ShieldPlus aria-hidden="true" className="h-4 w-4"/></span>:null;
}
