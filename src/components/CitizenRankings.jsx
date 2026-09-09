import React, { useCallback, useEffect, useState } from 'react';
import { Trophy, Users } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';

export default function CitizenRankings() {
  const [data,setData]=useState(null);
  const load=useCallback(async()=>{const result=await supabase.rpc('get_citizen_rankings');if(!result.error)setData(result.data);},[]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('citizen-rankings','public',[{broadcast:'rankings-changed',topic:'citizen-world-rankings'},'followers','parliament_voting_votes','country_rp_exchange_rates'],load);
  usePublicProfileChanges(load);
  return <section className="grid min-w-0 gap-6 lg:grid-cols-2">{[{key:'wealth',title:'Cidadãos mais ricos',icon:Trophy,method:'wealth_method'},{key:'influence',title:'Cidadãos mais influentes',icon:Users,method:'influence_method'}].map(({key,title,icon:Icon,method})=><div key={key} className="min-w-0 space-y-4 rounded-xl border bg-card p-4"><h2 className="flex items-center gap-2 text-xl font-semibold"><Icon className="h-5 w-5 text-primary"/>{title}</h2><ol className="space-y-3">{(data?.[key]||[]).map((citizen,i)=><li key={citizen.id} className="flex items-center gap-3"><span className="w-6 shrink-0 font-semibold">{i+1}º</span><img src={citizen.avatar_url||'/logo.png'} alt="" className="h-9 w-9 rounded-full object-cover"/><span className="min-w-0 flex-1 break-words text-sm">{citizen.full_name}</span><span className="shrink-0 text-right text-sm font-semibold">{key==='wealth'?Number(citizen.wealth).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):`${Number(citizen.influence).toLocaleString('pt-BR',{maximumFractionDigits:1})} pts`}</span></li>)}</ol><p className="text-xs text-muted-foreground">{data?.[method]}</p></div>)}</section>;
}
