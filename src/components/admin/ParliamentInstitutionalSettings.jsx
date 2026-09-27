import React, { useCallback, useEffect, useState } from 'react';
import { Landmark, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { userErrorMessage } from '@/lib/userErrors';
export default function ParliamentInstitutionalSettings() {
 const [current,setCurrent]=useState(null),[draft,setDraft]=useState(null),[saving,setSaving]=useState(false);const {toast}=useToast();
 const load=useCallback(async()=>{const {data,error}=await supabase.from('system_settings').select('value').eq('key','parliament_institutional_rules').single();if(!error)setCurrent(data.value);},[]);
 useEffect(()=>{void load();},[load]);useDomainRealtime('institutional-settings','admin',[{table:'system_settings',filter:'key=eq.parliament_institutional_rules'}],load);
 const value=draft||current;if(!value)return null;
 const save=async event=>{event.preventDefault();setSaving(true);try{const {data,error}=await supabase.rpc('configure_parliament_institutional_rules',{p_config:value});if(error)throw error;setCurrent(data);setDraft(null);toast({title:'Regras institucionais salvas'});}catch(error){toast({title:'Não foi possível salvar',description:userErrorMessage(error),variant:'destructive'});}finally{setSaving(false);}};
 return <form onSubmit={save} className="space-y-4 rounded-xl border bg-card p-4"><h2 className="flex items-center gap-2 font-semibold"><Landmark className="h-5 w-5"/>Regras institucionais do Parlamento</h2><p className="text-sm text-muted-foreground">Regra simplificada do RP: impeachment decidido na Câmara. A maioria qualificada considera todos os Deputados ativos na abertura. Cada pedido preserva a configuração vigente no protocolo.</p><div className="grid gap-3 sm:grid-cols-3">{[['impeachment_approval_numerator','Votos favoráveis: numerador',100],['impeachment_approval_denominator','Total: denominador',100],['impeachment_duration_hours','Prazo da votação (horas reais)',168]].map(([key,label,max])=><label key={key} className="text-sm">{label}<Input type="number" min="1" max={max} step="1" required value={value[key]} onChange={event=>setDraft({...value,[key]:Number(event.target.value)})}/></label>)}</div><p className="text-sm">Exigência: {value.impeachment_approval_numerator}/{value.impeachment_approval_denominator}, arredondada para cima. A fração deve ser maior que metade e no máximo a totalidade dos integrantes.</p><p className="text-sm">Sucessão: o Vice assume definitivamente. Na dupla vacância, a Presidência da Câmara exerce interinamente a Presidência da República, preservando seu mandato. A nova chefia escolhe manter ou reformar a equipe.</p><Button disabled={!draft||saving}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar regras institucionais</Button></form>;
}
