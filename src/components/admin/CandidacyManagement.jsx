import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Check, X, Info } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const CandidacyManagement = () => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [actionType, setActionType] = useState(''); // 'approve' or 'reject'
    const [feedback, setFeedback] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const { toast } = useToast();

    const fetchCandidates = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('candidates')
            .select(`
                id,
                status,
                political_name,
                campaign_photo_url,
                created_at,
                admin_feedback,
                election:elections(name),
                user:profiles!candidates_user_id_fkey(full_name, avatar_url),
                party:political_parties(name)
            `)
            .eq('status', 'Pendente')
            .order('created_at', { ascending: true });

        if (error) {
            toast({ title: "Erro ao buscar candidaturas", description: error.message, variant: "destructive" });
        } else {
            setCandidates(data);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchCandidates();
    }, [fetchCandidates]);

    const handleActionClick = (candidate, type) => {
        setSelectedCandidate(candidate);
        setActionType(type);
        setFeedback('');
        setIsActionModalOpen(true);
    };

    const handleConfirmAction = async () => {
        if (!selectedCandidate || !actionType) return;
        
        if(actionType === 'reject' && !feedback.trim()) {
            toast({ title: "Erro de validação", description: "O motivo da rejeição é obrigatório.", variant: "destructive" });
            return;
        }

        setIsProcessing(true);
        const rpcName = actionType === 'approve' ? 'approve_candidacy' : 'reject_candidacy';
        
        const { data, error } = await supabase.rpc(rpcName, {
            p_candidate_id: selectedCandidate.id,
            p_feedback: feedback
        });

        if (error || !data.success) {
            toast({ title: `Erro ao ${actionType === 'approve' ? 'aprovar' : 'rejeitar'}`, description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            fetchCandidates();
            setIsActionModalOpen(false);
        }
        setIsProcessing(false);
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Gerenciar Candidaturas Pendentes</h2>
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : candidates.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {candidates.map(candidate => (
                        <Card key={candidate.id} className="glass-effect">
                            <CardHeader className="flex flex-row items-start gap-4">
                                <Avatar className="h-16 w-16 border">
                                    <AvatarImage src={candidate.campaign_photo_url || candidate.user.avatar_url} alt={candidate.political_name} />
                                    <AvatarFallback>{candidate.political_name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1">
                                    <CardTitle>{candidate.political_name}</CardTitle>
                                    <CardDescription>{candidate.user.full_name}</CardDescription>
                                    <CardDescription>Eleição: {candidate.election.name}</CardDescription>
                                    <CardDescription>Partido: {candidate.party?.name || 'Independente'}</CardDescription>
                                </div>
                            </CardHeader>
                            <CardFooter className="gap-2">
                                <Button size="sm" variant="outline" className="flex-1"><Info className="w-4 h-4 mr-2" /> Ver Detalhes</Button>
                                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleActionClick(candidate, 'approve')}><Check className="w-4 h-4" /></Button>
                                <Button size="sm" variant="destructive" onClick={() => handleActionClick(candidate, 'reject')}><X className="w-4 h-4" /></Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            ) : (
                <div className="text-center py-10 glass-effect rounded-lg">
                    <h3 className="text-xl font-bold">Nenhuma candidatura pendente</h3>
                    <p className="text-muted-foreground mt-2">Tudo em ordem por aqui!</p>
                </div>
            )}
            
            <Dialog open={isActionModalOpen} onOpenChange={setIsActionModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{actionType === 'approve' ? 'Aprovar' : 'Rejeitar'} Candidatura</DialogTitle>
                        <DialogDescription>
                            Você está prestes a {actionType === 'approve' ? 'aprovar' : 'rejeitar'} a candidatura de {selectedCandidate?.political_name}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label htmlFor="feedback">{actionType === 'approve' ? 'Feedback (Opcional)' : 'Motivo da Rejeição (Obrigatório)'}</Label>
                        <Textarea 
                            id="feedback" 
                            value={feedback} 
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder={actionType === 'approve' ? 'Ex: Documentação verificada.' : 'Ex: Não cumpre os requisitos de Ficha Limpa.'}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsActionModalOpen(false)}>Cancelar</Button>
                        <Button 
                            onClick={handleConfirmAction} 
                            disabled={isProcessing} 
                            variant={actionType === 'reject' ? 'destructive' : 'default'}
                        >
                            {isProcessing && <Loader2 className="animate-spin mr-2 w-4 h-4"/>}
                            Confirmar {actionType === 'approve' ? 'Aprovação' : 'Rejeição'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CandidacyManagement;