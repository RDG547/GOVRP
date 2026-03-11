import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { Landmark, FileText, Vote, Users, PlusCircle, Check, X, ShieldCheck, Mail, Megaphone, Loader2, Scale, UserCheck, Gavel, UserX } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import PageHeader from '@/components/layout/PageHeader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const ParliamentPanel = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [accessData, setAccessData] = useState({ hasAccess: false, reason: 'Verificando...' });
    const [parliamentMember, setParliamentMember] = useState(null);
    const [house, setHouse] = useState(null);
    const [bills, setBills] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [plebisciteRequests, setPlebiscitesRequests] = useState([]);
    const [members, setMembers] = useState([]);
    const [isProposeBillOpen, setIsProposeBillOpen] = useState(false);
    const [newBill, setNewBill] = useState({ title: '', summary: '', full_text: '', type: 'PL' });
    const [proposingBill, setProposingBill] = useState(false);
    const [adminTargetHouseId, setAdminTargetHouseId] = useState('a1b2c3d4-e5f6-7890-1234-567890abcdef'); // Default to Câmara
    const [votings, setVotings] = useState([]);
    const [activeMainTab, setActiveMainTab] = useState('projects');
    const [activeSubTab, setActiveSubTab] = useState('citizen_suggestions');
    const [votingOn, setVotingOn] = useState(null);

    const houseConfig = {
        'a1b2c3d4-e5f6-7890-1234-567890abcdef': { name: 'Câmara dos Deputados', memberRole: 'Deputado', presidentRole: 'Presidente da Câmara dos Deputados' },
        'fedcba09-8765-4321-0987-654321fedcba': { name: 'Senado Federal', memberRole: 'Senador', presidentRole: 'Presidente do Senado' },
    };

    const fetchPanelData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: access, error: accessError } = await supabase.rpc('get_parliament_access_data', { p_user_id: user.id });

        if (accessError || !access.has_access) {
            setAccessData({ hasAccess: false, reason: access?.reason || accessError?.message || "Acesso negado." });
            setLoading(false);
            return;
        }

        setAccessData({ hasAccess: true });

        try {
            const currentHouseId = access.is_admin ? adminTargetHouseId : access.house?.id;

            if (!currentHouseId) {
                throw new Error("Não foi possível determinar a casa legislativa. Verifique sua filiação parlamentar.");
            }

            const currentHouse = houseConfig[currentHouseId];
            if (!currentHouse) {
                throw new Error(`Configuração da casa legislativa não encontrada para o ID: ${currentHouseId}`);
            }

            setParliamentMember(access.member);
            setHouse({ id: currentHouseId, ...currentHouse });

            const { memberRole, presidentRole } = currentHouse;

            const [billsRes, suggestionsRes, plebiscitesRes, membersRes, votingsRes] = await Promise.all([
                supabase.from('bills').select('*, author:profiles(full_name, role)').eq('house_id', currentHouseId),
                supabase.from('bill_suggestions').select('*, author:profiles(id, full_name, role, avatar_url)').eq('target_id', currentHouseId).eq('target_type', 'house'),
                supabase.from('plebiscites').select('*, author:profiles(id, full_name, avatar_url)').eq('status', 'Pendente'),
                supabase.from('parliament_members').select('profile:profiles(*), party:political_parties(name, acronym, logo_url)').eq('house_id', currentHouseId),
                supabase.from('parliament_votings').select('*, votes:parliament_voting_votes(vote), user_vote:parliament_voting_votes(vote, member_id)').eq('house_id', currentHouseId).eq('status', 'active'),
            ]);

            if (billsRes.error) throw billsRes.error;
            setBills(billsRes.data || []);

            if (suggestionsRes.error) throw suggestionsRes.error;
            setSuggestions(suggestionsRes.data || []);

            if (plebiscitesRes.error) throw plebiscitesRes.error;
            setPlebiscitesRequests(plebiscitesRes.data || []);

            if (membersRes.error) throw membersRes.error;
            setMembers(membersRes.data.map(m => ({ ...m.profile, party: m.party })) || []);

            if (votingsRes.error) throw votingsRes.error;
            const filteredVotings = (votingsRes.data || []).filter(v => v.type !== 'plebiscite');
            const enrichedVotings = await Promise.all(filteredVotings.map(async (voting) => {
                let relatedItem = null;
                if (voting.type === 'suggestion' && voting.related_id) {
                    const { data } = await supabase.from('bill_suggestions').select('title').eq('id', voting.related_id).single();
                    relatedItem = data;
                } else if (voting.type === 'bill' && voting.related_id) {
                    const { data } = await supabase.from('bills').select('title').eq('id', voting.related_id).single();
                    relatedItem = data;
                }
                return { ...voting, relatedItem };
            }));
            setVotings(enrichedVotings || []);

        } catch (error) {
            console.error("Erro ao buscar dados do painel do parlamento:", error);
            toast({ title: "Erro ao carregar dados", description: error.message, variant: "destructive" });
            setAccessData({ hasAccess: false, reason: error.message || 'Erro ao carregar dados.' });
        } finally {
            setLoading(false);
        }
    }, [user, toast, adminTargetHouseId]);

    useEffect(() => {
        fetchPanelData();
        const channel = supabase.channel('parliament_panel_changes')
          .on('postgres_changes', { event: '*', schema: 'public', table: '*' }, fetchPanelData)
          .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchPanelData]);

    const handleProposeBill = async () => {
        setProposingBill(true);
        try {
            const billData = {
                ...newBill,
                author_id: user.id,
                house_id: house.id,
                author_role: user.role,
                status: 'Em tramitação'
            };

            const { error } = await supabase.from('bills').insert(billData);

            if (error) throw error;
            toast({ title: "Sucesso!", description: "Projeto proposto." });
            setIsProposeBillOpen(false);
            setNewBill({ title: '', summary: '', full_text: '', type: 'PL' });
            fetchPanelData();
        } catch (error) {
            toast({ title: "Erro ao propor projeto", description: error.message, variant: "destructive" });
        }
        setProposingBill(false);
    };

    const handleSuggestionStatus = async (suggestionId, status) => {
        try {
            if (status === 'aceita') {
                const { error: rpcError } = await supabase.rpc('handle_suggestion_acceptance', { p_suggestion_id: suggestionId, p_house_id: house.id });
                if (rpcError) throw rpcError;
                toast({ title: "Sucesso!", description: `Sugestão aceita e enviada para votação.` });
                setActiveMainTab('votes');
            } else {
                 await supabase.from('bill_suggestions').update({ status }).eq('id', suggestionId);
                 toast({ title: "Sucesso!", description: `Sugestão rejeitada.` });
            }
            fetchPanelData();
        } catch (error) {
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        }
    };

    const handlePlebiscitesStatus = async (plebisciteId, action) => {
        const rpcName = action === 'approve' ? 'approve_plebiscite' : 'reject_plebiscite';
        const { data, error } = await supabase.rpc(rpcName, { p_plebiscite_id: plebisciteId, p_house_id: house.id });
        if (error || (data && !data.success)) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            fetchPanelData();
        }
    };

    const handleParliamentVote = async (votingId, vote) => {
        setVotingOn(votingId);
        const { data, error } = await supabase.rpc('cast_parliament_vote', {
            p_voting_id: votingId,
            p_member_id: parliamentMember.id,
            p_vote: vote
        });
        if (error || (data && !data.success)) {
            toast({ title: "Erro ao votar", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Voto computado!", description: data.message });
            fetchPanelData();
        }
        setVotingOn(null);
    };

    const canStartVote = user.role === 'Admin' || user.role === 'Presidente da Câmara dos Deputados' || user.role === 'Presidente do Senado';

    if (loading) return <div className="flex items-center justify-center h-screen"><Loader2 className="w-16 h-16 animate-spin" /></div>;

    if (!accessData.hasAccess) {
        return (
             <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
                <Alert variant="destructive">
                    <ShieldCheck className="h-4 w-4" />
                    <AlertTitle>Acesso Negado</AlertTitle>
                    <AlertDescription>{accessData.reason || 'Você não tem as permissões necessárias para acessar o painel do parlamento.'}</AlertDescription>
                </Alert>
            </div>
        );
    }

    const StatusBadge = ({ status }) => {
        const statusConfig = {
            'Pendente': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
            'rejeitada': 'bg-red-500/20 text-red-400 border-red-500/30',
            'em_votacao': 'bg-green-500/20 text-green-400 border-green-500/30',
        };
        const statusText = {
            'Pendente': 'Em Análise',
            'rejeitada': 'Rejeitado',
            'em_votacao': 'Em Votação',
        };
        return <Badge variant="outline" className={statusConfig[status] || ''}>{statusText[status] || status}</Badge>;
    };

    const COLORS = { 'Aprovar': '#22c55e', 'Rejeitar': '#ef4444', 'Abster': '#6b7280' };

    return (
        <>
            <Helmet><title>Painel do Parlamento</title></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader icon={Scale} title="Painel do" gradientText="Parlamento" description={`Bem-vindo ao painel da ${house?.name || 'Casa Legislativa'}.`} iconColor="text-yellow-400" centered={true}/>

                {user?.role === 'Admin' && (
                    <div className="mb-4">
                        <Label>Operando como Admin na:</Label>
                        <Select value={adminTargetHouseId} onValueChange={setAdminTargetHouseId}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="a1b2c3d4-e5f6-7890-1234-567890abcdef">Câmara dos Deputados</SelectItem>
                                <SelectItem value="fedcba09-8765-4321-0987-654321fedcba">Senado Federal</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}

                <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
                        <TabsTrigger value="projects">Projetos e Sugestões</TabsTrigger>
                        <TabsTrigger value="votes">Votações</TabsTrigger>
                        <TabsTrigger value="plebiscites">Plebiscitos</TabsTrigger>
                        <TabsTrigger value="members">Membros</TabsTrigger>
                    </TabsList>

                    <motion.div key={adminTargetHouseId} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-6">
                        <TabsContent value="projects">
                            <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="member_projects">Projetos dos Membros</TabsTrigger>
                                    <TabsTrigger value="citizen_suggestions">Sugestões Populares</TabsTrigger>
                                </TabsList>
                                <TabsContent value="member_projects" className="mt-4">
                                    <Card className="glass-effect">
                                        <CardHeader className="flex flex-row items-center justify-between">
                                            <div>
                                                <CardTitle>Projetos dos Membros ({house?.name})</CardTitle>
                                                <CardDescription>Projetos propostos por {house?.name === 'Câmara dos Deputados' ? 'Deputados' : 'Senadores'}.</CardDescription>
                                            </div>
                                            <Button onClick={() => setIsProposeBillOpen(true)}><PlusCircle className="mr-2 h-4 w-4"/>Propor Projeto</Button>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-4">
                                            {bills.length > 0 ? bills.map(bill => (
                                                <Card key={bill.id} className="bg-background/50">
                                                    <CardHeader>
                                                        <CardTitle>{bill.title} <span className="text-sm font-normal text-muted-foreground">({bill.type})</span></CardTitle>
                                                        <CardDescription>Autor: {bill.author?.full_name || 'Desconhecido'} | Status: {bill.status}</CardDescription>
                                                    </CardHeader>
                                                    <CardContent><p>{bill.summary}</p></CardContent>
                                                    {canStartVote && bill.status === 'Em tramitação' && (
                                                        <CardFooter>
                                                            <Button size="sm"><Gavel className="w-4 h-4 mr-2" /> Colocar em Votação</Button>
                                                        </CardFooter>
                                                    )}
                                                </Card>
                                            )) : <p className="text-center py-4">Nenhum projeto em tramitação nesta casa.</p>}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                                <TabsContent value="citizen_suggestions" className="mt-4">
                                    <Card className="glass-effect">
                                        <CardHeader>
                                            <CardTitle>Sugestões Populares</CardTitle>
                                            <CardDescription>Sugestões de projetos enviadas por cidadãos para esta casa.</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-4">
                                            {suggestions.length > 0 ? suggestions.map(sug => (
                                                <Card key={sug.id} className="bg-background/50">
                                                    <CardHeader>
                                                        <div className="flex justify-between items-start">
                                                          <div>
                                                            <CardTitle>{sug.title}</CardTitle>
                                                             <div className="flex items-center gap-2 mt-1">
                                                                <Avatar className="w-6 h-6">
                                                                    <AvatarImage src={sug.author?.avatar_url} />
                                                                    <AvatarFallback>{sug.author?.full_name?.charAt(0) || 'A'}</AvatarFallback>
                                                                </Avatar>
                                                                <CardDescription>De: {sug.author?.full_name || 'Anônimo'}</CardDescription>
                                                            </div>
                                                          </div>
                                                          <StatusBadge status={sug.status} />
                                                        </div>
                                                    </CardHeader>
                                                    <CardContent><p>{sug.suggestion}</p></CardContent>
                                                    {sug.status === 'Pendente' && canStartVote && (
                                                        <CardFooter className="gap-2">
                                                            <Button size="sm" onClick={() => handleSuggestionStatus(sug.id, 'aceita')}><Check className="mr-2 h-4 w-4"/>Aceitar e Votar</Button>
                                                            <Button size="sm" variant="destructive" onClick={() => handleSuggestionStatus(sug.id, 'rejeitada')}><X className="mr-2 h-4 w-4"/>Rejeitar</Button>
                                                        </CardFooter>
                                                    )}
                                                </Card>
                                            )) : <p className="text-center py-4">Nenhuma sugestão popular recebida.</p>}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>
                        </TabsContent>

                        <TabsContent value="votes">
                            <Card className="glass-effect">
                                <CardHeader>
                                    <CardTitle>Sessões de Votação</CardTitle>
                                    <CardDescription>Participe das votações em andamento na sua casa legislativa.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {votings.length > 0 ? (
                                        <div className="space-y-4">
                                            {votings.map(voting => {
                                                const userHasVoted = voting.user_vote.some(v => v.member_id === parliamentMember.id);
                                                const isVotingProcess = votingOn === voting.id;
                                                const votesSim = voting.votes.filter(v => v.vote === 'Aprovar').length;
                                                const votesNao = voting.votes.filter(v => v.vote === 'Rejeitar').length;
                                                const votesAbs = voting.votes.filter(v => v.vote === 'Abster').length;
                                                const chartData = [
                                                    { name: 'Aprovar', value: votesSim },
                                                    { name: 'Rejeitar', value: votesNao },
                                                    { name: 'Abster', value: votesAbs },
                                                ].filter(item => item.value > 0);

                                                return (
                                                <Card key={voting.id} className="bg-background/50">
                                                    <CardHeader>
                                                      <CardTitle>{voting.title || voting.relatedItem?.title || 'Votação sem Título'}</CardTitle>
                                                      <CardDescription>{voting.description}</CardDescription>
                                                    </CardHeader>
                                                    <CardContent>
                                                        {chartData.length > 0 && (
                                                            <div className="w-full h-48">
                                                                <ResponsiveContainer>
                                                                    <PieChart>
                                                                        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} fill="#8884d8" label>
                                                                            {chartData.map((entry, index) => (
                                                                                <Cell key={`cell-${index}`} fill={COLORS[entry.name]} />
                                                                            ))}
                                                                        </Pie>
                                                                        <Tooltip />
                                                                        <Legend />
                                                                    </PieChart>
                                                                </ResponsiveContainer>
                                                            </div>
                                                        )}
                                                    </CardContent>
                                                    <CardFooter className="gap-2">
                                                        {isVotingProcess ? (
                                                            <Loader2 className="animate-spin" />
                                                        ) : userHasVoted ? (
                                                            <p className="text-sm text-muted-foreground">Você já votou nesta sessão.</p>
                                                        ) : (
                                                            <>
                                                                <Button size="sm" variant="outline" className="bg-green-500/10 border-green-500 text-green-400 hover:bg-green-500/20" onClick={() => handleParliamentVote(voting.id, 'Aprovar')}><Check className="w-4 h-4 mr-2" />Aprovar</Button>
                                                                <Button size="sm" variant="destructive" onClick={() => handleParliamentVote(voting.id, 'Rejeitar')}><X className="w-4 h-4 mr-2" />Rejeitar</Button>
                                                                <Button size="sm" variant="secondary" onClick={() => handleParliamentVote(voting.id, 'Abster')}><UserX className="w-4 h-4 mr-2" />Abster</Button>
                                                            </>
                                                        )}
                                                    </CardFooter>
                                                </Card>
                                            )})}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8">
                                            <Vote className="mx-auto h-12 w-12 text-muted-foreground" />
                                            <h3 className="mt-4 text-lg font-semibold">Nenhuma votação em andamento</h3>
                                            <p className="mt-1 text-sm text-muted-foreground">Volte mais tarde para participar de votações.</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="plebiscites">
                             <Card className="glass-effect">
                                <CardHeader>
                                    <CardTitle>Solicitações de Plebiscitos</CardTitle>
                                    <CardDescription>Analise e aprove ou rejeite as solicitações de plebiscitos da população.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-4">
                                    {plebisciteRequests.length > 0 ? plebisciteRequests.map(req => (
                                        <Card key={req.id} className="bg-background/50">
                                            <CardHeader>
                                                <CardTitle className="flex items-center gap-2">{req.title}</CardTitle>
                                                <div className="flex items-center gap-2">
                                                    <Avatar className="w-6 h-6">
                                                        <AvatarImage src={req.author?.avatar_url} />
                                                        <AvatarFallback>{req.author?.full_name?.charAt(0) || '?'}</AvatarFallback>
                                                    </Avatar>
                                                    <CardDescription>Sugerido por: {req.author?.full_name || 'Cidadão'}</CardDescription>
                                                </div>
                                            </CardHeader>
                                            <CardContent><p>{req.description}</p></CardContent>
                                            <CardFooter className="gap-2">
                                                <Button size="sm" variant="outline" className="bg-green-500/10 border-green-500 text-green-400 hover:bg-green-500/20" onClick={() => handlePlebiscitesStatus(req.id, 'approve')}><Check className="w-4 h-4 mr-2" /> Aprovar Plebiscito</Button>
                                                <Button size="sm" variant="destructive" onClick={() => handlePlebiscitesStatus(req.id, 'reject')}><X className="w-4 h-4 mr-2" />Rejeitar</Button>
                                            </CardFooter>
                                        </Card>
                                    )) : <p className="text-center py-4">Nenhuma solicitação de plebiscito pendente.</p>}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="members">
                             <Card className="glass-effect">
                                 <CardHeader><CardTitle>Membros {house?.name === 'Senado Federal' ? 'do Senado' : `da ${house?.name}`}</CardTitle></CardHeader>
                                 <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {members.length > 0 ? members.map(member => (
                                        <Card key={member.id} className="bg-background/30 p-4 flex flex-col items-center text-center">
                                            <Avatar className="w-20 h-20 mb-4">
                                                <AvatarImage src={member.avatar_url} />
                                                <AvatarFallback>{member.full_name?.charAt(0)}</AvatarFallback>
                                            </Avatar>
                                            <CardTitle className="text-lg">{member.full_name}</CardTitle>
                                            <CardDescription>@{member.x_handle}</CardDescription>
                                            {member.party && (
                                                <Badge variant="secondary" className="mt-2 flex items-center gap-2">
                                                    <Avatar className="w-4 h-4">
                                                        <AvatarImage src={member.party.logo_url} />
                                                        <AvatarFallback>{member.party.acronym?.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    {member.party.acronym}
                                                </Badge>
                                            )}
                                        </Card>
                                    )) : <p className="col-span-full text-center py-4">Nenhum membro encontrado.</p>}
                                 </CardContent>
                             </Card>
                        </TabsContent>
                    </motion.div>
                </Tabs>
            </div>

            <Dialog open={isProposeBillOpen} onOpenChange={setIsProposeBillOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Propor Novo Projeto</DialogTitle>
                        <DialogDescription>Preencha os detalhes do seu projeto de lei ou proposta de emenda.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {user?.role === 'Admin' && (
                            <div>
                                <Label>Casa Legislativa de Destino</Label>
                                <Select value={adminTargetHouseId} onValueChange={setAdminTargetHouseId}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="a1b2c3d4-e5f6-7890-1234-567890abcdef">Câmara dos Deputados</SelectItem>
                                        <SelectItem value="fedcba09-8765-4321-0987-654321fedcba">Senado Federal</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        <div>
                            <Label htmlFor="type">Tipo de Projeto</Label>
                            <Select value={newBill.type} onValueChange={(v) => setNewBill(p => ({ ...p, type: v }))}>
                                <SelectTrigger id="type"><SelectValue/></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="PL">Projeto de Lei (PL)</SelectItem>
                                    <SelectItem value="PEC">Proposta de Emenda à Constituição (PEC)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div><Label htmlFor="title">Título</Label><Input id="title" value={newBill.title} onChange={(e) => setNewBill(p => ({ ...p, title: e.target.value }))} /></div>
                        <div><Label htmlFor="summary">Resumo</Label><Textarea id="summary" value={newBill.summary} onChange={(e) => setNewBill(p => ({ ...p, summary: e.target.value }))} /></div>
                        <div><Label htmlFor="full_text">Texto Completo</Label><Textarea id="full_text" value={newBill.full_text} onChange={(e) => setNewBill(p => ({ ...p, full_text: e.target.value }))} rows={10} /></div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsProposeBillOpen(false)}>Cancelar</Button>
                        <Button onClick={handleProposeBill} disabled={proposingBill}>{proposingBill && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Propor Projeto</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ParliamentPanel;
