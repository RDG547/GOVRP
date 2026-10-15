import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { readySession } from '@/lib/apiAuth';
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Check, X, Edit, Trash2, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const statusConfig = {
    Pendente: { label: 'Pendente', variant: 'secondary', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
    Approved: { label: 'Aprovado', variant: 'default', color: 'bg-green-500/20 text-green-300 border-green-500/30' },
    Rejected: { label: 'Rejeitado', variant: 'destructive', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

const CandidacyManagement = () => {
    const { user, loading: authLoading } = useAuth();
    const [candidates, setCandidates] = useState([]);
    const [elections, setElections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);
    const [actionType, setActionType] = useState(''); // 'approve', 'reject', 'edit', 'delete'
    const [feedback, setFeedback] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterElection, setFilterElection] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [editForm, setEditForm] = useState({ political_name: '', bio: '', proposals: '' });
    const [expandedElectionIds, setExpandedElectionIds] = useState([]);

    const { toast } = useToast();

    const fetchCandidates = useCallback(async () => {
        let query = supabase
            .from('candidates')
            .select(`
                id,
                status,
                political_name,
                campaign_photo_url,
                bio,
                proposals,
                created_at,
                admin_feedback,
                user_id,
                election_id,
                election:elections(id, name),
                user:profiles!candidates_user_id_fkey(full_name, avatar_url),
                vice:profiles!candidates_vice_candidate_id_fkey(full_name, avatar_url),
                party:political_parties(name, acronym)
            `)
            .is('removed_at', null)
            .order('created_at', { ascending: false });

        if (filterStatus !== 'all') {
            query = query.eq('status', filterStatus);
        }

        const { data, error } = await query;

        if (error) {
            toast({ title: "Erro ao buscar candidaturas", description: error.message, variant: "destructive" });
        } else {
            setCandidates(data);
        }
        setLoading(false);
    }, [toast, filterStatus]);

    useEffect(() => {
        fetchCandidates();
    }, [fetchCandidates]);

    useEffect(() => {
        const fetchElections = async () => {
            const { data, error } = await supabase
                .from('elections')
                .select('id, name, created_at')
                .order('created_at', { ascending: false });

            if (error) {
                toast({ title: "Erro ao buscar eleições", description: error.message, variant: "destructive" });
            } else {
                setElections(data || []);
            }
        };

        fetchElections();
    }, [toast]);

    useDomainRealtime('admin-candidacies', user?.id, ['candidates'], fetchCandidates, Boolean(user?.id));

    const handleActionClick = (candidate, type) => {
        setSelectedCandidate(candidate);
        setActionType(type);
        setFeedback(candidate.admin_feedback || '');
        if (type === 'edit') {
            setEditForm({
                political_name: candidate.political_name,
                bio: candidate.bio || '',
                proposals: candidate.proposals || '',
            });
        }
        setIsActionModalOpen(true);
    };

    const handleConfirmAction = async () => {
        if (!selectedCandidate || !actionType || isProcessing || authLoading || (!user?.is_platform_admin && user?.role !== 'Admin')) return;

        if (actionType === 'reject' && !feedback.trim()) {
            toast({ title: "Erro de validação", description: "O motivo da rejeição é obrigatório.", variant: "destructive" });
            return;
        }

        setIsProcessing(true);

        try {
            await readySession();
            if (actionType === 'approve' || actionType === 'reject') {
                const rpcName = actionType === 'approve' ? 'approve_candidacy' : 'reject_candidacy';
                const { data, error } = await supabase.rpc(rpcName, {
                    p_candidate_id: selectedCandidate.id,
                    p_feedback: feedback
                });
                if (error || !data.success) throw new Error(data?.message || error.message);
                toast({ title: "Sucesso!", description: data.message });
            } else if (actionType === 'edit') {
                const { error } = await supabase.rpc('admin_manage_candidacy', { p_candidate_id: selectedCandidate.id, p_action: 'edit', p_changes: { ...editForm, admin_feedback: feedback || null } });
                if (error) throw error;
                toast({ title: "Sucesso!", description: "Candidatura atualizada com sucesso." });
            } else if (actionType === 'delete') {
                const { error } = await supabase.rpc('admin_manage_candidacy', { p_candidate_id: selectedCandidate.id, p_action: 'delete' });
                if (error) throw error;
                toast({ title: "Sucesso!", description: "Candidatura excluída com sucesso." });
            }

            fetchCandidates();
            setIsActionModalOpen(false);
        } catch (error) {
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        }
        setIsProcessing(false);
    };

    const filteredCandidates = candidates.filter(c => {
        if (filterElection !== 'all' && c.election_id !== filterElection) return false;
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        return (
            c.political_name?.toLowerCase().includes(term) ||
            c.user?.full_name?.toLowerCase().includes(term) ||
            c.election?.name?.toLowerCase().includes(term) ||
            c.party?.name?.toLowerCase().includes(term)
        );
    });

    const groupedCandidates = filteredCandidates.reduce((accumulator, candidate) => {
        const electionId = candidate.election_id || 'unknown';
        if (!accumulator[electionId]) {
            accumulator[electionId] = {
                election: candidate.election || { id: electionId, name: 'Eleição não identificada' },
                candidates: [],
            };
        }
        accumulator[electionId].candidates.push(candidate);
        return accumulator;
    }, {});

    const orderedGroups = elections
        .map((election) => groupedCandidates[election.id])
        .filter(Boolean);

    if (groupedCandidates.unknown) {
        orderedGroups.push(groupedCandidates.unknown);
    }

    const toggleElectionGroup = (electionId) => {
        setExpandedElectionIds((current) =>
            current.includes(electionId)
                ? current.filter((id) => id !== electionId)
                : [...current, electionId]
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl font-bold text-white">Gerenciar Candidaturas</h2>
                <div className="flex flex-wrap gap-2 items-center">
                    <Input
                        placeholder="Buscar candidato..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-48"
                    />
                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-40">
                            <Filter className="w-4 h-4 mr-2" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="Pendente">Pendentes</SelectItem>
                            <SelectItem value="Approved">Aprovados</SelectItem>
                            <SelectItem value="Rejected">Rejeitados</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={filterElection} onValueChange={setFilterElection}>
                        <SelectTrigger className="w-56">
                            <SelectValue placeholder="Filtrar por eleição" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as eleições</SelectItem>
                            {elections.map((election) => (
                                <SelectItem key={election.id} value={election.id}>
                                    {election.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : filteredCandidates.length > 0 ? (
                <div className="space-y-8">
                    {orderedGroups.map((group) => {
                        const pendingCount = group.candidates.filter((candidate) => candidate.status === 'Pendente').length;
                        const isCollapsed = !expandedElectionIds.includes(group.election.id);
                        const ToggleIcon = isCollapsed ? ChevronDown : ChevronUp;

                        return (
                            <section key={group.election.id} className="space-y-4">
                                <button
                                    type="button"
                                    onClick={() => toggleElectionGroup(group.election.id)}
                                    className="w-full rounded-2xl border border-white/10 bg-background/20 p-5 text-left transition-colors hover:border-primary/50 hover:bg-white/5"
                                    aria-expanded={!isCollapsed}
                                >
                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                        <div>
                                            <h3 className="flex items-center gap-2 text-xl font-bold text-white">
                                                <ToggleIcon className="h-5 w-5 text-muted-foreground" />
                                                {group.election.name}
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                                {group.candidates.length} candidatura(s) nesta eleição.
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Badge className="border bg-blue-500/15 text-blue-300 border-blue-500/30">
                                                Total: {group.candidates.length}
                                            </Badge>
                                            <Badge className="border bg-yellow-500/15 text-yellow-300 border-yellow-500/30">
                                                Pendentes: {pendingCount}
                                            </Badge>
                                        </div>
                                    </div>
                                </button>

                                {!isCollapsed && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {group.candidates.map((candidate) => {
                                        const status = statusConfig[candidate.status] || statusConfig.Pendente;
                                        return (
                                            <Card key={candidate.id} className="glass-effect flex flex-col">
                                                <CardHeader className="flex flex-row items-start gap-4">
                                                    <Avatar className="h-16 w-16 border shrink-0">
                                                        <AvatarImage src={candidate.campaign_photo_url || candidate.user?.avatar_url} alt={candidate.political_name} />
                                                        <AvatarFallback>{candidate.political_name?.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex-1 min-w-0">
                                                        <CardTitle className="truncate">{candidate.political_name}</CardTitle>
                                                        <CardDescription className="truncate">{candidate.user?.full_name}</CardDescription>
                                                        {candidate.vice?.full_name ? (
                                                        <CardDescription className="truncate">Vice na chapa: {candidate.vice.full_name}</CardDescription>
                                                        ) : null}
                                                        <CardDescription className="truncate">Partido: {candidate.party ? `${candidate.party.name} (${candidate.party.acronym})` : 'Independente'}</CardDescription>
                                                    </div>
                                                </CardHeader>
                                                <CardContent className="flex-1">
                                                    <Badge className={`${status.color} border`}>{status.label}</Badge>
                                                    {candidate.admin_feedback && (
                                                        <p className="text-xs text-muted-foreground mt-2 italic">Feedback: {candidate.admin_feedback}</p>
                                                    )}
                                                </CardContent>
                                                <CardFooter className="gap-2 flex-wrap">
                                                    {candidate.status === 'Pendente' && (
                                                        <>
                                                            <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleActionClick(candidate, 'approve')}>
                                                                <Check className="w-4 h-4 mr-1" /> Aprovar
                                                            </Button>
                                                            <Button size="sm" variant="destructive" onClick={() => handleActionClick(candidate, 'reject')}>
                                                                <X className="w-4 h-4 mr-1" /> Rejeitar
                                                            </Button>
                                                        </>
                                                    )}
                                                    <Button size="sm" variant="outline" onClick={() => handleActionClick(candidate, 'edit')}>
                                                        <Edit className="w-4 h-4 mr-1" /> Editar
                                                    </Button>
                                                    <Button size="sm" variant="destructive" onClick={() => handleActionClick(candidate, 'delete')}>
                                                        <Trash2 className="w-4 h-4 mr-1" /> Excluir
                                                    </Button>
                                                </CardFooter>
                                            </Card>
                                        );
                                    })}
                                </div>}
                            </section>
                        );
                    })}
                </div>
            ) : (
                <div className="text-center py-10 glass-effect rounded-lg">
                    <h3 className="text-xl font-bold">Nenhuma candidatura encontrada</h3>
                    <p className="text-muted-foreground mt-2">
                        {filterStatus === 'all' ? 'Nenhuma candidatura registrada no sistema.' : `Nenhuma candidatura com status "${statusConfig[filterStatus]?.label || filterStatus}".`}
                    </p>
                </div>
            )}

            {/* Action Modal */}
            <Dialog open={isActionModalOpen} onOpenChange={setIsActionModalOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {actionType === 'approve' && 'Aprovar Candidatura'}
                            {actionType === 'reject' && 'Rejeitar Candidatura'}
                            {actionType === 'edit' && 'Editar Candidatura'}
                            {actionType === 'delete' && 'Excluir Candidatura'}
                        </DialogTitle>
                        <DialogDescription>
                            {actionType === 'delete'
                                ? `Tem certeza que deseja excluir a candidatura de ${selectedCandidate?.political_name}? Esta ação é irreversível.`
                                : `Candidatura de ${selectedCandidate?.political_name} para ${selectedCandidate?.election?.name}.`
                            }
                        </DialogDescription>
                    </DialogHeader>

                    {actionType === 'edit' && (
                        <div className="space-y-4 py-2">
                            <div>
                                <Label htmlFor="edit_political_name">Nome oficial registrado</Label>
                                <Input
                                    id="edit_political_name"
                                    value={editForm.political_name}
                                    readOnly aria-readonly="true"
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit_bio">Biografia</Label>
                                <Textarea
                                    id="edit_bio"
                                    value={editForm.bio}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, bio: e.target.value }))}
                                    rows={3}
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit_proposals">Propostas</Label>
                                <Textarea
                                    id="edit_proposals"
                                    value={editForm.proposals}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, proposals: e.target.value }))}
                                    rows={4}
                                />
                            </div>
                        </div>
                    )}

                    {(actionType === 'approve' || actionType === 'reject' || actionType === 'edit') && (
                        <div className="py-2">
                            <Label htmlFor="feedback">
                                {actionType === 'reject' ? 'Motivo da Rejeição (Obrigatório)' : 'Feedback (Opcional)'}
                            </Label>
                            <Textarea
                                id="feedback"
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={actionType === 'reject' ? 'Ex: Não cumpre os requisitos.' : 'Ex: Documentação verificada.'}
                            />
                        </div>
                    )}

                    <DialogFooter className="gap-3 sm:space-x-0">
                        <DialogClose asChild>
                            <Button variant="outline"><X className="mr-2 h-4 w-4"/>Cancelar</Button>
                        </DialogClose>
                        <Button
                            onClick={handleConfirmAction}
                            disabled={isProcessing || authLoading || (!user?.is_platform_admin && user?.role !== 'Admin')}
                            variant={actionType === 'reject' || actionType === 'delete' ? 'destructive' : 'default'}
                        >
                            {isProcessing && <Loader2 className="animate-spin mr-2 w-4 h-4"/>}
                            {actionType === 'approve' && 'Confirmar Aprovação'}
                            {actionType === 'reject' && 'Confirmar Rejeição'}
                            {actionType === 'edit' && 'Salvar Alterações'}
                            {actionType === 'delete' && <><Trash2 className="mr-2 h-4 w-4"/>Excluir Permanentemente</>}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CandidacyManagement;
