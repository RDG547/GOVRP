import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, FileCheck2, FileX2, Clock, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const StatusIcon = ({ status }) => {
  switch (status) {
    case 'Approved': return <FileCheck2 className="w-8 h-8 text-green-500" />;
    case 'Rejected': return <FileX2 className="w-8 h-8 text-red-500" />;
    case 'Pending': return <Clock className="w-8 h-8 text-yellow-500" />;
    default: return <HelpCircle className="w-8 h-8 text-gray-500" />;
  }
};

const getStatusVariant = (status) => {
  switch (status) {
    case 'Approved': return 'success';
    case 'Rejected': return 'destructive';
    case 'Pending': return 'secondary';
    default: return 'outline';
  }
};

const getStatusTranslation = (status) => {
    switch (status) {
        case 'Approved': return 'Aprovado';
        case 'Rejected': return 'Rejeitado';
        case 'Pending': return 'Pendente';
        default: return status;
    }
};

const TrackCandidacy = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [candidacies, setCandidacies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCandidacies = async () => {
      if (!user) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('candidates')
          .select('*, elections(name)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setCandidacies(data);
      } catch (error) {
        toast({ title: "Erro ao buscar candidaturas", description: error.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };
    fetchCandidacies();
  }, [user, toast]);

  return (
    <div className="mt-4">
      {loading ? (
        <div className="flex justify-center items-center py-16">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : candidacies.length > 0 ? (
        <div className="space-y-6">
          {candidacies.map(candidacy => (
            <Card key={candidacy.id} className="glass-effect">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{candidacy.political_name}</CardTitle>
                    <CardDescription>Para: {candidacy.elections.name}</CardDescription>
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
                          {candidacy.status === 'Pending' && 'Sua candidatura está em análise. Aguarde a avaliação do Tribunal Eleitoral.'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                          Registrado em: {new Date(candidacy.created_at).toLocaleDateString('pt-BR')}
                      </p>
                  </div>
                   <Button variant="outline" size="sm">Ver Detalhes</Button>
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
    </div>
  );
};

export default TrackCandidacy;