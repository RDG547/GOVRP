import React, { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import PaymentSelector, { usePaymentOptions } from './PaymentSelector';

export default function PurchaseDialog({ product, total = product?.final_price, open, onOpenChange, onConfirm, blocked = false, quoteReady = true }) {
  const [loading, setLoading] = useState(false);
  const payment = usePaymentOptions(open, total);
  const unavailable = blocked || !quoteReady || product?.unavailable || product?.seller?.activity_restricted;
  const confirm = async () => {
    if (loading || unavailable || !payment.valid) return;
    setLoading(true);
    try { await onConfirm(payment.method, payment.cardId); } finally { setLoading(false); }
  };
  return <Dialog open={open} onOpenChange={next => { if (!loading) onOpenChange(next); }}><DialogContent><DialogHeader><DialogTitle>Confirmar compra</DialogTitle><DialogDescription>{product?.name || 'Confira os produtos do seu carrinho e a forma de pagamento.'}</DialogDescription></DialogHeader>
    <p className="rounded-lg bg-muted p-4 font-semibold">Total: {formatCurrency(total)}</p>
    {unavailable && <p role="status" className="text-sm text-destructive">{!quoteReady ? 'Atualizando os valores vigentes…' : 'Há produtos indisponíveis ou suspensos por norma vigente.'}</p>}
    <PaymentSelector payment={payment}/>
    <DialogFooter className="gap-2"><Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={loading || unavailable || !payment.valid} onClick={confirm}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>}Confirmar e pagar</Button></DialogFooter>
  </DialogContent></Dialog>;
}
