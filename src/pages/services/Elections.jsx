import ElectionResults from '@/components/elections/ElectionResults';
import CandidateIdentity, { candidateIdentity } from '@/components/elections/CandidateIdentity';
import ElectronicBallot from '@/components/elections/ElectronicBallot';
import { formatDateBR, formatDateTimeBR } from '@/lib/dateTime';
import ElectoralManagement from '@/components/elections/ElectoralManagement';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClipboardSignature, Users, CheckSquare, Calendar, Vote, BarChart3, Loader2, Info, TrendingUp, User, Ban, Landmark, AlertTriangle, Scale } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import RegisterCandidacy from './elections/RegisterCandidacy';
import TrackCandidacy from './elections/TrackCandidacy';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { isCurrentElection } from '@/lib/currentElections';
import { fetchExecutiveConstitutionalState } from '@/lib/executiveGovernance';

const statusConfig = {
    Scheduled: { text: 'Agendada', color: 'bg-gray-500/80 text-white' },
    Candidacy: { text: 'Candidatura', color: 'bg-blue-500/80 text-white' },
    Voting: { text: 'Votação', color: 'bg-green-500/80 text-white' },
    Finished: { text: 'Finalizada', color: 'bg-red-500/80 text-white' },
};

const ElectionOverviewCard = ({ election, onClick, type }) => {
    const currentStatus = statusConfig[election.status] || { text: election.status, color: 'bg-gray-400/80 text-white' };
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.03 }}
            transition={{ duration: 0.2 }}
        >
            <button
                onClick={() => onClick(election.id)}
                className="w-full aspect-square rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-white/[0.02] p-5 flex flex-col items-center justify-center gap-3 text-center hover:border-teal-500/40 hover:bg-white/10 transition-all duration-300 group"
            >
                <div className={`p-3 rounded-full ${type === 'results' ? 'bg-teal-500/20' : 'bg-blue-500/20'} group-hover:scale-110 transition-transform`}>
                    {type === 'results'
                        ? <BarChart3 className="w-7 h-7 text-teal-400" />
                        : <Users className="w-7 h-7 text-blue-400" />
                    }
                </div>
                <h4 className="font-bold text-foreground text-sm leading-tight line-clamp-2">{election.name}</h4>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${currentStatus.color}`}>
                    {currentStatus.text}
                </span>
                {election.election_types && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                        {election.election_types.name}
                    </span>
                )}
                <p className="text-[10px] text-muted-foreground">
                    {formatDateBR(election.voting_start_date)}
                </p>
            </button>
        </motion.div>
    );
};

const CandidatesList = ({ election, onRecorded, userVote }) => {
    const [candidates, setCandidates] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    const fetchCandidates = useCallback(async () => {
            let { data, error } = await supabase
                .from('candidates')
                .select('*, political_parties(name, acronym, logo_url, ideology), profiles!candidates_user_id_fkey(avatar_url), vice:profiles!candidates_vice_candidate_id_fkey(full_name, avatar_url)')
                .eq('status', 'Approved')
                .eq('election_id', election.id);

            if (error) {
                toast({ title: "Erro ao buscar candidatos", description: error.message, variant: "destructive" });
            } else {
                setCandidates((data || []).map(candidate => ({ ...candidate, political_parties: candidate.political_parties || candidate.party_snapshot })));
            }
            setLoading(false);
    }, [election.id, toast]);
    useEffect(() => { setLoading(true); fetchCandidates(); }, [fetchCandidates]);
    useDomainRealtime('election-candidates', election.id, [{ table: 'candidates', filter: `election_id=eq.${election.id}` }, 'political_parties'], fetchCandidates);

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
    if (candidates.length === 0) return <p className="text-center p-8 text-muted-foreground">Nenhum candidato encontrado para esta eleição.</p>;



    return (
        <div className="space-y-6">
            {election.status === 'Voting' && <ElectronicBallot election={election} candidates={candidates} hasVoted={Boolean(userVote)} onRecorded={onRecorded} />}
            <h3 className="font-semibold">Candidaturas aprovadas</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {candidates.map(candidate => (
                    <Card key={candidate.id} className={`p-4 flex items-center justify-between gap-4 bg-background/70 ${userVote === candidate.id ? 'border-primary ring-2 ring-primary/30' : ''}`}>
                        <div className="min-w-0 space-y-3"><CandidateIdentity identity={candidateIdentity(candidate)} label="Candidato"/>{candidate.vice_identity_snapshot&&<CandidateIdentity identity={candidate.vice_identity_snapshot} label="Vice-Presidente" compact/>}</div>
                        <span className="rounded-lg bg-secondary p-2 font-mono text-xl font-bold">{candidate.electoral_number}</span>
                    </Card>
                ))}
            </div>

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
                                <li>Candidaturas: {formatDateTimeBR(election.candidacy_start_date)} a {formatDateTimeBR(election.candidacy_end_date)}</li>
                                <li>Votação: {formatDateTimeBR(election.voting_start_date)} a {formatDateTimeBR(election.voting_end_date)}</li>
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

const ExecutiveConstitutionCard = ({ executiveState }) => {
    if (!executiveState) {
        return null;
    }

    const viceAssumedPresidency = Boolean(executiveState.viceAssumedPresidency);
    const currentPresident = executiveState.currentPresidentProfile?.full_name || 'Sem presidente em exercício';
    const currentVice = viceAssumedPresidency
      ? 'Vaga após sucessão presidencial'
      : executiveState.currentViceProfile?.full_name || 'Vice-Presidente não definido';
    const presidentParty = (viceAssumedPresidency ? executiveState.currentTerm?.winner?.vice_identity_snapshot?.party : executiveState.currentTerm?.winner?.party) || null;
    const viceParty = viceAssumedPresidency ? null : executiveState.currentTerm?.winner?.vice_identity_snapshot?.party || null;
    const currentTermLabel = executiveState.currentTerm
      ? `${formatDateTimeBR(executiveState.currentTerm.term_start_at)} até ${formatDateTimeBR(executiveState.currentTerm.term_end_at)}`
      : executiveState.manualExecutiveOfficeActive
        ? 'Cargo executivo atribuído manualmente pelo admin, válido até nova eleição presidencial consolidada.'
      : 'Nenhum mandato presidencial mensal ativo foi identificado.';

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8"
      >
        <Card className="glass-effect border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-background to-slate-950/80">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl">
              <Landmark className="w-7 h-7 text-blue-400" />
              Estrutura Constitucional do Executivo
            </CardTitle>
            <CardDescription>
              A Presidência e a Vice-Presidência são eleitas simultaneamente por voto direto, com mandato de 1 mês e apenas 1 reeleição consecutiva.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-muted-foreground">Presidente da República</p>
                <div className="flex items-center gap-3 mt-2">
                  {executiveState.currentPresidentProfile?.avatar_url && (
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={executiveState.currentPresidentProfile.avatar_url} alt={currentPresident} />
                      <AvatarFallback>{currentPresident?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                  <div>
                    <p className="text-lg font-semibold text-foreground">{currentPresident}</p>
                    {viceAssumedPresidency && (
                      <p className="text-xs font-medium text-emerald-300">Vice eleito que assumiu a Presidência</p>
                    )}
                    {presidentParty && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {presidentParty.logo_url && <img src={presidentParty.logo_url} alt={presidentParty.acronym} className="w-4 h-4 rounded-full object-cover" />}
                        <span className="text-xs text-muted-foreground">{presidentParty.acronym}</span>
                        {presidentParty.ideology && <span className="text-xs text-muted-foreground">· {presidentParty.ideology}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-muted-foreground">Vice-Presidente</p>
                <div className="flex items-center gap-3 mt-2">
                  {executiveState.currentViceProfile?.avatar_url && (
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={executiveState.currentViceProfile.avatar_url} alt={currentVice} />
                      <AvatarFallback>{currentVice?.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                  <div>
                    <p className="text-lg font-semibold text-foreground">{currentVice}</p>
                    {viceParty && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {viceParty.logo_url && <img src={viceParty.logo_url} alt={viceParty.acronym} className="w-4 h-4 rounded-full object-cover" />}
                        <span className="text-xs text-muted-foreground">{viceParty.acronym}</span>
                        {viceParty.ideology && <span className="text-xs text-muted-foreground">· {viceParty.ideology}</span>}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-muted-foreground">Mandato Atual</p>
                <p className="text-sm font-medium text-foreground mt-1">{currentTermLabel}</p>
              </div>
            </div>

            <div className={`rounded-xl border p-4 ${executiveState.isVacant ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
              <div className="flex items-start gap-3">
                {executiveState.isVacant ? (
                  <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
                ) : (
                  <Vote className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="font-semibold text-foreground">
                    {executiveState.isVacant
                      ? 'Vacância presidencial identificada'
                      : viceAssumedPresidency
                        ? 'Sucessão presidencial automática'
                      : executiveState.manualExecutiveOfficeActive
                        ? 'Cargos executivos ativos'
                        : 'Mandato presidencial ativo'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {executiveState.isVacant
                      ? `Na ausência de Presidente em exercício, assume sucessivamente ${executiveState.actingAuthority?.label || 'a autoridade sucessória disponível'}.`
                      : viceAssumedPresidency
                        ? 'O vice-presidente assumiu a chefia do Executivo porque a Presidência ficou sem ocupante ativo.'
                      : 'O chefe do Executivo exerce a direção superior da administração federal, sanciona ou veta projetos e pode editar medidas provisórias.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-indigo-300" />
                <h4 className="font-semibold text-foreground">Linha de Sucessão</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {executiveState.successionLine.map((entry, index) => (
                  <div key={entry.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{index + 1}º na ordem</p>
                    <p className="font-semibold text-foreground mt-2">{entry.label}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {entry.profile?.full_name || (entry.is_cda ? 'Assunção excepcional colegiada' : 'Sem ocupante definido')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
};

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
    const [executiveState, setExecutiveState] = useState(null);
    const [selectedElection, setSelectedElection] = useState('all');
    const [isRegisterOpen, setIsRegisterOpen] = useState(false);
    const [isTrackOpen, setIsTrackOpen] = useState(false);
    const [userVotes, setUserVotes] = useState({});

    const fetchElectionsAndVotes = useCallback(async (syncStatuses = false) => {
        try {
          if (syncStatuses === true) await supabase.rpc('update_election_statuses');
          const [electionsResponse, executiveResponse] = await Promise.all([
            supabase.from('elections').select('*, election_types(name, requires_vice_candidate, voting_system)').is('archived_at', null).order('voting_start_date', { ascending: false }),
            fetchExecutiveConstitutionalState(supabase),
          ]);

          const { data: electionsData, error: electionsError } = electionsResponse;
          if (electionsError) {
              throw electionsError;
          }

          setElections(electionsData || []);
          setExecutiveState(executiveResponse);

          if (user?.id) {
            const { data: votesData, error: votesError } = await supabase.from('votes').select('election_id, candidate_id').eq('voter_id', user.id);
            if (votesError) {
                toast({ title: "Erro ao buscar seus votos", variant: "destructive" });
            } else {
                const votesMap = votesData.reduce((acc, vote) => {
                    acc[vote.election_id] = vote.candidate_id || 'null_vote';
                    return acc;
                }, {});
                setUserVotes(votesMap);
            }
          }
        } catch (error) {
          toast({ title: "Erro ao carregar eleições", description: error.message, variant: "destructive" });
        }
    }, [toast, user?.id]);

    useEffect(() => {
        fetchElectionsAndVotes(true);
    }, [fetchElectionsAndVotes]);
    useDomainRealtime('elections', user?.id, ['elections', 'candidates', { table: 'votes', filter: `voter_id=eq.${user?.id}` }], () => fetchElectionsAndVotes());

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

    const currentElections = elections.filter(election => isCurrentElection(election));
    const displayedElections = activeDisplay === 'candidatos' ? currentElections : elections;
    useEffect(() => {
        if (selectedElection !== 'all' && !displayedElections.some(election => election.id === selectedElection)) setSelectedElection('all');
    }, [selectedElection, displayedElections]);
    const currentElection = displayedElections.find(e => e.id === selectedElection);

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
                    <TabsList className={`grid w-full h-auto ${['Admin','Presidente do Portal Eleitoral'].includes(user?.role) ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`}>
                        {serviceSections.map((section) => (
                            <TabsTrigger key={section.value} value={section.value} className="flex flex-col sm:flex-row gap-2 items-center justify-center py-3">
                                <section.icon className="w-5 h-5" /><span>{section.label}</span>
                            </TabsTrigger>
                        ))}
                        {['Admin','Presidente do Portal Eleitoral'].includes(user?.role)&&<TabsTrigger value="management" className="flex gap-2 items-center py-3"><Vote className="h-5 w-5"/>Gestão eleitoral</TabsTrigger>}
                    </TabsList>
                    {['Admin','Presidente do Portal Eleitoral'].includes(user?.role)&&<TabsContent value="management"><ElectoralManagement /></TabsContent>}
                    {serviceSections.map((section) => (
                        <TabsContent key={section.value} value={section.value}>
                            {section.value === 'info' && <ExecutiveConstitutionCard executiveState={executiveState} />}
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
                                                <Select onValueChange={setSelectedElection} value={selectedElection}>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Selecione uma eleição" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">Todas as Eleições</SelectItem>
                                                        {displayedElections.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {activeDisplay === 'candidatos' && currentElection && <CandidatesList election={currentElection} onRecorded={() => fetchElectionsAndVotes()} userVote={userVotes[selectedElection]} />}
                                    {activeDisplay === 'candidatos' && selectedElection === 'all' && (
                                        currentElections.length > 0 ? (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                                {currentElections.map(e => (
                                                    <ElectionOverviewCard key={e.id} election={e} type="candidates" onClick={(id) => setSelectedElection(id)} />
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-center p-8 text-muted-foreground">Nenhuma eleição atual disponível para candidatura ou votação.</p>
                                        )
                                    )}
                                    {activeDisplay === 'resultados' && selectedElection === 'all' && (
                                        elections.length > 0 ? (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                                {elections.map(e => (
                                                    <ElectionOverviewCard key={e.id} election={e} type="results" onClick={(id) => setSelectedElection(id)} />
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-center p-8 text-muted-foreground">Nenhuma eleição encontrada.</p>
                                        )
                                    )}
                                    {activeDisplay === 'resultados' && selectedElection !== 'all' && <ElectionResults election={currentElection} />}
                                    {activeDisplay === 'calendar' && <ElectoralCalendar elections={elections} />}
                                </CardContent>
                            </Card>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <Dialog open={isRegisterOpen} onOpenChange={setIsRegisterOpen}>
                <DialogContent plain className="max-w-4xl max-h-[90dvh] overflow-hidden p-0 bg-card [&>button]:z-20">
                    <DialogHeader className="sr-only">
                        <DialogTitle>Registrar Candidatura</DialogTitle>
                        <DialogDescription>Preencha o formulário para registrar sua candidatura.</DialogDescription>
                    </DialogHeader>
                    <div className="overflow-y-auto max-h-[90vh] p-6 pr-4 custom-scrollbar">
                        <RegisterCandidacy onFinished={() => setIsRegisterOpen(false)} />
                    </div>
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
