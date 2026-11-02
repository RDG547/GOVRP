import InstitutionalInvitationCard from '@/components/InstitutionalInvitationCard';
import {notificationText} from '@/lib/notificationPresentation';
import {useInvitations} from '@/contexts/InvitationsContext';
import {usePopupSlot,PopupQueueActions} from '@/contexts/PopupQueueContext';
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
 const {refresh:refreshInvitations}=useInvitations();
 const navigate = useNavigate();
 const { toast } = useToast();
 const [notification, setNotification] = useState(null);
 const request = useRef(0);
 const acknowledging = useRef(false);
 const [saving, setSaving] = useState(false);
 const clockOffset=useRef(0);
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
       const result=await refreshInvitations().then(data=>({data})).catch(error=>({error}));
       if(result.data?.server_now)clockOffset.current=Date.parse(result.data.server_now)-Date.now();
       if (sequence !== request.current) return;
       if (result.error) { console.error('Convites ministeriais', result.error); return; }
       const item=result.data?.items?.find(item=>item.kind==='government'&&item.status==='pending'&&!item.popup_deferred_at);
       if(item)data={type:'minister_invitation',id:item.id,invitation:{...item,ministry:{name:item.office},inviter:{full_name:item.inviter}}};
     }
     setNotification(data);
   }
 }, [user?.id,refreshInvitations]);
 useEffect(() => { setNotification(null); void fetchPending(); return () => { request.current++; }; }, [fetchPending]);
 // Electoral database triggers already create one notification per citizen.
 // Avoid subscribing every user to every global election row and then asking
 // the database again when another citizen's election changes.
 useDomainRealtime('role-notifications', user?.id, [
   { table: 'notifications', filter: `user_id=eq.${user?.id}` },
   { table: 'minister_invitations', filter: `candidate_id=eq.${user?.id}` },
 ], fetchPending, Boolean(user?.id));
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
 // Countdown updates are entirely local. They must never poll the API.
 useEffect(() => {
   if (notification?.type !== 'minister_invitation') return undefined;
   const timer = setInterval(() => setNow(Date.now()+clockOffset.current), 1000);
   return () => clearInterval(timer);
 }, [notification?.type, notification?.id]);
 // One reconciliation after the deadline. Further changes arrive over Realtime
 // or are recovered once on reconnect; an expired popup cannot launch one
 // database request every second while waiting for server-side settlement.
 useEffect(() => {
   if (notification?.type !== 'minister_invitation' || !notification?.invitation?.expires_at) return undefined;
   const deadline = Date.parse(notification.invitation.expires_at);
   if (!Number.isFinite(deadline)) return undefined;
   const delay = Math.min(2147483647, Math.max(0, deadline - Date.now() - clockOffset.current) + 1000);
   const timer = setTimeout(() => void fetchPending(), delay);
   return () => clearTimeout(timer);
 }, [notification?.id, notification?.type, notification?.invitation?.expires_at, fetchPending]);
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
 const slot=usePopupSlot(notification?.id?`office:${notification.id}`:null,{priority:notification?.type==='minister_invitation'?20:10,dismissible:notification?.type!=='minister_invitation',onDismiss:()=>close()});
 const later=async()=>{if(!notification||saving)return;const r=await supabase.rpc('defer_government_invitation_popup',{p_invitation_id:notification.id});if(!r.error){setNotification(null);await fetchPending();}};
 if (!slot || !user || !notification) return null;
 return <OfficeNotificationView notification={notification} saving={saving} now={now} later={later} close={close} respond={respond}/>;
}
export function OfficeNotificationView({notification,saving=false,now=Date.now(),close=()=>{},respond=()=>{},later,preview=false}) {
 if(!notification)return null;
 if (notification.type === 'minister_invitation') {
   const invitation = notification.invitation;
   return <InstitutionalInvitationCard title="Convite para integrar o Governo" description={`O Presidente ${invitation.inviter?.full_name||''} convidou você para assumir o ${invitation.ministry?.name||invitation.office||'cargo público'}.`} expiresAt={invitation.expires_at} serverNow={new Date(now).toISOString()} busy={saving} onDecision={respond} onLater={later|| (preview?close:undefined)}><p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm">Suas funções e permissões serão atualizadas somente se você aceitar.</p></InstitutionalInvitationCard>;
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
       <DialogDescription>{isResult?'Conheça os representantes eleitos e suas respectivas chapas.':notificationText(notification)}</DialogDescription>
     </DialogHeader><PopupQueueActions/>
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
