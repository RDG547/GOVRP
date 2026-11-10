import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';

export const COMPETITION_ROLES = ['Defensor Público','Promotor','Agente Secreto','Professor','Policial','Militar','Agente Penitenciário'];
export const COMPETITION_STATUS = {draft:'Rascunho',published:'Publicado',finished:'Finalizado',cancelled:'Cancelado'};
export const APPLICATION_STATUS = {registered:'Inscrito',approved:'Aprovado — Efetivado',rejected:'Reprovado'};
export async function competitionRpc(name,args) {
 const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;
}
export function usePublicCompetitions() {
 const {user}=useAuth();
 const [competitions,setCompetitions]=useState([]),[applications,setApplications]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const sequence=useRef(0);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;
  try {
   const results=await Promise.all([supabase.from('public_competitions').select('*').order('created_at',{ascending:false}),supabase.from('public_competition_applications').select('*').eq('profile_id',user.id)]);
   for(const result of results)if(result.error)throw result.error;
   if(request!==sequence.current)return;
   setCompetitions(results[0].data||[]);setApplications(results[1].data||[]);setError('');
  }catch(failure){if(request===sequence.current)setError(failure.message);}finally{if(request===sequence.current)setLoading(false);}
 },[user.id]);
 useEffect(()=>{void refresh();return()=>{sequence.current++;};},[refresh]);
 useDomainRealtime('public-competitions',user.id,['public_competitions',{table:'public_competition_applications',filter:`profile_id=eq.${user.id}`}],refresh);
 return {competitions,applications,loading,error,refresh};
}
// One deadline timer, no continuous polling. The server rechecks every action.
export function useCompetitionClock(competitions) {
 const [tick,setTick]=useState(0);
 const signature=JSON.stringify(competitions.map(c=>[c.registration_starts_at,c.registration_ends_at,c.exam_starts_at,c.exam_ends_at]));
 useEffect(()=>{
  const current=Date.now();
  const next=Math.min(...JSON.parse(signature).flat().map(Date.parse).filter(at=>at>current));
  if(!Number.isFinite(next))return;
  const timer=setTimeout(()=>setTick(value=>value+1),Math.min(2147483647,next-current+100));
  return()=>clearTimeout(timer);
 },[signature,tick]);
 return Date.now();
}
