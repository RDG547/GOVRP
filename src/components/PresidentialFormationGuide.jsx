import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, Check, Loader2, Users, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import CitizenSelector from '@/components/CitizenSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { roleIcon } from '@/lib/roleIcons';

export default function PresidentialFormationGuide() {
  const { user } = useAuth(); const { toast } = useToast(); const navigate = useNavigate();
  const [formation,setFormation]=useState(null);
  const [pendingRole,setPendingRole]=useState(true);const [selected,setSelected]=useState('');const [saving,setSaving]=useState(false);
  const [dismissed,setDismissed]=useState(null);
  const loadSequence = useRef(0);

  const load=useCallback(async()=>{
    const sequence = ++loadSequence.current;
    if(user?.role!=='Presidente'){setFormation(null);return;}
    const [f,roles]=await Promise.all([
      supabase.rpc('get_presidential_formation'),
      supabase.from('notifications').select('id').eq('user_id',user.id).in('type',['role_changed','election_candidacy_open','election_voting_open','election_result_published','institutional_result']).is('metadata->>popup_shown_at',null).limit(1),
    ]);
    if(sequence !== loadSequence.current) return;
    if(f.error||roles.error){console.warn('Formação de governo:',f.error||roles.error);return;}
    setFormation(current => JSON.stringify(current) === JSON.stringify(f.data) ? current : f.data);setPendingRole(Boolean(roles.data?.length));
  },[user?.id,user?.role]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('presidential-formation',user?.id,[{table:'notifications',filter:`user_id=eq.${user?.id}`},'ministers','system_settings','presidential_formation','profiles'],load,user?.role==='Presidente');
  const pendingMinistry=formation?.ministries?.find(item=>!item.holder_id);
  const pendingOffice=formation?.offices?.find(item=>!item.appointment?.user_id);
  const target=pendingMinistry||pendingOffice;
  const candidateOffice = pendingMinistry ? 'minister' : pendingOffice?.office_key;
  useEffect(() => { setSelected(''); }, [candidateOffice, pendingMinistry?.id]);
  const officeTitle=pendingMinistry?`Ministério: ${pendingMinistry.name}`:pendingOffice?.role_label;
  const Icon=pendingMinistry?Users:roleIcon(pendingOffice?.role_label);
  const appoint=async()=>{
    if(!selected||saving||!target)return;setSaving(true);
    try{
      const result=pendingMinistry?await supabase.rpc('appoint_minister',{p_user_id:selected,p_ministry:pendingMinistry.name}):await supabase.rpc('manage_executive_appointment',{p_office_key:pendingOffice.office_key,p_user_id:selected,p_note:'Formação inicial do Governo.'});
      if(result.error)throw result.error;if(result.data?.success===false)throw new Error(result.data.message);
      setSelected('');await load();toast({title:'Nomeação registrada',description:'A pessoa nomeada receberá sua notificação de cargo.'});
    }catch(error){toast({title:'Nomeação não concluída',description:error.message,variant:'destructive'});}finally{setSaving(false);}
  };
  // Completed formations loaded in a later session never reopen.
  const [started,setStarted]=useState(null);
  useEffect(()=>{if(formation&&!formation.completed_at)setStarted(formation.id);},[formation]);
  const open=Boolean(formation&&!pendingRole&&formation.id!==dismissed&&(!formation.completed_at||started===formation.id));
  return <Dialog open={open}><DialogContent className="max-w-xl [&>button]:hidden" onEscapeKeyDown={e=>e.preventDefault()} onInteractOutside={e=>e.preventDefault()}><DialogHeader><Landmark className="mx-auto h-10 w-10 text-primary"/><DialogTitle className="text-center">{target?'Forme seu Governo':'Governo formado'}</DialogTitle><DialogDescription className="text-center">{target?'Antes de começar, preencha o gabinete e as nomeações estratégicas. Seu progresso é salvo a cada nomeação.':'Sua equipe está pronta. Você pode começar a governar.'}</DialogDescription></DialogHeader>
    {target?<div className="space-y-4"><p className="text-sm text-muted-foreground">Faltam {formation.remaining} nomeações.</p><h2 className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5"/>{officeTitle}</h2><p className="text-sm">{pendingMinistry?'Ministros coordenam suas áreas e integram o gabinete presidencial.':pendingOffice.description}</p><CitizenSelector key={`${candidateOffice}:${pendingMinistry?.id || 'office'}`} label="Selecionar cidadão para nomeação" value={selected} onChange={setSelected} executiveOffice={candidateOffice} disabled={saving} /><Button className="w-full" disabled={!selected||saving} onClick={appoint}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Confirmar nomeação</Button></div>:<div><Button className="w-full" onClick={()=>{setDismissed(formation.id);navigate('/dashboard/president');}}><ArrowRight className="mr-2 h-4 w-4"/>Ir para o Painel Presidencial</Button></div>}
  </DialogContent></Dialog>;
}
