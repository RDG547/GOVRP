import PagedResults from '@/components/ui/paged-results';
import { useSearchParams } from 'react-router-dom';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { electoralCalendarPayload } from '@/lib/electoralCalendar';
import { toBrasiliaInput, formatDateTimeBR } from '@/lib/dateTime';
import { userErrorMessage } from '@/lib/userErrors';
import { GovSelect } from '@/components/ui/gov-select';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import DeleteElectionButton from '@/components/admin/DeleteElectionButton';
import { AlignLeft, CalendarClock, Save } from 'lucide-react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, PlusCircle, Edit, Trash2, Calendar, Vote } from 'lucide-react';
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
        seats_available: election?.seats_available ?? '',
        candidacy_start_date: election?.candidacy_start_date ? toBrasiliaInput(election.candidacy_start_date) : '',
        candidacy_end_date: election?.candidacy_end_date ? toBrasiliaInput(election.candidacy_end_date) : '',
        voting_start_date: election?.voting_start_date ? toBrasiliaInput(election.voting_start_date) : '',
        voting_end_date: election?.voting_end_date ? toBrasiliaInput(election.voting_end_date) : '',
    });
    const [autoRecurring, setAutoRecurring] = useState(Boolean(automaticPlanEntry?.[1]?.enabled));
    const [electionTypes, setElectionTypes] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const minDateTime = toBrasiliaInput(new Date());
    const selectedKind = electionTypes.find(type => type.id === formData.election_type_id)?.name || election?.election_types?.name || '';
    const parliamentary = /senador|deputado/i.test(selectedKind);
    const votingLocked = Boolean(election?.id && (Date.parse(election?.voting_start_date) <= Date.now() || ['Voting', 'Finished', 'Cancelled'].includes(election?.status)));
    const savedId = useRef(election?.id || null);
    const [formError, setFormError] = useState('');

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
            seats_available: election?.seats_available ?? '',
            candidacy_start_date: election?.candidacy_start_date ? toBrasiliaInput(election.candidacy_start_date) : '',
            candidacy_end_date: election?.candidacy_end_date ? toBrasiliaInput(election.candidacy_end_date) : '',
            voting_start_date: election?.voting_start_date ? toBrasiliaInput(election.voting_start_date) : '',
            voting_end_date: election?.voting_end_date ? toBrasiliaInput(election.voting_end_date) : '',
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
        if (loading) return;
        setLoading(true);

        setFormError('');
        try {
            if (parliamentary && (!Number.isInteger(Number(formData.seats_available)) || Number(formData.seats_available) < 1)) {
                throw new Error('Informe a quantidade de cadeiras disponíveis.');
            }
            const payload = electoralCalendarPayload(formData);
            const { data: result, error } = await supabase.rpc('manage_electoral_calendar', {
                p_election_id: savedId.current,
                p_data: payload,
            });
            if (error) throw error;
            if (!result?.id) throw new Error('O servidor não confirmou o salvamento da eleição.');
            savedId.current = result.id;
            if (!votingLocked) await syncAutomaticElectionPlan({ ...payload, id: result.id });
            toast({ title: 'Eleição salva com sucesso' });
            onFinish();
        } catch (error) {
            console.error('Admin: calendário eleitoral', error);
            setFormError(userErrorMessage(error));
        }
        setLoading(false);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label htmlFor="name" className="mb-1 flex items-center gap-2"><Vote className="h-4 w-4 text-primary"/>Nome da Eleição</Label><Input id="name" value={formData.name} onChange={handleChange} required disabled={votingLocked} /></div>
            <div><Label htmlFor="description" className="mb-1 flex items-center gap-2"><AlignLeft className="h-4 w-4 text-primary"/>Descrição</Label><Textarea id="description" value={formData.description} onChange={handleChange} disabled={votingLocked} /></div>
            <div>
                <Label htmlFor="election_type_id" className="mb-1 flex items-center gap-2"><Vote className="h-4 w-4 text-primary"/>Tipo de Eleição</Label>
                <Select onValueChange={handleSelectChange} value={formData.election_type_id} disabled={votingLocked}>
                    <SelectTrigger id="election_type_id" aria-label="Tipo de eleição"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                    <SelectContent>
                        {electionTypes.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>
            {parliamentary && <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
                <Label htmlFor="seats_available">Quantidade de cadeiras disponíveis ({selectedKind})</Label>
                <Input id="seats_available" type="number" min="1" max={/senador/i.test(selectedKind)?81:513} required
                    value={formData.seats_available} onChange={handleChange} disabled={votingLocked}/>
                <p className="text-xs text-muted-foreground">Os candidatos eleitos serão limitados a esse número de vagas. A edição é bloqueada quando a votação começar.</p>
            </div>}
            {votingLocked && <p className="text-sm text-amber-300">A votação já começou. Somente nome e descrição podem ser alterados; votos, datas, tipo e cadeiras são preservados.</p>}
            {!votingLocked && election?.id && Date.parse(election?.candidacy_start_date) <= Date.now() && <p className="text-xs text-muted-foreground">O período de candidaturas já começou, mas os dados e as datas ainda podem ser ajustados antes da votação. O tipo de eleição não muda se já houver candidatos.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="candidacy_start_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Início das Candidaturas</Label><Input id="candidacy_start_date" type="datetime-local" value={formData.candidacy_start_date} onChange={handleChange} required disabled={votingLocked} min={election?.id ? undefined : minDateTime} /></div>
                <div><Label htmlFor="candidacy_end_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Fim das Candidaturas</Label><Input id="candidacy_end_date" type="datetime-local" value={formData.candidacy_end_date} onChange={handleChange} required disabled={votingLocked} min={formData.candidacy_start_date || minDateTime} /></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label htmlFor="voting_start_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Início da Votação</Label><Input id="voting_start_date" type="datetime-local" value={formData.voting_start_date} onChange={handleChange} required disabled={votingLocked} min={formData.candidacy_end_date || minDateTime} /></div>
                <div><Label htmlFor="voting_end_date" className="mb-1 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary"/>Fim da Votação</Label><Input id="voting_end_date" type="datetime-local" value={formData.voting_end_date} onChange={handleChange} required disabled={votingLocked} min={formData.voting_start_date || minDateTime} /></div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-4">
                <div>
                    <Label htmlFor="auto-recurring-election" className="text-base">Eleição automática mensal</Label>
                    <p className="text-sm text-muted-foreground">
                        Ao finalizar, cria a próxima eleição 1 mês depois com as mesmas janelas e numeração sequencial.
                    </p>
                </div>
                <Switch id="auto-recurring-election" checked={autoRecurring} onCheckedChange={setAutoRecurring} disabled={votingLocked} />
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
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
    const [params, setParams] = useSearchParams();
    const page = Math.max(1, Number.parseInt(params.get('electionPage'), 10) || 1);
    const status = params.get('electionStatus') || 'all';
    const search = params.get('electionSearch') || '';
    const [count, setCount] = useState(0);
    const request = useRef(0);
    const pageSize = 10;
    const changeFilter = values => setParams(current => {
        const next = new URLSearchParams(current);
        Object.entries(values).forEach(([key, value]) => value ? next.set(key, String(value)) : next.delete(key));
        return next;
    }, { replace: true, preventScrollReset: true });
    const { toast } = useToast();

    const fetchElections = useCallback(async () => {
        const sequence = ++request.current;setLoading(true);
        let query = supabase.from('elections').select('*, election_types(name)', { count: 'exact' }).is('archived_at', null).order('created_at', { ascending: false }).order('id');
        if (status !== 'all') query = query.eq('status', status);
        if (search.trim()) query = query.ilike('name', `%${search.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`);
        const [electionsResponse, automaticSettingsResponse] = await Promise.all([
            query.range((page - 1) * pageSize, page * pageSize - 1),
            supabase.from('system_settings').select('value').eq('key', AUTOMATIC_ELECTIONS_SETTINGS_KEY).maybeSingle(),
        ]);
        if (sequence !== request.current) return;
        setCount(electionsResponse.count || 0);
        if (!electionsResponse.error && page > Math.max(1, Math.ceil(electionsResponse.count / pageSize))) {
            setParams(current => { const next = new URLSearchParams(current); next.set('electionPage', String(Math.max(1, Math.ceil(electionsResponse.count / pageSize)))); return next; }, { replace: true, preventScrollReset: true });
            return;
        }
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
    }, [toast, page, status, search, setParams]);

    useEffect(() => {
        void fetchElections();
        return () => { request.current++; };
    }, [fetchElections]);
    useDomainRealtime('admin-election-list', 'admin', ['elections', 'election_types', { table: 'system_settings', filter: 'key=eq.automatic_elections' }], fetchElections);

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
            <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="text-2xl font-bold text-white">Gerenciamento de Eleições</h2>
                <Button onClick={handleAdd}><PlusCircle className="w-4 h-4 mr-2" /> Criar Eleição</Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="mb-1 flex items-center gap-2"><Search className="h-4 w-4"/>Buscar eleição</span><Input value={search} onChange={event => changeFilter({ electionSearch: event.target.value, electionPage: 1 })} /></label>
                <label className="text-sm">Status da eleição<GovSelect value={status} onChange={event => changeFilter({ electionStatus: event.target.value, electionPage: 1 })}><option value="all">Todos os status</option>{Object.entries(statusTranslations).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</GovSelect></label>
            </div>
            {loading && <p role="status" className="text-sm">Atualizando eleições…</p>}
            <PagedResults page={page} loading={loading}>
            {loading && !elections.length ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {elections.map(election => (
                        <Card key={election.id} data-election-card className="glass-effect min-w-0">
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
                            <CardContent className="space-y-2 text-sm [&_p]:flex-wrap">
                                <p className="flex items-center gap-2"><Calendar className="w-4 h-4 text-muted-foreground" /> <strong>Candidaturas:</strong> {formatDateTimeBR(election.candidacy_start_date)} - {formatDateTimeBR(election.candidacy_end_date)}</p>
                                <p className="flex items-center gap-2"><Vote className="w-4 h-4 text-muted-foreground" /> <strong>Votação:</strong> {formatDateTimeBR(election.voting_start_date)} - {formatDateTimeBR(election.voting_end_date)}</p>
                                <p><strong>Status:</strong> {statusTranslations[election.status] || election.status}</p>
                                {/senador|deputado/i.test(election.election_types?.name || '') && <p><strong>Cadeiras:</strong> {election.seats_available ?? 'A definir'}</p>}
                            </CardContent>
                            <CardFooter className="gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleEdit(election)}><Edit className="w-4 h-4 mr-2" /> Editar</Button>
                                <DeleteElectionButton election={election} onDeleted={fetchElections}/>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            </PagedResults>
            {<nav aria-label="Páginas de eleições" className="flex flex-wrap items-center justify-center gap-3">
                <Button variant="outline" disabled={loading || page <= 1} onClick={() => changeFilter({ electionPage: page - 1 })}><ChevronLeft className="mr-1 h-4 w-4"/>Anterior</Button>
                <span role="status" className="text-sm">Página {page} de {Math.max(1, Math.ceil(count / pageSize))} · {count} eleições</span>
                <Button variant="outline" disabled={loading || page * pageSize >= count} onClick={() => changeFilter({ electionPage: page + 1 })}>Próxima<ChevronRight className="ml-1 h-4 w-4"/></Button>
            </nav>}
            {!loading && !elections.length && <p className="text-center text-muted-foreground">Nenhuma eleição corresponde aos filtros.</p>}
            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingElection ? 'Editar Eleição' : 'Criar Nova Eleição'}</DialogTitle>
                    </DialogHeader>
                    <ElectionForm key={editingElection?.id || 'new'}
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
