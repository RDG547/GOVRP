import {usePopupSlot,PopupQueueActions} from '@/contexts/PopupQueueContext';
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
  const [dismissed,setDismissed]=useState(null);const [countdown,setCountdown]=useState(10);
  const loadSequence = useRef(0);
  const canGovern = user?.role === 'Presidente' || Boolean(user?.effective_roles?.includes('Presidente'));
  const cabinetPending = formation?.government?.cabinet_decision === 'pending';

  const load=useCallback(async()=>{
    const sequence = ++loadSequence.current;
    if(!canGovern){setFormation(null);return;}
    const [f,roles]=await Promise.all([
      supabase.rpc('get_presidential_formation'),
      supabase.rpc('get_pending_office_notification'),
    ]);
    if(sequence !== loadSequence.current) return;
    if(f.error||roles.error){console.warn('Formação de governo:',f.error||roles.error);return;}
    setFormation(current => JSON.stringify(current) === JSON.stringify(f.data) ? current : f.data);setPendingRole(Boolean(roles.data?.id));
  },[user?.id,canGovern]);
  useEffect(()=>{void load();},[load]);
  useDomainRealtime('presidential-formation',user?.id,[{table:'notifications',filter:`user_id=eq.${user?.id}`},'ministers','system_settings','presidential_formation','profiles','government_terms','minister_invitations'],load,canGovern);
  const pendingMinistry=formation?.ministries?.find(item=>!item.holder_id&&!(item.invitation?.status==='pending'&&Date.parse(item.invitation.expires_at)>Date.now()));
  const pendingOffice=formation?.offices?.find(item=>!item.appointment?.user_id&&!(item.invitation?.status==='pending'||(item.invitation?.status==='accepted'&&['hearing','voting'].includes(item.invitation?.institutional_stage))));
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
      setSelected('');await load();toast({title:'Convite enviado',description:'O cidadão tem 24 horas reais para aceitar ou recusar.'});
    }catch(error){toast({title:'Nomeação não concluída',description:error.message,variant:'destructive'});}finally{setSaving(false);}
  };
  const chooseCabinet = async choice => {
    setSaving(true);
    const result = await supabase.rpc('choose_government_cabinet', { p_choice: choice });
    if (result.error) toast({ title: 'Não foi possível registrar a escolha', description: 'Tente novamente.', variant: 'destructive' });
    else { await load(); toast({ title: choice === 'keep' ? 'Equipe ministerial mantida' : 'Forme sua nova equipe' }); }
    setSaving(false);
  };
  const complete=async()=>{setSaving(true);const result=await supabase.rpc('complete_presidential_formation');setSaving(false);if(result.error){toast({title:'Não foi possível concluir',description:result.error.message,variant:'destructive'});return;}setDismissed(`${formation.id}:${formation.revision || "initial"}`);navigate('/dashboard/president');};
  // Completed formations loaded in a later session never reopen.
  const open=Boolean(formation&&!pendingRole&&`${formation.id}:${formation.revision || "initial"}`!==dismissed&&!formation.completed_at);
  const waitingKey=open&&!cabinetPending&&!target&&formation?.awaiting?`${formation.id}:${formation.revision||'initial'}`:null;
  useEffect(()=>{
    if(!waitingKey)return;
    const deadline=Date.now()+10000;setCountdown(10);
    const timer=setInterval(()=>{const remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));setCountdown(remaining);if(!remaining){setDismissed(waitingKey);clearInterval(timer);}},200);
    return()=>clearInterval(timer);
  },[waitingKey]);
  const slot=usePopupSlot(open?`formation:${formation?.id}`:null,{priority:30});
  return <Dialog open={open&&slot}><DialogContent className="max-w-xl [&>button]:hidden" onEscapeKeyDown={e=>e.preventDefault()} onInteractOutside={e=>e.preventDefault()}><DialogHeader><Landmark className="mx-auto h-10 w-10 text-primary"/><DialogTitle className="text-center">{cabinetPending?'Como deseja conduzir o Governo?':target?'Forme seu Governo':formation?.awaiting?'Aguardando sua equipe':'Governo formado'}</DialogTitle><DialogDescription className="text-center">{cabinetPending?'Você assumiu por sucessão. Escolha manter a equipe atual ou formar um novo gabinete.':target?'Convide os ministros e preencha as nomeações estratégicas. Cada etapa é salva automaticamente.':formation?.awaiting?`${formation.awaiting} convite(s) aguardam resposta. Você será avisado sobre aceites, recusas e expirações.`:'Sua equipe está pronta. Você pode começar a governar.'}</DialogDescription></DialogHeader><PopupQueueActions/>
    {cabinetPending?<div className="grid gap-3"><Button disabled={saving} onClick={()=>chooseCabinet('keep')}><Users className="mr-2 h-4 w-4"/>Manter atual equipe ministerial</Button><Button variant="outline" disabled={saving} onClick={()=>chooseCabinet('reform')}><Landmark className="mr-2 h-4 w-4"/>Formar nova equipe ministerial</Button></div>:target?<div className="space-y-4"><p className="text-sm text-muted-foreground">{formation.remaining} cargos ainda não preenchidos · {formation.awaiting || 0} convites pendentes.</p><h2 className="flex items-center gap-2 font-semibold"><Icon className="h-5 w-5"/>{officeTitle}</h2><p className="text-sm">{pendingMinistry?'Ministros coordenam suas áreas e integram o gabinete presidencial.':pendingOffice.description}</p><CitizenSelector key={`${candidateOffice}:${pendingMinistry?.id || 'office'}`} label="Selecionar cidadão" value={selected} onChange={setSelected} executiveOffice={candidateOffice} disabled={saving} /><Button className="w-full" disabled={!selected||saving} onClick={appoint}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Enviar convite</Button></div>:formation?.awaiting?<div className="space-y-3 text-center"><p role="status">Esta janela fechará em {countdown} segundos.</p><progress aria-label="Tempo para fechar" max="10" value={countdown} className="h-2 w-full accent-primary"/><Button onClick={()=>setDismissed(`${formation.id}:${formation.revision || "initial"}`)}>Continuar enquanto aguardo</Button></div>:<div><Button className="w-full" disabled={saving} onClick={complete}><ArrowRight className="mr-2 h-4 w-4"/>Concluir formação do Governo</Button></div>}
  </DialogContent></Dialog>;
}
