import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Scale, FileText, PlusCircle, ThumbsUp, ThumbsDown, UserX, Edit, ChevronDown, ChevronUp, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const ProposeBillDialog = ({ onBillProposed, houses }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ title: '', summary: '', full_text: '', house_id: '', type: 'Projeto de Lei' });

    const isParliamentMember = ['Deputado', 'Senador', 'Admin'].some(role => (Array.isArray(user?.role) ? user.role.includes(role) : user?.role === role));

    const handleOpenChange = (open) => {
        if (open && !isParliamentMember) {
            toast({
                title: "Acesso Negado",
                description: "Apenas parlamentares (Deputados, Senadores) e Admins podem propor projetos.",
                variant: "destructive",
            });
            return;
        }
        setIsOpen(open);
    };

    const handleChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSelectChange = (id, value) => {
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        
        const billData = {
            title: formData.title,
            summary: formData.summary,
            full_text: formData.full_text,
            author_id: user.id,
            house_id: formData.house_id,
            status: 'Em tramitação',
            type: formData.type
        };

        const { error } = await supabase.from('bills').insert(billData);

        if (error) {
            toast({ title: 'Erro ao propor projeto', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Projeto proposto com sucesso.' });
            onBillProposed();
            setIsOpen(false);
            setFormData({ title: '', summary: '', full_text: '', house_id: '', type: 'Projeto de Lei' });
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" /> Propor Projeto
                </Button>
            </DialogTrigger>
            <DialogContent className="glass-effect">
                <DialogHeader>
                    <DialogTitle>Propor Projeto Legislativo</DialogTitle>
                    <DialogDescription>Preencha os detalhes da sua proposta.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="type">Tipo de Proposta</Label>
                        <Select onValueChange={(value) => handleSelectChange('type', value)} defaultValue={formData.type}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="Projeto de Lei">Projeto de Lei</SelectItem><SelectItem value="PEC">PEC (Proposta de Emenda à Constituição)</SelectItem></SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="title">Título</Label>
                        <Input id="title" value={formData.title} onChange={handleChange} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="house_id">Casa Legislativa</Label>
                        <Select onValueChange={(value) => handleSelectChange('house_id', value)} value={formData.house_id} required>
                            <SelectTrigger><SelectValue placeholder="Selecione a casa" /></SelectTrigger>
                            <SelectContent>
                                {houses.map(house => <SelectItem key={house.id} value={house.id}>{house.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="summary">Resumo</Label>
                        <Textarea id="summary" value={formData.summary} onChange={handleChange} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="full_text">Texto Completo</Label>
                        <Textarea id="full_text" value={formData.full_text} onChange={handleChange} rows={6} />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Propor
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const Parliament = () => {
    const { toast } = useToast();
    const [houses, setHouses] = useState([]);
    const [bills, setBills] = useState([]);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();
    const [parliamentMember, setParliamentMember] = useState(null);
    const [activeTab, setActiveTab] = useState('all');

    const fetchParliamentData = useCallback(async () => {
        setLoading(true);
        const { data: housesData, error: housesError } = await supabase.from('parliament_houses').select('*');
        if (housesError) toast({ title: "Erro ao carregar casas legislativas", variant: "destructive" });
        else {
            setHouses(housesData || []);
            if (!activeTab || activeTab === 'all') {
                setActiveTab('all');
            }
        }

        const { data: billsData, error: billsError } = await supabase
            .from('bills')
            .select('*, author:profiles(full_name), house:parliament_houses(id, name), votes:bill_votes(*, member:parliament_members(user:profiles(full_name)))')
            .order('created_at', { ascending: false });
        if (billsError) toast({ title: "Erro ao carregar projetos de lei", description: billsError.message, variant: "destructive" });
        else setBills(billsData || []);
        
        if (user) {
            const { data: memberData, error: memberError } = await supabase
                .from('parliament_members')
                .select('id, house_id')
                .eq('user_id', user.id)
                .maybeSingle();
            if (memberError && memberError.code !== 'PGRST116') toast({ title: "Erro ao verificar status de parlamentar", variant: "destructive" });
            else setParliamentMember(memberData);
        }

        setLoading(false);
    }, [toast, user, activeTab]);

    useEffect(() => {
        fetchParliamentData();
    }, [fetchParliamentData]);

    if (loading) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;

    return (
        <>
            <Helmet>
                <title>Parlamento - GOV.RP</title>
                <meta name="description" content="Acompanhe as atividades legislativas, projetos de lei e votações do parlamento." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Scale}
                    title="Parlamento"
                    gradientText="Cidadão"
                    description="O coração legislativo da nação. Proponha, debata e vote nas leis que moldam o futuro."
                    iconColor="text-yellow-400"
                />
                
                <div className="text-right mb-8">
                    <ProposeBillDialog onBillProposed={fetchParliamentData} houses={houses} />
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 mb-8">
                        <TabsTrigger value="all">Todos os Projetos</TabsTrigger>
                        {houses.map(house => (
                            <TabsTrigger key={house.id} value={house.id}>{house.name}</TabsTrigger>
                        ))}
                    </TabsList>
                    
                    <TabsContent value="all">
                        <BillList bills={bills} user={user} parliamentMember={parliamentMember} onAction={fetchParliamentData}/>
                    </TabsContent>

                    {houses.map(house => (
                        <TabsContent key={house.id} value={house.id}>
                            <BillList bills={bills.filter(b => b.house.id === house.id)} user={user} parliamentMember={parliamentMember} onAction={fetchParliamentData} />
                        </TabsContent>
                    ))}
                </Tabs>
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
            if (error.code === '23505') { // unique constraint violation
                 toast({ title: "Voto já computado", description: "Você já votou neste projeto.", variant: "default" });
            } else {
                toast({ title: "Erro ao votar", description: error.message, variant: "destructive" });
            }
        } else {
            toast({ title: "Voto computado!", description: `Você votou '${vote}'.` });
            onAction();
        }
    };

    const handleStatusChange = async (bill_id, new_status) => {
        const { data, error } = await supabase.rpc('update_bill_status', { p_bill_id: bill_id, p_new_status: new_status });
        if (error || !data.success) {
            toast({ title: "Erro", description: error?.message || data.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: data.message });
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
                const canManage = user?.role === 'Admin' || user?.id === bill.author_id;

                return (
                    <motion.div key={bill.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <Card className="glass-effect h-full flex flex-col">
                            <CardHeader>
                                <CardTitle className="text-foreground">{bill.title} <span className="text-sm font-normal text-muted-foreground">({bill.type})</span></CardTitle>
                                <CardDescription>Autor: {bill.author.full_name} | {bill.house.name}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow">
                                <p className="text-sm text-muted-foreground line-clamp-3">{bill.summary}</p>
                                <div className="mt-4 flex justify-between items-center">
                                    <span className={`px-2 py-1 text-xs rounded-full ${
                                        bill.status === 'Aprovado' ? 'bg-green-500/20 text-green-300' :
                                        bill.status === 'Rejeitado' ? 'bg-red-500/20 text-red-300' :
                                        'bg-yellow-500/20 text-yellow-300'
                                    }`}>{bill.status}</span>
                                    {canManage && (
                                        <Dialog>
                                            <DialogTrigger asChild><Button variant="ghost" size="sm"><Edit className="w-4 h-4 mr-2"/>Alterar Status</Button></DialogTrigger>
                                            <DialogContent>
                                                <DialogHeader><DialogTitle>Alterar Status do Projeto</DialogTitle></DialogHeader>
                                                <div className="flex gap-2 py-4">
                                                    <Button onClick={() => handleStatusChange(bill.id, 'Aprovado')} variant="default" className="bg-green-600 hover:bg-green-700">Aprovar</Button>
                                                    <Button onClick={() => handleStatusChange(bill.id, 'Rejeitado')} variant="destructive">Rejeitar</Button>
                                                    <Button onClick={() => handleStatusChange(bill.id, 'Arquivado')} variant="secondary">Arquivar</Button>
                                                </div>
                                            </DialogContent>
                                        </Dialog>
                                    )}
                                </div>
                                <Collapsible className="mt-4">
                                    <CollapsibleTrigger asChild>
                                        <Button variant="link" className="p-0 h-auto text-sm">
                                            <Users className="w-4 h-4 mr-2"/> Ver Votos ({totalVotes})
                                        </Button>
                                    </CollapsibleTrigger>
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
                                {parliamentMember && parliamentMember.house_id === bill.house.id && !userVote && bill.status === 'Em tramitação' && (
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
            }) : (
                <p className="col-span-full text-center text-muted-foreground py-10">Nenhum projeto de lei encontrado nesta casa.</p>
            )}
        </div>
    );
}

export default Parliament;