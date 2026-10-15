import ElectionParticipation from './ElectionParticipation';
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { partyColor } from '@/lib/partyIdentity';
import CandidateIdentity from './CandidateIdentity';

export default function ElectionResults({ election }) {
  const [participation,setParticipation]=useState(null);
  const [results,setResults]=useState(null),[identities,setIdentities]=useState({}),[error,setError]=useState('');
  const load=useCallback(async()=>{
    const [votes,meta,stats]=await Promise.all([supabase.rpc('get_election_results',{p_election_id:election.id}),supabase.rpc('get_electoral_candidate_identities',{p_election_id:election.id}),supabase.rpc('get_election_participation',{p_election_id:election.id})]);
    if(votes.error||meta.error||stats.error){console.error('Resultados eleitorais',votes.error||meta.error);setError('Não foi possível consultar os resultados. Tente novamente.');return;}
    setParticipation(stats.data);setResults(votes.data||[]);setIdentities(Object.fromEntries((meta.data||[]).map(item=>[item.id,item])));setError('');
  },[election.id]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('election-results',election.id,[{broadcast:'election-results-changed',topic:'electoral-results'},'candidates','election_settlements','votes'],load);
  if(error)return <p role="alert">{error}</p>;
  if(!results)return <Loader2 className="mx-auto animate-spin" aria-label="Consultando resultados"/>;

  const total=results.reduce((sum,item)=>sum+Number(item.vote_count),0);
  return <div className="space-y-4"><ElectionParticipation value={participation}/>{!results.length&&<p className="py-6 text-center text-muted-foreground">Nenhuma candidatura aprovada nesta eleição.</p>}{results.map(item=>{
    const meta=identities[item.candidate_id],identity=meta?.identity || {name:item.political_name,avatar_url:item.campaign_photo_url,party:{name:item.party_name,logo_url:item.party_logo_url}},percent=total?Number(item.vote_count)/total*100:0;
    return <article key={item.candidate_id} className="space-y-3 rounded-xl border border-l-4 p-4" style={{borderLeftColor:partyColor(identity.party?.color)}}>
      <div className="flex flex-wrap justify-between gap-3"><CandidateIdentity identity={identity} label={election.election_types?.requires_vice_candidate?'Presidente':'Candidato'}/><span className="font-mono font-bold">{meta?.electoral_number}</span></div>
      {meta?.vice&&<CandidateIdentity identity={meta.vice} label="Vice-Presidente" compact/>}
      <p className="text-sm font-semibold">{Number(item.vote_count).toLocaleString('pt-BR')} votos · {percent.toLocaleString('pt-BR',{maximumFractionDigits:2})}% dos votos válidos</p>
      <div role="meter" aria-label={`Votos de ${identity.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-3 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full transition-[width]" style={{width:`${percent}%`,backgroundColor:partyColor(identity.party?.color)}}/></div>
    </article>;
  })}</div>;
}
