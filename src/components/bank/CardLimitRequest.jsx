import { userErrorMessage } from '@/lib/userErrors';
import React, { useEffect, useRef, useState } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function CardLimitRequest({ card, pending, onSent }) {
  const [open, setOpen] = useState(false), [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [policy, setPolicy] = useState(null);
  const lock = useRef(false), { toast } = useToast();
  useEffect(() => {
    if (!open) return;
    let active = true;
    void supabase.rpc('get_bank_policy').then(result => { if (active && !result.error) setPolicy(result.data); });
    return () => { active = false; };
  }, [open]);
  const submit = async event => {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await supabase.rpc('request_card_limit_increase', { p_card_id: card.id, p_requested_limit: Number(amount), p_justification: reason.trim() });
      if (result.error) throw result.error;
      toast({ title: 'Solicitação enviada', description: 'O Banco Nacional analisará o pedido. Acompanhe em Solicitações de Cartão.' });
      setOpen(false); setAmount(''); setReason(''); await onSent();
    } catch (error) {
      console.error('Pedido de limite', error);
      toast({ title: 'Não foi possível solicitar o aumento', description: userErrorMessage(error), variant: 'destructive' });
    } finally { lock.current = false; setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogTrigger asChild><Button variant="outline" className="h-auto min-h-10 w-full whitespace-normal" disabled={pending}><TrendingUp className="mr-2 h-4 w-4 shrink-0"/>{pending ? 'Aumento em análise' : 'Solicitar aumento de limite'}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Solicitar aumento de limite</DialogTitle><DialogDescription>Cartão {card.brand} final {card.card_number.slice(-4)}. O envio não garante aprovação.</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-4"><p>Limite atual: <strong>{formatCurrency(card.card_limit)}</strong></p><p className="text-sm text-muted-foreground">Escolha um valor superior ao atual e explique a necessidade. Somente um pedido pendente por cartão. A análise segue a política de crédito vigente.{policy?.credit_card_max_limit && <> Limite máximo para solicitação: {formatCurrency(policy.credit_card_max_limit)}.</>}</p><div><Label htmlFor={`requested-${card.id}`}>Limite desejado</Label><CurrencyInput id={`requested-${card.id}`} decimal required min={Number(card.card_limit)+0.01} max={policy?.credit_card_max_limit || 1000000000} value={amount} onValueChange={setAmount}/></div><div><Label htmlFor={`justification-${card.id}`}>Justificativa</Label><Textarea id={`justification-${card.id}`} required minLength={10} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></div><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</Button><Button type="submit" disabled={busy || Number(amount)<=Number(card.card_limit) || reason.trim().length<10}>{busy&&<Loader2 className="mr-2 h-4 w-4 animate-spin"/>}Enviar solicitação</Button></DialogFooter></form></DialogContent></Dialog>;
}
