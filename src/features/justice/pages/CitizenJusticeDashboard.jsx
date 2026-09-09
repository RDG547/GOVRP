import { justiceStatus } from '@/lib/justice/constants';
import { useSectionLoader } from '@/hooks/use-section-loader';
import { CITIZEN_JUSTICE_SECTIONS, citizenJusticeSectionsForEvents } from '@/lib/justice/citizenData';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSearch,
  FileText,
  Gavel,
  Loader2,
  LockKeyhole,
  Plus,
  Search,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  createOccurrence,
  appealCitizenFine,
  createCitizenJusticeRequest,
  fetchCitizenJusticeData,
  issueClearanceCertificate,
  fileCaseAppeal,
  payCitizenFine,
  requestFineHearing,
  submitCaseDocument,
  subscribeToJusticeChanges,
} from '@/lib/justice/api';
import {
  CASE_STATUS_LABELS,
  CUSTODY_STATUS_LABELS,
  OCCURRENCE_TYPES,
  PRIORITY_LABELS,
  PRIORITY_OPTIONS,
  PRIORITY_STYLES,
  REQUEST_TYPE_LABELS,
} from '@/lib/justice/constants';
import { formatJusticeDate, formatRealDuration, getCountdown } from '@/lib/justice/time';
import CaseTimeline from '@/features/justice/components/CaseTimeline';
import JusticeEmptyState from '@/features/justice/components/JusticeEmptyState';
import JusticeStatCard from '@/features/justice/components/JusticeStatCard';

const emptyForm = {
  title: '',
  description: '',
  occurrenceType: '',
  location: '',
  occurredAt: '',
  anonymous: false,
  priority: 'normal',
  involvedPeople: '',
  witnesses: '',
  evidence: '',
};

const emptyRequestForm = { requestType: 'formal_investigation', subject: '', description: '', relatedOccurrenceId: '', evidence: '' };
const lines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const emptyJusticeData = {
    occurrences: [],
    cases: [],
    deadlines: [],
    requests: [],
    custody: null,
    fines: [],
    fineAppeals: [],
    fineHearings: [],
    citizenRequests: [],
    campaigns: [],
    security: { warrants: [], investigations: [] },
    wanted: [],
    policeMetrics: {},
    serverNow: null,
    investigationSubjects: [], profiles: [], timeline: [], caseDocuments: [], caseHearings: [], caseAppeals: [], sentences: [],
};

const CitizenJusticeDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState(emptyJusticeData);
  const [form, setForm] = useState(emptyForm);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [fineAction, setFineAction] = useState({ fineId: '', type: '', reason: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [caseAction, setCaseAction] = useState(null);
  const [caseActionText, setCaseActionText] = useState('');

  const [occurrencePage, setOccurrencePage] = useState(0);
  const [occurrencesLoading, setOccurrencesLoading] = useState(false);
  const occurrenceCursors = useRef([null]);
  const occurrenceCursor = useRef(null);
  const refreshSections = useSectionLoader(user?.id,
    async sections => {
      const cursor = occurrenceCursor.current;
      return { ...await fetchCitizenJusticeData(sections, cursor), cursorKey: JSON.stringify(cursor) };
    },
    ({ values, errors, cursorKey }, sections) => {
      const samePage = cursorKey === JSON.stringify(occurrenceCursor.current);
      if (!samePage) { delete values.occurrences; delete values.nextOccurrenceCursor; }
      setData(previous => ({ ...previous, ...values, errors: [...new Set([
        ...(previous.errors || []).filter(section => !sections.includes(section)), ...errors,
      ])] }));
      if (values.serverNow) setServerOffset(new Date(values.serverNow).getTime() - Date.now());
      if (samePage && sections.includes('occurrences')) setOccurrencesLoading(false);
      setLoading(false);
    },
    () => { setLoading(false); setOccurrencesLoading(false); toast({ title: 'Não foi possível atualizar sua área de justiça', description: 'Tente novamente.', variant: 'destructive' }); },
  );
  const loadData = useCallback(({ quiet = false, sections = CITIZEN_JUSTICE_SECTIONS } = {}) => {
    if (!quiet) setLoading(true);
    return refreshSections(sections);
  }, [refreshSections]);
  useEffect(() => {
    setData(emptyJusticeData);
    occurrenceCursor.current = null; occurrenceCursors.current = [null]; setOccurrencePage(0);
    void loadData();
  }, [loadData]);
  useEffect(() => {
    if (!user?.id) return undefined;
    return subscribeToJusticeChanges(user.id, events => refreshSections(citizenJusticeSectionsForEvents(events)));
  }, [refreshSections, user?.id]);

  const changeOccurrencePage = page => {
    if (occurrencesLoading || page < 0) return;
    const cursor = page > occurrencePage ? data.nextOccurrenceCursor : occurrenceCursors.current[page];
    if (page > occurrencePage && !cursor) return;
    occurrenceCursors.current[page] = cursor || null;
    occurrenceCursor.current = cursor || null;
    setOccurrencePage(page);
    setOccurrencesLoading(true);
    setData(previous => ({ ...previous, occurrences: [], nextOccurrenceCursor: null }));
    void refreshSections(['occurrences']);
  };

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now() + serverOffset), 1000);
    return () => window.clearInterval(interval);
  }, [serverOffset]);

  const stats = useMemo(() => ({
    activeOccurrences: data.activeOccurrenceCount || 0,
    activeCases: data.cases.filter(
      (item) => !['acquitted', 'archived', 'served'].includes(item.status)
    ).length,
    deadlines: data.deadlines.length,
    custody: data.custody ? 1 : 0,
  }), [data]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const occurrence = await createOccurrence({
        ...form,
        involvedPeople: lines(form.involvedPeople),
        witnesses: lines(form.witnesses),
        evidence: lines(form.evidence),
      });
      setForm(emptyForm);
      toast({
        title: 'Ocorrência registrada',
        description: `Protocolo ${occurrence.protocol_number}.`,
      });
      occurrenceCursor.current = null; occurrenceCursors.current = [null]; setOccurrencePage(0);
      await loadData({ quiet: true, sections: ['occurrences', 'policeMetrics'] });
    } catch (error) {
      toast({
        title: 'Não foi possível registrar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCitizenRequest = async (event) => {
    event.preventDefault();
    setActionLoading('request');
    try {
      const result = await createCitizenJusticeRequest({ ...requestForm, evidence: lines(requestForm.evidence) });
      setRequestForm(emptyRequestForm);
      toast({ title: 'Pedido protocolado', description: `Protocolo ${result.protocol_number}.` });
      await loadData({ quiet: true, sections: ['citizenRequests'] });
    } catch (error) {
      toast({ title: 'Não foi possível protocolar', description: error.message, variant: 'destructive' });
    } finally { setActionLoading(''); }
  };

  const handlePayFine = async (fineId) => {
    setActionLoading(`pay:${fineId}`);
    try {
      const result = await payCitizenFine(fineId);
      if (!result?.success) throw new Error(result?.message || 'Pagamento recusado.');
      toast({ title: 'Pagamento confirmado', description: result.message });
      await loadData({ quiet: true, sections: ['fines'] });
    } catch (error) {
      toast({ title: 'Não foi possível pagar', description: error.message, variant: 'destructive' });
    } finally { setActionLoading(''); }
  };

  const handleFineRequest = async (event) => {
    event.preventDefault();
    const { fineId, type, reason } = fineAction;
    setActionLoading(`${type}:${fineId}`);
    try {
      const result = type === 'appeal'
        ? await appealCitizenFine(fineId, reason)
        : await requestFineHearing(fineId, reason);
      if (result?.success === false) throw new Error(result.message);
      setFineAction({ fineId: '', type: '', reason: '' });
      toast({ title: type === 'appeal' ? 'Recurso protocolado' : 'Audiência solicitada' });
      await loadData({ quiet: true, sections: type === 'appeal' ? ['fineAppeals'] : ['fineHearings'] });
    } catch (error) {
      toast({ title: 'Solicitação não concluída', description: error.message, variant: 'destructive' });
    } finally { setActionLoading(''); }
  };

  const handleCertificate = async () => {
    setActionLoading('certificate');
    try {
      const document = await issueClearanceCertificate();
      toast({ title: 'Atestado emitido', description: `${document.document_number} disponível no DIC.` });
    } catch (error) {
      toast({ title: 'Não foi possível emitir', description: error.message, variant: 'destructive' });
    } finally { setActionLoading(''); }
  };

  const handleCaseAction = async () => {
    if (!caseAction) return;
    setActionLoading(`case:${caseAction.item.id}`);
    try {
      if (caseAction.type === 'defense') {
        await submitCaseDocument({
          caseId: caseAction.item.id,
          documentType: 'defense',
          title: 'Defesa inicial',
          body: caseActionText,
        });
      } else {
        await fileCaseAppeal({ caseId: caseAction.item.id, argumentsText: caseActionText });
      }
      toast({
        title: caseAction.type === 'defense' ? 'Defesa protocolada' : 'Recurso protocolado',
        description: 'O documento entrou na linha do tempo oficial do processo.',
      });
      setCaseAction(null);
      setCaseActionText('');
      await loadData({ quiet: true, sections: ['caseDocuments', 'caseAppeals', 'timeline', 'cases'] });
    } catch (error) {
      toast({ title: 'Não foi possível protocolar', description: error.message, variant: 'destructive' });
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-9 w-9 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {data.custody ? (
        <Card className="border-red-500/35 bg-red-500/10">
          <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-red-200">
                <LockKeyhole className="h-5 w-5" />
                {CUSTODY_STATUS_LABELS[data.custody.custody_status]}
              </CardTitle>
              <CardDescription className="mt-2">
                {data.custody.facility?.name} · saída prevista em{' '}
                {formatRealDuration(getCountdown(data.custody.expected_release_at, now))}
              </CardDescription>
            </div>
            <Button asChild className="mt-4 sm:mt-0">
              <Link to="/services/prison">Entrar na área prisional</Link>
            </Button>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <JusticeStatCard icon={FileSearch} label="Ocorrências ativas" value={stats.activeOccurrences} />
        <JusticeStatCard icon={Scale} label="Processos em andamento" value={stats.activeCases} tone="violet" />
        <JusticeStatCard icon={CalendarClock} label="Prazos abertos" value={stats.deadlines} tone="amber" />
        <JusticeStatCard
          icon={ShieldCheck}
          label="Situação de custódia"
          value={stats.custody ? 'Ativa' : 'Livre'}
          tone={stats.custody ? 'red' : 'green'}
        />
      </div>

      {data.errors?.length ? <div role="alert" className="rounded-lg border border-amber-500/40 p-3 text-sm">Algumas informações não puderam ser atualizadas. <Button variant="link" onClick={() => loadData({ quiet: true, sections: data.errors })}>Tentar novamente</Button></div> : null}
      <Tabs defaultValue="occurrences" className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 md:grid-cols-3 xl:grid-cols-6">
          <TabsTrigger value="occurrences"><FileSearch className="mr-2 h-4 w-4" />Ocorrências</TabsTrigger>
          <TabsTrigger value="cases"><Scale className="mr-2 h-4 w-4" />Processos</TabsTrigger>
          <TabsTrigger value="deadlines"><CalendarClock className="mr-2 h-4 w-4" />Prazos e intimações</TabsTrigger>
          <TabsTrigger value="requests"><Gavel className="mr-2 h-4 w-4" />Pedidos e decisões</TabsTrigger>
          <TabsTrigger value="fines"><Banknote className="mr-2 h-4 w-4" />Multas</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="mr-2 h-4 w-4" />Segurança pública</TabsTrigger>
        </TabsList>

        <TabsContent value="occurrences" className="space-y-6">
          <Card className="glass-effect">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-blue-300" />
                Registrar nova ocorrência
              </CardTitle>
              <CardDescription>
                O protocolo gera uma missão para a polícia. Descreva fatos do RP; denúncias falsas também
                podem gerar consequências dentro do jogo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="grid gap-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="occurrence-title">Título</Label>
                    <Input
                      id="occurrence-title"
                      value={form.title}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))}
                      minLength={5}
                      required
                      placeholder="Ex.: Furto no centro da cidade"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Categoria</Label>
                    <Select
                      value={form.occurrenceType}
                      onValueChange={(value) => setForm((current) => ({
                        ...current,
                        occurrenceType: value,
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a categoria" />
                      </SelectTrigger>
                      <SelectContent>
                        {OCCURRENCE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="occurrence-description">Descrição dos fatos</Label>
                  <Textarea
                    id="occurrence-description"
                    value={form.description}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))}
                    minLength={20}
                    required
                    rows={6}
                    placeholder="Conte o que aconteceu, quem estava presente e quais provas podem existir."
                  />
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="occurrence-location">Local</Label>
                    <Input
                      id="occurrence-location"
                      value={form.location}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))}
                      placeholder="Local no universo do GOVRP"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="occurrence-date">Quando ocorreu</Label>
                    <Input
                      id="occurrence-date"
                      type="datetime-local"
                      value={form.occurredAt}
                      onChange={(event) => setForm((current) => ({
                        ...current,
                        occurredAt: event.target.value,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Urgência</Label>
                    <Select
                      value={form.priority}
                      onValueChange={(value) => setForm((current) => ({
                        ...current,
                        priority: value,
                      }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2"><Label htmlFor="occurrence-involved">Envolvidos ou suspeitos</Label><Textarea id="occurrence-involved" rows={3} value={form.involvedPeople} onChange={(event) => setForm((current) => ({ ...current, involvedPeople: event.target.value }))} placeholder="Um nome ou descrição por linha" /></div>
                  <div className="space-y-2"><Label htmlFor="occurrence-witnesses">Testemunhas</Label><Textarea id="occurrence-witnesses" rows={3} value={form.witnesses} onChange={(event) => setForm((current) => ({ ...current, witnesses: event.target.value }))} placeholder="Uma testemunha por linha" /></div>
                  <div className="space-y-2"><Label htmlFor="occurrence-evidence">Evidências ou anexos</Label><Textarea id="occurrence-evidence" rows={3} value={form.evidence} onChange={(event) => setForm((current) => ({ ...current, evidence: event.target.value }))} placeholder="Links, documentos ou protocolos, um por linha" /></div>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-4">
                  <input
                    type="checkbox"
                    checked={form.anonymous}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      anonymous: event.target.checked,
                    }))}
                    className="mt-1 h-4 w-4"
                  />
                  <span>
                    <span className="block font-medium text-foreground">Enviar anonimamente</span>
                    <span className="text-sm text-muted-foreground">
                      Seu perfil não ficará ligado à ocorrência visível, mas você não poderá acompanhar o
                      andamento pela área do cidadão.
                    </span>
                  </span>
                </label>

                <Button type="submit" disabled={submitting || !form.occurrenceType}>
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Registrar ocorrência
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {occurrencesLoading ? <div role="status" className="flex justify-center p-6"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">Carregando ocorrências</span></div> : data.occurrences.length ? data.occurrences.map((occurrence) => (
              <Card key={occurrence.id} className="glass-effect">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{occurrence.title}</CardTitle>
                      <CardDescription className="mt-1">
                        {occurrence.protocol_number || occurrence.id}
                        {' · '}
                        {formatJusticeDate(occurrence.created_at)}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className={PRIORITY_STYLES[occurrence.priority]}>
                        {PRIORITY_LABELS[occurrence.priority] || occurrence.priority}
                      </Badge>
                      <Badge>{justiceStatus(occurrence.status)}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {occurrence.description || occurrence.details}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">Atualizada em {formatJusticeDate(occurrence.updated_at || occurrence.created_at)}</p>
                  {occurrence.history?.length ? <ol className="mt-4 space-y-2 border-l pl-4">{occurrence.history.map(event => <li key={event.id} className="text-sm"><p>{event.content}</p><time className="text-xs text-muted-foreground">{formatJusticeDate(event.created_at)}</time></li>)}</ol> : null}
                </CardContent>
              </Card>
            )) : data.errors?.includes('occurrences') ? <JusticeEmptyState title="Ocorrências temporariamente indisponíveis" description="Tente atualizar novamente para consultar seus protocolos." /> : (
              <JusticeEmptyState
                title="Nenhuma ocorrência identificada"
                description="Ocorrências registradas com seu perfil aparecerão aqui com atualizações em tempo real."
              />
            )}
          </div>
          <nav aria-label="Páginas de ocorrências" className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" disabled={occurrencesLoading || occurrencePage === 0} onClick={() => changeOccurrencePage(occurrencePage - 1)}><ChevronLeft className="mr-2 h-4 w-4" />Anteriores</Button>
            <span className="text-sm" aria-live="polite">Página {occurrencePage + 1}</span>
            <Button variant="outline" disabled={occurrencesLoading || !data.nextOccurrenceCursor} onClick={() => changeOccurrencePage(occurrencePage + 1)}>Mais antigas<ChevronRight className="ml-2 h-4 w-4" /></Button>
            {occurrencePage > 0 && <Button variant="link" disabled={occurrencesLoading} onClick={() => changeOccurrencePage(0)}>Ver mais recentes</Button>}
          </nav>

        </TabsContent>

        <TabsContent value="cases" className="space-y-4">
          {data.cases.length ? data.cases.map((criminalCase) => (
            <Card key={criminalCase.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{criminalCase.title}</CardTitle>
                    <CardDescription className="mt-1">{criminalCase.case_number}</CardDescription>
                  </div>
                  <Badge variant="outline">
                    {justiceStatus(criminalCase.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">{criminalCase.summary}</p>
                <CaseTimeline
                  status={criminalCase.status}
                  events={data.timeline.filter((event) => event.case_id === criminalCase.id || (criminalCase.investigation_id && event.investigation_id === criminalCase.investigation_id))}
                />
                {criminalCase.status === 'initial_defense' ? (
                  <Button onClick={() => setCaseAction({ type: 'defense', item: criminalCase })}>
                    <FileText className="mr-2 h-4 w-4" />Apresentar defesa
                  </Button>
                ) : null}
                {['convicted', 'acquitted'].includes(criminalCase.status) ? (
                  <Button variant="outline" onClick={() => setCaseAction({ type: 'appeal', item: criminalCase })}>
                    <Gavel className="mr-2 h-4 w-4" />Protocolar recurso
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhum processo relacionado ao seu perfil"
              description="Se você for incluído como parte, receberá uma notificação e poderá acompanhar cada etapa aqui."
            />
          )}
        </TabsContent>

        <TabsContent value="deadlines" className="space-y-4">
          {data.deadlines.length ? data.deadlines.map((deadline) => (
            <Card key={deadline.id} className="border-amber-500/25 bg-amber-500/5">
              <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <CalendarClock className="h-5 w-5 text-amber-300" />
                    {deadline.deadline_type === 'appeal' ? 'Prazo de recurso' : deadline.deadline_type}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Data RP: {formatJusticeDate(deadline.rp_due_at)}
                  </CardDescription>
                </div>
                <Badge className="mt-3 w-fit bg-amber-500/15 text-amber-200 sm:mt-0">
                  {formatRealDuration(getCountdown(deadline.real_due_at, now))}
                </Badge>
              </CardHeader>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhum prazo aberto"
              description="Intimações, defesa, recurso e outros prazos processuais aparecerão nesta área."
            />
          )}
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          <Card className="glass-effect">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-cyan-300" />Novo pedido administrativo</CardTitle>
              <CardDescription>Solicite abertura formal de investigação ou liberação de bem apreendido, com protocolo e acompanhamento.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCitizenRequest} className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2"><Label>Tipo</Label><Select value={requestForm.requestType} onValueChange={(value) => setRequestForm((current) => ({ ...current, requestType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="formal_investigation">Pedido de investigação formal</SelectItem><SelectItem value="asset_release">Liberação de bem apreendido</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label htmlFor="justice-request-subject">Assunto</Label><Input id="justice-request-subject" required minLength={5} value={requestForm.subject} onChange={(event) => setRequestForm((current) => ({ ...current, subject: event.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label>Ocorrência relacionada</Label><Select value={requestForm.relatedOccurrenceId || 'none'} onValueChange={(value) => setRequestForm((current) => ({ ...current, relatedOccurrenceId: value === 'none' ? '' : value }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhuma</SelectItem>{data.occurrences.map((item) => <SelectItem key={item.id} value={item.id}>{item.protocol_number} — {item.title}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="justice-request-description">Fundamentação e provas</Label><Textarea id="justice-request-description" required minLength={20} rows={5} value={requestForm.description} onChange={(event) => setRequestForm((current) => ({ ...current, description: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="justice-request-evidence">Referências e evidências</Label><Textarea id="justice-request-evidence" rows={3} value={requestForm.evidence} onChange={(event) => setRequestForm((current) => ({ ...current, evidence: event.target.value }))} placeholder="Uma referência ou link por linha" /></div>
                <Button type="submit" disabled={actionLoading === 'request'}>{actionLoading === 'request' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Protocolar pedido</Button>
              </form>
            </CardContent>
          </Card>

          {data.citizenRequests.map((request) => (
            <Card key={request.id} className="border-cyan-500/20 bg-cyan-500/5"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{request.subject}</CardTitle><CardDescription>{request.protocol_number} · {request.request_type === 'formal_investigation' ? 'Investigação formal' : 'Liberação de bem'}</CardDescription></div><Badge variant="outline">{justiceStatus(request.status)}</Badge></div></CardHeader>{request.decision_notes ? <CardContent><p className="text-sm text-muted-foreground">{request.decision_notes}</p></CardContent> : null}</Card>
          ))}

          {data.requests.length ? data.requests.map((request) => (
            <Card key={request.id} className="glass-effect">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Gavel className="h-5 w-5 text-violet-300" />
                      {REQUEST_TYPE_LABELS[request.request_type] || request.request_type}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Solicitado em {formatJusticeDate(request.created_at)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{justiceStatus(request.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {request.decision_reason ? (
                  <p className="text-sm text-muted-foreground">{request.decision_reason}</p>
          ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    Aguardando decisão fundamentada.
                  </p>
                )}
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhum pedido judicial relacionado"
              description="Pedidos de fiança, liberdade, mandados e outras decisões aparecerão aqui."
            />
          )}
        </TabsContent>

        <TabsContent value="fines" className="space-y-4">
          {data.fines.length ? data.fines.map((fine) => {
            const canAct = ['Pendente', 'Vencida'].includes(fine.status);
            const appeal = data.fineAppeals.find((item) => item.fine_id === fine.id);
            const hearing = data.fineHearings.find((item) => item.fine_id === fine.id);
            const actionOpen = fineAction.fineId === fine.id;
            return (
              <Card key={fine.id} className="glass-effect">
                <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-amber-300" />{fine.fine_code}</CardTitle><CardDescription>Emitida em {formatJusticeDate(fine.created_at)}{fine.due_date ? ` · vence em ${formatJusticeDate(fine.due_date)}` : ''}</CardDescription></div><Badge variant="outline">{justiceStatus(fine.status)}</Badge></div></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs uppercase text-muted-foreground">Valor</p><p className="text-xl font-bold">{money(fine.amount)}</p></div><div><p className="text-xs uppercase text-muted-foreground">Pontos</p><p className="text-xl font-bold">{fine.points || 0}</p></div><div><p className="text-xs uppercase text-muted-foreground">Motivo</p><p className="text-sm">{fine.reason}</p></div></div>
                  {fine.status === 'Paga' && fine.payment_snapshot ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">Pagamento confirmado · total {money(fine.payment_snapshot.totalAmount)} · comprovante {fine.payment_snapshot.transactionId}</div> : null}
                  {appeal ? <p className="text-sm text-cyan-200">Recurso: {justiceStatus(appeal.status)}</p> : null}{hearing ? <p className="text-sm text-violet-200">Audiência: {justiceStatus(hearing.status)}</p> : null}
                  {canAct ? <div className="flex flex-wrap gap-2"><Button onClick={() => handlePayFine(fine.id)} disabled={Boolean(actionLoading)}>{actionLoading === `pay:${fine.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Pagar</Button>{!appeal ? <Button variant="outline" onClick={() => setFineAction({ fineId: fine.id, type: 'appeal', reason: '' })}>Recorrer</Button> : null}{!hearing ? <Button variant="outline" onClick={() => setFineAction({ fineId: fine.id, type: 'hearing', reason: '' })}>Pedir audiência</Button> : null}</div> : null}
                  {actionOpen ? <form onSubmit={handleFineRequest} className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4"><Label htmlFor={`fine-reason-${fine.id}`}>{fineAction.type === 'appeal' ? 'Fundamentação do recurso' : 'Motivo do pedido de audiência'}</Label><Textarea id={`fine-reason-${fine.id}`} minLength={20} required value={fineAction.reason} onChange={(event) => setFineAction((current) => ({ ...current, reason: event.target.value }))} /><div className="flex gap-2"><Button type="submit" disabled={Boolean(actionLoading)}>Enviar</Button><Button type="button" variant="ghost" onClick={() => setFineAction({ fineId: '', type: '', reason: '' })}>Cancelar</Button></div></form> : null}
                </CardContent>
              </Card>
            );
          }) : <JusticeEmptyState title="Nenhuma multa recebida" description="Multas oficiais aparecerão aqui com número único, pagamento, recurso e audiência." />}
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="glass-effect"><CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-5 w-5 text-red-300" />Mandados em seu nome</CardTitle></CardHeader><CardContent>{data.security.warrants?.length ? data.security.warrants.map((item) => <div key={item.id} className="mb-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3"><p className="font-medium">{item.number}</p><p className="text-sm text-muted-foreground">{item.type} · {justiceStatus(item.status)}</p></div>) : <p className="text-sm text-muted-foreground">Nenhum mandado ativo localizado.</p>}</CardContent></Card>
            <Card className="glass-effect"><CardHeader><CardTitle className="flex items-center gap-2"><FileSearch className="h-5 w-5 text-violet-300" />Investigações relacionadas</CardTitle></CardHeader><CardContent>{data.security.investigations?.length ? data.security.investigations.map((item) => <div key={item.number} className="mb-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"><p className="font-medium">{item.number}</p><p className="text-sm text-muted-foreground">{justiceStatus(item.status)}</p></div>) : <p className="text-sm text-muted-foreground">Seu perfil não consta como investigado.</p>}</CardContent></Card>
          </div>
          <Card className="border-emerald-500/25 bg-emerald-500/5"><CardHeader className="sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><BadgeCheck className="h-5 w-5 text-emerald-300" />Atestado de antecedentes</CardTitle><CardDescription>O resultado é calculado no servidor e o documento verificável fica salvo no DIC por 90 dias.</CardDescription></div><Button className="mt-4 sm:mt-0" onClick={handleCertificate} disabled={actionLoading === 'certificate'}>{actionLoading === 'certificate' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Emitir atestado</Button></CardHeader></Card>
          <Card className="glass-effect"><CardHeader><CardTitle>Indicadores de eficiência policial</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-4"><div><p className="text-sm text-muted-foreground">Ocorrências</p><p className="text-2xl font-bold">{data.policeMetrics.reported || 0}</p></div><div><p className="text-sm text-muted-foreground">Em investigação</p><p className="text-2xl font-bold">{data.policeMetrics.inInvestigation || 0}</p></div><div><p className="text-sm text-muted-foreground">Resolvidas</p><p className="text-2xl font-bold">{data.policeMetrics.resolved || 0}</p></div><div><p className="text-sm text-muted-foreground">Taxa de resolução</p><p className="text-2xl font-bold">{data.policeMetrics.resolutionRate || 0}%</p></div></CardContent></Card>
          {data.campaigns.length ? <div className="grid gap-4 md:grid-cols-2">{data.campaigns.map((campaign) => <Card key={campaign.id} className="glass-effect"><CardHeader><Badge className="mb-2 w-fit" variant="outline">{campaign.category}</Badge><CardTitle>{campaign.title}</CardTitle><CardDescription>{campaign.summary}</CardDescription></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm text-muted-foreground">{campaign.content}</p></CardContent></Card>)}</div> : null}
          {data.wanted.length ? <Card className="border-red-500/25 bg-red-500/5"><CardHeader><CardTitle>Lista pública de procurados</CardTitle><CardDescription>Somente mandados de prisão oficiais, ativos e não expirados.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{data.wanted.map((item) => <div key={item.warrant_number} className="rounded-lg border border-red-500/20 p-3"><p className="font-semibold">{item.full_name}</p><p className="text-sm text-muted-foreground">{item.warrant_number}</p></div>)}</CardContent></Card> : null}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(caseAction)} onOpenChange={(open) => !open && setCaseAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{caseAction?.type === 'defense' ? 'Apresentar defesa inicial' : 'Protocolar recurso'}</DialogTitle>
            <DialogDescription>
              O texto será assinado, preservado no processo e exibido na linha do tempo para as partes autorizadas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="case-action-text">Fundamentação</Label>
            <Textarea id="case-action-text" rows={8} value={caseActionText} onChange={(event) => setCaseActionText(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCaseAction(null)}>Cancelar</Button>
            <Button onClick={handleCaseAction} disabled={Boolean(actionLoading) || caseActionText.trim().length < (caseAction?.type === 'appeal' ? 40 : 20)}>
              {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Protocolar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CitizenJusticeDashboard;
