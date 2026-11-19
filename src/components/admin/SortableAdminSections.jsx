import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { GripVertical } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

function Section({item,active,onOpen,onMove,onDrop,onDragStart}) {
 const controls=useDragControls();
 return <Reorder.Item as="div" value={item.id} dragListener={false} dragControls={controls} onDragStart={onDragStart} onDragEnd={onDrop} whileDrag={{scale:1.04,zIndex:10,boxShadow:'0 0 0 2px hsl(var(--primary))'}} className={`relative flex shrink-0 items-stretch rounded-lg border ${active?'border-primary bg-primary text-primary-foreground':'border-transparent bg-card text-muted-foreground'}`}>
  <button type="button" data-tab-id={item.id} onClick={()=>onOpen(item.id)} className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-l-lg px-3 py-2 text-xs font-medium hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:text-sm" aria-current={active?'page':undefined}><item.icon className="h-4 w-4 shrink-0"/><span>{item.label}</span></button>
  <button type="button" aria-label={`Reordenar ${item.label}`} title="Arraste ou use as setas esquerda e direita" style={{touchAction:'none'}} onPointerDown={event=>controls.start(event)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();onMove(item.id,event.key==='ArrowLeft'?-1:1);}}} className="flex min-h-11 w-9 cursor-grab items-center justify-center rounded-r-lg hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"><GripVertical aria-hidden="true" className="h-4 w-4"/></button>
 </Reorder.Item>;
}
export default function SortableAdminSections({tabs,activeTab,onOpen,navRef}) {
 const {user}=useAuth(),[order,setOrder]=useState(tabs.map(tab=>tab.id)),[status,setStatus]=useState(''),latest=useRef(order),saving=useRef(false),queued=useRef(null),dragging=useRef(false);
 const signature=tabs.map(tab=>tab.id).join('|');
 useEffect(()=>{let active=true;void supabase.from('admin_dashboard_preferences').select('section_order').eq('user_id',user.id).maybeSingle().then(result=>{if(!active)return;if(result.error){setStatus('Não foi possível consultar a ordem salva.');return;}const ids=signature.split('|'),saved=(result.data?.section_order||[]).filter(id=>ids.includes(id));const next=[...saved,...ids.filter(id=>!saved.includes(id))];latest.current=next;setOrder(next);});return()=>{active=false;};},[user.id,signature]);
 const persist=useCallback(async()=>{
  queued.current=[...latest.current];if(saving.current)return;saving.current=true;
  try{while(queued.current){const desired=queued.current;queued.current=null;setStatus('Salvando ordem…');const result=await supabase.rpc('save_admin_dashboard_order',{p_order:desired});if(result.error)throw result.error;setStatus('Ordem salva para sua conta.');}}
  catch(error){console.error('Ordem administrativa',error);setStatus('Não foi possível salvar a ordem. Mova uma seção para tentar novamente.');}
  finally{saving.current=false;}
 },[]);
 const change=values=>{latest.current=values;setOrder(values);};
 const move=(id,direction)=>{const next=[...latest.current],index=next.indexOf(id),target=index+direction;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];change(next);void persist();};
 return <><p className="mb-2 text-xs text-muted-foreground">Use a alça para arrastar as seções. No teclado, foque a alça e use ← ou →.</p><Reorder.Group as="nav" axis="x" values={order} onReorder={change} ref={navRef} aria-label="Seções do Painel de Administração" onPointerMove={event=>{if(!dragging.current||!navRef.current)return;const bounds=navRef.current.getBoundingClientRect();if(event.clientX>bounds.right-35)navRef.current.scrollLeft+=12;else if(event.clientX<bounds.left+35)navRef.current.scrollLeft-=12;}} className="mb-3 flex list-none gap-2 overflow-x-auto px-1 py-2 custom-scrollbar">{order.map(id=>{const item=tabs.find(tab=>tab.id===id);return item&&<Section key={id} item={item} active={activeTab===id} onOpen={onOpen} onMove={move} onDragStart={()=>{dragging.current=true;}} onDrop={()=>{dragging.current=false;void persist();}}/>;})}</Reorder.Group><p role="status" className="mb-4 min-h-4 text-xs text-muted-foreground">{status}</p></>;
}
