import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BatteryFull, Briefcase, Circle, HeartPulse, Home, Landmark, LineChart, MessageSquare, Newspaper, Phone, Signal, Smartphone, Square, Store, Triangle, Wifi, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import PhoneAppViewport from '@/components/PhoneAppViewport';

const APPS = [
  ['Banco', '/services/bank', Landmark, 'bg-emerald-600'],
  ['X', '/services/x', MessageSquare, 'bg-slate-900'],
  ['Negócios Livre', '/services/business', Store, 'bg-blue-600'],
  ['Internet', '/services/internet', Wifi, 'bg-cyan-700'],
  ['Telefonia', '/services/phone', Phone, 'bg-violet-600'],
  ['Moradia', '/services/national-housing', Home, 'bg-emerald-700'],
  ['Portal do Trabalhador', '/services/my-work', Briefcase, 'bg-amber-700'],
  ['Notícias', '/news', Newspaper, 'bg-rose-600'],
  ['SNS', '/services/health', HeartPulse, 'bg-red-600'],
  ['Bolsa de Valores', '/services/stock-exchange', LineChart, 'bg-indigo-600'],
];
const DEFAULT_ORDER=APPS.map(app=>app[1]);
const validOrder=value=>Array.isArray(value)&&value.length===DEFAULT_ORDER.length&&new Set(value).size===DEFAULT_ORDER.length&&value.every(path=>DEFAULT_ORDER.includes(path));
export default function CitizenPhone() {
  const { user, refreshUser }=useAuth(), {toast}=useToast(), navigate=useNavigate();
  const [open,setOpen]=useState(false),[clock,setClock]=useState(new Date()),[recent,setRecent]=useState([]),[screen,setScreen]=useState('home'),[appPath,setAppPath]=useState(null);
  const [order,setOrder]=useState(DEFAULT_ORDER),[dragging,setDragging]=useState(null),[saving,setSaving]=useState(false);
  const orderRef=useRef(order),drag=useRef(null),suppressClick=useRef(false),back=useRef(new Map()),panel=useRef(null),launcher=useRef(null),saveQueue=useRef(Promise.resolve()),pendingSave=useRef(0);
  const changeOrder=next=>{orderRef.current=next;setOrder(next);};
  useEffect(()=>{
    if(!pendingSave.current&&!drag.current&&validOrder(user?.ui_preferences?.phone_app_order))changeOrder(user.ui_preferences.phone_app_order);
  },[user?.ui_preferences?.phone_app_order]);
  useEffect(()=>{setRecent([]);setAppPath(null);setScreen('home');setOpen(false);changeOrder(validOrder(user?.ui_preferences?.phone_app_order)?user.ui_preferences.phone_app_order:DEFAULT_ORDER);},[user?.id]);
  const show=useCallback(()=>{setOpen(current=>!current);},[]);
  const goHome=useCallback(()=>setScreen('home'),[]);
  const register=useCallback((path,callback)=>back.current.set(path,callback),[]);
  const close=()=>{setOpen(false);launcher.current?.focus();};
  const openFull=useCallback(path=>{setOpen(false);navigate(path);},[navigate]);
  useEffect(()=>{window.addEventListener('govrp:open-phone',show);return()=>window.removeEventListener('govrp:open-phone',show);},[show]);
  useEffect(()=>{
    if(!open)return undefined;
    setClock(new Date());const interval=setInterval(()=>setClock(new Date()),15000);
    const escape=event=>{if(event.key==='Escape'&&!document.querySelector('[data-modal-layer]'))setOpen(false);};
    window.addEventListener('keydown',escape);panel.current?.focus();
    return()=>{clearInterval(interval);window.removeEventListener('keydown',escape);};
  },[open]);
  useEffect(()=>()=>clearTimeout(drag.current?.timer),[]);
  const saveOrder=next=>{
    pendingSave.current++;setSaving(true);
    saveQueue.current=saveQueue.current.then(async()=>{
      const result=await supabase.rpc('save_phone_app_order',{p_order:next});
      if(result.error)throw result.error;
    }).catch(error=>{console.error('Ordem dos aplicativos',error);toast({title:'Não foi possível salvar a ordem',description:'Confira a conexão e reorganize os aplicativos para tentar novamente.',variant:'destructive'});}).finally(()=>{pendingSave.current--;if(!pendingSave.current){setSaving(false);void refreshUser();}});
  };
  const move=(path,target)=>{
    const next=[...orderRef.current],from=next.indexOf(path),to=next.indexOf(target);
    if(from<0||to<0||from===to)return;
    next.splice(from,1);next.splice(to,0,path);changeOrder(next);
  };
  const pointerDown=(event,path)=>{
    if(event.button!==0)return;
    suppressClick.current=false;
    const item={path,x:event.clientX,y:event.clientY,active:false,original:[...orderRef.current]};
    item.timer=setTimeout(()=>{item.active=true;suppressClick.current=true;setDragging(path);},400);
    drag.current=item;event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove=event=>{
    const item=drag.current;if(!item)return;
    if(!item.active){if(Math.hypot(event.clientX-item.x,event.clientY-item.y)>10){clearTimeout(item.timer);drag.current=null;}return;}
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-phone-app]')?.dataset.phoneApp;
    if(target)move(item.path,target);
  };
  const pointerUp=()=>{
    const item=drag.current;if(!item)return;
    clearTimeout(item.timer);drag.current=null;setDragging(null);
    if(item.active&&JSON.stringify(item.original)!==JSON.stringify(orderRef.current))saveOrder(orderRef.current);
  };
  const launch=app=>{
    if(suppressClick.current){suppressClick.current=false;return;}
    setRecent(current=>[app[1],...current.filter(path=>path!==app[1])]);setAppPath(app[1]);setScreen('app');
  };
  const removeApp=path=>{setRecent(current=>current.filter(item=>item!==path));back.current.delete(path);if(appPath===path){setAppPath(null);setScreen('recent');}};
  const appButton=app=>{const [name,path,Icon,color]=app;return <button key={path} type="button" data-phone-app={path} onClick={()=>launch(app)} onPointerDown={event=>pointerDown(event,path)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
    if(!event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4}[event.key];const index=orderRef.current.indexOf(path);const target=orderRef.current[index+offset];if(target){move(path,target);saveOrder(orderRef.current);}
  }} aria-label={`Abrir ${name}`} aria-describedby="phone-reorder-help" className={`group flex touch-none select-none min-w-0 flex-col items-center gap-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${dragging===path?'ring-2 ring-cyan-300 scale-105':''}`}><span className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-md transition-transform group-hover:scale-105 ${color}`}><Icon className="h-6 w-6 text-white"/></span><span className="min-h-8 text-center text-[11px] leading-4 text-white">{name}</span></button>;};
  if(!user?.onboarding_completed)return null;
  return <>
    <button ref={launcher} type="button" aria-label={open?"Fechar celular":"Abrir celular"} title="Celular" aria-expanded={open} aria-controls="citizen-phone" onClick={show} className="fixed bottom-[5.25rem] left-5 z-40 hidden h-12 w-12 items-center justify-center rounded-full border-4 border-background bg-slate-800 text-white shadow-lg hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-ring md:flex"><Smartphone className="h-6 w-6"/></button>
    <section id="citizen-phone" ref={panel} tabIndex={-1} role="region" aria-label="Celular do cidadão" hidden={!open} className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-2 z-[90] h-[min(730px,calc(100dvh-7rem))] w-[min(390px,calc(100vw-1rem))] overflow-hidden rounded-[2.25rem] border-[6px] border-slate-800 bg-slate-950 text-white shadow-2xl outline-none md:bottom-5 md:left-20 md:h-[min(730px,calc(100dvh-2.5rem))]">
      <div className="flex h-full min-h-0 flex-col bg-gradient-to-br from-indigo-950 via-slate-900 to-cyan-950">
        <div className="flex shrink-0 items-center justify-between px-5 pt-3 text-xs"><time>{clock.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time><div aria-hidden="true" className="h-5 w-20 rounded-full bg-black"/><span className="flex gap-1" aria-hidden="true"><Signal className="h-3 w-3"/><Wifi className="h-3 w-3"/><BatteryFull className="h-4 w-4"/></span></div>
        <div className="flex shrink-0 items-center justify-between px-3 py-1"><h2 className="text-xs font-semibold">{screen==='app'?APPS.find(app=>app[1]===appPath)?.[0]:'Celular'}</h2><Button size="icon" variant="ghost" aria-label="Fechar celular" onClick={close}><X className="h-4 w-4"/></Button></div>
        <div className="relative min-h-0 flex-1">
          {recent.map(path=><PhoneAppViewport key={path} app={APPS.find(app=>app[1]===path)} active={open&&screen==='app'&&appPath===path} register={register} goHome={goHome} openFull={openFull}/>)}
          {screen==='home'&&<div className="absolute inset-0 overflow-y-auto px-3 py-2"><p className="mb-4 text-center text-xs text-slate-300">{clock.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'})}</p><div className="grid grid-cols-4 gap-x-1 gap-y-3">{order.map(path=>appButton(APPS.find(app=>app[1]===path)))}</div><p id="phone-reorder-help" className="mt-3 text-center text-[11px] text-slate-300">Segure e arraste para organizar. No teclado, use Alt + setas.</p>{saving&&<p role="status" className="text-center text-xs">Salvando ordem…</p>}</div>}
          {screen==='recent'&&<div className="absolute inset-0 space-y-3 overflow-y-auto px-3 py-3"><h3 className="text-sm font-semibold">Aplicativos recentes</h3>{recent.length?recent.map(path=>{const [name,,Icon,color]=APPS.find(app=>app[1]===path);return <article key={path} className="flex gap-2 rounded-2xl border border-white/15 bg-white/5 p-3"><button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-white" onClick={()=>launch(APPS.find(app=>app[1]===path))}><span className={`rounded-xl p-3 ${color}`}><Icon className="h-5 w-5"/></span><span className="text-sm">{name}<span className="block text-xs text-slate-300">Retomar aplicativo</span></span></button><Button size="icon" variant="ghost" aria-label={`Fechar aplicativo ${name}`} onClick={()=>removeApp(path)}><X className="h-4 w-4"/></Button></article>;}):<p className="py-8 text-center text-sm text-slate-300">Os aplicativos abertos aparecerão aqui.</p>}</div>}
        </div>
        <nav aria-label="Navegação do celular" className="flex shrink-0 items-center justify-around border-t border-white/10 py-1">
          <Button size="icon" variant="ghost" aria-label="Aplicativos recentes" onClick={()=>setScreen('recent')}><Square className="h-4 w-4"/></Button>
          <Button size="icon" variant="ghost" aria-label="Tela inicial do celular" onClick={goHome}><Circle className="h-5 w-5"/></Button>
          <Button size="icon" variant="ghost" aria-label="Voltar no aplicativo" onClick={()=>screen==='app'?back.current.get(appPath)?.():goHome()}><Triangle className="h-4 w-4 -rotate-90"/></Button>
        </nav>
      </div>
    </section>
  </>;
}
