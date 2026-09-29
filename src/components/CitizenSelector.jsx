import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem } from '@/components/ui/command';
import UserSelectOption from './UserSelectOption';

export default function CitizenSelector({ value, onChange, onSelect, roles, eligibleIds, executiveOffice, disabled, label = 'Selecionar cidadão' }) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState('');
  const [rows, setRows] = useState([]), [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [total, setTotal] = useState(0);
  const request = useRef(0), busy = useRef(false), loaded = useRef(0), more = useRef(false), list = useRef(null);
  const pageSize = executiveOffice ? 50 : 30;
  const roleKey = JSON.stringify(roles || null), idsKey = JSON.stringify(eligibleIds || null);
  const fetchPage = useCallback(async (offset) => {
    const response = executiveOffice
      ? await supabase.rpc('search_executive_candidates', { p_office_key: executiveOffice, p_query: search, p_offset: offset })
      : await supabase.rpc('search_citizens', { p_search: search, p_roles: JSON.parse(roleKey), p_ids: JSON.parse(idsKey), p_limit: pageSize, p_offset: offset });
    if (response.error) throw response.error;
    return executiveOffice ? response.data?.candidates || [] : response.data || [];
  }, [search, roleKey, idsKey, executiveOffice, pageSize]);
  const load = useCallback(async (append = false) => {
    if (!open || (append && (busy.current || !more.current))) return;
    const version = ++request.current;
    busy.current = true; setLoading(true); setError('');
    const offset = append ? loaded.current : 0;
    try {
      // A directory event refreshes the already visible rows without collapsing the list.
      const pages = append ? 1 : Math.max(1, Math.ceil(loaded.current / pageSize));
      const result = (await Promise.all(Array.from({length:pages}, (_,i)=>fetchPage(offset+i*pageSize)))).flat();
      if (version !== request.current) return;
      const count = Number(result[0]?.total_count || 0);
      loaded.current = offset + result.length; more.current = loaded.current < count;
      setTotal(count); setRows(current => append ? [...new Map([...current,...result].map(row=>[row.id,row])).values()] : result);
    } catch (failure) {
      console.error('Consulta do diretório público', failure);
      if (version === request.current) setError('Não foi possível consultar os cidadãos. Tente novamente.');
    } finally { if (version === request.current) { busy.current=false; setLoading(false); } }
  }, [open, fetchPage, pageSize]);
  useEffect(() => {
    loaded.current=0; more.current=false; setRows([]); setTotal(0); busy.current=false;
    if (list.current) list.current.scrollTop=0;
    const timer=setTimeout(()=>load(),200);
    return ()=>{ clearTimeout(timer); request.current++; };
  }, [load]);
  const refresh = useCallback(()=>load(false),[load]);
  usePublicProfileChanges(refresh, open);
  useEffect(() => {
    let active=true;
    if (!value) { setSelected(null); return; }
    void supabase.rpc('search_citizens',{p_ids:[value],p_limit:1}).then(result=>{if(active)setSelected(result.data?.[0]||null);});
    return ()=>{active=false;};
  },[value]);
  const choose = row => {setSelected(row);onChange(row.id);onSelect?.(row);setOpen(false);};
  return <Popover open={open} onOpenChange={setOpen} modal>
    <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled} className="h-auto min-h-11 w-full justify-between gap-2 text-left">{selected?<UserSelectOption user={selected} detail={`@${selected.username||selected.x_handle||'cidadão'} · ${selected.role}`}/>:label}<ChevronsUpDown className="h-4 w-4 shrink-0"/></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(90vw,26rem)] p-2">
      <Command shouldFilter={false}><CommandInput aria-label="Buscar cidadão por nome ou username" value={search} onValueChange={setSearch} maxLength={120} placeholder="Nome ou username"/>
        <p aria-live="polite" className="px-2 py-2 text-xs text-muted-foreground">{total} cidadãos elegíveis{rows.length>0&&` · ${rows.length} carregados`}</p>
        <CommandList ref={list} label="Cidadãos elegíveis" className="max-h-[min(16rem,45dvh)]" onScroll={event=>{const el=event.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight<64)void load(true);}}>
          {rows.map(row=><CommandItem value={row.id} key={row.id} onSelect={()=>choose(row)} className="min-h-12 gap-2 p-2"><UserSelectOption user={row} detail={`@${row.username||row.x_handle||'cidadão'} · ${row.role}`}/>{row.id===value&&<Check className="ml-auto h-4 w-4 shrink-0"/>}</CommandItem>)}
          {!loading&&!error&&!rows.length&&<p className="p-3 text-sm text-muted-foreground">Nenhum cidadão encontrado.</p>}
        </CommandList>
      </Command>
      {loading&&<p role="status" className="flex items-center gap-2 p-2 text-xs"><Loader2 className="h-4 w-4 animate-spin"/>Buscando…</p>}
      {error&&<div role="alert" className="p-2 text-sm text-destructive">{error}<Button type="button" variant="link" onClick={()=>load(loaded.current>0)}>Tentar novamente</Button></div>}
    </PopoverContent>
  </Popover>;
}
