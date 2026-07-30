import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Gavel,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Scale,
  Search,
  Siren,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  decideJudicialRequest,
  fetchAuthorityJusticeData,
  openInvestigation,
  subscribeToJusticeChanges,
  triageOccurrence,
} from '@/lib/justice/api';
import {
  CASE_STATUS_LABELS,
  CUSTODY_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  REQUEST_TYPE_LABELS,
  hasAnyJusticeRole,
  primaryJusticeRole,
} from '@/lib/justice/constants';
import { formatJusticeDate, formatRealDuration, getCountdown } from '@/lib/justice/time';
import JusticeEmptyState from '@/features/justice/components/JusticeEmptyState';
import JusticeStatCard from '@/features/justice/components/JusticeStatCard';

const AuthorityJusticeDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState({
    occurrences: [],
    investigations: [],
    cases: [],
    requests: [],
    warrants: [],
    custody: [],
  });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');

  const role = primaryJusticeRole(user);
  const isPolice = hasAnyJusticeRole(user, ['Admin', 'Policial', 'Police', 'Delegado']);
  const isJudge = hasAnyJusticeRole(user, ['Admin', 'Juiz']);
  const isProsecutor = hasAnyJusticeRole(user, ['Admin', 'Promotor']);
  const isLawyer = hasAnyJusticeRole(user, ['Admin', 'Advogado', 'Defensor Público']);
  const isPrisonStaff = hasAnyJusticeRole(user, ['Admin', 'Agente Penitenciário', 'Diretor Penitenciário']);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      setData(await fetchAuthorityJusticeData());
    } catch (error) {
      toast({
        title: 'Falha ao carregar painel de autoridade',
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

  const queues = useMemo(() => ({
    newOccurrences: data.occurrences.filter((item) => item.status === 'Pendente'),
    activeInvestigations: data.investigations.filter(
      (item) => !['archived', 'closed', 'sent_to_prosecutor'].includes(item.status)
    ),
    urgentRequests: data.requests.filter((item) => item.status === 'pending'),
    waitingSentence: data.cases.filter(
      (item) => ['awaiting_sentence', 'hearing_scheduled', 'judicial_review'].includes(item.status)
    ),
    provisionalCustody: data.custody.filter((item) => item.custody_status === 'provisional'),
  }), [data]);

  const closeAction = () => {
    setAction(null);
    setReason('');
  };

  const performAction = async () => {
    if (!action) return;
    setActing(true);
    try {
      if (action.type === 'triage') {
        await triageOccurrence({
          occurrenceId: action.item.id,
          action: 'accept',
          notes: reason,
        });
      } else if (action.type === 'investigate') {
        await openInvestigation({
          occurrenceId: action.item.id,
          summary: reason,
        });
      } else if (action.type === 'request-decision') {
        await decideJudicialRequest({
          requestId: action.item.id,
          approved: action.approved,
          reason,
        });
      }

      toast({
        title: 'Ação registrada',
        description: 'A fila e o histórico foram atualizados com auditoria.',
      });
      closeAction();
      await loadData({ quiet: true });
    } catch (error) {
      toast({
        title: 'A ação não foi concluída',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setActing(false);
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
      <Card className="border-cyan-500/25 bg-cyan-500/5">
        <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge className="mb-3 bg-cyan-500/15 text-cyan-200">{role}</Badge>
            <CardTitle>Central operacional de Segurança e Justiça</CardTitle>
            <CardDescription className="mt-2">
              Cada ação exige competência, estado válido e justificativa. Tudo fica registrado na auditoria.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => loadData()} className="mt-4 sm:mt-0">
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar filas
          </Button>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <JusticeStatCard icon={Siren} label="Ocorrências novas" value={queues.newOccurrences.length} tone="red" />
        <JusticeStatCard icon={Search} label="Investigações" value={queues.activeInvestigations.length} />
        <JusticeStatCard icon={Gavel} label="Pedidos urgentes" value={queues.urgentRequests.length} tone="amber" />
        <JusticeStatCard icon={Scale} label="Fila judicial" value={queues.waitingSentence.length} tone="violet" />
        <JusticeStatCard icon={LockKeyhole} label="Presos provisórios" value={queues.provisionalCustody.length} tone="red" />
      </div>

      <Tabs defaultValue={isPolice ? 'missions' : isJudge ? 'requests' : 'cases'} className="space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-muted/50 p-2 lg:grid-cols-5">
          <TabsTrigger value="missions">Missões policiais</TabsTrigger>
          <TabsTrigger value="investigations">Investigações</TabsTrigger>
          <TabsTrigger value="requests">Pedidos judiciais</TabsTrigger>
          <TabsTrigger value="cases">Processos</TabsTrigger>
          <TabsTrigger value="custody">Custódia</TabsTrigger>
        </TabsList>

        <TabsContent value="missions" className="space-y-4">
          {!isPolice ? (
            <JusticeEmptyState
              title="Fila exclusiva da Polícia"
              description="Seu cargo não permite aceitar ou transformar ocorrências em investigação."
            />
          ) : queues.newOccurrences.length ? queues.newOccurrences.map((occurrence) => (
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
                  <Badge variant="outline" className={PRIORITY_STYLES[occurrence.priority]}>
                    {PRIORITY_LABELS[occurrence.priority] || occurrence.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {occurrence.description || occurrence.details}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAction({ type: 'triage', item: occurrence })}
                  >
                    <ClipboardList className="mr-2 h-4 w-4" />
                    Aceitar para triagem
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setAction({ type: 'investigate', item: occurrence })}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Abrir investigação
                  </Button>
                </div>
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhuma missão nova"
              description="Quando um cidadão registrar uma ocorrência, ela aparecerá aqui em tempo real."
            />
          )}
        </TabsContent>

        <TabsContent value="investigations" className="space-y-4">
          {data.investigations.length ? data.investigations.map((investigation) => (
            <Card key={investigation.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{investigation.investigation_number}</CardTitle>
                    <CardDescription className="mt-1">{investigation.summary}</CardDescription>
                  </div>
                  <Badge variant="outline">{investigation.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
                <p><span className="text-muted-foreground">Aberta em:</span><br />{formatJusticeDate(investigation.opened_at)}</p>
                <p><span className="text-muted-foreground">Policial responsável:</span><br />{investigation.lead_officer_id ? 'Designado' : 'Não designado'}</p>
                <p><span className="text-muted-foreground">Delegado:</span><br />{investigation.delegate_id ? 'Designado' : 'Aguardando'}</p>
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhuma investigação disponível"
              description="A visibilidade respeita sua competência e os vínculos com cada procedimento."
            />
          )}
        </TabsContent>

        <TabsContent value="requests" className="space-y-4">
          {data.requests.length ? data.requests.map((request) => (
            <Card
              key={request.id}
              className={request.status === 'pending' ? 'border-amber-500/30 bg-amber-500/5' : 'glass-effect'}
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">
                      {REQUEST_TYPE_LABELS[request.request_type] || request.request_type}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Pedido em {formatJusticeDate(request.created_at)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{request.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{request.justification}</p>
                {isJudge && request.status === 'pending' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => setAction({
                        type: 'request-decision',
                        item: request,
                        approved: true,
                      })}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setAction({
                        type: 'request-decision',
                        item: request,
                        approved: false,
                      })}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Negar
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhum pedido judicial na fila"
              description="Mandados, liberdade, fiança e outras medidas urgentes aparecerão aqui."
            />
          )}
        </TabsContent>

        <TabsContent value="cases" className="space-y-4">
          {(isJudge || isProsecutor || isLawyer) && data.cases.length ? data.cases.map((criminalCase) => (
            <Card key={criminalCase.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{criminalCase.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {criminalCase.case_number} · {criminalCase.court_level}ª instância
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {CASE_STATUS_LABELS[criminalCase.status] || criminalCase.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm md:grid-cols-3">
                <div className="rounded-lg border border-border/70 p-3">
                  <BadgeCheck className="mb-2 h-5 w-5 text-violet-300" />
                  <p className="text-muted-foreground">Promotor</p>
                  <p>{criminalCase.prosecutor_id ? 'Designado' : 'Pendente'}</p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <Gavel className="mb-2 h-5 w-5 text-amber-300" />
                  <p className="text-muted-foreground">Juiz</p>
                  <p>{criminalCase.judge_id ? 'Distribuído' : 'Pendente'}</p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <CalendarClock className="mb-2 h-5 w-5 text-cyan-300" />
                  <p className="text-muted-foreground">Última atualização</p>
                  <p>{formatJusticeDate(criminalCase.updated_at)}</p>
                </div>
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhum processo disponível"
              description="Promotores, advogados e juízes visualizam apenas os processos compatíveis com suas atribuições."
            />
          )}
        </TabsContent>

        <TabsContent value="custody" className="space-y-4">
          {(isPrisonStaff || isJudge) && data.custody.length ? data.custody.map((term) => (
            <Card key={term.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {term.inmate?.avatar_url ? (
                      <img
                        src={term.inmate.avatar_url}
                        alt=""
                        className="h-11 w-11 rounded-full object-cover"
                      />
                    ) : <Users className="h-9 w-9 text-muted-foreground" />}
                    <div>
                      <CardTitle className="text-lg">
                        {term.inmate?.full_name || term.inmate_id}
                      </CardTitle>
                      <CardDescription>
                        {term.facility?.name || 'Unidade pendente'}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant="outline">
                    {CUSTODY_STATUS_LABELS[term.custody_status] || term.custody_status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Liberação prevista: {formatJusticeDate(term.expected_release_at)}
                </span>
                <span className="font-semibold text-red-200">
                  {formatRealDuration(getCountdown(term.expected_release_at, now))}
                </span>
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhuma custódia disponível"
              description="Agentes penitenciários, diretores e juízes acompanham aqui entradas, prazos e ordens de soltura."
            />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action?.type === 'investigate'
                ? 'Abrir investigação'
                : action?.type === 'request-decision'
                  ? action?.approved ? 'Aprovar pedido' : 'Negar pedido'
                  : 'Aceitar para triagem'}
            </DialogTitle>
            <DialogDescription>
              A justificativa será anexada à linha do tempo e ao registro imutável de auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="authority-reason">Fundamentação</Label>
            <Textarea
              id="authority-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={6}
              placeholder="Explique os fatos, a base da ação e o próximo passo esperado."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAction}>Cancelar</Button>
            <Button
              onClick={performAction}
              disabled={acting || reason.trim().length < (action?.type === 'request-decision' ? 20 : 10)}
            >
              {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BriefcaseBusiness className="mr-2 h-4 w-4" />}
              Confirmar ação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AuthorityJusticeDashboard;
