import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Gavel, Search, PlusCircle, Coins as HandCoins } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCurrency, formatCurrency } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const NewConvictionDialog = ({ onConvictionAdded }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState([]);
    const [formData, setFormData] = useState({ user_id: '', crime: '', sentence_details: '', sentence_end_date: '' });

    const minDate = new Date();
    minDate.setSeconds(0);
    minDate.setMilliseconds(0);
    const minDateString = minDate.toISOString().slice(0,16);

    useEffect(() => {
        if (isOpen) {
            const fetchUsers = async () => {
                const { data, error } = await supabase
                  .from('profiles')
                  .select('id, full_name')
                  .order('full_name', { ascending: true });
                if (error) {
                    toast({ title: 'Erro ao buscar usuários', variant: 'destructive' });
                } else {
                    setUsers(data);
                }
            };
            fetchUsers();
        }
    }, [isOpen, toast]);

    const handleChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleUserSelect = (userId) => {
        setFormData(prev => ({...prev, user_id: userId}));
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const convictionData = {
            user_id: formData.user_id,
            crime: formData.crime,
            sentence_details: formData.sentence_details,
            sentence_start_date: new Date().toISOString(),
            sentence_end_date: formData.sentence_end_date,
            judge_id: user.id,
            is_active: true
        };

        const { error } = await supabase.from('criminal_records').insert(convictionData);
        if (error) {
            toast({ title: 'Erro ao registrar condenação', description: error.message, variant: 'destructive' });
        } else {
            const { error: profileError } = await supabase.from('profiles').update({ criminal_status: 'Condenado', is_imprisoned: true, release_date: formData.sentence_end_date }).eq('id', formData.user_id);
            if (profileError) {
                toast({ title: 'Erro ao atualizar status do perfil', description: profileError.message, variant: 'destructive' });
            } else {
                toast({ title: 'Sucesso!', description: 'Condenação registrada.' });
                onConvictionAdded();
                setIsOpen(false);
                setFormData({ user_id: '', crime: '', sentence_details: '', sentence_end_date: '' });
            }
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button><PlusCircle className="mr-2 h-4 w-4" /> Nova Condenação</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Registrar Nova Condenação</DialogTitle>
                    <DialogDescription>Preencha os detalhes da sentença.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="user_id">Condenado</Label>
                        <Select onValueChange={handleUserSelect} value={formData.user_id}>
                            <SelectTrigger id="user_id">
                                <SelectValue placeholder="Selecione um usuário" />
                            </SelectTrigger>
                            <SelectContent>
                                <ScrollArea className="h-72">
                                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                                </ScrollArea>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="crime">Crime</Label>
                        <Input id="crime" value={formData.crime} onChange={handleChange} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="sentence_details">Detalhes da Sentença</Label>
                        <Textarea id="sentence_details" value={formData.sentence_details} onChange={handleChange} required />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="sentence_end_date">Fim da Pena</Label>
                        <Input id="sentence_end_date" type="datetime-local" value={formData.sentence_end_date} onChange={handleChange} required min={minDateString} />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const NewFineDialog = ({ onFineAdded }) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState([]);
    const [formData, setFormData] = useState({ user_id: '', reason: '', amount: '', due_date: '' });

    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 1);
    const minDateString = minDate.toISOString().split('T')[0];

    useEffect(() => {
        if (isOpen) {
            const fetchUsers = async () => {
                const { data, error } = await supabase
                  .from('profiles')
                  .select('id, full_name')
                  .order('full_name', { ascending: true });
                if (error) {
                    toast({ title: 'Erro ao buscar usuários', variant: 'destructive' });
                } else {
                    setUsers(data);
                }
            };
            fetchUsers();
        }
    }, [isOpen, toast]);

    const handleChange = (e) => {
        let { id, value } = e.target;
        if(id === 'amount') {
            value = formatCurrency(value, false);
        }
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const { data, error } = await supabase.rpc('issue_fine', {
            p_user_id: formData.user_id,
            p_reason: formData.reason,
            p_amount: parseCurrency(formData.amount),
            p_due_date: formData.due_date
        });

        if (error || (data && !data.success)) {
            toast({ title: 'Erro ao emitir multa', description: error?.message || data?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Multa emitida com sucesso.' });
            onFineAdded();
            setIsOpen(false);
            setFormData({ user_id: '', reason: '', amount: '', due_date: '' });
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="secondary"><HandCoins className="mr-2 h-4 w-4" /> Emitir Multa</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Emitir Nova Multa Judicial</DialogTitle>
                    <DialogDescription>Preencha os detalhes da multa.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="user_id">Infrator</Label>
                        <Select onValueChange={(val) => setFormData(p => ({...p, user_id: val}))} value={formData.user_id}>
                            <SelectTrigger id="user_id"><SelectValue placeholder="Selecione um usuário" /></SelectTrigger>
                            <SelectContent>
                                <ScrollArea className="h-72">
                                    {users.map(u => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                                </ScrollArea>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="reason">Motivo</Label>
                        <Input id="reason" value={formData.reason} onChange={handleChange} required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="amount">Valor</Label>
                            <Input id="amount" value={formData.amount} onChange={handleChange} required placeholder="R$ 0,00" />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="due_date">Data de Vencimento</Label>
                            <Input id="due_date" type="date" value={formData.due_date} onChange={handleChange} required min={minDateString} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Emitir Multa</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const PenalSystemPanel = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchRecords = useCallback(async () => {
        setLoading(true);
        try {
            await supabase.rpc('check_and_update_prisoner_status');
            
            let query = supabase
                .from('criminal_records')
                .select('*, profile:profiles!criminal_records_user_id_fkey(full_name), judge:profiles!criminal_records_judge_id_fkey(full_name)')
                .order('created_at', { ascending: false });

            if (searchTerm) {
                query = query.ilike('profile.full_name', `%${searchTerm}%`);
            }
            
            const { data, error } = await query;
            if (error) throw error;
            setRecords(data);
        } catch (error) {
            toast({ title: 'Erro ao buscar registros', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchRecords();
        const interval = setInterval(fetchRecords, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, [fetchRecords]);
    
    const isAuthorized = ['Admin', 'Juiz'].some(role => (Array.isArray(user?.role) ? user.role.includes(role) : user?.role === role));

    return (
        <>
            <Helmet>
                <title>Painel do Sistema Penal - GOV.RP</title>
                <meta name="description" content="Gerencie registros criminais e o status do sistema prisional." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Gavel}
                    title="Painel do Sistema"
                    gradientText="Penal"
                    description="Gerencie registros criminais e status de sentenças da comunidade."
                    iconColor="text-amber-400"
                    centered={true}
                />
                
                <div className="flex justify-between items-center mb-8 gap-4">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por nome..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 bg-white/5 border-white/10 rounded-lg"
                        />
                    </div>
                    {isAuthorized && (
                        <div className="flex gap-2">
                           <NewFineDialog onFineAdded={() => {}} />
                           <NewConvictionDialog onConvictionAdded={fetchRecords} />
                        </div>
                    )}
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-white/10">
                                    <TableHead className="text-white">Condenado</TableHead>
                                    <TableHead className="text-white">Crime</TableHead>
                                    <TableHead className="text-white">Juiz</TableHead>
                                    <TableHead className="text-white">Data da Sentença</TableHead>
                                    <TableHead className="text-white">Fim da Pena</TableHead>
                                    <TableHead className="text-white text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.map(record => (
                                    <TableRow key={record.id} className="border-b-white/10">
                                        <TableCell>{record.profile.full_name}</TableCell>
                                        <TableCell>{record.crime}</TableCell>
                                        <TableCell>{record.judge?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{record.sentence_start_date ? format(new Date(record.sentence_start_date), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                        <TableCell>{record.sentence_end_date ? format(new Date(record.sentence_end_date), 'dd/MM/yyyy HH:mm') : 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={`px-2 py-1 text-xs rounded-full ${record.is_active ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                                                {record.is_active ? 'Ativa' : 'Cumprida'}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {records.length === 0 && (
                                    <TableRow><TableCell colSpan="6" className="text-center text-muted-foreground">Nenhum registro encontrado.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </>
    );
};

export default PenalSystemPanel;