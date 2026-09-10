import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, Check, Loader2, Users, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { roleIcon } from '@/lib/roleIcons';

export default function PresidentialFormationGuide() {
  const { user } = useAuth(); const { toast } = useToast(); const navigate = useNavigate();
  const [formation,setFormation]=useState(null);const [candidates,setCandidates]=useState([]);
  const [pendingRole,setPendingRole]=useState(true);const [selected,setSelected]=useState('');const [saving,setSaving]=useState(false);
  const [dismissed,setDismissed]=useState(null);
  const [query,setQuery]=useState('');const [offset,setOffset]=useState(0);const [hasMore,setHasMore]=useState(false);const [searching,setSearching]=useState(false);const [searchError,setSearchError]=useState('');
  const load=useCallback(async()=>{
    if(user?.role!=='Presidente'){setFormation(null);return;}
    const [f,roles]=await Promise.all([
      supabase.rpc('get_presidential_formation'),
      supabase.from('notifications').select('id').eq('user_id',user.id).eq('type','role_changed').is('metadata->>popup_shown_at',null).limit(1),
    ]);
    if(f.error||roles.error){console.warn('Formação de governo:',f.error||roles.error);return;}
    setFormation(f.data);setPendingRole(Boolean(roles.data?.length));
  },[user?.id,user?.role]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('presidential-formation',user?.id,[{table:'notifications',filter:`user_id=eq.${user?.id}`},'ministers','system_settings','presidential_formation','profiles'],load,user?.role==='Presidente');
  const pendingMinistry=formation?.ministries?.find(item=>!item.holder_id);
  const pendingOffice=formation?.offices?.find(item=>!item.appointment?.user_id);
  const target=pendingMinistry||pendingOffice;
  const candidateOffice = pendingMinistry ? 'minister' : pendingOffice?.office_key;
  useLayoutEffect(() => { setOffset(0);setSelected('');setCandidates([]);setSearching(true); }, [candidateOffice, pendingMinistry?.id, query]);
  useEffect(() => {
    if (!candidateOffice || user?.role !== 'Presidente') return;
    let active = true;setSearching(true);
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_executive_candidates', { p_office_key: candidateOffice, p_query: query, p_offset: offset });
      if (!active) return;
      setSearching(false);
      if (error) { console.error('Consulta de candidatos', error); setSearchError('Não foi possível consultar os cidadãos. Tente novamente.'); }
      else { setCandidates(data.candidates);setHasMore(data.has_more);setSearchError(''); }
    }, 200);
    return () => { active = false;clearTimeout(timer); };
  }, [candidateOffice, query, offset, formation, user?.role]);
  const officeTitle=pendingMinistry?`Ministério: ${pendingMinistry.name}`:pendingOffice?.role_label;
  const Icon=pendingMinistry?Users:roleIcon(pendingOffice?.role_label);
  const appoint=async()=>{
    if(!selected||saving||!target)return;setSaving(true);
    try{
      const result=pendingMinistry?await supabase.rpc('appoint_minister',{p_user_id:selected,p_ministry:pendingMinistry.name}):await supabase.rpc('manage_executive_appointment',{p_office_key:pendingOffice.office_key,p_user_id:selected,p_note:'Formação inicial do Governo.'});
      if(result.error)throw result.error;if(result.data?.success===false)throw new Error(result.data.message);
      setSelected('');setCandidates([]);await load();toast({title:'Nomeação registrada',description:'A pessoa nomeada receberá sua notificação de cargo.'});
    }catch(error){toast({title:'Nomeação não concluída',description:error.message,variant:'destructive'});}finally{setSaving(false);}
  };
  // Completed formations loaded in a later session never reopen.
  const [started,setStarted]=useState(null);
  useEffect(()=>{if(formation&&!formation.completed_at)setStarted(formation.id);},[formation]);
  const open=Boolean(formation&&!pendingRole&&formation.id!==dismissed&&(!formation.completed_at||started===formation.id));
  return <Dialog open={open}><DialogContent className="z-[80] max-w-xl [&>button]:hidden" onEscapeKeyDown={e=>e.preventDefault()} onInteractOutside={e=>e.preventDefault()}><DialogHeader><Landmark className="mx-auto h-10 w-10 text-primary"/><DialogTitle className="text-center">{target?'Forme seu Governo':'Governo formado'}</DialogTitle><DialogDescription className="text-center">{target?'Antes de começar, preencha o gabinete e as nomeações estratégicas. Seu progresso é salvo a cada nomeação.':'Sua equipe está pronta. Você pode começar a governar.'}</DialogDescription></DialogHeader>
    {target?<div className="space-y-4"><p className="text-sm text-muted-foreground">Faltam {formation.remaining} nomeações.</p><h2 className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5"/>{officeTitle}</h2><p className="text-sm">{pendingMinistry?'Ministros coordenam suas áreas e integram o gabinete presidencial.':pendingOffice.description}</p><Input aria-label="Buscar cidadão para nomeação" placeholder="Buscar por nome ou @username" value={query} onChange={e=>setQuery(e.target.value)} />{searchError&&<p role="alert" className="text-sm text-destructive">{searchError}</p>}<div role="radiogroup" aria-label="Cidadão a nomear" aria-busy={searching} className="max-h-52 overflow-y-auto space-y-1">{candidates.map(candidate=><button role="radio" aria-checked={selected===candidate.id} type="button" disabled={searching||saving} key={candidate.id} onClick={()=>setSelected(candidate.id)} className={`flex w-full items-center gap-3 rounded-lg border p-2 text-left focus-visible:ring-2 focus-visible:ring-primary ${selected===candidate.id?'border-primary bg-primary/10':'border-transparent hover:bg-secondary'}`}><img src={candidate.avatar_url||'/icon-192x192.png'} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover"/><span className="min-w-0"><span className="block break-words font-medium">{candidate.full_name}</span><span className="block text-xs text-muted-foreground break-words">@{candidate.username} · {candidate.role}</span></span>{selected===candidate.id&&<Check className="ml-auto h-4 w-4 shrink-0"/>}</button>)}</div><div className="flex justify-between gap-2"><Button size="sm" variant="outline" disabled={offset===0||searching} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Anterior</Button><Button size="sm" variant="outline" disabled={!hasMore||searching} onClick={()=>setOffset(value=>value+50)}>Mais cidadãos</Button></div>{!candidates.length&&<p role="status">Não há cidadãos elegíveis disponíveis. As nomeações serão retomadas quando houver candidatos.</p>}<Button className="w-full" disabled={!selected||saving||searching} onClick={appoint}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar nomeação</Button></div>:<div><Button className="w-full" onClick={()=>{setDismissed(formation.id);navigate('/dashboard/president');}}><ArrowRight className="mr-2 h-4 w-4"/>Ir para o Painel Presidencial</Button></div>}
  </DialogContent></Dialog>;
}
