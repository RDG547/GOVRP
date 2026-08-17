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

  const fetchPendingInvitation = useCallback(async () => {
    if (!user?.id) {
      setPendingInvitation(null);
      return;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, content, created_at, metadata')
      .eq('user_id', user.id)
      .eq('type', 'vice_candidacy_invitation')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Erro ao buscar convite de vice:', error);
      return;
    }

    const nextPendingInvitation =
      (data || []).find((notification) => `${notification?.metadata?.status || ''}`.toLowerCase() === 'pending') ||
      null;

    setPendingInvitation(nextPendingInvitation);
  }, [user?.id]);

  useEffect(() => {
    fetchPendingInvitation();
  }, [fetchPendingInvitation]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const channel = supabase
      .channel(`vice-candidacy-invitations:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (
            payload.new?.type === 'vice_candidacy_invitation' ||
            payload.old?.type === 'vice_candidacy_invitation'
          ) {
            fetchPendingInvitation();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingInvitation, user?.id]);

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

  if (!user?.id || !pendingInvitation) {
    return null;
  }

  const metadata = pendingInvitation.metadata || {};

  return (
    <div className="fixed bottom-6 right-4 z-[90] w-[calc(100vw-2rem)] max-w-md">
      <Card className="border-blue-500/30 bg-slate-950/95 shadow-2xl backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Vote className="h-5 w-5 text-blue-300" />
            Convite para Vice-Presidência
          </CardTitle>
          <CardDescription>
            Você foi convidado para compor uma chapa presidencial. Sua resposta define se a candidatura seguirá para análise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
            <p className="font-semibold text-foreground">
              {metadata.candidate_name || 'Candidato presidencial'}
            </p>
            <p className="text-sm text-muted-foreground">
              Eleição: {metadata.election_name || 'Eleição presidencial'}
            </p>
            <p className="text-sm text-muted-foreground">
              Nome político: {metadata.political_name || 'Não informado'}
            </p>
            <p className="text-xs text-muted-foreground">
              Convite recebido em: {new Date(pendingInvitation.created_at).toLocaleString('pt-BR')}
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 border-red-500/40 text-red-200 hover:bg-red-500/10"
              onClick={() => handleDecision(false)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
              Recusar
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => handleDecision(true)}
              disabled={isSubmitting}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Aceitar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ViceCandidacyDecisionPopup;
