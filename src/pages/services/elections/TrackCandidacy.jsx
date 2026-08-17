import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, FileCheck2, FileX2, Clock, HelpCircle, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchWithSessionAuth } from '@/lib/apiAuth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'Approved': return <FileCheck2 className="w-8 h-8 text-green-500" />;
    case 'Rejected': return <FileX2 className="w-8 h-8 text-red-500" />;
    case 'Pendente': return <Clock className="w-8 h-8 text-yellow-500" />;
    default: return <HelpCircle className="w-8 h-8 text-gray-500" />;
  }
};

const getStatusVariant = (status) => {
  switch (status) {
    case 'Approved': return 'success';
    case 'Rejected': return 'destructive';
    case 'Pendente': return 'secondary';
    default: return 'outline';
  }
};

const getStatusTranslation = (status) => {
    switch (status) {
        case 'Approved': return 'Aprovado';
        case 'Rejected': return 'Rejeitado';
        case 'Pendente': return 'Pendente';
        default: return status;
    }
};

const TrackCandidacy = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [candidacies, setCandidacies] = useState([]);
  const [pendingViceRequests, setPendingViceRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelingTarget, setCancelingTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchCandidacies = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [candidaciesResponse, viceRequestsResponse] = await Promise.all([
        supabase
          .from('candidates')
          .select('*, elections(name), vice:profiles!candidates_vice_candidate_id_fkey(full_name)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('notifications')
          .select('id, content, created_at, metadata')
          .eq('user_id', user.id)
          .eq('type', 'vice_candidacy_request_sent')
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      if (candidaciesResponse.error) throw candidaciesResponse.error;
      if (viceRequestsResponse.error) throw viceRequestsResponse.error;

      setCandidacies(candidaciesResponse.data || []);
      setPendingViceRequests(
        (viceRequestsResponse.data || []).filter((notification) => {
          const status = `${notification?.metadata?.status || ''}`.toLowerCase();
          return status === 'pending' || status === 'rejected';
        })
      );
    } catch (error) {
      toast({ title: "Erro ao buscar candidaturas", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchCandidacies();
  }, [fetchCandidacies]);

  const handleCancelCandidacy = async () => {
    if (!cancelingTarget?.id) return;
    setIsDeleting(true);
    try {
      const response = await fetchWithSessionAuth('/api/elections/cancel-candidacy', {
        method: 'POST',
        body: JSON.stringify(
          cancelingTarget.type === 'tracker'
            ? { trackerNotificationId: cancelingTarget.id }
            : { candidateId: cancelingTarget.id }
        ),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível retirar a candidatura.');
      }

      toast({ title: "Candidatura cancelada", description: payload.message || "Sua candidatura foi removida com sucesso." });
      fetchCandidacies();
    } catch (error) {
      toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setCancelingTarget(null);
    }
  };

  return (
    <div className="mt-4">
      {loading ? (
        <div className="flex justify-center items-center py-16">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : candidacies.length > 0 || pendingViceRequests.length > 0 ? (
        <div className="space-y-6">
          {pendingViceRequests.map((request) => {
            const status = `${request?.metadata?.status || ''}`.toLowerCase();
            const isRejected = status === 'rejected';

            return (
              <Card key={request.id} className="glass-effect border-blue-500/20">
                <CardHeader>
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <CardTitle>{request.metadata?.political_name || 'Chapa presidencial em montagem'}</CardTitle>
                      <CardDescription>
                        Para: {request.metadata?.election_name || 'Eleição presidencial'}
                      </CardDescription>
                      <CardDescription>
                        Vice indicado: {request.metadata?.vice_candidate_name || 'Aguardando resposta'}
                      </CardDescription>
                    </div>
                    <Badge variant={isRejected ? 'destructive' : 'secondary'}>
                      {isRejected ? 'Vice recusou' : 'Aguardando vice'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col md:flex-row items-center gap-6">
                  <StatusIcon status={isRejected ? 'Rejected' : 'Pendente'} />
                  <div className="flex-grow">
                    <p className="text-sm text-muted-foreground">
                      {isRejected
                        ? 'O vice indicado recusou compor a chapa. Você já pode voltar ao formulário e escolher outro nome.'
                        : 'O convite foi enviado ao vice indicado. Assim que ele aceitar, a candidatura seguirá automaticamente para análise.'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Registrado em: {new Date(request.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  {!isRejected && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setCancelingTarget({ id: request.id, type: 'tracker', name: request.metadata?.political_name })}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Retirar
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {candidacies.map(candidacy => (
            <Card key={candidacy.id} className="glass-effect">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{candidacy.political_name}</CardTitle>
                    <CardDescription>Para: {candidacy.elections?.name}</CardDescription>
                    {candidacy.vice?.full_name ? (
                      <CardDescription>Vice na chapa: {candidacy.vice.full_name}</CardDescription>
                    ) : null}
                  </div>
                  <Badge variant={getStatusVariant(candidacy.status)}>{getStatusTranslation(candidacy.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col md:flex-row items-center gap-6">
                  <StatusIcon status={candidacy.status} />
                  <div className="flex-grow">
                      <p className="text-sm text-muted-foreground">
                          {candidacy.status === 'Approved' && 'Sua candidatura foi aprovada! Você está oficialmente concorrendo.'}
                          {candidacy.status === 'Rejected' && `Sua candidatura foi rejeitada. Motivo: ${candidacy.admin_feedback || 'Não especificado.'}`}
                          {candidacy.status === 'Pendente' && 'Sua candidatura está em análise. Aguarde a avaliação do Tribunal Eleitoral.'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                          Registrado em: {new Date(candidacy.created_at).toLocaleDateString('pt-BR')}
                      </p>
                  </div>
                  {(candidacy.status === 'Pendente' || candidacy.status === 'Approved') && (
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => setCancelingTarget({ id: candidacy.id, type: 'candidate', name: candidacy.political_name })}
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Cancelar
                    </Button>
                  )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 glass-effect rounded-lg">
          <h3 className="text-xl font-semibold">Nenhum registro encontrado</h3>
          <p className="text-muted-foreground mt-2">Você ainda não registrou nenhuma candidatura.</p>
        </div>
      )}

      <AlertDialog open={!!cancelingTarget} onOpenChange={() => setCancelingTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Candidatura</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza de que deseja cancelar esta candidatura? Esta ação é irreversível e você precisará registrar uma nova candidatura se desejar concorrer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelCandidacy} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
              {isDeleting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
              Confirmar Cancelamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TrackCandidacy;
