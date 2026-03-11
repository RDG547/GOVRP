import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardSignature, Users, CheckSquare, Calendar, Vote, BarChart3, Loader2, Info } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import RegisterCandidacy from './elections/RegisterCandidacy';
import TrackCandidacy from './elections/TrackCandidacy';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const CandidatesList = ({ election, onVote, userVote }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchCandidates = async () => {
            setLoading(true);
            let { data, error } = await supabase
                .from('candidates')
                .select('*, political_parties(acronym, logo_url), profiles!candidates_user_id_fkey(avatar_url)')
                .eq('status', 'Approved')
                .eq('election_id', election.id);

            if (error) {
                toast({ title: "Erro ao buscar candidatos", description: error.message, variant: "destructive" });
            } else {
                setCandidates(data);
            }
            setLoading(false);
        };
        fetchCandidates();
    }, [election.id, toast]);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (candidates.length === 0) return <p className="text-center p-8 text-muted-foreground">Nenhum candidato encontrado para esta eleição.</p>;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {candidates.map(candidate => (
                <Card key={candidate.id} className={`p-4 flex items-center justify-between gap-4 bg-background/70 ${userVote === candidate.id ? 'border-primary' : ''}`}>
                    <div className="flex items-center gap-4">
                        <Avatar className="w-12 h-12">
                            <AvatarImage src={candidate.campaign_photo_url || candidate.profiles.avatar_url} alt={candidate.political_name} />
                            <AvatarFallback>{candidate.political_name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <p className="font-semibold">{candidate.political_name}</p>
                            <p className="text-sm text-muted-foreground">{candidate.political_parties?.acronym || 'Avulso'}</p>
                        </div>
                    </div>
                    {election.status === 'Voting' && (
                        <Button 
                            onClick={() => onVote(candidate.id)} 
                            disabled={!!userVote}
                            variant={userVote === candidate.id ? 'secondary' : 'default'}
                        >
                            {userVote === candidate.id ? 'Votado' : 'Votar'}
                        </Button>
                    )}
                </Card>
            ))}
        </div>
    );
};

const ElectionResults = ({ electionId }) => {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchResults = useCallback(async () => {
        const { data, error } = await supabase.rpc('get_election_results', { p_election_id: electionId });
        if (error) {
            toast({ title: "Erro ao buscar resultados", description: error.message, variant: "destructive" });
        } else {
            setResults(data);
        }
        setLoading(false);
    }, [electionId, toast]);

    useEffect(() => {
        if (electionId !== 'all') {
            setLoading(true);
            fetchResults();

            const channel = supabase.channel(`election_results_${electionId}`)
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes', filter: `election_id=eq.${electionId}` }, fetchResults)
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        } else {
            setResults([]);
            setLoading(false);
        }
    }, [electionId, fetchResults]);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (electionId === 'all') return <p className="text-center p-8 text-muted-foreground">Selecione uma eleição para ver os resultados.</p>;
    if (results.length === 0) return <p className="text-center p-8 text-muted-foreground">Nenhum resultado disponível para esta eleição.</p>;
    
    const totalVotes = results.reduce((sum, r) => sum + Number(r.vote_count), 0);

    return (
        <div className="space-y-4">
            {results.map(result => (
                <div key={result.candidate_id}>
                    <div className="flex justify-between font-semibold">
                        <span>{result.political_name} ({result.party_name || 'Avulso'})</span>
                        <span>{result.vote_count} votos ({totalVotes > 0 ? ((result.vote_count / totalVotes) * 100).toFixed(2) : 0}%)</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-4 mt-1">
                        <motion.div 
                            className="bg-primary h-4 rounded-full" 
                            initial={{ width: 0 }}
                            animate={{ width: `${totalVotes > 0 ? (result.vote_count / totalVotes) * 100 : 0}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};

const getStatus = (election) => {
    const now = new Date();
    if (now >= new Date(election.voting_end_date)) return 'Finished';
    if (now >= new Date(election.voting_start_date)) return 'Voting';
    if (now >= new Date(election.candidacy_end_date)) return 'Scheduled'; // Gap between candidacy and voting
    if (now >= new Date(election.candidacy_start_date)) return 'Candidacy';
    return 'Scheduled';
};

const statusConfig = {
    Scheduled: { text: 'Agendada', color: 'bg-gray-500/80 text-white' },
    Candidacy: { text: 'Candidatura', color: 'bg-blue-500/80 text-white' },
    Voting: { text: 'Votação', color: 'bg-green-500/80 text-white' },
    Finished: { text: 'Finalizada', color: 'bg-red-500/80 text-white' },
};

const ElectoralCalendar = ({ elections }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        className="mt-6 p-6 border rounded-lg bg-background/50 shadow-lg space-y-4"
    >
        <h3 className="text-xl font-bold flex items-center gap-2 text-teal-300"><Calendar className="w-6 h-6" /> Calendário Eleitoral</h3>
        {elections.length > 0 ? (
            <ul className="space-y-4">
                {elections.map(election => {
                    const currentStatusKey = election.status;
                    const currentStatus = statusConfig[currentStatusKey] || { text: currentStatusKey, color: 'bg-gray-400/80 text-white' };
                    return (
                        <li key={election.id}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span className="font-bold text-foreground text-lg">{election.name}</span>
                                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${currentStatus.color}`}>
                                    {currentStatus.text}
                                </span>
                                {election.election_types && <span className="text-xs font-semibold px-2 py-1 rounded-full bg-purple-500/80 text-white">{election.election_types.name}</span>}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">{election.description}</p>
                            <ul className="list-['-_'] list-inside ml-4 text-sm text-muted-foreground mt-1">
                                <li>Candidaturas: {format(new Date(election.candidacy_start_date), 'dd/MM/yyyy HH:mm', { locale: ptBR })} a {format(new Date(election.candidacy_end_date), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</li>
                                <li>Votação: {format(new Date(election.voting_start_date), 'dd/MM/yyyy HH:mm', { locale: ptBR })} a {format(new Date(election.voting_end_date), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</li>
                            </ul>
                        </li>
                    )
                })}
            </ul>
        ) : (
            <p className="text-muted-foreground">Nenhuma eleição com calendário definido no momento.</p>
        )}
    </motion.div>
);

const ServiceActionSimple = ({ title, description, icon: Icon, onAction }) => (
    <button 
        className="w-full text-left p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all duration-200 flex items-start gap-4"
        onClick={onAction}
    >
        <div className="p-2 bg-teal-500/20 rounded-md"><Icon className="w-6 h-6 text-teal-400" /></div>
        <div><h4 className="font-semibold text-white">{title}</h4><p className="text-sm text-muted-foreground">{description}</p></div>
    </button>
);

const Elections = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [activeDisplay, setActiveDisplay] = useState(null);
    const [elections, setElections] = useState([]);
    const [selectedElection, setSelectedElection] = useState('all');
    const [isRegisterOpen, setIsRegisterOpen] = useState(false);
    const [isTrackOpen, setIsTrackOpen] = useState(false);
    const [userVotes, setUserVotes] = useState({});

    const fetchElectionsAndVotes = useCallback(async () => {
        await supabase.rpc('update_election_statuses'); // Update statuses on page load
        const { data: electionsData, error: electionsError } = await supabase.from('elections').select('*, election_types(name)').order('voting_start_date', { ascending: false });
        if (electionsError) {
            toast({ title: "Erro ao carregar eleições", description: electionsError.message, variant: "destructive" });
        } else {
            setElections(electionsData);
        }

        if (user?.id) {
          const { data: votesData, error: votesError } = await supabase.from('votes').select('election_id, candidate_id').eq('voter_id', user.id);
          if (votesError) {
              toast({ title: "Erro ao buscar seus votos", variant: "destructive" });
          } else {
              const votesMap = votesData.reduce((acc, vote) => {
                  acc[vote.election_id] = vote.candidate_id;
                  return acc;
              }, {});
              setUserVotes(votesMap);
          }
        }
    }, [toast, user?.id]);

    useEffect(() => {
        fetchElectionsAndVotes();
    }, [fetchElectionsAndVotes]);

    const handleVote = async (candidateId) => {
        const { data, error } = await supabase.rpc('cast_vote', { p_election_id: selectedElection, p_candidate_id: candidateId });
        if (error || !data.success) {
            toast({ title: "Erro ao votar", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Voto computado!", description: data.message });
            fetchElectionsAndVotes();
        }
    };

    const serviceSections = [
        {
            value: "cidadao", label: "Eleitor", icon: Users,
            services: [
                { title: 'Votar / Consultar Candidatos', description: 'Conheça os candidatos e exerça seu direito de voto.', icon: Users, onAction: () => setActiveDisplay('candidatos') },
                { title: 'Resultados de Eleições', description: 'Confira os resultados detalhados das eleições.', icon: BarChart3, onAction: () => setActiveDisplay('resultados') }
            ]
        },
        {
            value: "candidato", label: "Candidato", icon: ClipboardSignature,
            services: [
                { title: 'Registrar Candidatura', description: 'Inicie o processo para se candidatar a um cargo eletivo.', icon: ClipboardSignature, onAction: () => setIsRegisterOpen(true) },
                { title: 'Acompanhar Situação', description: 'Verifique o status de seus registros de candidatura.', icon: CheckSquare, onAction: () => setIsTrackOpen(true) },
            ]
        },
        {
            value: "info", label: "Informações", icon: Info,
            services: [
                { title: 'Calendário Eleitoral', description: 'Fique por dentro de todas as datas importantes.', icon: Calendar, onAction: () => setActiveDisplay('calendar') },
            ]
        }
    ];

    const currentElection = elections.find(e => e.id === selectedElection);

    return (
        <div className="container mx-auto p-4 md:p-8">
            <Helmet>
                <title>Portal Eleitoral - GOV.RP</title>
                <meta name="description" content="Acesse todos os serviços eleitorais em um só lugar." />
            </Helmet>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Vote}
                    title="Portal"
                    gradientText="Eleitoral"
                    description="Seu hub central para todos os assuntos relacionados às eleições."
                    iconColor="text-teal-400"
                    centered={true}
                />

                <Tabs defaultValue="cidadao" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 h-auto">
                        {serviceSections.map((section) => (
                            <TabsTrigger key={section.value} value={section.value} className="flex flex-col sm:flex-row gap-2 items-center justify-center py-3">
                                <section.icon className="w-5 h-5" /><span>{section.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {serviceSections.map((section) => (
                        <TabsContent key={section.value} value={section.value}>
                            <Card className="glass-effect mt-6">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-3 text-2xl"><section.icon className="w-8 h-8 text-teal-400" />{section.label}</CardTitle>
                                    <CardDescription>Selecione um dos serviços abaixo para continuar.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {section.services.map((service, index) => (
                                            <ServiceActionSimple
                                                key={index}
                                                {...service}
                                            />
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    ))}
                </Tabs>
                
                <AnimatePresence mode="wait">
                    {activeDisplay && (
                        <motion.div
                            key={activeDisplay}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                            className="mt-8"
                        >
                            <Card className="glass-effect">
                                <CardHeader>
                                    <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                                        <CardTitle>
                                            {activeDisplay === 'candidatos' && 'Candidatos'}
                                            {activeDisplay === 'resultados' && 'Resultados da Eleição'}
                                            {activeDisplay === 'calendar' && 'Calendário Eleitoral'}
                                        </CardTitle>
                                        {(activeDisplay === 'candidatos' || activeDisplay === 'resultados') && (
                                            <div className="w-full md:w-auto">
                                                <Select onValueChange={setSelectedElection} defaultValue="all">
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione uma eleição" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">Todas as Eleições</SelectItem>
                                                        {elections.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {activeDisplay === 'candidatos' && currentElection && <CandidatesList election={currentElection} onVote={handleVote} userVote={userVotes[selectedElection]} />}
                                    {activeDisplay === 'candidatos' && !currentElection && <p className="text-center p-8 text-muted-foreground">Selecione uma eleição para ver os candidatos.</p>}
                                    {activeDisplay === 'resultados' && <ElectionResults electionId={selectedElection} />}
                                    {activeDisplay === 'calendar' && <ElectoralCalendar elections={elections} />}
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <RegisterCandidacy onFinished={() => setIsRegisterOpen(false)} />
                </DialogContent>
            </Dialog>

            <Dialog open={isTrackOpen} onOpenChange={setIsTrackOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Acompanhar Candidaturas</DialogTitle>
                        <DialogDescription>Verifique o status de todos os seus registros de candidatura.</DialogDescription>
                    </DialogHeader>
                    <TrackCandidacy />
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Elections;