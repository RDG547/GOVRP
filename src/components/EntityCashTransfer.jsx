import React, { useRef, useState } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import CitizenSelector from './CitizenSelector';
import { Button } from './ui/button';
import { CurrencyInput } from './ui/currency-input';
import { Input } from './ui/input';
import { GovSelect } from './ui/gov-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { useToast } from './ui/use-toast';

export default function EntityCashTransfer({ companyId, partyId, sectorId, regionCode, destinations = [], onCompleted }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(''), [destination, setDestination] = useState(''), [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false), [recipientName, setRecipientName] = useState('');
  const request = useRef(null);
  const isCompany = Boolean(companyId);
  const prepare = async event => {
    event.preventDefault();
    if (!destination) { toast({ title: 'Selecione o destinatário', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('quote_legal_levies', { p_basis: 'transfer', p_amount: Number(amount), p_business: false, ...(isCompany ? { p_sector: sectorId || null, p_region: regionCode || null } : {}) });
      if (error) throw error;
      if (data?.restricted) throw new Error('A transferência está restrita por norma vigente.');
      setPreview(data);
    } catch (failure) { console.error('Prévia da transferência', failure); toast({ title: 'Não foi possível calcular a transferência', description: 'Tente novamente antes de confirmar.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const payload = isCompany ? { p_business_id: companyId, p_destination_account_id: destination } : { p_party_id: partyId, p_recipient_id: destination };
    Object.assign(payload, { p_amount: Number(amount), p_reason: reason.trim() });
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    try {
      const { error } = await supabase.rpc(isCompany ? 'withdraw_company_cash' : 'transfer_party_funds', { ...payload, p_idempotency_key: request.current.key });
      if (error) throw error;
      setPreview(null); setAmount(''); setReason(''); request.current = null;
      toast({ title: isCompany ? 'Retirada registrada' : 'Transferência registrada', description: 'O extrato preserva o valor e os tributos efetivamente cobrados.' });
      onCompleted?.();
    } catch (failure) { console.error('Transferência de entidade', failure); toast({ title: 'Transferência não concluída', description: /^[A-Z_0-9]+$/.test(failure.message) ? 'Confira o saldo, a autorização e os dados informados.' : failure.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <>
    <form onSubmit={prepare} className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">{isCompany ? 'Retirar do caixa' : 'Transferir do caixa partidário'}</h3>
      <p className="text-sm text-muted-foreground">{isCompany ? 'Os salários já devidos permanecem reservados. O destino é uma conta do proprietário.' : 'O destino, o responsável e a justificativa ficam registrados no histórico público do partido.'}</p>
      <label className="block space-y-1 text-sm">Valor (R$)<CurrencyInput required decimal min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {isCompany ? <label className="block space-y-1 text-sm">Conta de destino<GovSelect required value={destination} onChange={event => setDestination(event.target.value)}><option value="">Selecione a conta</option>{destinations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</GovSelect></label> : <CitizenSelector label="Destinatário da transferência" value={destination} onChange={setDestination} onSelect={person => setRecipientName(person.full_name)} />}
      <label className="block space-y-1 text-sm">Justificativa<Input required minLength={5} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Button type="submit" disabled={busy} className="bg-amber-600 text-white hover:bg-amber-700">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpRight className="mr-2 h-4 w-4" />}Revisar transferência</Button>
    </form>
    <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open && !busy) setPreview(null); }}><DialogContent><DialogHeader><DialogTitle>Confirmar transferência</DialogTitle><DialogDescription>Confira o valor e o destino. A regra vigente será validada novamente ao confirmar.</DialogDescription></DialogHeader><p className="break-words text-sm">Destino: {isCompany ? destinations.find(item => item.id === destination)?.label : recipientName}</p><dl className="space-y-2 text-sm">{[['Valor da operação', Number(amount)], ['Tributos', Number(preview?.buyer_tax || 0) + Number(preview?.seller_tax || 0)], ['Total debitado', preview?.total_debited], ['Destinatário recebe', preview?.net_amount]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{formatCurrency(value || 0)}</dd></div>)}</dl><p className="break-words text-sm">{reason}</p><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Voltar</Button><Button disabled={busy} onClick={confirm}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
