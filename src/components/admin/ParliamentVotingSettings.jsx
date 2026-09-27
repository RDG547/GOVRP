import React, { useCallback, useEffect, useState } from 'react';
import { Vote, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { Button } from '@/components/ui/button';
export default function ParliamentVotingSettings(){
 const [rules,setRules]=useState([]),[current,setCurrent]=useState({}),[draft,setDraft]=useState({}),[busy,setBusy]=useState(''),{toast}=useToast();
 const load=useCallback(async()=>{const [r,c]=await Promise.all([supabase.from('parliament_voting_rules').select('*').order('key'),supabase.from('system_settings').select('value').eq('key','parliament_proposition_voting_rules').maybeSingle()]);if(!r.error)setRules(r.data||[]);if(!c.error)setCurrent(c.data?.value||{});},[]);
 useEffect(()=>{void load();},[load]);useDomainRealtime('parliament-voting-settings','admin',['parliament_voting_rules','system_settings'],load);
 const save=async(type)=>{setBusy(type);const r=await supabase.rpc('configure_proposition_voting_rule',{p_type:type,p_rule_key:draft[type]});setBusy('');if(r.error)toast({title:'Regra não salva',description:r.error.message,variant:'destructive'});else{setDraft(previous=>{const next={...previous};delete next[type];return next;});await load();toast({title:'Regra atualizada para novos projetos'});}};
 return <section className="space-y-4 rounded-xl border bg-card p-4"><h2 className="flex gap-2 font-semibold"><Vote className="h-5 w-5"/>Regras de votação por proposição</h2><p className="text-sm text-muted-foreground">Na maioria simples, a Presidência vota apenas para desempatar. Nas regras absoluta e qualificada, participa normalmente. Projetos protocolados conservam sua regra e votações abertas conservam o quórum.</p>{Object.entries(current).map(([type,rule])=><div key={type} className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">{type}<select className="mt-1 h-11 w-full rounded border bg-background px-2" value={draft[type]||rule} onChange={e=>setDraft({...draft,[type]:e.target.value})}>{rules.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label><Button disabled={Boolean(busy)||!draft[type]} onClick={()=>save(type)}>{busy===type?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar {type}</Button></div>)}</section>;
}
