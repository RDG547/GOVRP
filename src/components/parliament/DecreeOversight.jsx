import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export default function DecreeOversight({ houseId, onUpdated }) {
  const [decrees, setDecrees] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const load = useCallback(async () => {
    const [acts, bills] = await Promise.all([supabase.from('decrees').select('id,title').eq('is_published', true).is('revoked_at', null), supabase.from('bills').select('id,title,status').eq('house_id', houseId).eq('type', 'PDL').not('suspends_decree_id', 'is', null)]);
    if (acts.error || bills.error) console.error('Fiscalização de decretos indisponível', acts.error || bills.error);
    else { setDecrees(acts.data); setProposals(bills.data); }
  }, [houseId]);
  useEffect(() => { if (houseId) void load(); }, [load, houseId]);
  useDomainRealtime('decree-oversight', houseId, ['decrees', 'bills', 'parliament_voting_votes'], load, Boolean(houseId));
  const execute = async (name, args) => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc(name, args); if (error) throw error;
      toast({ title: name === 'propose_decree_suspension' ? 'Sustação proposta para votação' : 'Sustação promulgada pelo Parlamento' });
      setSelected(null); setReason(''); await load(); await onUpdated?.();
    } catch (error) { console.error('Controle parlamentar recusado', error); toast({ title: 'Não foi possível concluir', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Fiscalização parlamentar de decretos</summary><div className="mt-3 space-y-3">
    <p className="text-sm text-muted-foreground">Propostas de sustação são votadas pela Casa. A promulgação depende do resultado da votação e encerra os efeitos do decreto.</p>
    {decrees.map(decree => <div key={decree.id} className="flex flex-wrap justify-between gap-2"><span className="text-sm">{decree.title}</span><Button size="sm" variant="outline" onClick={() => setSelected(decree)}>Propor sustação</Button></div>)}
    {proposals.filter(bill => bill.status !== 'Promulgado').map(bill => <div key={bill.id} className="flex flex-wrap justify-between gap-2"><span className="text-sm">{bill.title} · {bill.status}</span><Button size="sm" disabled={saving} onClick={() => execute('promulgate_decree_suspension', { p_bill_id: bill.id })}>Promulgar após votação</Button></div>)}
  </div><Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !saving) setSelected(null); }}><DialogContent><DialogHeader><DialogTitle>Propor sustação de decreto</DialogTitle><DialogDescription>{selected?.title}. Descreva a fundamentação com pelo menos 40 caracteres.</DialogDescription></DialogHeader><Textarea aria-label="Fundamentação da sustação" value={reason} onChange={e => setReason(e.target.value)} /><Button disabled={saving || reason.trim().length < 40} onClick={() => execute('propose_decree_suspension', { p_decree_id: selected.id, p_house_id: houseId, p_reason: reason })}>Enviar para votação</Button></DialogContent></Dialog></details>;
}
