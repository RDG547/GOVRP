import React,{useEffect,useRef,useState} from 'react';
import {CurrencyInput} from '@/components/ui/currency-input';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Loader2,Receipt} from 'lucide-react';
import {useToast} from '@/components/ui/use-toast';
import {formatCurrency,formatBoleto,validateBoleto} from '@/lib/utils';
import {supabase} from '@/lib/supabaseClient';
const normalizeCode=value=>/[a-z]/i.test(value)?value.trim().slice(0,80):formatBoleto(value);
const completeCode=value=>validateBoleto(value)||/^[a-z][a-z0-9-]{3,79}$/i.test(value);
export default function PayBillDialog({isOpen,setIsOpen,onPaymentSuccess,initialBillCode=''}){
 const {toast}=useToast();const [code,setCode]=useState(''),[bill,setBill]=useState(null),[checking,setChecking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');const sequence=useRef(0);
 useEffect(()=>{if(isOpen){setCode(normalizeCode(initialBillCode));setBill(null);setError('');}else{sequence.current++;}},[isOpen,initialBillCode]);
 useEffect(()=>{const version=++sequence.current;setBill(null);setChecking(false);if(!isOpen||!completeCode(code))return;setChecking(true);const timer=setTimeout(async()=>{const r=await supabase.rpc('validate_and_get_bill',{p_bill_code:code});if(version!==sequence.current)return;setChecking(false);if(r.error||!r.data?.success){setError(r.data?.message||'Não foi possível verificar o boleto.');return;}setError('');setBill(r.data);},350);return()=>clearTimeout(timer);},[isOpen,code]);
 const pay=async event=>{event.preventDefault();if(!bill||busy)return;setBusy(true);try{const r=await supabase.rpc('pay_boleto',{p_bill_code:code});if(r.error||!r.data?.success)throw new Error(r.data?.message||'Não foi possível pagar este boleto.');toast({title:'Pagamento confirmado',description:r.data.message});onPaymentSuccess?.();setIsOpen(false);}catch(f){setError(f.message);}finally{setBusy(false);}};
 return <Dialog open={isOpen} onOpenChange={open=>{if(!busy)setIsOpen(open);}}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><Receipt/>Pagar Conta</DialogTitle><DialogDescription>Boletos do GOVRP usam linha digitável de 47 dígitos. Referências antigas de multas e serviços continuam aceitas quando cadastradas para você.</DialogDescription></DialogHeader><form onSubmit={pay} className="space-y-4"><Label htmlFor="billCode">Código de Barras</Label><Input id="billCode" inputMode="numeric" autoComplete="off" maxLength={/[a-z]/i.test(code)?80:54} value={code} onChange={event=>{setCode(normalizeCode(event.target.value));setError('');}} placeholder="Cole ou Digite o código de barras" required/><p className="text-xs text-muted-foreground">{/[a-z]/i.test(code)?'Referência histórica da plataforma':`${code.replace(/\D/g,'').length}/47 dígitos`}</p>{code&&!completeCode(code)&&<p className="text-sm text-amber-400">Informe os 47 dígitos do boleto emitido pelo GOVRP.</p>}{checking&&<p role="status">Verificando boleto…</p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Label htmlFor="amount">Valor a Pagar</Label><CurrencyInput id="amount" value={bill?formatCurrency(bill.amount,true):''} readOnly disabled/><DialogFooter><Button type="submit" disabled={busy||checking||!bill}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Confirmar Pagamento</Button></DialogFooter></form></DialogContent></Dialog>;
}
