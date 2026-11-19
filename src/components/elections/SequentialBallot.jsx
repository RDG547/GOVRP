import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Volume2, VolumeX } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { getVotingEligibilityNotice } from '@/lib/electoralEligibility';
import { playBallotSound } from '@/lib/ballotAudio';
import { Button } from '@/components/ui/button';
import ElectronicBallot from './ElectronicBallot';

export default function SequentialBallot() {
 const {user}=useAuth(),[data,setData]=useState(null),[candidates,setCandidates]=useState({id:null,rows:[]}),[error,setError]=useState(''),[candidateError,setCandidateError]=useState(''),[sound,setSound]=useState(true),[transition,setTransition]=useState(false);
 const candidateSequence=useRef(0);
 const sequence=useRef(0),hadInteraction=useRef(false),finished=useRef(false);
 const load=useCallback(async()=>{
  const request=++sequence.current;
  const result=await supabase.rpc('get_my_ballot_sequence');
  if(request!==sequence.current)return;
  if(result.error){setError('Não foi possível consultar a sequência de votação. Seus votos confirmados permanecem registrados.');return;}
  setError('');setData(result.data);setTransition(false);
 },[]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),30000);return()=>{sequence.current++;clearInterval(timer);};},[load,user?.role]);
 useDomainRealtime('ballot-sequence',user?.id,['elections',{table:'votes',filter:`voter_id=eq.${user?.id}`}],load);
 const current=data?.elections?.[0];
 const loadCandidates=useCallback(async()=>{
  if(!current?.id)return;
  const request=++candidateSequence.current;
  const result=await supabase.from('candidates').select('*, political_parties(name,acronym,logo_url,ideology)').eq('election_id',current.id).eq('status','Approved').is('removed_at',null);
  if(request!==candidateSequence.current)return;
  if(result.error)setCandidateError('Não foi possível consultar os candidatos. Tente novamente antes de votar.');
  else{setCandidateError('');setCandidates({id:current.id,rows:result.data.map(candidate=>({...candidate,political_parties:candidate.political_parties||candidate.party_snapshot}))});}
 },[current?.id]);
 useEffect(()=>{void loadCandidates();return()=>{candidateSequence.current++;};},[loadCandidates]);
 useDomainRealtime('sequence-candidates',current?.id,[{table:'candidates',filter:`election_id=eq.${current?.id}`},'political_parties'],loadCandidates,Boolean(current?.id));
 const done=Boolean(data&&data.active_count>0&&!current&&data.completed>0);
 useEffect(()=>{if(done&&hadInteraction.current&&!finished.current){finished.current=true;playBallotSound('finish',sound);}},[done,sound]);
 return <section className="space-y-4" aria-label="Votação sequencial"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Urna eletrônica</h2><Button type="button" variant="outline" aria-pressed={sound} onClick={()=>{setSound(value=>!value);if(!sound)playBallotSound('digit');}}>{sound?<Volume2 className="mr-2 h-4 w-4"/>:<VolumeX className="mr-2 h-4 w-4"/>}{sound?'Som ligado':'Som desligado'}</Button></div>{(error||candidateError)&&<p role="alert" className="rounded-xl border p-4">{error||candidateError}<Button variant="link" onClick={()=>{void load();void loadCandidates();}}>Tentar novamente</Button></p>}{!data?<p role="status" className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin"/>Consultando eleições disponíveis…</p>:done?<div role="status" className="rounded-2xl border bg-[#e4e7d8] px-4 py-16 text-center text-slate-950"><CheckCircle2 className="mx-auto h-12 w-12 text-green-800"/><p className="mt-4 text-6xl font-black">FIM</p><p className="mt-4">Todos os seus votos disponíveis foram confirmados.</p></div>:current?<><p className="text-sm text-muted-foreground">Deputado → Senador → Presidente · São apresentados apenas os cargos disponíveis. {data.completed} voto(s) já confirmado(s).</p>{error||candidateError?<p role="status">Aguardando a consulta dos dados antes de liberar a urna.</p>:transition||candidates.id!==current.id?<p role="status">Preparando o próximo cargo…</p>:<ElectronicBallot key={current.id} election={current} candidates={candidates.rows} soundEnabled={sound} onRecorded={async()=>{hadInteraction.current=true;setTransition(true);await load();}}/>}</>:<p role="status" className="rounded-xl border p-4">Não há eleições com votação aberta no momento para você.</p>}{data?.unavailable?.map(item=><p key={item.id} className="rounded-lg border p-3 text-sm">{item.name}: {getVotingEligibilityNotice(item.reason,item.eligibleAt).message}</p>)}</section>;
}
