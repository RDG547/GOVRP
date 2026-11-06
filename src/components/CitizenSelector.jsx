import React, { useCallback, useEffect, useRef, useState } from 'react';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem } from '@/components/ui/command';
import UserSelectOption from './UserSelectOption';

export default function CitizenSelector({ value, onChange, onSelect, roles, eligibleIds, executiveOffice, disabled, label = 'Selecionar cidadão' }) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[rows,setRows]=useState([]),[selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const version=useRef(0),roleKey=JSON.stringify(roles||null),idsKey=JSON.stringify(eligibleIds||null);
  const load=useCallback(async()=>{
    if(!open)return;
    const current=++version.current;setLoading(true);setError('');
    try {
      const size=executiveOffice?50:100;
      const page=async(offset)=>{
        const r=executiveOffice?await supabase.rpc('search_executive_candidates',{p_office_key:executiveOffice,p_query:'',p_offset:offset}):await supabase.rpc('search_citizens',{p_search:'',p_roles:JSON.parse(roleKey),p_ids:JSON.parse(idsKey),p_limit:size,p_offset:offset});
        if(r.error)throw r.error;
        return executiveOffice?r.data?.candidates||[]:r.data||[];
      };
      const all=await page(0),total=Number(all[0]?.total_count||0);
      // Fetch bounded batches eagerly; no additional request depends on scrolling.
      for(let offset=size;offset<total;offset+=size*4){
        const offsets=Array.from({length:Math.min(4,Math.ceil((total-offset)/size))},(_,i)=>offset+i*size);
        all.push(...(await Promise.all(offsets.map(page))).flat());
        if(current!==version.current)return;
      }
      if(current===version.current)setRows([...new Map(all.map(row=>[row.id,row])).values()]);
    }catch(failure){console.error('Consulta do diretório público',failure);if(current===version.current)setError('Não foi possível consultar os cidadãos. Tente novamente.');}
    finally{if(current===version.current)setLoading(false);}
  },[open,roleKey,idsKey,executiveOffice]);
  useEffect(()=>{setRows([]);setSearch('');void load();return()=>{version.current++;};},[load]);
  usePublicProfileChanges(load,open);
  useDomainRealtime('executive-candidate-invitations',executiveOffice||'none',['minister_invitations','ministers'],load,open&&Boolean(executiveOffice));
  useEffect(()=>{let active=true;if(!value){setSelected(null);return;}void supabase.rpc('search_citizens',{p_ids:[value],p_limit:1}).then(r=>{if(active)setSelected(r.data?.[0]||null);});return()=>{active=false;};},[value]);
  const needle=search.trim().toLocaleLowerCase('pt-BR');
  const visible=rows.filter(row=>[row.full_name,row.username,row.x_username,row.x_handle].join(' ').toLocaleLowerCase('pt-BR').includes(needle));
  return <Popover open={open} onOpenChange={setOpen} modal><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled} className="h-auto min-h-11 w-full justify-between gap-2 text-left">{selected?<UserSelectOption user={selected} detail={`@${selected.username||selected.x_handle||'cidadão'} · ${selected.role}`}/>:label}<ChevronsUpDown className="h-4 w-4 shrink-0"/></Button></PopoverTrigger><PopoverContent align="start" className="w-[min(90vw,26rem)] p-2"><Command label="Buscar cidadão por nome ou username" shouldFilter={false}><CommandInput aria-label="Buscar cidadão por nome ou username" value={search} onValueChange={setSearch} maxLength={120} placeholder="Nome ou username"/><p aria-live="polite" className="px-2 py-2 text-xs text-muted-foreground">{loading?'Consultando cidadãos elegíveis…':`${search.trim() ? `${visible.length} resultados · ` : ''}${rows.length} cidadãos elegíveis`}</p><CommandList label="Cidadãos elegíveis" className="max-h-[min(16rem,45dvh)]">{visible.map(row=><CommandItem value={row.id} key={row.id} disabled={Boolean(row.invitation_pending)} onSelect={()=>{if(row.invitation_pending)return;setSelected(row);onChange(row.id);onSelect?.(row);setOpen(false);}} className="min-h-12 gap-2 p-2"><UserSelectOption user={row} detail={`@${row.username||row.x_handle||'cidadão'} · ${row.invitation_pending?'Aguardando resposta':row.role}`}/>{row.id===value&&<Check className="ml-auto h-4 w-4 shrink-0"/>}</CommandItem>)}{!loading&&!error&&!visible.length&&<p className="p-3 text-sm text-muted-foreground">Nenhum cidadão encontrado.</p>}</CommandList></Command>{loading&&<p role="status" className="flex items-center gap-2 p-2 text-xs"><Loader2 className="h-4 w-4 animate-spin"/>Preparando a lista completa…</p>}{error&&<div role="alert" className="p-2 text-sm text-destructive">{error}<Button type="button" variant="link" onClick={load}>Tentar novamente</Button></div>}</PopoverContent></Popover>;
}
