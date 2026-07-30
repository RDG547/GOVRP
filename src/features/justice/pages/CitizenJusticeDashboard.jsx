import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  FileSearch,
  FileText,
  Gavel,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  createOccurrence,
  fetchCitizenJusticeData,
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
};

const CitizenJusticeDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState({
    occurrences: [],
    cases: [],
    deadlines: [],
    requests: [],
    custody: null,
  });
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      setData(await fetchCitizenJusticeData());
    } catch (error) {
      toast({
        title: 'Não foi possível carregar sua área de justiça',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!user?.id) return undefined;
    return subscribeToJusticeChanges(user.id, () => loadData({ quiet: true }));
  }, [loadData, user?.id]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const stats = useMemo(() => ({
    activeOccurrences: data.occurrences.filter(
      (item) => !['Arquivada', 'Duplicada'].includes(item.status)
    ).length,
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
      const occurrence = await createOccurrence(form);
      setForm(emptyForm);
      toast({
        title: 'Ocorrência registrada',
        description: `Protocolo ${occurrence.protocol_number}.`,
      });
      await loadData({ quiet: true });
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

      <Tabs defaultValue="occurrences" className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 lg:grid-cols-4">
          <TabsTrigger value="occurrences">Ocorrências</TabsTrigger>
          <TabsTrigger value="cases">Processos</TabsTrigger>
          <TabsTrigger value="deadlines">Prazos e intimações</TabsTrigger>
          <TabsTrigger value="requests">Pedidos e decisões</TabsTrigger>
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
            {data.occurrences.length ? data.occurrences.map((occurrence) => (
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
                      <Badge>{occurrence.status}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {occurrence.description || occurrence.details}
                  </p>
                </CardContent>
              </Card>
            )) : (
              <JusticeEmptyState
                title="Nenhuma ocorrência identificada"
                description="Ocorrências registradas com seu perfil aparecerão aqui com atualizações em tempo real."
              />
            )}
          </div>
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
                    {CASE_STATUS_LABELS[criminalCase.status] || criminalCase.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">{criminalCase.summary}</p>
                <CaseTimeline status={criminalCase.status} />
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
                  <Badge variant="outline">{request.status}</Badge>
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
      </Tabs>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => loadData()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar área
        </Button>
      </div>
    </div>
  );
};

export default CitizenJusticeDashboard;

