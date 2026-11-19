import React, { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { hydrateBillHistory } from '@/lib/billHistory';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import BillAuthorParty from './BillAuthorParty';

export default function BillDetailsDialog({ billId, onClose }) {
  const [state, setState] = useState({ id: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!billId) return;
    let active = true;
    void (async () => {
      try {
        const response = await supabase.from('bills').select('*').eq('id', billId).single();
        if (response.error) throw response.error;
        const [bill] = await hydrateBillHistory([response.data], supabase);
        if (active) setState({ id: billId, bill });
      } catch (error) {
        console.error('Consulta do projeto oficial', error);
        if (active) setState({ id: billId, error: true });
      }
    })();
    return () => { active = false; };
  }, [billId, retry]);
  const bill = state.id === billId ? state.bill : null;
  return <Dialog open={Boolean(billId)} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="max-w-3xl [overflow-wrap:anywhere]"><DialogHeader><DialogTitle><FileText className="mr-2 inline h-5 w-5 text-amber-400" />{bill?.title || 'Detalhes do projeto'}</DialogTitle><DialogDescription>Consulta do texto oficial. Esta ação não registra voto.</DialogDescription></DialogHeader>{bill ? <div className="min-w-0 space-y-4"><p className="text-sm">{bill.bill_number || bill.number || bill.id} · {bill.type} · {bill.status}</p><p className="text-sm">Autoria: {bill.author?.full_name || bill.author_identity_snapshot?.full_name || 'Não registrada'}</p><BillAuthorParty bill={bill} /><section><h3 className="font-semibold">Ementa</h3><p className="whitespace-pre-wrap">{bill.summary || bill.description || 'Não cadastrada.'}</p></section><section><h3 className="font-semibold">Texto integral</h3><div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{bill.full_text || 'Este projeto não possui texto integral cadastrado.'}</div></section>{bill.justification && <section><h3 className="font-semibold">Justificativa</h3><p className="whitespace-pre-wrap text-sm">{bill.justification}</p></section>}</div> : state.id === billId && state.error ? <p role="alert">Não foi possível consultar o projeto. <Button onClick={() => { setState({}); setRetry(value => value + 1); }}>Tentar novamente</Button></p> : <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Consultando o texto oficial…</p>}</DialogContent></Dialog>;
}
