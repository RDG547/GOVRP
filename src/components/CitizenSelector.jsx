import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import UserSelectOption from './UserSelectOption';

export default function CitizenSelector({ value, onChange, onSelect, roles, eligibleIds, executiveOffice, disabled, label = 'Selecionar cidadão' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const pageSize = executiveOffice ? 50 : 30;
  const roleKey = JSON.stringify(roles || null), idsKey = JSON.stringify(eligibleIds || null);
  const load = useCallback(async () => {
    if (!open) return;
    const sequence = ++request.current;
    setLoading(true);
    const response = executiveOffice ? await supabase.rpc('search_executive_candidates', { p_office_key: executiveOffice, p_query: search, p_offset: page * pageSize }) : await supabase.rpc('search_citizens', { p_search: search, p_roles: JSON.parse(roleKey), p_ids: JSON.parse(idsKey), p_limit: pageSize, p_offset: page * pageSize });
    const result = executiveOffice ? { ...response, data: response.data?.candidates } : response;
    if (sequence !== request.current) return;
    setRows(result.data || []);
    setError(result.error ? 'Não foi possível consultar os cidadãos.' : '');
    setLoading(false);
  }, [open, search, page, roleKey, idsKey, executiveOffice, pageSize]);
  useEffect(() => { const timer = setTimeout(load, 200); return () => { clearTimeout(timer); request.current += 1; }; }, [load]);
  usePublicProfileChanges(load);
  useEffect(() => {
    let active = true;
    if (!value) { setSelected(null); return; }
    void supabase.rpc('search_citizens', { p_ids: [value], p_limit: 1 }).then(result => { if (active) setSelected(result.data?.[0] || null); });
    return () => { active = false; };
  }, [value]);
  const choose = row => { setSelected(row); onChange(row.id); onSelect?.(row); setOpen(false); };
  return <Popover open={open} onOpenChange={setOpen} modal><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled} className="h-auto min-h-11 w-full justify-between gap-2 text-left">{selected ? <UserSelectOption user={selected} detail={`@${selected.username || selected.x_handle || 'cidadão'} · ${selected.role}`}/> : label}<ChevronsUpDown className="h-4 w-4 shrink-0"/></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(90vw,26rem)] p-2"><div className="mb-2 flex items-center gap-2"><Search className="h-4 w-4 shrink-0"/><Input aria-label="Buscar cidadão por nome ou username" value={search} placeholder="Nome ou username" onChange={event => { setSearch(event.target.value); setPage(0); }}/></div>
      <div aria-live="polite" className="min-h-8 text-xs text-muted-foreground">{loading ? <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin"/>Buscando…</span> : error || `${rows[0]?.total_count || 0} cidadãos elegíveis`}</div>
      <div role="listbox" aria-label="Cidadãos elegíveis" className="max-h-64 overflow-y-auto">{rows.map(row => <button type="button" role="option" aria-selected={row.id === value} key={row.id} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline focus-visible:outline-primary" onClick={() => choose(row)}><UserSelectOption user={row} detail={`@${row.username || row.x_handle || 'cidadão'} · ${row.role}`}/>{row.id === value && <Check className="h-4 w-4 shrink-0"/>}</button>)}</div>
      {error && <Button variant="link" onClick={load}>Tentar novamente</Button>}
      <div className="mt-2 flex items-center justify-between gap-2"><Button size="sm" variant="outline" disabled={!page || loading} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-xs">Página {page + 1}</span><Button size="sm" variant="outline" disabled={loading || (page + 1) * pageSize >= Number(rows[0]?.total_count || 0)} onClick={() => setPage(page + 1)}>Próxima</Button></div>
    </PopoverContent>
  </Popover>;
}
