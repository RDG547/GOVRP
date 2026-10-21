import React,{createContext,useContext,useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from './AuthContext';
import {supabase} from '@/lib/supabaseClient';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
const Context=createContext(null);
export const useNotifications=()=>useContext(Context);
export function NotificationsProvider({children}){
 const {user}=useAuth();const [items,setItems]=useState([]),[unread,setUnread]=useState(0);const current=useRef(user?.id),version=useRef(0);current.current=user?.id;
 const refresh=useCallback(async()=>{const id=user?.id;if(!id)return;const sequence=++version.current;const [rows,count]=await Promise.all([supabase.from('notifications').select('*').eq('user_id',id).order('created_at',{ascending:false}).limit(100),supabase.from('notifications').select('id',{head:true,count:'exact'}).eq('user_id',id).eq('is_read',false)]);if(current.current!==id||sequence!==version.current)return;if(!rows.error)setItems(rows.data||[]);if(!count.error)setUnread(count.count||0);},[user?.id]);
 useEffect(()=>{setItems([]);setUnread(0);void refresh();},[refresh]);
 useDomainRealtime('notification-feed',user?.id,[{table:'notifications',filter:`user_id=eq.${user?.id}`}],refresh,Boolean(user?.id));
 const markRead=async id=>{const query=supabase.from('notifications').update({is_read:true}).eq('user_id',user.id);const r=await(id?query.eq('id',id):query.eq('is_read',false));if(!r.error)await refresh();};
 const dismissPhone=async value=>{const ids=Array.isArray(value)?value:[value];const now=new Date().toISOString();setItems(current=>current.map(n=>ids.includes(n.id)?{...n,phone_dismissed_at:now}:n));const r=await supabase.rpc('dismiss_phone_notifications',{p_ids:ids});if(r.error){console.error('Dispensar avisos do celular',r.error);await refresh();}return !r.error;};
 const clear=async()=>{const r=await supabase.from('notifications').delete().eq('user_id',user.id);if(r.error)throw r.error;await refresh();};
 return <Context.Provider value={{items,unread,refresh,markRead,clear,dismissPhone}}>{children}</Context.Provider>;
}
