import React,{useEffect,useRef,useState} from 'react';
import {Vote,Clock3,Loader2,XCircle,CheckCircle2} from 'lucide-react';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {PopupQueueActions} from '@/contexts/PopupQueueContext';
export default function InstitutionalInvitationCard({title,description,expiresAt,serverNow,busy=false,onDecision,onLater,onExpire,children}){
 const [now,setNow]=useState(Date.now()),offset=useRef(serverNow?Date.parse(serverNow)-Date.now():0),expired=useRef(false);
 useEffect(()=>{if(serverNow)offset.current=Date.parse(serverNow)-Date.now();},[serverNow]);
 const remaining=Math.max(0,Math.ceil((Date.parse(expiresAt)-now-offset.current)/1000)),valid=Number.isFinite(remaining)&&remaining>0;
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{expired.current=false;},[expiresAt]);
 useEffect(()=>{if(!valid&&!expired.current){expired.current=true;if(onExpire)void Promise.resolve(onExpire()).catch(error=>console.error('Atualização do convite expirado',error));}},[valid,onExpire,expiresAt]);
 return <div className="fixed bottom-6 right-4 z-[90] w-[calc(100vw-2rem)] max-w-md"><Card className="border-blue-500/30 bg-slate-950/95 shadow-2xl backdrop-blur"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Vote className="h-5 w-5 text-blue-300"/>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="space-y-4"><PopupQueueActions/>{children}<p role="timer" className="flex items-center justify-center gap-2 font-mono text-sm"><Clock3 className="h-4 w-4"/>{valid?`Expira em: ${String(Math.floor(remaining/3600)).padStart(2,'0')}h ${String(Math.floor(remaining/60)%60).padStart(2,'0')}m ${String(remaining%60).padStart(2,'0')}s`:'Prazo encerrado'}</p><div className="grid grid-cols-2 gap-3"><Button variant="outline" className="border-red-500/40 text-red-200 hover:bg-red-500/10" disabled={busy||!valid} onClick={()=>onDecision(false)}><XCircle className="mr-2 h-4 w-4"/>Recusar</Button><Button className="bg-emerald-700 text-white hover:bg-emerald-600" disabled={busy||!valid} onClick={()=>onDecision(true)}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CheckCircle2 className="mr-2 h-4 w-4"/>}Aceitar</Button></div>{onLater&&<div className="flex justify-center"><Button variant="ghost" disabled={busy} onClick={onLater}><Clock3 className="mr-2 h-4 w-4"/>Responder Depois</Button></div>}</CardContent></Card></div>;
}
