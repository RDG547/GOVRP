import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, Wallet, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { GovSelect } from '@/components/ui/gov-select';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';

export function usePaymentOptions(open, total) {
  const { user } = useAuth();
  const [method, setMethod] = useState('balance');
  const [cardId, setCardId] = useState('');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!user?.id || !open) return;
    setLoading(true);
    const result = await supabase.from('cards').select('id,brand,card_number,card_limit,used_limit,is_active').eq('user_id', user.id).eq('is_active', true).eq('card_type', 'credit');
    setCards(result.error ? [] : result.data || []);
    setError(result.error ? 'Não foi possível consultar seus cartões. Tente novamente.' : '');
    setLoading(false);
  }, [open, user?.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!open) { setMethod('balance'); setCardId(''); } }, [open]);
  useDomainRealtime('purchase-cards', user?.id, ['cards'], load, Boolean(open && user?.id));
  const selected = cards.find(card => card.id === cardId);
  const available = selected ? Math.max(0, Number(selected.card_limit) - Number(selected.used_limit)) : 0;
  const valid = method === 'balance' || Boolean(!loading && !error && selected && available >= Number(total));
  return { method, setMethod, cardId, setCardId, cards, selected, available, valid, loading, error, retry: load, total };
}

export default function PaymentSelector({ payment }) {
  const { method, setMethod, cardId, setCardId, cards, selected, available, loading, error, total } = payment;
  return <fieldset className="min-w-0 space-y-3"><legend className="mb-2 text-sm font-semibold">Forma de pagamento</legend>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {[['balance', 'Saldo em conta', Wallet], ['card', 'Cartão de crédito', CreditCard]].map(([value, label, Icon]) => <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 ${method === value ? 'border-primary bg-primary/10' : ''}`}><input type="radio" name="purchase-payment" value={value} checked={method === value} onChange={() => setMethod(value)} /><Icon aria-hidden="true" className="h-5 w-5 shrink-0"/><span className="text-sm">{label}</span></label>)}
    </div>
    {method === 'card' && <div className="space-y-3">
      {loading && <p role="status" className="text-sm">Consultando limite disponível…</p>}
      {error ? <div role="alert" className="text-sm">{error}<Button variant="link" onClick={payment.retry}>Tentar novamente</Button></div> : !loading && !cards.length ? <p className="text-sm text-muted-foreground">Você ainda não possui um cartão de crédito ativo.</p> : <GovSelect aria-label="Cartão de crédito" value={cardId} onChange={event => setCardId(event.target.value)}><option value="">Selecione seu cartão</option>{cards.map(card => <option key={card.id} value={card.id}><CreditCard className="mr-2 inline h-4 w-4"/>{card.brand} · final {String(card.card_number).slice(-4)}</option>)}</GovSelect>}
      {selected && <div className="rounded-lg border bg-muted/40 p-3"><dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">{[['Limite total', selected.card_limit], ['Utilizado', selected.used_limit], ['Disponível', available]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{formatCurrency(value)}</dd></div>)}</dl>{available < Number(total) && <p role="alert" className="mt-3 flex items-center gap-2 text-destructive"><AlertCircle className="h-4 w-4 shrink-0"/>Limite insuficiente para o total desta compra.</p>}</div>}
    </div>}
  </fieldset>;
}
