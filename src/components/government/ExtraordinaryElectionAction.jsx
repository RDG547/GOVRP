import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Vote, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTimeBR } from '@/lib/dateTime';
export default function ExtraordinaryElectionAction({ government, onUpdate }) {
  const [busy,setBusy]=useState(false),{toast}=useToast();
  if(!government?.is_interim)return null;
  const call=async()=>{
    setBusy(true);
    const result=await supabase.rpc('call_extraordinary_election');
    if(result.error)toast({title:'Convocação não concluída',description:result.error.message,variant:'destructive'});
    else {toast({title:'Eleição extraordinária convocada',description:'Candidaturas e votação estão disponíveis no Portal Eleitoral.'});await onUpdate();}
    setBusy(false);
  };
  return <section className="mb-6 space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"><h2 className="flex gap-2 font-semibold"><Vote className="h-5 w-5"/>Presidência Interina · dupla vacância</h2><p className="text-sm">Seu mandato parlamentar e a Presidência da Câmara permanecem ativos. A eleição extraordinária será {government.extraordinary_mode==='indirect'?'indireta, com votação do Congresso':'direta, com votação popular'}.</p><p className="text-sm">Prazo de convocação: {formatDateTimeBR(government.call_deadline)}. O vencedor completa o mandato até {formatDateTimeBR(government.term_ends_at)}.</p>{government.extraordinary_election_id?<Button asChild><Link to="/services/elections">Acompanhar eleição no Portal Eleitoral</Link></Button>:<Button disabled={busy} onClick={call}>{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Vote className="mr-2 h-4 w-4"/>}Convocar eleição extraordinária</Button>}</section>;
}
