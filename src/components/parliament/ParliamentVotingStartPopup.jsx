import React,{useEffect,useMemo,useState,useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {BellRing,Clock3,Vote,Loader2} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {useAuth} from '@/contexts/AuthContext';
import {useNotifications} from '@/contexts/NotificationsContext';
import {usePopupSlot,PopupQueueActions} from '@/contexts/PopupQueueContext';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {useToast} from '@/components/ui/use-toast';

/** Realtime parliamentary start notice, never displayed after the voting deadline. */
export default function ParliamentVotingStartPopup(){
 const {user}=useAuth(),feed=useNotifications(),navigate=useNavigate(),{toast}=useToast();
 const [clock,setClock]=useState(Date.now()),[checked,setChecked]=useState(null),
       [dismissed,setDismissed]=useState([]),[busy,setBusy]=useState(false);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),3000);return()=>clearInterval(timer);},[]);
 const notification=useMemo(()=>
   (feed?.items||[]).find(n=>
      n.type==='parliament_voting_open' && n.metadata?.voting_id &&
      !n.metadata?.popup_seen_at && !dismissed.includes(n.id) &&
      Number.isFinite(Date.parse(n.metadata?.ends_at)) &&
      Date.parse(n.metadata.ends_at)>clock
   )||null,[feed?.items,dismissed,clock]);
 const votingId=notification?.metadata?.voting_id;
 useEffect(()=>{
  let active=true;
  setChecked(null);
  if(!votingId||!notification){return()=>{active=false;};}
  void supabase.from('parliament_votings')
   .select('id,status,end_date,house_id')
   .eq('id',votingId).maybeSingle()
   .then(({data,error})=>{
      if(!active)return;
      if(error||!data||data.status!=='active'||Date.parse(data.end_date)<=Date.now() ||
       String(data.house_id)!==String(notification.metadata.house_id)){
        setDismissed(old=>old.includes(notification.id)?old:[...old,notification.id]);
      }else setChecked(notification.id);
   });
  return()=>{active=false;};
 },[votingId,notification?.id]);
 const closedEarly=Boolean(votingId&&(feed?.items||[]).some(item=>
    item.type==='parliament_voting_closed' && item.metadata?.voting_id===votingId));
 const ready=Boolean(notification&&checked===notification.id&&!closedEarly&&Date.parse(notification.metadata?.ends_at)>clock);
 const slot=usePopupSlot(ready?'parliament-voting:'+notification.id:null,{priority:38});
 const dismiss=useCallback(async openVoting=>{
   if(!notification||busy)return;
   const id=notification.id;
   setBusy(true);setDismissed(prev=>prev.includes(id)?prev:[...prev,id]);
   try{
    const {error}=await supabase.rpc('acknowledge_parliament_vote_popup',{p_notification_id:id});
    if(error)throw error;
    void feed?.refresh?.();
   }catch(error){toast({title:'Aviso registrado apenas nesta sessão',description:error.message,variant:'destructive'});}
   finally{setBusy(false);}
   if(openVoting)navigate('/services/parliament/panel');
 },[notification,busy,feed,navigate,toast]);
 return <Dialog open={Boolean(ready&&slot)}>
  <DialogContent className="max-w-md [&>button]:hidden" onEscapeKeyDown={event=>event.preventDefault()}>
   <DialogHeader>
    <BellRing className="mx-auto h-10 w-10 text-sky-400"/>
    <DialogTitle className="text-center">Votação iniciada na sua Casa Legislativa</DialogTitle>
    <DialogDescription className="text-center">{notification?.content||'Uma votação legislativa está aberta.'}</DialogDescription>
   </DialogHeader>
   <PopupQueueActions/>
   <div className="rounded-lg border border-border/70 p-3 text-sm">
    <p className="flex items-center gap-2"><Clock3 className="h-4 w-4"/>Prazo até {notification?.metadata?.ends_at?new Date(notification.metadata.ends_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'—'} (Brasília)</p>
    <p className="mt-1 text-xs text-muted-foreground">O aviso desaparece automaticamente quando a votação é encerrada ou expira.</p>
   </div>
   <div className="flex flex-col gap-2 sm:flex-row">
    <Button className="flex-1" disabled={busy} onClick={()=>void dismiss(true)}>
     {busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Vote className="mr-2 h-4 w-4"/>}Ver votação
    </Button>
    <Button variant="outline" className="flex-1" disabled={busy} onClick={()=>void dismiss(false)}>Agora não</Button>
   </div>
  </DialogContent>
 </Dialog>;
}
