import CandidateIdentity, { candidateIdentity } from './CandidateIdentity';
import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, RotateCcw, Vote } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { electionNumberDigits } from '@/lib/electoralNumbers';

export default function ElectronicBallot({ election, candidates, hasVoted, onRecorded }) {
  const [number, setNumber] = useState(''), [blank, setBlank] = useState(false), [saving, setSaving] = useState(false), [recorded, setRecorded] = useState(false);
  const busy = useRef(false), { toast } = useToast();
  const digits = electionNumberDigits(election), complete = number.length === digits;
  const candidate = complete ? candidates.find(item => item.electoral_number === number && item.status === 'Approved') : null;
  const [eligible, setEligible] = useState(null);
  useEffect(()=>{let active=true;setEligible(null);supabase.rpc('can_vote_in_election',{p_election_id:election.id}).then(({data,error})=>{if(active)setEligible(!error&&Boolean(data));});return()=>{active=false;};},[election.id,election.election_mode]);
  const disabled = saving || recorded || hasVoted || eligible !== true;
  useEffect(() => { setNumber(''); setBlank(false); setRecorded(false); }, [election.id]);
  const type = digit => { if (!disabled) { setBlank(false); setNumber(current => (blank ? digit : current + digit).slice(0, digits)); } };
  const correct = () => { if (!disabled) { setNumber(''); setBlank(false); } };
  const confirm = async () => {
    if (busy.current || disabled || (!blank && !complete)) return;
    busy.current = true; setSaving(true);
    try {
      const { data, error } = await supabase.rpc('cast_ballot', { p_election_id: election.id, p_number: blank ? null : number, p_kind: blank ? 'blank' : candidate ? 'candidate' : 'null' });
      if (error || !data?.success) throw error || new Error('Não foi possível registrar o voto.');
      setRecorded(true); onRecorded?.();
    } catch (error) {
      console.error('electronic-ballot', error);
      const text = error.message || '';
      toast({ title: 'Voto não registrado', description: /^(Entre |Seu cidadão|Emita |Eleição|Esta eleição|Você já votou|Digite |Candidato|Este número)/.test(text) ? text : 'Não foi possível registrar o voto. Confira sua conexão e tente novamente.', variant: 'destructive' });
    } finally { setSaving(false); busy.current = false; }
  };
  if(eligible===false)return <p role="status" className="rounded-xl border p-4">{election.election_mode==='indirect'?'Esta eleição indireta é exclusiva dos parlamentares elegíveis do Congresso. Você pode acompanhar as candidaturas e o resultado.':'Sua sessão não está habilitada para votar nesta eleição.'}</p>;
  return <section aria-label="Urna eletrônica" className="rounded-2xl border border-slate-400 bg-gradient-to-br from-slate-200 to-slate-400 p-3 text-slate-950 shadow-[5px_8px_0_#475569,0_18px_30px_#0005] sm:p-5"><div className="mb-3 flex items-center gap-2 font-bold"><Vote className="h-6 w-6"/>JUSTIÇA ELEITORAL · GOVRP</div><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]"><div className="min-h-64 rounded-lg border-4 border-slate-600 bg-[#e4e7d8] p-3 shadow-inner sm:p-5" aria-live="polite" aria-atomic="true">{recorded || hasVoted ? <div className="flex h-full min-h-56 flex-col items-center justify-center gap-4"><Check className="h-14 w-14 text-green-800 motion-safe:animate-in motion-safe:zoom-in"/><p className="text-center text-2xl font-black">VOTO REGISTRADO.</p><p className="text-sm">Você concluiu sua votação nesta eleição.</p></div> : <><p className="text-xs">SEU VOTO PARA</p><h3 className="mt-2 text-xl font-bold uppercase">{election.election_types?.name || election.name}</h3><label htmlFor={`ballot-${election.id}`} className="mt-4 block text-sm">Digite o número ({digits} dígitos)</label><input id={`ballot-${election.id}`} inputMode="numeric" autoComplete="off" maxLength={digits} value={number} disabled={disabled} onChange={event => { setBlank(false); setNumber(event.target.value.replace(/\D/g, '').slice(0, digits)); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); confirm(); } if (event.key === 'Escape') correct(); }} className="mt-1 w-full max-w-56 rounded border-2 border-slate-700 bg-white/50 p-2 font-mono text-3xl tracking-[.3em] outline-offset-4 focus-visible:outline focus-visible:outline-blue-700"/>{blank ? <p className="mt-4 text-xl font-bold">VOTO EM BRANCO</p> : candidate ? <div className="mt-4 space-y-3"><CandidateIdentity identity={candidateIdentity(candidate)} label="Titular"/>{candidate.vice_identity_snapshot&&<CandidateIdentity identity={candidate.vice_identity_snapshot} label="Vice-Presidente" compact/>}<p className="text-sm">Confira os dados e pressione CONFIRMA.</p></div> : complete ? <div className="mt-4"><p className="font-bold">Candidato não encontrado.</p><p className="mt-2 text-sm">CONFIRMA registra um voto nulo. Use CORRIGE para trocar o número.</p></div> : <p className="mt-4 text-sm">Digite o número completo para conferir o candidato.</p>}</>}</div><div className="rounded-lg bg-slate-900 p-3"><div className="mx-auto grid max-w-72 grid-cols-3 gap-2">{[1,2,3,4,5,6,7,8,9,0].map(digit => <button type="button" key={digit} disabled={disabled} aria-label={`Dígito ${digit}`} onClick={() => type(String(digit))} className={`min-h-12 rounded border border-slate-600 bg-gradient-to-b from-slate-600 to-slate-800 text-2xl font-bold text-white shadow-[0_3px_0_#020617] transition active:translate-y-0.5 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${digit === 0 ? 'col-start-2' : ''}`}>{digit}</button>)}</div><div className="mt-4 grid grid-cols-3 gap-1.5"><button type="button" disabled={disabled} onClick={() => { setNumber(''); setBlank(true); }} className="min-h-14 rounded bg-white px-1 text-[10px] font-bold text-slate-950 focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:opacity-50">BRANCO</button><button type="button" disabled={disabled} onClick={correct} className="min-h-14 rounded bg-orange-400 px-1 text-[10px] font-bold text-slate-950 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"><RotateCcw className="mx-auto mb-1 h-4 w-4"/>CORRIGE</button><button type="button" disabled={disabled || (!complete && !blank)} onClick={confirm} className="min-h-14 rounded bg-green-400 px-1 text-[10px] font-bold text-slate-950 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50">{saving ? <Loader2 className="mx-auto h-5 w-5 animate-spin"/> : <><Check className="mx-auto mb-1 h-4 w-4"/>CONFIRMA</>}</button></div></div></div></section>;
}
