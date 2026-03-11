import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from '../ui/use-toast';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Loader2, PlusCircle, Edit, Trash2, Calendar, Vote, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const statusTranslations = {
    Scheduled: 'Agendada',
    Candidacy: 'Candidatura',
    Voting: 'Votação',
    Finished: 'Finalizada',
};

const ElectionForm = ({ election, onFinish }) => {
    const [formData, setFormData] = useState({
        name: election?.name || '',
        description: election?.description || '',
        election_type_id: election?.election_type_id || '',
        candidacy_start_date: election?.candidacy_start_date ? format(new Date(election.candidacy_start_date), "yyyy-MM-dd'T'HH:mm") : '',
        candidacy_end_date: election?.candidacy_end_date ? format(new Date(election.candidacy_end_date), "yyyy-MM-dd'T'HH:mm") : '',
        voting_start_date: election?.voting_start_date ? format(new Date(election.voting_start_date), "yyyy-MM-dd'T'HH:mm") : '',
        voting_end_date: election?.voting_end_date ? format(new Date(election.voting_end_date), "yyyy-MM-dd'T'HH:mm") : '',
    });
    const [electionTypes, setElectionTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const minDateTime = format(new Date(), "yyyy-MM-dd'T'HH:mm");

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
            <div><Label htmlFor="name">Nome da Eleição</Label><Input id="name" value={formData.name} onChange={handleChange} required /></div>
            <div><Label htmlFor="description">Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} /></div>
            <div>
                <Label htmlFor="election_type_id">Tipo de Eleição</Label>
                <Select onValueChange={handleSelectChange} value={formData.election_type_id}>
                    <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                    <SelectContent>
                        {electionTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="candidacy_start_date">Início das Candidaturas</Label><Input id="candidacy_start_date" type="datetime-local" value={formData.candidacy_start_date} onChange={handleChange} required min={minDateTime} /></div>
                <div><Label htmlFor="candidacy_end_date">Fim das Candidaturas</Label><Input id="candidacy_end_date" type="datetime-local" value={formData.candidacy_end_date} onChange={handleChange} required min={formData.candidacy_start_date || minDateTime} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="voting_start_date">Início da Votação</Label><Input id="voting_start_date" type="datetime-local" value={formData.voting_start_date} onChange={handleChange} required min={formData.candidacy_end_date || minDateTime} /></div>
                <div><Label htmlFor="voting_end_date">Fim da Votação</Label><Input id="voting_end_date" type="datetime-local" value={formData.voting_end_date} onChange={handleChange} required min={formData.voting_start_date || minDateTime} /></div>
            </div>
            <DialogFooter>
                <Button type="submit" disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : 'Salvar Eleição'}</Button>
            </DialogFooter>
        </form>
    );
};

const ElectionManagement = () => {
    const [elections, setElections] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingElection, setEditingElection] = useState(null);
    const { toast } = useToast();

    const fetchElections = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('elections_with_status')
            .select('*, election_types(name)')
            .order('created_at', { ascending: false });
            
        if (error) {
            toast({ title: "Erro ao buscar eleições", description: error.message, variant: "destructive" });
        } else {
            setElections(data);
        }
        setLoading(false);
    }, [toast]);

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

    const handleDelete = async (electionId) => {
        const { error } = await supabase.from('elections').delete().eq('id', electionId);
        if (error) {
            toast({ title: "Erro ao excluir eleição", description: error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso", description: "Eleição excluída." });
            fetchElections();
        }
    };

    const handleFormFinish = () => {
        setIsFormOpen(false);
        fetchElections();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center gap-4">
                <h2 className="text-2xl font-bold text-white">Gerenciamento de Eleições</h2>
                <div className="flex gap-2">
                    <Button onClick={fetchElections} variant="outline" size="icon" disabled={loading}>
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </Button>
                    <Button onClick={handleAdd}><PlusCircle className="w-4 h-4 mr-2" /> Criar Eleição</Button>
                </div>
            </div>

            {loading ? (
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
                                <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> <strong>Candidaturas:</strong> {format(new Date(election.candidacy_start_date), 'dd/MM/yy HH:mm', { locale: ptBR })} - {format(new Date(election.candidacy_end_date), 'dd/MM/yy HH:mm', { locale: ptBR })}</p>
                                <p className="flex items-center gap-2"><Vote className="w-4 h-4 text-muted-foreground" /> <strong>Votação:</strong> {format(new Date(election.voting_start_date), 'dd/MM/yy HH:mm', { locale: ptBR })} - {format(new Date(election.voting_end_date), 'dd/MM/yy HH:mm', { locale: ptBR })}</p>
                                {/* O 'status' virá da VIEW e vai funcionar */}
                                <p><strong>Status:</strong> {statusTranslations[election.status] || election.status}</p>
                            </CardContent>
                            <CardFooter className="gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEdit(election)}><Edit className="w-4 h-4 mr-2" /> Editar</Button>
                                <Button variant="destructive" size="sm" onClick={() => handleDelete(election.id)}><Trash2 className="w-4 h-4 mr-2" /> Excluir</Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

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