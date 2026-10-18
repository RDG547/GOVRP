import React,{useCallback,useEffect,useState} from 'react';
import {Smile,Save} from 'lucide-react';
import {supabase} from '@/lib/supabaseClient';
import {useToast} from '@/components/ui/use-toast';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
const fields={low_threshold:'Limite de infelicidade (%)',low_hours:'Duração para condição ficcional (horas reais)',recovery_threshold:'Felicidade mínima para recuperação (%)',recovery_hours:'Recuperação contínua (horas reais)',social_daily_cap:'Ganho social diário máximo',social_cooldown_seconds:'Intervalo entre ganhos sociais (segundos)',election_win:'Vitória eleitoral',election_loss:'Derrota eleitoral',property_purchase:'Primeira moradia',professional_achievement:'Conquista profissional diária',alcohol_happiness:'Álcool: felicidade',alcohol_thirst:'Álcool: sede',alcohol_health:'Álcool: saúde',productivity_factor:'Produtividade durante a condição (0,75 a 1)'};
export default function HappinessSettings(){
 const {toast}=useToast();const [saved,setSaved]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{const r=await supabase.from('system_settings').select('value').eq('key','citizen_happiness').single();if(!r.error)setSaved(r.data.value);},[]);
 useEffect(()=>{void load();},[load]);useDomainRealtime('happiness-settings','admin',[{table:'system_settings',filter:'key=eq.citizen_happiness'}],load);
 const value=draft||saved;if(!value)return null;
 return <form className="space-y-4 rounded-xl border p-4" onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);const r=await supabase.rpc('configure_citizen_happiness',{p_config:value});setBusy(false);if(r.error)toast({title:'Não foi possível salvar',description:r.error.message,variant:'destructive'});else{setSaved(r.data);setDraft(null);toast({title:'Felicidade configurada'});}}}><h2 className="flex items-center gap-2 font-semibold"><Smile className="h-5 w-5 text-yellow-400"/>Felicidade do cidadão</h2><p className="text-sm text-muted-foreground">Condição exclusivamente ficcional do RP. Tempos contínuos em horas reais. Eventos eleitorais e compras são deduplicados pelo servidor.</p><div className="grid gap-3 sm:grid-cols-2">{Object.entries(fields).map(([key,label])=><label key={key} className="text-sm">{label}<Input type="number" required step={key==='productivity_factor'?.01:1} value={value[key]} onChange={event=>setDraft({...value,[key]:Number(event.target.value)})}/></label>)}</div><Button disabled={!draft||busy}><Save className="mr-2 h-4 w-4"/>{busy?'Salvando…':'Salvar felicidade'}</Button></form>;
}
