import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
const Context=createContext(null);
export function PopupQueueProvider({children}){
 const [entries,setEntries]=useState(new Map()),[active,setActive]=useState(null),[closing,setClosing]=useState(false);
 const register=useCallback((id,item)=>{setEntries(previous=>{const next=new Map(previous);next.set(id,item);return next;});return()=>setEntries(previous=>{if(!previous.has(id))return previous;const next=new Map(previous);next.delete(id);return next;});},[]);
 useEffect(()=>{if(active&&entries.has(active))return;setActive([...entries].sort((a,b)=>a[1].priority-b[1].priority||a[0].localeCompare(b[0]))[0]?.[0]||null);},[entries,active]);
 const dismissAll=useCallback(async()=>{if(closing)return;setClosing(true);try{const r=await supabase.rpc('dismiss_all_informational_popups');if(r.error)throw r.error;await Promise.all([...entries.values()].filter(item=>item.dismissible).map(item=>item.dismiss()));}catch(error){console.error('Fechar avisos',error);}finally{setClosing(false);}},[entries,closing]);
 const informational=[...entries.values()].filter(entry=>entry.dismissible).length;
 const value=useMemo(()=>({register,active,dismissAll,closing,informational}),[register,active,dismissAll,closing,informational]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function usePopupSlot(id,{priority=50,dismissible=false,onDismiss}={}){
 const queue=useContext(Context),callback=useRef(onDismiss);callback.current=onDismiss;
 const register=queue?.register;
 useEffect(()=>{if(!id||!register)return;return register(id,{priority,dismissible,dismiss:()=>callback.current?.()});},[id,register,priority,dismissible]);
 return Boolean(id&&(!queue||queue.active===id));
}

// Render within the active overlay so Radix focus trapping, pointer handling
// and screen-reader visibility apply to this action as well.
export function PopupQueueActions(){
 const queue=useContext(Context);
 if(!queue?.active||!queue.informational)return null;
 return <div className="mb-3 flex justify-center pr-6"><Button size="sm" variant="secondary" disabled={queue.closing} onClick={queue.dismissAll} className="h-auto min-h-10 whitespace-normal"><X className="mr-2 h-4 w-4 shrink-0"/>{queue.closing?'Fechando avisos…':'Fechar todos os avisos'}</Button></div>;
}
