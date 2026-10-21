import PagedResults from '@/components/ui/paged-results';
import DeleteElectionButton from '@/components/admin/DeleteElectionButton';
import { AlignLeft, CalendarClock, Save } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, PlusCircle, Edit, Trash2, Calendar, Vote, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { toBrasiliaInput, fromBrasiliaInput, formatDateTimeBR } from '@/lib/dateTime';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const statusTranslations = {
    Scheduled: 'Agendada',
    Candidacy: 'Candidatura',
    Voting: 'Votação',
    Finished: 'Finalizada',
    Cancelled: 'Cancelada',
};

const PAGE_SIZE = 10;

const ElectionForm = ({ election, onFinish }) => {
    const [formData, setFormData] = useState({
        name: election?.name || '',
        description: election?.description || '',
        election_type_id: election?.election_type_id || '',
        candidacy_start_date: toBrasiliaInput(election?.candidacy_start_date),
        candidacy_end_date: toBrasiliaInput(election?.candidacy_end_date),
        voting_start_date: toBrasiliaInput(election?.voting_start_date),
        voting_end_date: toBrasiliaInput(election?.voting_end_date),
    });
    const [electionTypes, setElectionTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const minDateTime = toBrasiliaInput(new Date());

    useEffect(() => {
        const fetchTypes = async () => {
            const { data, error } = await supabase.from('election_types').select('*');
            if (error) toast({ title: "Erro ao buscar tipos de eleição", variant: "destructive" });
            else setElectionTypes(data);
        };
        fetchTypes();
    }, [toast]);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
    };

    const handleSelectChange = (value) => {
        setFormData(prev => ({ ...prev, election_type_id: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const payload = {
            ...formData,
            voting_end_date: fromBrasiliaInput(formData.voting_end_date),
            voting_start_date: fromBrasiliaInput(formData.voting_start_date),
            candidacy_end_date: fromBrasiliaInput(formData.candidacy_end_date),
            candidacy_start_date: fromBrasiliaInput(formData.candidacy_start_date),
            election_type_id: formData.election_type_id === '' ? null : formData.election_type_id,
        };

        let query;
        if (election) {
            query = supabase.from('elections').update(payload).eq('id', election.id);
        } else {
            query = supabase.from('elections').insert(payload);
        }

        const { error } = await query;

        if (error) {
            toast({ title: "Erro ao salvar eleição", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: `Eleição ${election ? 'atualizada' : 'criada'} com sucesso.` });
            onFinish();
        }
        setLoading(false);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label htmlFor="name" className="mb-1 flex items-center gap-2"><Vote className="h-4 w-4 text-primary"/>Nome da Eleição</Label><Input id="name" value={formData.name} onChange={handleChange} required /></div>
            <div><Label htmlFor="description" className="mb-1 flex items-center gap-2"><AlignLeft className="h-4 w-4 text-primary"/>Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} /></div>
            <div>
                <Label htmlFor="election_type_id" className="mb-1 flex items-center gap-2"><Vote className="h-4 w-4 text-primary"/>Tipo de Eleição</Label>
                <Select onValueChange={handleSelectChange} value={formData.election_type_id}>
                    <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                    <SelectContent>
                        {electionTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="candidacy_start_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Início das Candidaturas</Label><Input id="candidacy_start_date" type="datetime-local" value={formData.candidacy_start_date} onChange={handleChange} required min={minDateTime} /></div>
                <div><Label htmlFor="candidacy_end_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Fim das Candidaturas</Label><Input id="candidacy_end_date" type="datetime-local" value={formData.candidacy_end_date} onChange={handleChange} required min={formData.candidacy_start_date || minDateTime} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="voting_start_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Início da Votação</Label><Input id="voting_start_date" type="datetime-local" value={formData.voting_start_date} onChange={handleChange} required min={formData.candidacy_end_date || minDateTime} /></div>
                <div><Label htmlFor="voting_end_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Fim da Votação</Label><Input id="voting_end_date" type="datetime-local" value={formData.voting_end_date} onChange={handleChange} required min={formData.voting_start_date || minDateTime} /></div>
            </div>
            <DialogFooter className="sm:justify-center">
                <Button type="submit" disabled={loading}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}Salvar Eleição</Button>
            </DialogFooter>
        </form>
    );
};

const ElectionManagement = () => {
    const [elections, setElections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingElection, setEditingElection] = useState(null);
    const [page, setPage] = useState(1);
    const [electionCount, setElectionCount] = useState(0);
    const [statusFilter, setStatusFilter] = useState('all');
    const { toast } = useToast();

    const fetchElections = useCallback(async () => {
        setLoading(true);
        const from = (page - 1) * PAGE_SIZE;
        let query = supabase
            .from('elections_with_status')
            .select('*, election_types(name)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        if (statusFilter !== 'all') query = query.eq('status', statusFilter);
        const { data, count, error } = await query;
            
        if (error) {
            toast({ title: "Erro ao buscar eleições", description: error.message, variant: "destructive" });
        } else {
            setElections(data);
            setElectionCount(count || 0);
        }
        setLoading(false);
    }, [page, statusFilter, toast]);

    useEffect(() => {
        fetchElections();
    }, [fetchElections]);

    const handleAdd = () => {
        setEditingElection(null);
        setIsFormOpen(true);
    };

    const handleEdit = (election) => {
        setEditingElection(election);
        setIsFormOpen(true);
    };

    const handleFormFinish = () => {
        setIsFormOpen(false);
        if (page === 1) fetchElections();
        else setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(electionCount / PAGE_SIZE));
    const firstShown = electionCount ? (page - 1) * PAGE_SIZE + 1 : 0;
    const lastShown = Math.min(page * PAGE_SIZE, electionCount);

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <h2 className="text-2xl font-bold text-white">Gerenciamento de Eleições</h2>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
                        <SelectTrigger className="w-full sm:w-52" aria-label="Filtrar eleições por status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos os status</SelectItem>
                            {Object.entries(statusTranslations).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <Button onClick={fetchElections} variant="outline" size="icon" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </Button>
                    <Button onClick={handleAdd}><PlusCircle className="w-4 h-4 mr-2" /> Criar Eleição</Button>
                </div>
            </div>

            <PagedResults page={page} loading={loading}>
            {loading && !elections.length ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {elections.map(election => (
                        <Card key={election.id} className="glass-effect">
                            <CardHeader>
                                <CardTitle>{election.name}</CardTitle>
                                <CardDescription>{election.election_types?.name || 'Tipo não definido'} - {election.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> <strong>Candidaturas:</strong> {formatDateTimeBR(election.candidacy_start_date)} - {formatDateTimeBR(election.candidacy_end_date)}</p>
                                <p className="flex items-center gap-2"><Vote className="w-4 h-4 text-muted-foreground" /> <strong>Votação:</strong> {formatDateTimeBR(election.voting_start_date)} - {formatDateTimeBR(election.voting_end_date)}</p>
                                {/* O 'status' virá da VIEW e vai funcionar */}
                                <p><strong>Status:</strong> {statusTranslations[election.status] || election.status}</p>
                            </CardContent>
                            <CardFooter className="gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEdit(election)}><Edit className="w-4 h-4 mr-2" /> Editar</Button>
                                <DeleteElectionButton election={election} onDeleted={fetchElections}/>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3 sm:flex-row">
                <p className="text-sm text-muted-foreground">Exibindo {firstShown}–{lastShown} de {electionCount} eleição(ões)</p>
                <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</Button>
                    <span className="min-w-20 text-center text-sm">{page} de {totalPages}</span>
                    <Button type="button" variant="outline" size="sm" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></Button>
                </div>
            </div>

            </PagedResults>
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingElection ? 'Editar Eleição' : 'Criar Nova Eleição'}</DialogTitle>
                    </DialogHeader>
                    <ElectionForm election={editingElection} onFinish={handleFormFinish} />
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ElectionManagement;
