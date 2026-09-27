import React, { useCallback, useEffect, useState } from 'react';
import { Landmark, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
const fields=[['direct_call_hours','Convocar eleição direta em até (horas reais)'],['indirect_call_hours','Convocar eleição indireta em até (horas reais)'],['candidacy_hours','Inscrições (horas reais)'],['voting_hours','Votação (horas reais)'],['indirect_quorum_numerator','Quórum indireto: numerador'],['indirect_quorum_denominator','Quórum indireto: denominador'],['administrative_term_days','Novo mandato administrativo (dias reais)']];
export default function ExecutiveTransitionSettings(){
  const [current,setCurrent]=useState(null),[draft,setDraft]=useState(null),[saving,setSaving]=useState(false),{toast}=useToast();
  const load=useCallback(async()=>{const result=await supabase.from('system_settings').select('value').eq('key','executive_transition_rules').maybeSingle();if(!result.error)setCurrent(result.data?.value);},[]);
  useEffect(()=>{void load();},[load]);useDomainRealtime('executive-rules','admin',[{table:'system_settings',filter:'key=eq.executive_transition_rules'}],load);
  const value=draft||current;if(!value)return null;
  const save=async event=>{event.preventDefault();setSaving(true);const r=await supabase.rpc('configure_executive_transition_rules',{p_rules:value});setSaving(false);if(r.error)toast({title:'Regras não salvas',description:r.error.message,variant:'destructive'});else{setDraft(null);setCurrent(r.data);toast({title:'Regras de sucessão salvas'});}};
  return <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-4"><h2 className="flex gap-2 font-semibold"><Landmark className="h-5 w-5"/>Sucessão e eleições extraordinárias</h2><p className="text-sm text-muted-foreground">Primeira metade do mandato: eleição direta. Segunda metade: Congresso. A Presidência da Câmara atua interinamente, mantendo o mandato parlamentar. O vencedor completa o prazo original.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key,label])=><label key={key} className="text-sm">{label}<Input type="number" min="1" max="720" step="1" required value={value[key]} onChange={e=>setDraft({...value,[key]:Number(e.target.value)})}/></label>)}</div><p className="text-xs text-muted-foreground">Quórum: mais de {value.indirect_quorum_numerator}/{value.indirect_quorum_denominator} dos parlamentares registrados na convocação. Os prazos de inscrição e votação são reduzidos proporcionalmente quando o mandato está perto do fim. Eleições convocadas preservam suas regras.</p><Button disabled={!draft||saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar regras de sucessão</Button></form>;
}
