import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Check, Vote, UserCheck, Info, Clock, Users, Percent, UserPlus, Calendar, Flag } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Progress } from '@/components/ui/progress';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CandidateDetailsDialog = ({ candidate }) => (
    <Dialog>
        <DialogTrigger asChild><Button variant="outline" size="sm"><Info className="mr-2 h-4 w-4" />Info</Button></DialogTrigger>
        <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <div className="flex items-center gap-4 mb-4">
                    <img src={candidate.campaign_photo_url || candidate.profile?.avatar_url} alt={candidate.political_name} className="w-20 h-20 rounded-lg bg-secondary p-1 object-cover" />
                    <div>
                        <DialogTitle className="text-2xl">{candidate.political_name}</DialogTitle>
                        <DialogDescription>{candidate.party?.name || 'Candidatura Independente'}</DialogDescription>
                    </div>
                </div>
            </DialogHeader>
            <div>
                <h4 className="font-semibold text-lg">Biografia</h4>
                <p className="text-muted-foreground whitespace-pre-wrap text-sm mt-1">{candidate.bio || 'Nenhuma biografia fornecida.'}</p>
            </div>
            <div className="mt-4">
                <h4 className="font-semibold text-lg">Propostas</h4>
                <p className="text-muted-foreground whitespace-pre-wrap text-sm mt-1 max-h-60 overflow-y-auto">{candidate.proposals || 'Nenhuma proposta detalhada.'}</p>
            </div>
        </DialogContent>
    </Dialog>
);

const Countdown = ({ toDate, onEnd, prefix = '' }) => {
    const [timeLeft, setTimeLeft] = useState('');
    useEffect(() => {
        const interval = setInterval(() => {
            const distance = new Date(toDate).getTime() - new Date().getTime();
            if (distance < 0) {
                setTimeLeft("Encerrado");
                clearInterval(interval);
                if(onEnd) onEnd();
                return;
            }
            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);
            setTimeLeft(`${prefix}${days}d ${hours}h ${minutes}m ${seconds}s`);
        }, 1000);
        return () => clearInterval(interval);
    }, [toDate, onEnd, prefix]);
    return <span className="font-mono font-bold">{timeLeft}</span>;
};

const ActiveElection = ({ election, onDataChange }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [candidates, setCandidates] = useState([]);
    const [votes, setVotes] = useState([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [userVote, setUserVote] = useState(null);
    const [actionLoading, setActionLoading] = useState(null);
    const [isCandidacyOpen, setIsCandidacyOpen] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const { data: cData, error: cError } = await supabase.from('candidates').select('*, profile:profiles(id, full_name, avatar_url), party:political_parties(id, name)').eq('election_id', election.id).eq('status', 'Approved');
            if (cError) throw cError;
            setCandidates(cData || []);

            const { data: vData, error: vError } = await supabase.from('votes').select('*').eq('election_id', election.id);
            if (vError) throw vError;
            setVotes(vData || []);
            if (user?.id) setUserVote(vData.find(v => v.voter_id === user.id));
            
            const { count: userCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
            setTotalUsers(userCount || 0);
        } catch(error) {
            toast({ title: 'Erro ao carregar dados da eleição ativa', variant: 'destructive' });
        }
    }, [election.id, user, toast]);

    useEffect(() => { 
        fetchData();
        const channel = supabase.channel(`election-${election.id}`).on('postgres_changes', { event: '*', schema: 'public' }, payload => { fetchData(); onDataChange(); }).subscribe();
        return () => supabase.removeChannel(channel);
    }, [fetchData, election.id, onDataChange]);

    const handleVote = async (candidateId) => {
        setActionLoading(candidateId);
        const { data, error } = await supabase.rpc('cast_vote', { p_election_id: election.id, p_candidate_id: candidateId });
        if (error || !data.success) toast({ title: "Erro ao votar", description: error?.message || data.message, variant: "destructive" });
        else {
            toast({ title: "Voto registrado!", description: "Seu voto foi computado com sucesso." });
            fetchData();
        }
        setActionLoading(null);
    };
    
    const calculateResults = () => {
        if (candidates.length === 0) return [];
        const results = candidates.map(c => ({ ...c, voteCount: votes.filter(v => v.candidate_id === c.id).length }));
        const totalVotes = votes.length;
        return results.map(r => ({ ...r, percentage: totalVotes > 0 ? (r.voteCount / totalVotes) * 100 : 0 })).sort((a,b) => b.voteCount - a.voteCount);
    };

    const electionResults = calculateResults();
    const turnout = totalUsers > 0 ? (votes.length / totalUsers) * 100 : 0;
    
    return (
        <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 text-center">
                <Card className="glass-effect p-4"><CardHeader><CardTitle className="flex items-center justify-center gap-2"><Clock/>Encerra em</CardTitle></CardHeader><CardContent><Countdown toDate={election.voting_end_date} onEnd={onDataChange} /></CardContent></Card>
                <Card className="glass-effect p-4"><CardHeader><CardTitle className="flex items-center justify-center gap-2"><Users/>Total de Votos</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{votes.length}</p></CardContent></Card>
                <Card className="glass-effect p-4"><CardHeader><CardTitle className="flex items-center justify-center gap-2"><Percent/>Participação</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{turnout.toFixed(2)}%</p></CardContent></Card>
            </div>

             {isCandidacyOpen && (
                <div className="text-center mb-8"><Button size="lg"><UserPlus className="mr-2 h-5 w-5"/>Candidatar-se</Button></div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {electionResults.map(candidate => (
                    <motion.div key={candidate.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <Card className="glass-effect flex flex-col h-full">
                            <CardHeader>
                                <div className="flex items-center gap-4"><img src={candidate.campaign_photo_url || candidate.profile?.avatar_url} alt={candidate.political_name} className="w-16 h-16 rounded-full border-2 border-green-400 object-cover" />
                                <div><CardTitle className="text-white">{candidate.political_name}</CardTitle><CardDescription className="text-gray-300">{candidate.party?.name || 'Independente'}</CardDescription></div></div>
                                <p className="text-sm text-gray-400 italic mt-2 line-clamp-2">"{candidate.bio || 'Sem biografia.'}"</p>
                            </CardHeader>
                            <CardContent className="flex-grow"><div className="space-y-2"><div className="flex justify-between items-center font-bold"><span className="text-white">{candidate.voteCount} Votos</span><span className="text-green-400">{candidate.percentage.toFixed(2)}%</span></div><Progress value={candidate.percentage} className="w-full" indicatorClassName="bg-green-500" /></div></CardContent>
                            <CardFooter className="flex gap-2">
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button className="w-full" disabled={!!userVote || actionLoading === candidate.id}>{actionLoading === candidate.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : userVote ? (userVote.candidate_id === candidate.id ? <><UserCheck className="mr-2 h-4 w-4"/> Seu Voto</> : <><Check className="mr-2 h-4 w-4"/> Votado</>) : <><Vote className="mr-2 h-4 w-4"/> Votar</>}</Button>
                                    </AlertDialogTrigger>
                                    {!userVote && (<AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirmar Voto?</AlertDialogTitle><AlertDialogDescription>Você está prestes a votar em <span className="font-bold">{candidate.political_name}</span>. Esta ação é irreversível.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => handleVote(candidate.id)}>Confirmar Voto</AlertDialogAction></AlertDialogFooter></AlertDialogContent>)}
                                </AlertDialog>
                                <CandidateDetailsDialog candidate={candidate} />
                            </CardFooter>
                        </Card>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

const Elections = () => {
    const [elections, setElections] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchElections = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('elections').select('*').order('voting_start_date', { ascending: false });
            if (error) throw error;
            setElections(data || []);
        } catch (error) {
            toast({ title: 'Erro ao carregar eleições.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchElections(); }, [fetchElections]);

    const activeElection = elections.find(e => new Date(e.voting_start_date) <= new Date() && new Date(e.voting_end_date) >= new Date() && e.status === 'Voting');
    const futureElections = elections.filter(e => new Date(e.candidacy_start_date) > new Date() && e.status === 'Scheduled');
    const pastElections = elections.filter(e => new Date(e.voting_end_date) < new Date() || e.status === 'Finished');

    if (loading) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;

    return (
        <>
            <Helmet><title>Eleições - GOV.RP</title><meta name="description" content="Participe e acompanhe o processo democrático do GOV.RP." /></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader icon={Flag} title="Portal Eleitoral" gradientText="Nacional" description="Acompanhe o processo democrático, candidate-se e exerça seu direito de voto." iconColor="text-green-400" />
                
                <section className="mb-12">
                    <h2 className="text-3xl font-bold mb-4 border-b-2 border-primary pb-2">Eleição Ativa</h2>
                    {activeElection ? <ActiveElection election={activeElection} onDataChange={fetchElections}/> : <p className="text-center text-muted-foreground py-8">Nenhuma eleição ativa no momento.</p>}
                </section>

                <section className="mb-12">
                    <h2 className="text-3xl font-bold mb-4 border-b-2 border-primary pb-2">Próximas Eleições</h2>
                    {futureElections.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {futureElections.map(e => (<Card key={e.id} className="glass-effect"><CardHeader><CardTitle>{e.name}</CardTitle><CardDescription>{e.description}</CardDescription></CardHeader><CardContent><Countdown toDate={e.candidacy_start_date} prefix="Inscrições em: " /></CardContent></Card>))}
                        </div>
                    ) : <p className="text-center text-muted-foreground py-8">Nenhuma eleição futura agendada.</p>}
                </section>

                <section>
                    <h2 className="text-3xl font-bold mb-4 border-b-2 border-primary pb-2">Resultados Anteriores</h2>
                    {pastElections.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {pastElections.map(e => (<Card key={e.id} className="glass-effect"><CardHeader><CardTitle>{e.name}</CardTitle><CardDescription>Realizada em {format(new Date(e.voting_end_date), 'dd/MM/yyyy')}</CardDescription></CardHeader><CardFooter><Button variant="outline" className="w-full">Ver Resultados</Button></CardFooter></Card>))}
                        </div>
                    ) : <p className="text-center text-muted-foreground py-8">Nenhum resultado de eleição anterior disponível.</p>}
                </section>
            </div>
        </>
    );
};

export default Elections;