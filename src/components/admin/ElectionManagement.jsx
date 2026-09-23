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
import { Loader2, PlusCircle, Edit, Trash2, Calendar, Vote } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const statusTranslations = {
    Scheduled: 'Agendada',
    Candidacy: 'Candidatura',
    Voting: 'Votação',
    Finished: 'Finalizada',
};

const AUTOMATIC_ELECTIONS_SETTINGS_KEY = 'automatic_elections';

const parseElectionSequence = (name = '') => {
    const match = name.trim().match(/^(\d+)[ªº]?\s+(.+)$/i);

    return {
        sequence: match ? Number(match[1]) || 1 : 1,
        suffix: match?.[2] || name.trim() || 'Eleição',
    };
};

const findAutomaticPlanForElection = (plans = {}, electionId) => {
    if (!electionId) return null;

    return Object.entries(plans).find(([, plan]) => (
        plan?.root_election_id === electionId ||
        plan?.last_election_id === electionId ||
        (Array.isArray(plan?.generated_election_ids) && plan.generated_election_ids.includes(electionId))
    )) || null;
};

const ElectionForm = ({ election, onFinish, automaticElectionPlans }) => {
    const automaticPlanEntry = findAutomaticPlanForElection(automaticElectionPlans, election?.id);
    const [formData, setFormData] = useState({
        name: election?.name || '',
        description: election?.description || '',
        election_type_id: election?.election_type_id || '',
        candidacy_start_date: election?.candidacy_start_date ? format(new Date(election.candidacy_start_date), "yyyy-MM-dd'T'HH:mm") : '',
        candidacy_end_date: election?.candidacy_end_date ? format(new Date(election.candidacy_end_date), "yyyy-MM-dd'T'HH:mm") : '',
        voting_start_date: election?.voting_start_date ? format(new Date(election.voting_start_date), "yyyy-MM-dd'T'HH:mm") : '',
        voting_end_date: election?.voting_end_date ? format(new Date(election.voting_end_date), "yyyy-MM-dd'T'HH:mm") : '',
    });
    const [autoRecurring, setAutoRecurring] = useState(Boolean(automaticPlanEntry?.[1]?.enabled));
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

    useEffect(() => {
        const currentPlanEntry = findAutomaticPlanForElection(automaticElectionPlans, election?.id);
        setAutoRecurring(Boolean(currentPlanEntry?.[1]?.enabled));
    }, [automaticElectionPlans, election?.id]);

    useEffect(() => {
        setFormData({
            name: election?.name || '',
            description: election?.description || '',
            election_type_id: election?.election_type_id || '',
            candidacy_start_date: election?.candidacy_start_date ? format(new Date(election.candidacy_start_date), "yyyy-MM-dd'T'HH:mm") : '',
            candidacy_end_date: election?.candidacy_end_date ? format(new Date(election.candidacy_end_date), "yyyy-MM-dd'T'HH:mm") : '',
            voting_start_date: election?.voting_start_date ? format(new Date(election.voting_start_date), "yyyy-MM-dd'T'HH:mm") : '',
            voting_end_date: election?.voting_end_date ? format(new Date(election.voting_end_date), "yyyy-MM-dd'T'HH:mm") : '',
        });
    }, [election]);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.id]: e.target.value }));
    };

    const handleSelectChange = (value) => {
        setFormData(prev => ({ ...prev, election_type_id: value }));
    };

    const syncAutomaticElectionPlan = async (savedElection) => {
        const { data: currentSettings, error: settingsError } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', AUTOMATIC_ELECTIONS_SETTINGS_KEY)
            .maybeSingle();

        if (settingsError) {
            throw settingsError;
        }

        const settingsValue = currentSettings?.value && typeof currentSettings.value === 'object'
            ? currentSettings.value
            : {};
        const plans = settingsValue.plans && typeof settingsValue.plans === 'object' ? settingsValue.plans : {};
        const existingEntry = findAutomaticPlanForElection(plans, savedElection.id);
        const planId = existingEntry?.[0] || savedElection.id;
        const existingPlan = existingEntry?.[1] || {};
        const parsedSequence = parseElectionSequence(savedElection.name);

        plans[planId] = {
            ...existingPlan,
            enabled: autoRecurring,
            root_election_id: existingPlan.root_election_id || savedElection.id,
            last_election_id: existingPlan.last_election_id || savedElection.id,
            election_type_id: savedElection.election_type_id,
            sequence: Number(existingPlan.sequence || parsedSequence.sequence || 1),
            updated_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
            .from('system_settings')
            .upsert(
                {
                    key: AUTOMATIC_ELECTIONS_SETTINGS_KEY,
                    value: {
                        ...settingsValue,
                        plans,
                        updated_at: new Date().toISOString(),
                    },
                    description: 'Agenda eleições automáticas recorrentes.',
                },
                { onConflict: 'key' }
            );

        if (upsertError) {
            throw upsertError;
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const { data: statusData, error: statusError } = await supabase.rpc('get_initial_election_status', {
            p_candidacy_start_date: formData.candidacy_start_date,
            p_candidacy_end_date: formData.candidacy_end_date,
            p_voting_start_date: formData.voting_start_date,
            p_voting_end_date: formData.voting_end_date,
        });

        if (statusError) {
            toast({ title: "Erro ao definir status inicial", description: statusError.message, variant: "destructive" });
            setLoading(false);
            return;
        }

        const payload = {
            ...formData,
            election_type_id: formData.election_type_id === '' ? null : formData.election_type_id,
        };

        let query;
        if (election) {
            query = supabase.from('elections').update(payload).eq('id', election.id).select('id, name, election_type_id').single();
        } else {
            query = supabase.from('elections').insert({ ...payload, status: statusData }).select('id, name, election_type_id').single();
        }

        const { data: savedElection, error } = await query;

        if (error) {
            toast({ title: "Erro ao salvar eleição", description: error.message, variant: "destructive" });
        } else {
            try {
                await syncAutomaticElectionPlan(savedElection);
            } catch (settingsError) {
                toast({
                    title: "Eleição salva, mas recorrência não foi atualizada",
                    description: settingsError.message,
                    variant: "destructive"
                });
                setLoading(false);
                return;
            }
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
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-4">
                <div>
                    <Label htmlFor="auto-recurring-election" className="text-base">Eleição automática mensal</Label>
                    <p className="text-sm text-muted-foreground">
                        Ao finalizar, cria a próxima eleição 1 mês depois com as mesmas janelas e numeração sequencial.
                    </p>
                </div>
                <Switch id="auto-recurring-election" checked={autoRecurring} onCheckedChange={setAutoRecurring} />
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
    const [automaticElectionPlans, setAutomaticElectionPlans] = useState({});
    const { toast } = useToast();

    const fetchElections = useCallback(async () => {
        setLoading(true);
        const [electionsResponse, automaticSettingsResponse] = await Promise.all([
            supabase.from('elections').select('*, election_types(name)').is('archived_at',null).order('created_at', { ascending: false }),
            supabase.from('system_settings').select('value').eq('key', AUTOMATIC_ELECTIONS_SETTINGS_KEY).maybeSingle(),
        ]);
        if (electionsResponse.error) {
            toast({ title: "Erro ao buscar eleições", description: electionsResponse.error.message, variant: "destructive" });
        } else if (automaticSettingsResponse.error) {
            toast({ title: "Erro ao buscar recorrência eleitoral", description: automaticSettingsResponse.error.message, variant: "destructive" });
            setElections(electionsResponse.data);
        } else {
            setElections(electionsResponse.data);
            setAutomaticElectionPlans(automaticSettingsResponse.data?.value?.plans || {});
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

    const handleFormFinish = () => {
        setIsFormOpen(false);
        fetchElections();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Gerenciamento de Eleições</h2>
                <Button onClick={handleAdd}><PlusCircle className="w-4 h-4 mr-2" /> Criar Eleição</Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {elections.map(election => (
                        <Card key={election.id} className="glass-effect">
                            <CardHeader>
                                <CardTitle>{election.name}</CardTitle>
                                <CardDescription>
                                    {election.election_types?.name || 'Tipo não definido'} - {election.description}
                                    {findAutomaticPlanForElection(automaticElectionPlans, election.id)?.[1]?.enabled ? (
                                        <span className="ml-2 inline-flex rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                                            Automática
                                        </span>
                                    ) : null}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> <strong>Candidaturas:</strong> {format(new Date(election.candidacy_start_date), 'dd/MM/yy HH:mm', { locale: ptBR })} - {format(new Date(election.candidacy_end_date), 'dd/MM/yy HH:mm', { locale: ptBR })}</p>
                                <p className="flex items-center gap-2"><Vote className="w-4 h-4 text-muted-foreground" /> <strong>Votação:</strong> {format(new Date(election.voting_start_date), 'dd/MM/yy HH:mm', { locale: ptBR })} - {format(new Date(election.voting_end_date), 'dd/MM/yy HH:mm', { locale: ptBR })}</p>
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

            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingElection ? 'Editar Eleição' : 'Criar Nova Eleição'}</DialogTitle>
                    </DialogHeader>
                    <ElectionForm
                        election={editingElection}
                        onFinish={handleFormFinish}
                        automaticElectionPlans={automaticElectionPlans}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ElectionManagement;
