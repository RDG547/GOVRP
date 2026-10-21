import InstitutionalInvitationCard from '@/components/InstitutionalInvitationCard';
import {useInvitations} from '@/contexts/InvitationsContext';
import {usePopupSlot,PopupQueueActions} from '@/contexts/PopupQueueContext';
import { formatLocaleBR } from '@/lib/dateTime';
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Vote, XCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { fetchWithSessionAuth } from '@/lib/apiAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const ViceCandidacyDecisionPopup = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pendingInvitation, setPendingInvitation] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {data,refresh}=useInvitations();
  const fetchPendingInvitation=useCallback(async()=>{const next=await refresh();const item=next?.items?.find(i=>i.kind==='vice'&&i.status==='pending'&&!i.popup_deferred_at);setPendingInvitation(item?{...item,metadata:{...item.metadata,candidate_name:item.inviter,expires_at:item.expires_at},server_now:next.server_now}:null);},[refresh]);
  useEffect(()=>{const item=data?.items?.find(i=>i.kind==='vice'&&i.status==='pending'&&!i.popup_deferred_at);setPendingInvitation(item?{...item,metadata:{...item.metadata,candidate_name:item.inviter,expires_at:item.expires_at},server_now:data.server_now}:null);},[data]);
  const handleDecision = async (accepted) => {
    if (!pendingInvitation?.id) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetchWithSessionAuth('/api/elections/respond-vice-invitation', {
        method: 'POST',
        body: JSON.stringify({
          notificationId: pendingInvitation.id,
          accepted,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível responder ao convite da chapa.');
      }

      toast({
        title: accepted ? 'Chapa aceita' : 'Chapa recusada',
        description: payload.message,
      });
      setPendingInvitation(null);
      fetchPendingInvitation();
    } catch (error) {
      toast({
        title: 'Erro ao responder convite',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const slot=usePopupSlot(pendingInvitation?.id?`vice:${pendingInvitation.id}`:null,{priority:15});
  const later=async()=>{if(!pendingInvitation||isSubmitting)return;const r=await supabase.rpc('defer_invitation_popup',{p_notification_id:pendingInvitation.id});if(!r.error)setPendingInvitation(null);};
  if (!slot || !user?.id || !pendingInvitation) {
    return null;
  }

  return <ViceCandidacyDecisionView onExpire={fetchPendingInvitation} onLater={later} pendingInvitation={pendingInvitation} isSubmitting={isSubmitting} onDecision={handleDecision} />;
};

export function ViceCandidacyDecisionView({pendingInvitation,isSubmitting=false,onDecision,onLater,onExpire}){
 const metadata=pendingInvitation.metadata||{};
 return <InstitutionalInvitationCard title="Convite para Vice-Presidência" description="Você foi convidado para compor uma chapa presidencial. Sua resposta define se a candidatura seguirá para análise." expiresAt={pendingInvitation.expires_at||metadata.expires_at} serverNow={pendingInvitation.server_now} busy={isSubmitting} onExpire={onExpire} onDecision={onDecision} onLater={onLater}><div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4"><p className="font-semibold">{metadata.candidate_name||'Candidato presidencial'}</p><p className="text-sm text-muted-foreground">{pendingInvitation.office||metadata.election_name||'Eleição presidencial'}</p><p className="text-xs text-muted-foreground">Convite recebido em: {formatLocaleBR(new Date(pendingInvitation.created_at),'toLocaleString','pt-BR')}</p></div></InstitutionalInvitationCard>;
}

export default ViceCandidacyDecisionPopup;
