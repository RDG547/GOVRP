import React, { useCallback, useEffect, useState } from 'react';
import { Save, Loader2, HeartPulse } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const decayNames = { hunger: 'Fome', thirst: 'Sede', hygiene: 'Higiene', social: 'Socialização', sleep: 'Sono' };
const settings = [
  ['offline_decay_cap', 'Perda máxima offline', 0, 30], ['offline_floor', 'Piso de necessidades offline', 30, 100],
  ['grace_rp_days', 'Carência inicial (dias RP)', 1, 100], ['bath_cooldown_rp_hours', 'Intervalo entre banhos (horas RP)', 1, 100],
  ['sleep_cooldown_rp_hours', 'Intervalo entre descansos (horas RP)', 1, 100], ['social_daily_cap', 'Recuperação social máxima por dia RP', 0, 20],
];
export default function CitizenNeedsSettings() {
  const [current,setCurrent]=useState(null); const [draft,setDraft]=useState(null); const [saving,setSaving]=useState(false); const {toast}=useToast();
  const load=useCallback(async()=>{const {data,error}=await supabase.from('system_settings').select('value').eq('key','citizen_needs').single();if(!error)setCurrent(data.value);},[]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('citizen-needs-settings','admin',[{table:'system_settings',filter:'key=eq.citizen_needs'}],load);
  const value=draft||current;
  const save=async e=>{e.preventDefault();setSaving(true);try {const result=await supabase.rpc('configure_citizen_needs',{p_config:value});if(result.error)throw result.error;setCurrent(result.data);setDraft(null);toast({title:'Necessidades configuradas'});}catch(error){toast({title:'Não foi possível salvar',description:error.message,variant:'destructive'});}finally{setSaving(false);}};
  if(!value)return null;
  return <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-4"><h2 className="flex items-center gap-2 font-semibold"><HeartPulse className="h-5 w-5"/>Necessidades do cidadão</h2><p className="text-sm text-muted-foreground">O decaimento segue o relógio do RP. A saúde mantém um piso seguro e não altera direitos, cargos ou participação política.</p><fieldset className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 text-sm font-medium">Pontos perdidos por dia RP</legend>{Object.entries(decayNames).map(([key,label])=><label key={key} className="text-sm">{label}<Input type="number" min="0" max="10" step=".1" required value={value.decay_per_rp_day[key]} onChange={e=>setDraft({...value,decay_per_rp_day:{...value.decay_per_rp_day,[key]:Number(e.target.value)}})}/></label>)}</fieldset><div className="grid gap-3 sm:grid-cols-2">{settings.map(([key,label,min,max])=><label key={key} className="text-sm">{label}<Input type="number" min={min} max={max} step="1" required value={value[key]} onChange={e=>setDraft({...value,[key]:Number(e.target.value)})}/></label>)}</div><Button disabled={!draft||saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar configuração</Button></form>;
}
