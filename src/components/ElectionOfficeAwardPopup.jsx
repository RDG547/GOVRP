import CelebrationBackdrop from '@/components/CelebrationBackdrop';
import ElectionResultSections from '@/components/elections/ElectionResultSections';
import CandidateIdentity from '@/components/elections/CandidateIdentity';
import { partyColor } from '@/lib/partyIdentity';
import { formatDateTimeBR } from '@/lib/dateTime';
import PartyIdentity from '@/components/parliament/PartyIdentity';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { roleIcon } from '@/lib/roleIcons';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Crown, Loader2, Landmark, Check, X, Clock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { roleEventPresentation } from '@/lib/roleEvents';

// Reuses the office popup for every official role transition, including removals.
export default function ElectionOfficeAwardPopup() {
 const { user, refreshUser } = useAuth();
 const navigate = useNavigate();
 const { toast } = useToast();
 const [notification, setNotification] = useState(null);
 const request = useRef(0);
 const acknowledging = useRef(false);
 const [saving, setSaving] = useState(false);
 const fetchPending = useCallback(async () => {
   if (acknowledging.current) return;
   const sequence = ++request.current;
   if (!user?.id) { setNotification(null); return; }
   let { data, error } = await supabase.rpc('get_pending_office_notification');
   if (sequence !== request.current) return;
   if (error) console.error('Não foi possível consultar mudanças de cargo', error);
   else {
     if(data?.type==='election_result_published'){const bundle=await supabase.rpc('get_election_result_bundle',{p_notification_id:data.id});if(sequence!==request.current)return;if(bundle.error){console.error('Resultados eleitorais',bundle.error);return;}data.bundle=bundle.data;}
     if (!data) {
       const result = await supabase.from('minister_invitations').select('*, ministry:government_ministries(name), inviter:profiles!invited_by(full_name)').eq('candidate_id', user.id).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at').limit(1).maybeSingle();
       if (sequence !== request.current) return;
       if (result.error) { console.error('Convites ministeriais', result.error); return; }
       if (result.data) data = { type: 'minister_invitation', id: result.data.id, invitation: result.data };
     }
     setNotification(data);
   }
 }, [user?.id]);
 useEffect(() => { setNotification(null); void fetchPending(); return () => { request.current++; }; }, [fetchPending]);
 useDomainRealtime('role-notifications', user?.id, [{ table: 'notifications', filter: `user_id=eq.${user?.id}` }, 'election_settlements', 'elections', { table: 'minister_invitations', filter: `candidate_id=eq.${user?.id}` }], fetchPending, Boolean(user?.id));
 const close = async (destination) => {
   if (!notification || saving) return;
   acknowledging.current = true;
   request.current++;
   setSaving(true);
   try {
     const { data, error } = await supabase.rpc('acknowledge_role_change', { p_notification_id: notification.id });
     if (error || !data) throw error || new Error('Confirmação não persistida.');
     setNotification(null);
     if (destination) navigate(destination);
     acknowledging.current = false;
     await fetchPending();
   } catch (error) {
     console.error('Falha ao confirmar ciência do cargo', error);
     toast({ title: 'Não foi possível confirmar a leitura', description: 'Tente novamente.', variant: 'destructive' });
   } finally { acknowledging.current = false; setSaving(false); }
 };
 const [now, setNow] = useState(Date.now());
 useEffect(() => {
   if (notification?.type !== 'minister_invitation') return undefined;
   const timer = setInterval(() => { setNow(Date.now()); if (Date.parse(notification.invitation.expires_at) <= Date.now()) void fetchPending(); }, 15000);
   return () => clearInterval(timer);
 }, [notification, fetchPending]);
 const respond = async accept => {
   if (saving || acknowledging.current) return;
   acknowledging.current = true; request.current++; setSaving(true);
   try {
     const result = await supabase.rpc('respond_minister_invitation', { p_invitation_id: notification.id, p_accept: accept });
     if (result.error) throw result.error;
     toast({ title: result.data.message, variant: result.data.success ? 'default' : 'destructive' });
     await refreshUser({ skipSync: true });
     setNotification(null);
   } catch (error) { console.error('Resposta ministerial', error); toast({ title: 'Não foi possível responder', description: error.message, variant: 'destructive' }); }
   finally { acknowledging.current = false; setSaving(false); await fetchPending(); }
 };
 if (!user || !notification) return null;
 return <OfficeNotificationView notification={notification} saving={saving} now={now} close={close} respond={respond}/>;
}
export function OfficeNotificationView({notification,saving=false,now=Date.now(),close=()=>{},respond=()=>{},preview=false}) {
 if(!notification)return null;
 if (notification.type === 'minister_invitation') {
   const invitation = notification.invitation;
   const minutes = Math.max(0, Math.ceil((Date.parse(invitation.expires_at) - now) / 60000));
   return <Dialog open onOpenChange={open=>{if(preview&&!open)close();}}><DialogContent className={`max-w-lg text-center ${preview?'':'[&>button]:hidden'}`} onEscapeKeyDown={e=>{if(!preview)e.preventDefault();}} onInteractOutside={e=>{if(!preview)e.preventDefault();}}><DialogHeader className="sm:text-center"><Landmark className="mx-auto mb-2 h-10 w-10 text-primary"/><DialogTitle>Convite para integrar o Governo</DialogTitle><DialogDescription>O Presidente {invitation.inviter?.full_name} convidou você para assumir o {invitation.ministry?.name}.</DialogDescription></DialogHeader><p className="flex items-center justify-center gap-2 text-sm"><Clock className="h-4 w-4"/>Expira em {Math.floor(minutes/60)}h {minutes%60}min</p><p className="text-sm text-muted-foreground">Suas funções e permissões serão atualizadas somente se você aceitar.</p><div className="flex flex-wrap justify-center gap-3"><Button variant="outline" disabled={saving} onClick={()=>respond(false)}><X className="mr-2 h-4 w-4"/>Recusar</Button><Button disabled={saving||minutes===0} onClick={()=>respond(true)}>{saving?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Check className="mr-2 h-4 w-4"/>}Aceitar</Button></div></DialogContent></Dialog>;
 }
 const institutional = notification.type !== 'role_changed';
 const info = institutional ? { title: ({election_candidacy_open:'Candidaturas abertas',election_voting_open:'Votação aberta',election_result_published:'Resultado eleitoral',institutional_result:'Decisão institucional'})[notification.type], role: notification.metadata?.election_name || notification.metadata?.outcome, loss: true, to: notification.link || '/services/elections', action: notification.type === 'institutional_result' ? 'Consultar decisão' : 'Ir ao Portal Eleitoral' } : roleEventPresentation(notification);
 const isResult=notification.type==='election_result_published';
 const resultSections=notification.bundle?.sections||[];
 const resultTitle=resultSections.length===1?`Resultado da ${resultSections[0].name}`:resultSections.length ? `Resultado das eleições: ${resultSections.map(s=>s.name).join(', ')}` : 'Resultado eleitoral';
 const Icon = institutional ? Landmark : roleIcon(info.role);
 return <><CelebrationBackdrop active={isResult&&resultSections.some(s=>s.winners?.length>0)}/><Dialog open onOpenChange={open => { if (!open) void close(); }}>
   <DialogContent className="z-[60] max-h-[90dvh] max-w-lg overflow-y-auto text-center" onInteractOutside={event => event.preventDefault()}>
     <DialogHeader className="text-center sm:text-center">
       <Icon className={`mx-auto mb-3 h-10 w-10 ${info.loss ? 'text-slate-400' : 'text-amber-400'}`} />
       <DialogTitle>{isResult?resultTitle:info.title}</DialogTitle>
       <DialogDescription>{isResult?'Conheça os representantes eleitos e suas respectivas chapas.':notification.content}</DialogDescription>
     </DialogHeader>
     {!isResult&&<p className="text-2xl font-semibold">{info.role}</p>}
     {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}
     {institutional && <div className="space-y-3 text-left text-sm">
       {notification.type === 'election_candidacy_open' && <><p>Candidaturas até {formatDateTimeBR(notification.metadata.candidacy_end_at)}.</p><p>Votação a partir de {formatDateTimeBR(notification.metadata.voting_start_at)}.</p></>}
       {notification.type === 'election_voting_open' && <p>Vote até {formatDateTimeBR(notification.metadata.voting_end_at)}. Horário de Brasília.</p>}
       {isResult&&(resultSections.length ? <ElectionResultSections sections={resultSections}/> : <p>Este resultado está no histórico eleitoral. Você pode fechar este aviso.</p>)}
       {notification.type === 'institutional_result' && <><p>Presidência envolvida: {notification.metadata.former_president?.full_name}.</p><p>{formatDateTimeBR(notification.metadata.occurred_at)}</p>{notification.metadata.successor && <p>Nova Presidência: <strong>{notification.metadata.successor.name || 'Sucessor institucional'}</strong>. As permissões foram atualizadas.</p>}</>}
     </div>}
     <div className="flex flex-col gap-2">
       {!isResult&&<Button disabled={saving} onClick={() => close(info.to)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}{info.action}</Button>}
       <Button disabled={saving} variant="outline" onClick={() => close()}><Check className="mr-2 h-4 w-4" />{isResult?'Fechar':'Entendi'}</Button>
     </div>
   </DialogContent>
 </Dialog></>;
}
