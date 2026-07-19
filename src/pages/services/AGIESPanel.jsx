import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Eye, Search, PlusCircle, User, ArrowRight, ArrowLeft } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCurrency } from '@/lib/utils';

const normalizeSearchValue = (value = '') =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

const TransactionViewer = () => {
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(true);
    const [loadingTransactions, setLoadingTransactions] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const { toast } = useToast();

    useEffect(() => {
        if (!isDialogOpen) return;
        const fetchUsers = async () => {
            setLoadingUsers(true);
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, username, avatar_url')
                .order('full_name', { ascending: true });
            if (error) {
                toast({ title: "Erro ao buscar usuários", variant: "destructive" });
            } else {
                setUsers(data || []);
            }
            setLoadingUsers(false);
        };
        fetchUsers();
    }, [isDialogOpen, toast]);

    const handleUserSelect = useCallback(async (userId) => {
        const user = users.find(u => u.id === userId);
        if (!user) return;

        setSelectedUser(user);
        setLoadingTransactions(true);
        const { data, error } = await supabase.rpc('get_user_transactions_for_admin', { p_user_id: user.id });

        if (error) {
            toast({ title: "Erro ao buscar transações", description: error.message, variant: "destructive" });
            setTransactions([]);
        } else {
            setTransactions(data || []);
        }
        setLoadingTransactions(false);
    }, [users, toast]);

    const filteredUsers = useMemo(() => {
        const normalizedSearch = normalizeSearchValue(userSearchTerm);

        if (!normalizedSearch) {
            return users;
        }

        return users.filter((user) => {
            const userLabel = `${user.full_name || ''} ${user.username || ''} ${user.id || ''}`;
            return normalizeSearchValue(userLabel).includes(normalizedSearch);
        });
    }, [userSearchTerm, users]);

    const handleDialogChange = useCallback((open) => {
        setIsDialogOpen(open);

        if (!open) {
            setUserSearchTerm('');
            setSelectedUser(null);
            setTransactions([]);
            setLoadingTransactions(false);
        }
    }, []);

    return (
        <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
            <DialogTrigger asChild>
                <Button variant="outline"><Eye className="mr-2 h-4 w-4" /> Ver Transações de Usuário</Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl h-[80vh]">
                <DialogHeader>
                    <DialogTitle>Monitor de Transações</DialogTitle>
                    <DialogDescription>Selecione um usuário para visualizar seu histórico de transações.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-full overflow-hidden">
                    <div className="md:col-span-1 h-full flex flex-col">
                        <div className="rounded-lg border shadow-md h-full bg-background/80 overflow-hidden">
                            <div className="border-b px-3 py-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={userSearchTerm}
                                        onChange={(event) => setUserSearchTerm(event.target.value)}
                                        placeholder="Buscar usuário..."
                                        className="pl-9"
                                    />
                                </div>
                            </div>
                            <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">Usuários</div>
                            <div className="h-full max-h-[58vh] overflow-y-auto custom-scrollbar p-2 space-y-1">
                                {loadingUsers ? <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div> : null}
                                {!loadingUsers && filteredUsers.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
                                ) : null}
                                {!loadingUsers ? filteredUsers.map((user) => {
                                    const userLabel = user.full_name || user.username || 'Usuário sem nome';
                                    const isSelected = selectedUser?.id === user.id;

                                    return (
                                        <button
                                            key={user.id}
                                            type="button"
                                            onClick={() => handleUserSelect(user.id)}
                                            className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${isSelected ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'}`}
                                        >
                                            <User className="h-4 w-4 shrink-0" />
                                            <span className="truncate">{userLabel}</span>
                                        </button>
                                    );
                                }) : null}
                            </div>
                        </div>
                    </div>
                    <div className="md:col-span-2 h-full overflow-y-auto custom-scrollbar">
                        {selectedUser ? (
                            <div>
                                <h3 className="text-lg font-semibold mb-4">Transações de {selectedUser.full_name}</h3>
                                {loadingTransactions ? <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div> : (
                                    <div className="space-y-4">
                                        {transactions.length > 0 ? transactions.map(tx => (
                                            <div key={tx.id} className="p-3 rounded-lg bg-background/50 border border-border">
                                                <div className="flex justify-between items-center">
                                                    <div className="flex items-center gap-3">
                                                        {tx.direction === 'sent' ? <ArrowRight className="w-5 h-5 text-red-400" /> : <ArrowLeft className="w-5 h-5 text-green-400" />}
                                                        <div>
                                                            <p className="font-medium">{tx.description}</p>
                                                            <p className="text-xs text-muted-foreground">
                                                                {tx.direction === 'sent' ? `Para: ${tx.other_party_name || 'N/A'}` : `De: ${tx.other_party_name || 'N/A'}`}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`font-bold ${tx.direction === 'sent' ? 'text-red-400' : 'text-green-400'}`}>
                                                            {tx.direction === 'sent' ? '-' : '+'} {formatCurrency(tx.amount)}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">{format(new Date(tx.created_at), 'dd/MM/yy HH:mm')}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        )) : <p className="text-muted-foreground text-center">Nenhuma transação encontrada.</p>}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted-foreground">
                                <p>Selecione um usuário para começar.</p>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const AGIESPanel = () => {
    const { toast } = useToast();
    const [missions, setMissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchMissions = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('agies_missions')
            .select('*, agent:profiles(full_name)')
            .order('created_at', { ascending: false });

        if (searchTerm) {
            query = query.ilike('name', `%${searchTerm}%`);
        }

        const { data, error } = await query;
        if (error) {
            toast({ title: "Erro ao carregar missões", variant: "destructive" });
            console.error("Error fetching missions:", error);
        } else {
            setMissions(data || []);
        }

        setLoading(false);
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchMissions();
    }, [fetchMissions]);

    return (
        <>
            <Helmet>
                <title>Painel AGIES - GOV.RP</title>
                <meta name="description" content="Painel da Agência de Inteligência e Espionagem Suprema." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Eye}
                    title="Painel"
                    gradientText="AGIES"
                    description="Agência de Inteligência e Espionagem Suprema. A vigilância é a nossa virtude."
                    iconColor="text-red-500"
                    centered={true}
                />

                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por missão..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 text-lg"
                        />
                    </div>
                    <div className="flex gap-2">
                        <TransactionViewer />
                        <Button onClick={() => toast({ title: "🚧 Funcionalidade em desenvolvimento!" })}>
                            <PlusCircle className="mr-2 h-4 w-4" /> Nova Missão
                        </Button>
                    </div>
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-border">
                                    <TableHead>Missão</TableHead>
                                    <TableHead>Agente Responsável</TableHead>
                                    <TableHead>Data de Início</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {missions.map(mission => (
                                    <TableRow key={mission.id} className="border-b-border">
                                        <TableCell className="font-medium">{mission.name}</TableCell>
                                        <TableCell>{mission.agent?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{mission.start_date ? format(new Date(mission.start_date), 'dd/MM/yyyy') : 'Não definida'}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                mission.status === 'Em Andamento' ? 'bg-yellow-500/20 text-yellow-300' :
                                                mission.status === 'Concluída' ? 'bg-green-500/20 text-green-300' :
                                                'bg-gray-500/20 text-gray-300'
                                            }`}>{mission.status}</span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </>
    );
};

export default AGIESPanel;
