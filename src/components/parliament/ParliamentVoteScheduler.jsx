import React,{useState} from 'react';
import {CalendarClock,Loader2,XCircle} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {toBrasiliaInput,fromBrasiliaInput} from '@/lib/dateTime';
import {useToast} from '@/components/ui/use-toast';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

/** Only Presidents of the corresponding House can schedule a bill voting. */
export default function ParliamentVoteScheduler({bill,houseId,schedule,onChanged}){
 const {toast}=useToast(),[open,setOpen]=useState(false),[saving,setSaving]=useState(false);
 const [startsAt,setStartsAt]=useState(()=>toBrasiliaInput(new Date(Date.now()+3600000)));
 const [endsAt,setEndsAt]=useState(()=>toBrasiliaInput(new Date(Date.now()+25*3600000)));
 const submit=async()=>{
  if(saving)return;
  const start=fromBrasiliaInput(startsAt),end=fromBrasiliaInput(endsAt);
  const first=Date.parse(start),last=Date.parse(end);
  if(!Number.isFinite(first)||!Number.isFinite(last)||last-first<300000||first<Date.now()+60000){
   toast({title:'Confira o período',description:'Início futuro e duração de pelo menos 5 minutos.',variant:'destructive'});return;
  }
  setSaving(true);
  try{
   const {data,error}=await supabase.rpc('schedule_parliament_bill_voting',{p_bill_id:bill.id,p_house_id:houseId,p_starts_at:start,p_ends_at:end});
   if(error||data?.success===false)throw error||new Error(data?.message);
   toast({title:'Votação agendada',description:'Os parlamentares desta Casa foram notificados. A abertura será automática.'});
   setOpen(false);await onChanged?.();
  }catch(error){toast({title:'Não foi possível agendar',description:error.message,variant:'destructive'});}finally{setSaving(false);}
 };
 const cancel=async()=>{
  if(saving||!schedule)return;setSaving(true);
  try{
   const {error}=await supabase.rpc('cancel_parliament_bill_schedule',{p_schedule_id:schedule.id});
   if(error)throw error;
   toast({title:'Agendamento cancelado'});await onChanged?.();
  }catch(error){toast({title:'Erro ao cancelar',description:error.message,variant:'destructive'});}finally{setSaving(false);}
 };
 return <>
  {schedule?
  <div className="flex flex-wrap items-center gap-2 text-xs">
   <span>Agendada para {new Date(schedule.starts_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})} · encerra {new Date(schedule.ends_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}</span>
   <Button type="button" size="sm" variant="outline" disabled={saving} onClick={cancel}>
    <XCircle className="mr-1 h-4 w-4"/>Cancelar agendamento
   </Button>
  </div>:
  <Button type="button" size="sm" variant="outline" onClick={()=>setOpen(true)}>
   <CalendarClock className="mr-1 h-4 w-4"/>Agendar votação
  </Button>}
  <Dialog open={open} onOpenChange={setOpen}>
   <DialogContent>
    <DialogHeader><DialogTitle>Agendar votação legislativa</DialogTitle>
     <DialogDescription>{bill.title}. Horários de Brasília. Todos os parlamentares da Casa receberão aviso do agendamento e da abertura.</DialogDescription>
    </DialogHeader>
    <div className="space-y-3">
     <div className="space-y-1"><Label htmlFor="parliament-schedule-start">Início</Label><Input id="parliament-schedule-start" type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)}/></div>
     <div className="space-y-1"><Label htmlFor="parliament-schedule-end">Encerramento</Label><Input id="parliament-schedule-end" type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)}/></div>
     <Button disabled={saving} className="w-full" onClick={()=>void submit()}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<CalendarClock className="mr-2 h-4 w-4"/>}Confirmar agendamento</Button>
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
