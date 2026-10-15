import React,{useState} from 'react';
import {Loader2,RefreshCw} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {Button} from '@/components/ui/button';
import {useToast} from '@/components/ui/use-toast';
import {formatCurrency} from '@/lib/utils';
import {formatDateTimeBR} from '@/lib/dateTime';
export default function RecurringBillingStatus({service,onChanged,kind='service'}){
 const {toast}=useToast(),[busy,setBusy]=useState(false);if(!service)return null;
 const overdue=service.billing_status==='past_due'||service.status==='past_due';
 const pay=async()=>{setBusy(true);try{const r=await supabase.rpc('retry_my_recurring_payment',{p_kind:kind,p_id:service.id});if(r.error)throw r.error;toast({title:r.data.success?'Renovação concluída':'Renovação não concluída',description:r.data.message,variant:r.data.success?'default':'destructive'});await onChanged?.();}catch(error){toast({title:'Não foi possível renovar',description:error.message,variant:'destructive'});}finally{setBusy(false);}};
 return <section className="space-y-2 rounded-xl border p-4 text-sm" aria-label="Cobrança automática"><p>Cobrança automática na conta pessoal: {formatCurrency(service.price||service.due_amount||0)} por período.</p><p>Próximo vencimento: {formatDateTimeBR(service.next_billing_at||service.next_payment_date)}.</p>{service.billing_status==='recovery_pending'&&<p role="status" className="text-cyan-400">Renovação automática em processamento após ajuste da cobrança.</p>}{overdue&&<><p role="status" className="text-amber-400">Renovação pendente por saldo insuficiente. Regularize o saldo para retomar.</p><Button variant="outline" disabled={busy} onClick={pay}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<RefreshCw className="mr-2 h-4 w-4"/>}Pagar e renovar agora</Button></>}</section>;
}
