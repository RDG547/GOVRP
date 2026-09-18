import { formatDateTimeBR } from '@/lib/dateTime';
import PartyIdentity from '@/components/parliament/PartyIdentity';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { roleIcon } from '@/lib/roleIcons';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Crown, Loader2, Landmark, Check, ArrowRight } from 'lucide-react';
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
 const { user } = useAuth();
 const navigate = useNavigate();
 const { toast } = useToast();
 const [notification, setNotification] = useState(null);
 const request = useRef(0);
 const [saving, setSaving] = useState(false);
 const fetchPending = useCallback(async () => {
   const sequence = ++request.current;
   if (!user?.id) { setNotification(null); return; }
   const { data, error } = await supabase.from('notifications').select('id,content,link,created_at,type,metadata')
     .eq('user_id', user.id).in('type', ['role_changed','election_candidacy_open','election_voting_open','election_result_published','institutional_result']).is('metadata->>popup_shown_at', null).order('created_at').limit(1).maybeSingle();
   if (sequence !== request.current) return;
   if (error) console.error('Não foi possível consultar mudanças de cargo', error);
   else setNotification(data);
 }, [user?.id]);
 useEffect(() => { setNotification(null); void fetchPending(); return () => { request.current++; }; }, [fetchPending]);
 useDomainRealtime('role-notifications', user?.id, [{ table: 'notifications', filter: `user_id=eq.${user?.id}` }], fetchPending, Boolean(user?.id));
 const close = async (destination) => {
   if (!notification || saving) return;
   setSaving(true);
   try {
     const { error } = await supabase.rpc('acknowledge_role_change', { p_notification_id: notification.id });
     if (error) throw error;
     setNotification(null);
     if (destination) navigate(destination);
     await fetchPending();
   } catch (error) {
     console.error('Falha ao confirmar ciência do cargo', error);
     toast({ title: 'Não foi possível confirmar a leitura', description: 'Tente novamente.', variant: 'destructive' });
   } finally { setSaving(false); }
 };
 if (!user || !notification) return null;
 const institutional = notification.type !== 'role_changed';
 const info = institutional ? { title: ({election_candidacy_open:'Candidaturas abertas',election_voting_open:'Votação aberta',election_result_published:'Resultado eleitoral',institutional_result:'Decisão institucional'})[notification.type], role: notification.metadata?.election_name || notification.metadata?.outcome, loss: true, to: notification.link || '/services/elections', action: notification.type === 'institutional_result' ? 'Consultar decisão' : 'Ir ao Portal Eleitoral' } : roleEventPresentation(notification);
 const Icon = institutional ? Landmark : roleIcon(info.role);
 return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
   <DialogContent className="max-w-md text-center" onInteractOutside={event => event.preventDefault()}>
     <DialogHeader className="text-center sm:text-center">
       <Icon className={`mx-auto mb-3 h-10 w-10 ${info.loss ? 'text-slate-400' : 'text-amber-400'}`} />
       <DialogTitle>{info.title}</DialogTitle>
       <DialogDescription>{notification.content}</DialogDescription>
     </DialogHeader>
     <p className="text-2xl font-semibold">{info.role}</p>
     {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}
     {institutional && <div className="space-y-3 text-left text-sm">
       {notification.type === 'election_candidacy_open' && <><p>Candidaturas até {formatDateTimeBR(notification.metadata.candidacy_end_at)}.</p><p>Votação a partir de {formatDateTimeBR(notification.metadata.voting_start_at)}.</p></>}
       {notification.type === 'election_voting_open' && <p>Vote até {formatDateTimeBR(notification.metadata.voting_end_at)}. Horário de Brasília.</p>}
       {notification.type === 'election_result_published' && <div className="max-h-64 space-y-3 overflow-y-auto">{(notification.metadata.winners || []).map(winner => <div key={`${winner.id}:${winner.office_role}`} className="flex items-start gap-3 rounded-lg border p-3"><Avatar><AvatarImage src={winner.avatar_url}/><AvatarFallback>{winner.name?.charAt(0)}</AvatarFallback></Avatar><div className="min-w-0"><p className="break-words font-semibold">{winner.name}</p><p>{winner.office_role} · {winner.votes} votos</p><PartyIdentity party={winner.party}/></div></div>)}</div>}
       {notification.type === 'institutional_result' && <><p>Presidência envolvida: {notification.metadata.former_president?.full_name}.</p><p>{formatDateTimeBR(notification.metadata.occurred_at)}</p>{notification.metadata.successor && <p>Nova Presidência: <strong>{notification.metadata.successor.name || 'Sucessor institucional'}</strong>. As permissões foram atualizadas.</p>}</>}
     </div>}
     <div className="flex flex-col gap-2">
       <Button disabled={saving} onClick={() => close(info.to)}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}{info.action}</Button>
       <Button disabled={saving} variant="outline" onClick={() => close()}><Check className="mr-2 h-4 w-4" />Entendi</Button>
     </div>
   </DialogContent>
 </Dialog>;
}
