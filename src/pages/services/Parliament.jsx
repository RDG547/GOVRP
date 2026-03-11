import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Scale, Inbox, Vote, Users, ThumbsUp, ThumbsDown, UserX, Send, Check, X, Hand, FileText, Landmark } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const CitizenActions = ({ onPlebAction }) => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [isSuggestOpen, setIsSuggestOpen] = useState(false);
    const [isPlebChoiceOpen, setIsPlebChoiceOpen] = useState(false);
    const [isPlebFormOpen, setIsPlebFormOpen] = useState(false);
    const [suggestionData, setSuggestionData] = useState({ title: '', suggestion: '', target_type: 'house', target_id: '', bill_type: 'PL' });
    const [plebisciteData, setPlebisciteData] = useState({ title: '', description: '' });
    const [parliamentarians, setParliamentarians] = useState([]);
    const [parties, setParties] = useState([]);
    const [houses, setHouses] = useState([]);

    const fetchTargets = useCallback(async () => {
        setLoading(true);
        try {
            const { data: housesData, error: housesError } = await supabase.from('parliament_houses').select('id, name');
            if (housesError) throw housesError;
            setHouses(housesData || []);

            const { data: partiesData, error: partiesError } = await supabase.from('political_parties').select('id, name').eq('is_active', true);
            if (partiesError) throw partiesError;
            setParties(partiesData || []);

            const { data: membersData, error: membersError } = await supabase
                .from('profiles')
                .select('id, full_name')
                .in('role', ['Deputado', 'Senador']);
            if (membersError) throw membersError;
            setParliamentarians((membersData || []).map(m => ({ id: m.id, name: m.full_name })));

        } catch (error) {
            toast({ title: "Erro ao buscar alvos da sugestão", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        if (isSuggestOpen) {
            fetchTargets();
        }
    }, [isSuggestOpen, fetchTargets]);

    const handleSuggestionSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const { data, error } = await supabase.rpc('submit_bill_suggestion', {
            p_title: `${suggestionData.bill_type}: ${suggestionData.title}`,
            p_suggestion: suggestionData.suggestion,
            p_target_type: suggestionData.target_type,
            p_target_id: suggestionData.target_id
        });
        if(error || (data && !data.success)) {
            toast({ title: "Erro ao enviar sugestão", description: error?.message || data.message, variant: 'destructive' });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setIsSuggestOpen(false);
            setSuggestionData({ title: '', suggestion: '', target_type: 'house', target_id: '', bill_type: 'PL' });
        }
        setLoading(false);
    };

    const handlePlebisciteSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const { data, error } = await supabase.rpc('request_plebiscite', {
            p_title: plebisciteData.title,
            p_description: plebisciteData.description
        });
        if(error || (data && !data.success)) {
            toast({ title: "Erro ao solicitar plebiscito", description: error?.message || data.message, variant: 'destructive' });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setIsPlebFormOpen(false);
            setPlebisciteData({ title: '', description: '' });
        }
        setLoading(false);
    };

    const getTargetOptions = () => {
        switch (suggestionData.target_type) {
            case 'house': return houses;
            case 'party': return parties;
            case 'parliamentarian': return parliamentarians;
            default: return [];
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
            <Dialog open={isSuggestOpen} onOpenChange={setIsSuggestOpen}>
                <DialogTrigger asChild>
                    <Card className="glass-effect hover:bg-accent/50 cursor-pointer transition-colors"><CardHeader><CardTitle className="flex items-center gap-2"><Inbox className="w-5 h-5 text-primary"/> Sugerir Projeto</CardTitle><CardDescription>Tem uma ideia para uma nova lei? Envie sua sugestão diretamente.</CardDescription></CardHeader></Card>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader><DialogTitle>Sugerir Projeto</DialogTitle><DialogDescription>Sua ideia pode se tornar uma lei. Preencha os campos abaixo.</DialogDescription></DialogHeader>
                    <form onSubmit={handleSuggestionSubmit} className="space-y-4 pt-4">
                        <div className="space-y-2">
                            <Label htmlFor="target_type">Enviar Para</Label>
                             <Select onValueChange={value => setSuggestionData(p => ({...p, target_type: value, target_id: ''}))} value={suggestionData.target_type}>
                                <SelectTrigger id="target_type"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="house">Casa Legislativa</SelectItem>
                                    <SelectItem value="party">Partido Político</SelectItem>
                                    <SelectItem value="parliamentarian">Parlamentar Específico</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="target_id">Destinatário Específico</Label>
                            <Select onValueChange={value => setSuggestionData(p => ({...p, target_id: value}))} value={suggestionData.target_id} disabled={loading}>
                                <SelectTrigger id="target_id"><SelectValue placeholder={loading ? 'Carregando...' : 'Selecione...'} /></SelectTrigger>
                                <SelectContent>
                                    {getTargetOptions().map(t=><SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-1 space-y-2">
                                <Label htmlFor="bill_type">Tipo</Label>
                                <Select value={suggestionData.bill_type} onValueChange={v => setSuggestionData(p => ({...p, bill_type: v}))}>
                                    <SelectTrigger id="bill_type"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="PL">PL</SelectItem>
                                        <SelectItem value="PEC">PEC</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="col-span-2 space-y-2">
                                <Label htmlFor="title">Título da Sugestão</Label>
                                <Input id="title" value={suggestionData.title} onChange={e=>setSuggestionData(p=>({...p, title:e.target.value}))} required/>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="suggestion">Sua Sugestão</Label>
                            <Textarea id="suggestion" value={suggestionData.suggestion} onChange={e=>setSuggestionData(p=>({...p, suggestion:e.target.value}))} required placeholder="Descreva sua ideia de projeto de lei detalhadamente..."/>
                        </div>
                        <DialogFooter><Button type="submit" disabled={loading || !suggestionData.target_id}>{loading ? <Loader2 className="animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />} Enviar Sugestão</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={isPlebChoiceOpen} onOpenChange={setIsPlebChoiceOpen}>
                <DialogTrigger asChild>
                    <Card className="glass-effect hover:bg-accent/50 cursor-pointer transition-colors"><CardHeader><CardTitle className="flex items-center gap-2"><Vote className="w-5 h-5 text-primary"/> Plebiscitos e Referendos</CardTitle><CardDescription>Participe de consultas populares ou solicite uma nova votação sobre temas importantes.</CardDescription></CardHeader></Card>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader><DialogTitle>Plebiscitos e Referendos</DialogTitle><DialogDescription>O que você gostaria de fazer?</DialogDescription></DialogHeader>
                    <div className="flex flex-col gap-4 pt-4">
                        <Button onClick={() => { setIsPlebChoiceOpen(false); setIsPlebFormOpen(true); }}><FileText className="mr-2 h-4 w-4"/>Solicitar uma nova votação</Button>
                        <Button variant="secondary" onClick={() => { setIsPlebChoiceOpen(false); onPlebAction(); }}><Hand className="mr-2 h-4 w-4"/>Participar de uma consulta ativa</Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isPlebFormOpen} onOpenChange={setIsPlebFormOpen}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Solicitar Plebiscito</DialogTitle><DialogDescription>Proponha um tema para ser votado pela população.</DialogDescription></DialogHeader>
                    <form onSubmit={handlePlebisciteSubmit} className="space-y-4 pt-4">
                        <div className="space-y-2"><Label htmlFor="pleb_title">Título do Plebiscito</Label><Input id="pleb_title" value={plebisciteData.title} onChange={e=>setPlebisciteData(p=>({...p, title:e.target.value}))} required/></div>
                        <div className="space-y-2"><Label htmlFor="pleb_desc">Descrição / Justificativa</Label><Textarea id="pleb_desc" value={plebisciteData.description} onChange={e=>setPlebisciteData(p=>({...p, description:e.target.value}))} required/></div>
                        <DialogFooter><Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin mr-2"/> : <Send className="w-4 h-4 mr-2" />}Solicitar</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
};

const ParliamentMembersList = ({ members }) => {
    if (!members || members.length === 0) {
        return <p className="text-muted-foreground text-center py-8">Nenhum membro nesta casa no momento.</p>;
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {members.map(member => (
                <Card key={member.id} className="glass-effect">
                    <CardContent className="p-4 flex items-center gap-4">
                        <Avatar className="w-12 h-12">
                            <AvatarImage src={member.profile.avatar_url} alt={member.profile.full_name} />
                            <AvatarFallback>{member.profile.full_name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div>
                            <Link to={`/services/x/profile/${member.profile.x_handle}`} className="font-semibold hover:underline">{member.profile.full_name}</Link>
                            <p className="text-sm text-muted-foreground">{member.political_parties?.name || 'Sem Partido'}</p>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
};

const PlebisciteList = ({ plebiscites, userVote, onVote, user }) => {
    const { toast } = useToast();
    const [votingOn, setVotingOn] = useState(null);

    const handleVote = async (plebisciteId, vote) => {
        setVotingOn(plebisciteId);
        const { data, error } = await supabase.rpc('cast_plebiscite_vote', { p_plebiscite_id: plebisciteId, p_vote: vote });
        if (error || (data && !data.success)) {
            toast({ title: "Erro ao votar", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Voto computado!", description: data.message });
            onVote();
        }
        setVotingOn(null);
    };

    const getStatusInfo = (status) => {
        switch (status) {
            case 'Pendente': return { text: 'Em Análise', color: 'bg-yellow-500/20 text-yellow-300' };
            case 'Ativo': return { text: 'Ativo', color: 'bg-green-500/20 text-green-300' };
            case 'Rejeitado': return { text: 'Rejeitado', color: 'bg-red-500/20 text-red-300' };
            case 'Aprovado': return { text: 'Aprovado', color: 'bg-blue-500/20 text-blue-300' };
            case 'Reprovado': return { text: 'Reprovado', color: 'bg-purple-500/20 text-purple-300' };
            default: return { text: status, color: 'bg-muted text-muted-foreground' };
        }
    };

    const COLORS = { 'Sim': '#22c55e', 'Não': '#ef4444', 'Abstenção': '#6b7280' };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {plebiscites.length > 0 ? plebiscites.map(pleb => {
                const statusInfo = getStatusInfo(pleb.status);
                const isVoting = votingOn === pleb.id;
                const userHasVoted = userVote?.[pleb.id];
                const canVote = user && user.role !== 'Usuário';

                const chartData = [
                    { name: 'Sim', value: pleb.votes_sim || 0 },
                    { name: 'Não', value: pleb.votes_nao || 0 },
                    { name: 'Abstenção', value: pleb.votes_abstencao || 0 },
                ].filter(item => item.value > 0);

                return (
                    <motion.div key={pleb.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <Card className="glass-effect h-full flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-foreground">{pleb.title}</CardTitle>
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage src={pleb.author_avatar_url} alt={pleb.author_name}/>
                                    <AvatarFallback>{pleb.author_name?.[0]}</AvatarFallback>
                                  </Avatar>
                                  <CardDescription>Sugerido por {pleb.author_name} {formatDistanceToNow(new Date(pleb.created_at), { addSuffix: true, locale: ptBR })}</CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="flex-grow">
                                <p className="text-sm text-muted-foreground">{pleb.description}</p>
                                {pleb.status === 'Ativo' && (
                                    <div className="w-full h-48 mt-4">
                                        <ResponsiveContainer>
                                            <PieChart>
                                                <Pie data={chartData.length > 0 ? chartData : [{ name: 'Sem Votos', value: 1 }]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} fill="#8884d8" label={chartData.length > 0}>
                                                    {chartData.length > 0 ? chartData.map((entry, index) => (
                                                        <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
                                                    )) : <Cell fill="#4b5563" />}
                                                </Pie>
                                                <Tooltip />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex-col items-start gap-4">
                                <span className={`px-2 py-1 text-xs rounded-full ${statusInfo.color}`}>{statusInfo.text}</span>
                                {pleb.status === 'Ativo' && canVote && (
                                    isVoting ? (
                                        <div className="w-full flex justify-center"><Loader2 className="animate-spin" /></div>
                                    ) : userHasVoted ? (
                                        <p className="text-sm text-muted-foreground w-full text-center">Seu voto: <span className="font-bold">{userHasVoted}</span></p>
                                    ) : (
                                        <div className="flex gap-2 w-full">
                                            <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => handleVote(pleb.id, 'Sim')}><ThumbsUp className="w-4 h-4 mr-2" />Sim</Button>
                                            <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => handleVote(pleb.id, 'Não')}><ThumbsDown className="w-4 h-4 mr-2" />Não</Button>
                                            <Button size="sm" className="flex-1 bg-gray-600 hover:bg-gray-700" onClick={() => handleVote(pleb.id, 'Abstenção')}><UserX className="w-4 h-4 mr-2" />Abster</Button>
                                        </div>
                                    )
                                )}
                                {pleb.status === 'Ativo' && !canVote && (
                                    <p className="text-sm text-muted-foreground w-full text-center">Apenas cidadãos com cargos podem votar.</p>
                                )}
                            </CardFooter>
                        </Card>
                    </motion.div>
                )
            }) : <p className="col-span-full text-center text-muted-foreground py-10">Nenhum plebiscito encontrado.</p>}
        </div>
    );
};

const Parliament = () => {
    const { toast } = useToast();
    const [houses, setHouses] = useState([]);
    const [bills, setBills] = useState([]);
    const [plebiscites, setPlebiscites] = useState([]);
    const [userPlebiscitesVotes, setUserPlebiscitesVotes] = useState({});
    const [allMembers, setAllMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();
    const [parliamentMember, setParliamentMember] = useState(null);
    const [activeTab, setActiveTab] = useState('members');
    const [selectedHouse, setSelectedHouse] = useState('all');

    const fetchParliamentData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: housesData, error: housesError } = await supabase.from('parliament_houses').select('*');
            if (housesError) throw housesError;
            setHouses(housesData || []);

            const { data: membersData, error: membersError } = await supabase.from('parliament_members').select('*, profile:profiles(*), political_parties:political_parties(*)');
            if (membersError) throw membersError;
            setAllMembers(membersData || []);

            const { data: billsData, error: billsError } = await supabase.from('bills').select('*, author:profiles(full_name), house:parliament_houses(id, name), votes:bill_votes(*, member:parliament_members(user:profiles(full_name)))').order('created_at', { ascending: false });
            if (billsError) throw billsError;
            setBills(billsData || []);

            const { data: plebiscitesData, error: plebiscitesError } = await supabase
                .from('plebiscites')
                .select(`id, title, description, status, author_id, start_date, end_date, created_at, updated_at, approved_by_house_id, author_name, author_avatar_url, votes_sim, votes_nao, votes_abstencao`)
                .order('created_at', { ascending: false });

            if (plebiscitesError) throw plebiscitesError;

            setPlebiscites(plebiscitesData || []);

            if (user) {
                const { data: memberStatus, error: memberStatusError } = await supabase.from('parliament_members').select('id, house_id').eq('user_id', user.id).maybeSingle();
                if (memberStatusError && memberStatusError.code !== 'PGRST116') throw memberStatusError;
                setParliamentMember(memberStatus);

                const { data: plebVotes, error: plebVotesError } = await supabase.from('plebiscite_votes').select('plebiscite_id, vote').eq('voter_id', user.id);
                if (plebVotesError) throw plebVotesError;
                setUserPlebiscitesVotes(plebVotes.reduce((acc, v) => ({ ...acc, [v.plebiscite_id]: v.vote }), {}));
            }
        } catch (error) {
            toast({ title: "Erro ao carregar dados do parlamento", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast, user]);

    useEffect(() => {
        fetchParliamentData();

        const channel = supabase.channel('plebiscite_votes')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'plebiscite_votes' }, fetchParliamentData)
          .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchParliamentData]);

    if (loading) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;

    const filteredMembers = selectedHouse === 'all' ? allMembers : allMembers.filter(m => m.house_id === selectedHouse);
    const filteredBills = selectedHouse === 'all' ? bills : bills.filter(b => b.house_id === selectedHouse);
    const membersByHouse = houses.reduce((acc, house) => {
        acc[house.id] = filteredMembers.filter(m => m.house_id === house.id);
        return acc;
    }, {});


    return (
        <>
            <Helmet><title>Parlamento Cidadão - GOV.RP</title><meta name="description" content="Acompanhe as atividades legislativas, projetos de lei e participe da vida política." /></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader icon={Scale} title="Parlamento" gradientText="Cidadão" description="O coração legislativo da nação. Acompanhe, sugira e participe." iconColor="text-yellow-400" centered={true} />
                <CitizenActions onPlebAction={() => setActiveTab('plebiscites')} />
                <div className="mt-12">
                     <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                            <TabsList className="grid w-full grid-cols-3 md:w-auto">
                                <TabsTrigger value="members">Membros</TabsTrigger>
                                <TabsTrigger value="bills">Projetos</TabsTrigger>
                                <TabsTrigger value="plebiscites">Plebiscitos</TabsTrigger>
                            </TabsList>
                             <Select onValueChange={setSelectedHouse} value={selectedHouse}>
                                <SelectTrigger className="w-full md:w-[240px]"><SelectValue placeholder="Filtrar por Casa" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as Casas</SelectItem>
                                    {houses.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <TabsContent value="members">
                            { (selectedHouse === 'all' ? houses : houses.filter(h => h.id === selectedHouse)).map(house => (
                                <div key={house.id} className="mb-8">
                                    <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl flex items-center gap-3 mb-4"><Landmark className="w-6 h-6"/>{house.name}</h2>
                                    <ParliamentMembersList members={membersByHouse[house.id]} />
                                </div>
                            ))}
                        </TabsContent>
                        <TabsContent value="bills"><BillList bills={filteredBills} user={user} parliamentMember={parliamentMember} onAction={fetchParliamentData} /></TabsContent>
                        <TabsContent value="plebiscites"><PlebisciteList plebiscites={plebiscites} userVote={userPlebiscitesVotes} onVote={fetchParliamentData} user={user} /></TabsContent>
                    </Tabs>
                </div>
            </div>
        </>
    );
};

const BillList = ({ bills, user, parliamentMember, onAction }) => {
    const { toast } = useToast();

    const handleVote = async (bill_id, vote) => {
        if (!parliamentMember) {
            toast({ title: "Acesso negado", description: "Apenas membros do parlamento podem votar.", variant: "destructive" });
            return;
        }

        const { error } = await supabase.from('bill_votes').insert({
            bill_id,
            member_id: parliamentMember.id,
            vote
        });

        if (error) {
            if (error.code === '23505') {
                 toast({ title: "Voto já computado", description: "Você já votou neste projeto.", variant: "default" });
            } else {
                toast({ title: "Erro ao votar", description: error.message, variant: "destructive" });
            }
        } else {
            toast({ title: "Voto computado!", description: `Você votou '${vote}'.` });
            onAction();
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bills.length > 0 ? bills.map(bill => {
                const votesFor = bill.votes.filter(v => v.vote === 'Sim').length;
                const votesAgainst = bill.votes.filter(v => v.vote === 'Não').length;
                const votesAbstain = bill.votes.filter(v => v.vote === 'Abstenção').length;
                const totalVotes = votesFor + votesAgainst + votesAbstain;
                const userVote = bill.votes.find(v => v.member_id === parliamentMember?.id)?.vote;

                return (
                    <motion.div key={bill.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <Card className="glass-effect h-full flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-foreground">{bill.title}</CardTitle>
                                <CardDescription>Autor: {bill.author.full_name} | {bill.house.name}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow">
                                <p className="text-sm text-muted-foreground line-clamp-3">{bill.summary}</p>
                                <div className="mt-4">
                                    <span className={`px-2 py-1 text-xs rounded-full ${
                                        bill.status === 'Aprovado' ? 'bg-green-500/20 text-green-300' :
                                        bill.status === 'Rejeitado' ? 'bg-red-500/20 text-red-300' :
                                        'bg-yellow-500/20 text-yellow-300'
                                    }`}>{bill.status}</span>
                                </div>
                                <Collapsible className="mt-4">
                                    <CollapsibleTrigger asChild><Button variant="link" className="p-0 h-auto text-sm"><Users className="w-4 h-4 mr-2"/> Ver Votos ({totalVotes})</Button></CollapsibleTrigger>
                                    <CollapsibleContent className="mt-2 space-y-2 text-xs max-h-40 overflow-y-auto">
                                        {bill.votes.map(vote => (
                                            <div key={vote.id} className="flex justify-between items-center">
                                                <span>{vote.member.user.full_name}</span>
                                                <span className={`font-bold ${vote.vote === 'Sim' ? 'text-green-400' : vote.vote === 'Não' ? 'text-red-400' : 'text-gray-400'}`}>{vote.vote}</span>
                                            </div>
                                        ))}
                                        {bill.votes.length === 0 && <p className="text-muted-foreground text-center">Nenhum voto registrado.</p>}
                                    </CollapsibleContent>
                                </Collapsible>
                                <div className="mt-4 space-y-2">
                                    <div className="flex gap-1">
                                       {totalVotes > 0 && <Progress value={votesFor} max={totalVotes} className="flex-1 h-2" indicatorClassName="bg-green-500" />}
                                       {totalVotes > 0 && <Progress value={votesAgainst} max={totalVotes} className="flex-1 h-2" indicatorClassName="bg-red-500" />}
                                       {totalVotes > 0 && <Progress value={votesAbstain} max={totalVotes} className="flex-1 h-2" indicatorClassName="bg-gray-500" />}
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-green-400">Sim: {votesFor}</span>
                                        <span className="text-red-400">Não: {votesAgainst}</span>
                                        <span className="text-gray-400">Abs: {votesAbstain}</span>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter>
                                {parliamentMember && parliamentMember.house_id === bill.house_id && !userVote && bill.status === 'Em tramitação' && (
                                    <div className="flex gap-2 w-full">
                                        <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => handleVote(bill.id, 'Sim')}><ThumbsUp className="w-4 h-4 mr-2" />Sim</Button>
                                        <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => handleVote(bill.id, 'Não')}><ThumbsDown className="w-4 h-4 mr-2" />Não</Button>
                                        <Button size="sm" className="flex-1 bg-gray-600 hover:bg-gray-700" onClick={() => handleVote(bill.id, 'Abstenção')}><UserX className="w-4 h-4 mr-2" />Abster</Button>
                                    </div>
                                )}
                                {userVote && <p className="text-sm text-center w-full text-muted-foreground">Seu voto: <span className="font-bold">{userVote}</span></p>}
                            </CardFooter>
                        </Card>
                    </motion.div>
                )
            }) : <p className="col-span-full text-center text-muted-foreground py-10">Nenhum projeto de lei encontrado.</p>}
        </div>
    );
}

export default Parliament;
