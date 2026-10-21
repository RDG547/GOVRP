import React,{useId,useRef,useState} from 'react';
import {Banknote,CalendarClock,FileText,Loader2,Send,User,X} from 'lucide-react';
import CitizenSelector from '@/components/CitizenSelector';
import {supabase} from '@/lib/supabaseClient';
import {fromBrasiliaInput} from '@/lib/dateTime';
import {useToast} from '@/components/ui/use-toast';
import {Button} from '@/components/ui/button';
import {CurrencyInput} from '@/components/ui/currency-input';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
export default function IssueFineDialog({onFineIssued,onFineAdded}){
 const id=useId(),intent=useRef(null); const {toast}=useToast();
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[citizen,setCitizen]=useState(''),[reason,setReason]=useState(''),[amount,setAmount]=useState(''),[due,setDue]=useState('');
 const submit=async event=>{
  event.preventDefault();if(busy)return;setBusy(true);
  const input={p_user_id:citizen,p_reason:reason.trim(),p_amount:Number(amount),p_due_date:fromBrasiliaInput(due)};
  const signature=JSON.stringify(input);if(intent.current?.signature!==signature)intent.current={signature,key:crypto.randomUUID()};
  try{
   const result=await supabase.rpc('issue_fine_idempotent',{...input,p_key:intent.current.key});if(result.error||!result.data?.success)throw result.error||new Error(result.data?.message);
   toast({title:'Multa emitida',description:result.data?.message});setOpen(false);setCitizen('');setReason('');setAmount('');setDue('');intent.current=null;await(onFineIssued||onFineAdded)?.();
  }catch(error){console.error('Emissão de multa recusada',error);toast({title:'Não foi possível emitir a multa',description:error.message,variant:'destructive'});}finally{setBusy(false);}
 };
 return <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogTrigger asChild><Button disabled={busy} variant="secondary"><Banknote className="mr-2 h-4 w-4"/>Emitir Multa</Button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10"><Banknote className="h-7 w-7 text-amber-400"/></span><DialogTitle>Emitir Nova Multa</DialogTitle><DialogDescription>Identifique o cidadão, fundamente a infração e confira o valor antes de emitir.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5">
  <div className="space-y-2"><Label className="flex items-center gap-2"><User className="h-4 w-4 text-cyan-400"/>Cidadão</Label><CitizenSelector value={citizen} onChange={setCitizen} disabled={busy}/></div>
  <div className="space-y-2"><Label htmlFor={`${id}-reason`} className="flex items-center gap-2"><FileText className="h-4 w-4 text-purple-400"/>Motivo e fundamentação</Label><Textarea id={`${id}-reason`} value={reason} onChange={event=>setReason(event.target.value)} rows={4} minLength={10} required placeholder="Descreva a infração e a fundamentação da multa"/></div>
  <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`${id}-amount`} className="flex items-center gap-2"><Banknote className="h-4 w-4 text-emerald-400"/>Valor (R$)</Label><CurrencyInput id={`${id}-amount`} value={amount} onValueChange={setAmount} min="0.01" required/></div><div className="space-y-2"><Label htmlFor={`${id}-due`} className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-amber-400"/>Vencimento (Brasília)</Label><Input id={`${id}-due`} type="datetime-local" value={due} onChange={event=>setDue(event.target.value)} required/></div></div>
  <p className="text-xs text-muted-foreground">A emissão será auditada e o cidadão receberá uma notificação. Para sanções previstas em norma estruturada, o juiz deve usar “Aplicar sanção prevista em lei” no processo.</p>
  <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)} disabled={busy}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button type="submit" disabled={busy||!citizen||!amount||!due||reason.trim().length<10}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Send className="mr-2 h-4 w-4"/>}Emitir Multa</Button></DialogFooter>
 </form></DialogContent></Dialog>;
}
