import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Siren, Search, PlusCircle, FileText } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const ReportDialog = ({ report, dialogOpen, setDialogOpen }) => {
    return (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{report ? report.title : "Nova Ocorrência"}</DialogTitle>
                    {report && <DialogDescription>Registrado por: {report.officer?.full_name || 'N/A'} em {format(new Date(report.report_time), 'dd/MM/yyyy HH:mm')}</DialogDescription>}
                </DialogHeader>
                {report && (
                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                        <div><Label>Detalhes</Label><p className="text-sm p-2 bg-slate-800 rounded-md whitespace-pre-wrap">{report.details}</p></div>
                        <div><Label>Partes Envolvidas</Label><p className="text-sm p-2 bg-slate-800 rounded-md">{report.involved_parties?.join(', ') || 'Nenhuma'}</p></div>
                        <div><Label>Local</Label><p className="text-sm p-2 bg-slate-800 rounded-md">{report.location || 'Não informado'}</p></div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

const NewReportDialog = ({ onReportAdded }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ title: '', details: '', involved_parties: '', location: '' });
    
    const handleChange = (e) => {
        setFormData(prev => ({...prev, [e.target.id]: e.target.value}));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const reportData = {
            officer_id: user.id,
            title: formData.title,
            details: formData.details,
            location: formData.location,
            involved_parties: formData.involved_parties.split(',').map(p => p.trim()),
            report_time: new Date().toISOString()
        };

        const { error } = await supabase.from('police_reports').insert(reportData);
        if (error) {
            toast({ title: 'Erro ao registrar ocorrência', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Ocorrência registrada.' });
            onReportAdded();
            setIsOpen(false);
            setFormData({ title: '', details: '', involved_parties: '', location: '' });
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button><PlusCircle className="mr-2 h-4 w-4" /> Nova Ocorrência</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Registrar Nova Ocorrência</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2"><Label htmlFor="title">Título</Label><Input id="title" value={formData.title} onChange={handleChange} required /></div>
                    <div className="grid gap-2"><Label htmlFor="details">Detalhes</Label><Textarea id="details" value={formData.details} onChange={handleChange} required /></div>
                    <div className="grid gap-2"><Label htmlFor="involved_parties">Partes Envolvidas (separadas por vírgula)</Label><Input id="involved_parties" value={formData.involved_parties} onChange={handleChange} /></div>
                    <div className="grid gap-2"><Label htmlFor="location">Local</Label><Input id="location" value={formData.location} onChange={handleChange} /></div>
                    <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Registrar</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const IssueFineDialog = ({ onFineIssued }) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [reason, setReason] = useState('');
    const [amount, setAmount] = useState('');
    const [isUsersComboboxOpen, setIsUsersComboboxOpen] = useState(false);

    useEffect(() => {
        if(isOpen) {
            const fetchUsers = async () => {
                const { data, error } = await supabase.from('profiles').select('id, full_name, username');
                if (error) {
                    toast({ title: 'Erro ao buscar usuários', variant: 'destructive' });
                } else {
                    setUsers(data);
                }
            };
            fetchUsers();
        }
    }, [isOpen, toast]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const { data, error } = await supabase.rpc('issue_fine', {
            p_user_id: selectedUser,
            p_reason: reason,
            p_amount: parseFloat(amount),
            p_due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Vence em 7 dias
        });

        if (error || !data.success) {
            toast({ title: 'Erro ao emitir multa', description: data?.message || error?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Multa emitida.' });
            onFineIssued();
            setIsOpen(false);
            setSelectedUser(null);
            setReason('');
            setAmount('');
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="secondary"><FileText className="mr-2 h-4 w-4" /> Emitir Multa</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Emitir Nova Multa</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>Selecionar Usuário</Label>
                        <Popover open={isUsersComboboxOpen} onOpenChange={setIsUsersComboboxOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" role="combobox" aria-expanded={isUsersComboboxOpen} className="w-full justify-between">
                                    {selectedUser ? users.find(u => u.id === selectedUser)?.full_name : "Selecione um usuário..."}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0">
                                <Command>
                                    <CommandInput placeholder="Procurar usuário..." />
                                    <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                                    <ScrollArea className="h-48">
                                        <CommandGroup>
                                            {users.map((user) => (
                                                <CommandItem
                                                    key={user.id}
                                                    value={user.full_name}
                                                    onSelect={() => {
                                                        setSelectedUser(user.id);
                                                        setIsUsersComboboxOpen(false);
                                                    }}
                                                >
                                                    <Check className={cn("mr-2 h-4 w-4", selectedUser === user.id ? "opacity-100" : "opacity-0")} />
                                                    {user.full_name} (@{user.username})
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </ScrollArea>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="grid gap-2"><Label htmlFor="reason">Motivo</Label><Input id="reason" value={reason} onChange={e => setReason(e.target.value)} required /></div>
                    <div className="grid gap-2"><Label htmlFor="amount">Valor</Label><Input id="amount" type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required /></div>
                    <DialogFooter><Button type="submit" disabled={loading || !selectedUser}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Emitir Multa</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const PolicePanel = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedReport, setSelectedReport] = useState(null);
    const [isReportOpen, setIsReportOpen] = useState(false);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('police_reports')
            .select('*, officer:profiles(full_name)')
            .order('report_time', { ascending: false });

        if (searchTerm) {
            query = query.ilike('title', `%${searchTerm}%`);
        }
        
        const { data, error } = await query;
        if (error) {
            toast({ title: "Erro ao carregar ocorrências", variant: "destructive" });
        } else {
            setReports(data || []);
        }
        
        setLoading(false);
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const handleViewDetails = (report) => {
        setSelectedReport(report);
        setIsReportOpen(true);
    };

    const isAuthorized = user && (user.role === 'Admin' || user.role === 'Policial');

    return (
        <>
            <Helmet>
                <title>Painel da Polícia - GOV.RP</title>
                <meta name="description" content="Painel de controle do departamento de polícia." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Siren}
                    title="Painel de"
                    gradientText="Polícia"
                    description="Servir e proteger a comunidade. Registre e consulte ocorrências."
                    iconColor="text-blue-500"
                    centered={true}
                />
                
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                     <div className="relative w-full md:flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por título da ocorrência..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 text-lg"
                        />
                    </div>
                    {isAuthorized && (
                        <div className="flex gap-2">
                           <NewReportDialog onReportAdded={fetchReports} />
                           <IssueFineDialog onFineIssued={() => {}} />
                        </div>
                    )}
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-border">
                                    <TableHead>Título</TableHead>
                                    <TableHead>Oficial Responsável</TableHead>
                                    <TableHead>Data</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reports.length > 0 ? reports.map(report => (
                                    <TableRow key={report.id} className="border-b-border">
                                        <TableCell className="font-medium">{report.title}</TableCell>
                                        <TableCell>{report.officer?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{format(new Date(report.report_time), 'dd/MM/yyyy HH:mm')}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleViewDetails(report)}><FileText className="w-4 h-4 mr-2"/>Ver Detalhes</Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan="4" className="text-center py-10 text-muted-foreground">Nenhuma ocorrência encontrada.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
            {selectedReport && <ReportDialog report={selectedReport} dialogOpen={isReportOpen} setDialogOpen={setIsReportOpen} />}
        </>
    );
};

export default PolicePanel;