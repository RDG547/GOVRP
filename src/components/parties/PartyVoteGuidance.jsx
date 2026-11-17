import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { GovSelect } from '@/components/ui/gov-select';
import { Loader2 } from 'lucide-react';

const positions = {
  support: 'Orientação: votar a favor',
  oppose: 'Orientação: votar contra',
  abstain: 'Orientação: abster-se',
  free: 'Voto liberado (sem orientação)',
};

export function PartyGuidanceNotice({ billId, partyId }) {
  const [guidance, setGuidance] = useState(null);
  useEffect(() => {
    let alive = true;
    setGuidance(null);
    if (!billId || !partyId) return undefined;
    supabase.from('party_vote_guidance')
      .select('position,rationale,updated_at')
      .eq('bill_id', billId).eq('party_id', partyId).maybeSingle()
      .then(({ data, error }) => {
        if (alive && !error) setGuidance(data || null);
      });
    return () => { alive = false; };
  }, [billId, partyId]);
  if (!guidance) return null;
  return (
    <div className="mt-3 min-w-0 space-y-1 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-sm">
      <p className="font-semibold text-sky-200">{positions[guidance.position] || 'Orientação partidária'}</p>
      {guidance.rationale && <p className="whitespace-pre-wrap break-words text-muted-foreground">{guidance.rationale}</p>}
      <p className="text-xs text-muted-foreground">Orientação não vinculante: o parlamentar vota livremente, inclusive em sentido diferente.</p>
    </div>
  );
}

export default function PartyVoteGuidance({ party, canManage }) {
  const { toast } = useToast();
  const [bills, setBills] = useState([]);
  const [issued, setIssued] = useState([]);
  const [billId, setBillId] = useState('');
  const [position, setPosition] = useState('support');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const [billsResponse, guidanceResponse] = await Promise.all([
      supabase.from('bills').select('id,title,type,status').in('status',['Em tramitação','Em votação','Em votação (2ª Casa)']).order('updated_at',{ ascending:false }).limit(150),
      supabase.from('party_vote_guidance').select('id,bill_id,position,rationale,updated_at').eq('party_id',party.id).order('updated_at',{ ascending:false }).limit(100),
    ]);
    if (billsResponse.error || guidanceResponse.error) {
      throw billsResponse.error || guidanceResponse.error;
    }
    setBills(billsResponse.data || []);
    setIssued(guidanceResponse.data || []);
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('bills').select('id,title,type,status').in('status',['Em tramitação','Em votação','Em votação (2ª Casa)']).order('updated_at',{ascending:false}).limit(150),
      supabase.from('party_vote_guidance').select('id,bill_id,position,rationale,updated_at').eq('party_id',party.id).order('updated_at',{ascending:false}).limit(100),
    ]).then(([a,b]) => {
      if (!active) return;
      if (a.error || b.error) throw a.error || b.error;
      setBills(a.data || []);setIssued(b.data || []);
    }).catch(error => { if (active) toast({title:'Não foi possível consultar orientações',description:error.message,variant:'destructive'}); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active=false; };
  }, [party.id,toast]);

  const current = useMemo(() => issued.find(row => row.bill_id === billId), [billId,issued]);
  useEffect(() => {
    setPosition(current?.position || 'support');
    setRationale(current?.rationale || '');
  }, [current?.id,current?.updated_at,billId]);

  const save = async event => {
    event.preventDefault();
    if (!canManage || !billId || busy) return;
    setBusy(true);
    const {error} = await supabase.rpc('set_party_vote_guidance',{
      p_party_id:party.id,p_bill_id:billId,p_position:position,p_rationale:rationale.trim(),
    });
    if (error) toast({title:'Orientação não publicada',description:error.message,variant:'destructive'});
    else {
      toast({title:'Orientação publicada',description:'A bancada foi orientada, mas cada parlamentar mantém seu voto livre.'});
      try { await refresh(); } catch (failure) {
        toast({title:'Atualize as orientações',description:failure.message,variant:'destructive'});
      }
    }
    setBusy(false);
  };

  if (loading) return <Loader2 className="mx-auto my-5 h-5 w-5 animate-spin"/>;
  return <div className="min-w-0 space-y-4 py-2">
    <div><h3 className="font-semibold">Orientação de voto da bancada</h3>
      <p className="text-sm text-muted-foreground">Uma posição política sugerida sobre um projeto. Não registra voto, não restringe votos divergentes e não substitui a vontade dos parlamentares.</p>
    </div>
    {canManage && <form className="space-y-3" onSubmit={save}>
      <Label htmlFor="guidance-bill">Projeto em tramitação</Label>
      <GovSelect id="guidance-bill" value={billId} onChange={e=>setBillId(e.target.value)} aria-label="Selecionar projeto para orientar">
        <option value="">Selecione um projeto</option>
        {bills.map(bill=><option key={bill.id} value={bill.id}>{bill.title} ({bill.type})</option>)}
      </GovSelect>
      <Label htmlFor="guidance-position">Orientação não obrigatória</Label>
      <GovSelect id="guidance-position" value={position} onChange={e=>setPosition(e.target.value)} aria-label="Orientação de voto">
        {Object.entries(positions).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </GovSelect>
      <Label htmlFor="guidance-reason">Justificativa política (opcional)</Label>
      <Textarea id="guidance-reason" maxLength={2500} value={rationale} onChange={e=>setRationale(e.target.value)} placeholder="Explique a posição do partido sem impor a decisão individual."/>
      <Button type="submit" disabled={busy || !billId}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}{current?'Atualizar orientação':'Publicar orientação'}</Button>
    </form>}
    {!bills.length && <p className="text-sm text-muted-foreground">Não há projetos em tramitação para receber uma nova orientação.</p>}
    <div className="space-y-2"><h4 className="font-medium">Orientações publicadas</h4>
      {issued.length ? issued.map(item=><div key={item.id} className="rounded-lg border border-border/70 p-3 text-sm">
        <p className="font-semibold">{bills.find(bill=>bill.id===item.bill_id)?.title || 'Projeto arquivado ou já decidido'}</p>
        <p className="mt-1 text-sky-300">{positions[item.position]}</p>
        {item.rationale && <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.rationale}</p>}
      </div>) : <p className="text-sm text-muted-foreground">Nenhuma orientação registrada.</p>}
    </div>
  </div>;
}
