import OccurrenceDetails from '@/features/justice/components/OccurrenceDetails';
import JudicialOrders from '@/components/justice/JudicialOrders';
import IssueFineDialog from '@/components/justice/IssueFineDialog';
import LawSanctionDialog from '@/components/justice/LawSanctionDialog';
import {CurrencyInput} from '@/components/ui/currency-input';
import { Archive, FileWarning } from 'lucide-react';
import CaseEvidence from '@/features/justice/components/CaseEvidence';
import { fromBrasiliaInput } from '@/lib/dateTime';
import CitizenSelector from '@/components/CitizenSelector';
import { justiceDeadline, justiceRequest } from '@/lib/justice/constants';
import { justiceStatus } from '@/lib/justice/constants';
import { executeArrestWarrant, archiveReferredInvestigation } from '@/lib/justice/api';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  BadgeCheck,
  Banknote,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Gavel,
  Loader2,
  LockKeyhole,
  Scale,
  Search,
  Siren,
  Shield,
  Users,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  addInvestigationSubject,
  completeCaseHearing,
  decideCaseAppeal,
  decideChargeAdmission,
  decideJudicialRequest,
  decideCitizenJusticeRequest,
  decideFineAppeal,
  decideFineHearing,
  fetchAuthorityJusticeData,
  sealInvestigationEvidence,
  fileCriminalCharges,
  issueCaseAcquittal,
  issueCriminalSentence,
  issueJusticeFine,
  revokeJudicialWarrant,
  openInvestigation,
  recordInvestigationEvidence,
  releasePrisonTerm,
  requestInvestigationComplement,
  resolveInvestigation,
  scheduleCaseHearing,
  subscribeToJusticeChanges,
  transitionIntegrityCase,
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
import CaseTimeline from '@/features/justice/components/CaseTimeline';
import UserSelectOption from '@/components/UserSelectOption';

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
    fines: [],
    fineAppeals: [],
    fineHearings: [],
    citizenRequests: [],
    integrityCases: [],
    serverNow: null,
    investigationSubjects: [],
    evidence: [], profiles: [], timeline: [], caseDocuments: [], caseHearings: [], caseAppeals: [], sentences: [], investigationParties: [], caseParties: [], penalCodes: [], caseCharges: [],
  });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [subjectForm, setSubjectForm] = useState(null);

  const role = primaryJusticeRole(user);
  const isPolice = hasAnyJusticeRole(user, ['Admin', 'Policial', 'Police', 'Diretor-Geral de Polícia']);
  const isDelegate = hasAnyJusticeRole(user, ['Admin', 'Diretor-Geral de Polícia']);
  const isAdmin = hasAnyJusticeRole(user, ['Admin']);
  const canDecideCase = criminalCase => isAdmin || (isJudge && criminalCase.judge_id === user?.id);
  const isJudge = hasAnyJusticeRole(user, ['Admin', 'Juiz Federal']);
  const isProsecutor = hasAnyJusticeRole(user, ['Admin', 'Promotor']);
  const isLawyer = hasAnyJusticeRole(user, ['Admin', 'Advogado', 'Defensor Público']);
  const isPrisonStaff = hasAnyJusticeRole(user, ['Admin', 'Agente Penitenciário', 'Diretor Penitenciário']);
  const hasJudicialAccess = isJudge || isProsecutor || isLawyer || isPrisonStaff;
  const [panelMode, setPanelMode] = useState(isPolice ? 'police' : 'judicial');
  const activePanelMode = panelMode === 'police' && !isPolice ? 'judicial'
    : panelMode === 'judicial' && !hasJudicialAccess ? 'police'
      : panelMode;
  const visibleTabs = activePanelMode === 'police'
    ? [
      ['missions', Siren, 'Boletins de Ocorrências'],
      ['investigations', Search, 'Investigações'],
      ['requests', Gavel, 'Pedidos da investigação'],
      ['warrants', ClipboardList, 'Mandados'],
      ['integrity', BadgeCheck, 'Integridade'],
    ]
    : [
      ...(isProsecutor ? [['investigations', Search, 'Remessas ao MP']] : []),
      ['requests', Gavel, 'Pedidos judiciais'],
      ['cases', Scale, 'Processos'],
      ['warrants', ClipboardList, 'Mandados'],
      ['custody', LockKeyhole, 'Custódia'],
      ['sanctions', Banknote, 'Multas'],
      ['citizen', Users, 'Pedidos cidadãos'],
      ['integrity', BadgeCheck, 'Integridade'],
    ];

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const nextData = await fetchAuthorityJusticeData();
      setData(previous => ({ ...nextData, ...Object.fromEntries((nextData.errors || []).map(section => [section, previous[section]])) }));
      if (nextData.serverNow) setServerOffset(new Date(nextData.serverNow).getTime() - Date.now());
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
    const interval = window.setInterval(() => setNow(Date.now() + serverOffset), 1000);
    return () => window.clearInterval(interval);
  }, [serverOffset]);

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
    setScheduledAt('');
  };

  const updateAction = (values) => setAction((current) => ({ ...current, ...values }));

  const performAction = async () => {
    if (!action || acting) return;
    if (reason.trim().length < actionReasonMinimum) {
      toast({ title: 'Fundamentação incompleta', description: `Informe pelo menos ${actionReasonMinimum} caracteres.`, variant: 'destructive' });
      return;
    }
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
      } else if (action.type === 'revoke-warrant') {
        await revokeJudicialWarrant({ warrantId: action.item.id, reason });
      } else if (action.type === 'issue-fine') {
        await issueJusticeFine({ userId: action.userId, reason, amount: action.amount, dueDate: fromBrasiliaInput(scheduledAt) });
      } else if (action.type === 'fine-appeal') {
        await decideFineAppeal({ appealId: action.item.id, approved: action.approved, reason });
      } else if (action.type === 'fine-hearing') {
        await decideFineHearing({
          hearingId: action.item.id,
          status: action.status,
          scheduledAt: scheduledAt ? fromBrasiliaInput(scheduledAt) : null,
          notes: reason,
        });
      } else if (action.type === 'citizen-request') {
        await decideCitizenJusticeRequest({ requestId: action.item.id, status: action.status, notes: reason });
      } else if (action.type === 'integrity') {
        await transitionIntegrityCase({ caseId: action.item.id, status: action.status, summary: reason });
      } else if (action.type === 'seal-evidence') {
        await sealInvestigationEvidence({ evidenceId: action.item.id, justification: reason });
      } else if (action.type === 'evidence') {
        await recordInvestigationEvidence({ investigationId: action.item.id, title: action.title, description: reason, seal: action.seal });
      } else if (action.type === 'execute-warrant') {
        await executeArrestWarrant({ warrantId: action.item.id, location: action.location, description: reason });
      } else if (action.type === 'archive-referred') {
        await archiveReferredInvestigation({ investigationId: action.item.id, reason });
      } else if (action.type === 'resolve-investigation') {
        await resolveInvestigation({ investigationId: action.item.id, outcome: action.outcome, conclusion: reason });
      } else if (action.type === 'complement-investigation') {
        await requestInvestigationComplement({ investigationId: action.item.id, reason });
      } else if (action.type === 'file-charge') {
        await fileCriminalCharges({
          investigationId: action.item.id,
          defendantId: action.defendantId,
          penalCodeId: action.penalCodeId,
          title: action.title,
          facts: reason,
        });
      } else if (action.type === 'admission') {
        await decideChargeAdmission({ caseId: action.item.id, admitted: action.admitted, reason });
      } else if (action.type === 'schedule-case-hearing') {
        await scheduleCaseHearing({ caseId: action.item.id, scheduledAt: fromBrasiliaInput(scheduledAt), location: action.location });
      } else if (action.type === 'complete-case-hearing') {
        await completeCaseHearing({ hearingId: action.hearing.id, minutes: reason });
      } else if (action.type === 'acquit') {
        await issueCaseAcquittal({ caseId: action.item.id, reason });
      } else if (action.type === 'convict') {
        await issueCriminalSentence({
          caseId: action.item.id,
          defendantId: action.defendantId,
          reason,
          sentenceUnits: action.sentenceUnits,
          fineAmount: action.fineAmount,
          prisonRegime: action.prisonRegime,
          specialJustification: action.specialJustification || '',
        });
      } else if (action.type === 'appeal-decision') {
        await decideCaseAppeal({ appealId: action.appeal.id, outcome: action.outcome, decision: reason });
      } else if (action.type === 'release') {
        await releasePrisonTerm({ prisonTermId: action.item.id, reason });
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

  const persistSubject = async () => {
    setActing(true);
    try {
      await addInvestigationSubject({
        investigationId: subjectForm.investigationId,
        profileId: subjectForm.profileId,
        subjectStatus: subjectForm.subjectStatus,
        notifySubject: subjectForm.notifySubject,
        notes: subjectForm.notes,
      });
      setSubjectForm(null);
      toast({ title: 'Pessoa vinculada à investigação', description: 'O sigilo e a eventual notificação foram registrados no backend.' });
      await loadData({ quiet: true });
    } catch (error) {
      toast({ title: 'Não foi possível vincular a pessoa', description: error.message, variant: 'destructive' });
    } finally { setActing(false); }
  };

  const actionReasonMinimum = action?.type === 'acquit' || action?.type === 'convict' ? 80
    : action?.type === 'appeal-decision' ? 60
      : ['admission', 'resolve-investigation', 'archive-referred', 'file-charge', 'complete-case-hearing'].includes(action?.type) ? 40
        : ['investigate', 'complement-investigation', 'execute-warrant', 'request-decision', 'release', 'revoke-warrant'].includes(action?.type) ? 20
          : 10;

  const actionTitle = {
    investigate: 'Abrir investigação',
    'revoke-warrant': 'Revogar mandado',
    'execute-warrant': 'Cumprir mandado de prisão',
    'archive-referred': 'Arquivar investigação no Ministério Público',
    'issue-fine': 'Emitir multa',
    'request-decision': action?.approved ? 'Aprovar pedido' : 'Negar pedido',
    'fine-hearing': action?.status === 'scheduled' ? 'Agendar audiência' : 'Negar audiência',
    'fine-appeal': action?.approved ? 'Deferir recurso' : 'Indeferir recurso',
    'citizen-request': 'Decidir pedido do cidadão',
    integrity: 'Movimentar caso de integridade',
    evidence: 'Registrar prova na investigação',
    'seal-evidence': 'Lacrar prova registrada',
    'resolve-investigation': action?.outcome === 'indict' ? 'Indiciar e remeter ao MP' : 'Arquivar sem indiciamento',
    'complement-investigation': 'Solicitar novas diligências',
    'file-charge': 'Oferecer denúncia criminal',
    admission: action?.admitted ? 'Receber denúncia' : 'Rejeitar denúncia',
    'schedule-case-hearing': 'Agendar audiência de instrução',
    'complete-case-hearing': 'Concluir audiência',
    acquit: 'Proferir sentença absolutória',
    convict: 'Proferir sentença condenatória',
    'appeal-decision': action?.outcome === 'granted' ? 'Dar provimento ao recurso' : 'Manter decisão recorrida',
    release: 'Registrar ordem de soltura',
    triage: 'Aceitar para triagem',
  }[action?.type] || 'Registrar ação';

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
        <CardHeader>
          <div>
            <Badge className="mb-3 bg-cyan-500/15 text-cyan-200">{role}</Badge>
            <CardTitle>{activePanelMode === 'police' ? 'Central operacional da Polícia' : 'Central operacional do Judiciário'}</CardTitle>
            <CardDescription className="mt-2">
              {activePanelMode === 'police'
                ? 'Ocorrências, investigações, diligências e prevenção reunidas conforme as competências policiais.'
                : 'Pedidos, processos, custódia e decisões reunidos conforme as competências judiciais.'}
            </CardDescription>
            {isPolice && hasJudicialAccess ? (
              <div className="mt-4 inline-flex rounded-lg border border-white/10 bg-slate-950/40 p-1" aria-label="Área de atuação">
                <Button type="button" size="sm" variant={activePanelMode === 'police' ? 'default' : 'ghost'} onClick={() => setPanelMode('police')}><Siren className="mr-2 h-4 w-4" />Polícia</Button>
                <Button type="button" size="sm" variant={activePanelMode === 'judicial' ? 'default' : 'ghost'} onClick={() => setPanelMode('judicial')}><Scale className="mr-2 h-4 w-4" />Judiciário</Button>
              </div>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {activePanelMode === 'police' ? (
          <>
            <JusticeStatCard icon={Siren} label="Ocorrências novas" value={queues.newOccurrences.length} tone="red" />
            <JusticeStatCard icon={Search} label="Investigações" value={queues.activeInvestigations.length} />
            <JusticeStatCard icon={ClipboardList} label="Mandados disponíveis" value={data.warrants.length} tone="amber" />
          </>
        ) : (
          <>
            <JusticeStatCard icon={Gavel} label="Pedidos urgentes" value={queues.urgentRequests.length} tone="amber" />
            <JusticeStatCard icon={Scale} label="Fila judicial" value={queues.waitingSentence.length} tone="violet" />
            <JusticeStatCard icon={LockKeyhole} label="Presos provisórios" value={queues.provisionalCustody.length} tone="red" />
          </>
        )}
      </div>

      {data.errors?.length ? <div role="alert" className="rounded-lg border border-amber-500/40 p-3 text-sm">Algumas informações não puderam ser atualizadas. <Button variant="link" onClick={() => loadData({ quiet: true })}>Tentar novamente</Button></div> : null}
      <Tabs key={activePanelMode} defaultValue={visibleTabs[0]?.[0]} className="space-y-6">
        <TabsList className="flex h-auto w-full justify-start gap-2 overflow-x-auto bg-muted/50 p-2">
          {visibleTabs.map(([value, Icon, label]) => (
            <TabsTrigger key={value} value={value} className="shrink-0">
              <Icon className="mr-2 h-4 w-4" aria-hidden="true" />{label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="missions" className="space-y-4">
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Polícia.</p>}
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
                    Prioridade {PRIORITY_LABELS[occurrence.priority] || occurrence.priority}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {occurrence.description || occurrence.details}
                </p>
                <OccurrenceDetails occurrence={occurrence} showReporter/>
                <div className="flex flex-wrap gap-2">

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
              title="Nenhum boletim novo"
              description="Quando um cidadão registrar uma ocorrência, ela aparecerá aqui em tempo real."
            />
          )}
        </TabsContent>

        <TabsContent value="investigations" className="space-y-4">
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Polícia e Diretoria-Geral.</p>}
          {data.investigations.length ? data.investigations.map((investigation) => (
            <Card key={investigation.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{investigation.investigation_number}</CardTitle>
                    <CardDescription className="mt-1">{investigation.summary}</CardDescription>
                  </div>
                  <Badge variant="outline">{justiceStatus(investigation.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
                <p><span className="text-muted-foreground">Aberta em:</span><br />{formatJusticeDate(investigation.opened_at)}</p>
                <p><span className="text-muted-foreground">Policial responsável:</span><br />{investigation.lead_officer_id ? 'Designado' : 'Não designado'}</p>
                <p><span className="text-muted-foreground">Diretor-Geral de Polícia:</span><br />{investigation.delegate_id ? 'Designado' : 'Aguardando'}</p>
                <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <details className="w-full rounded-lg border p-3"><summary className="cursor-pointer font-medium">Pessoas vinculadas ({data.investigationSubjects.filter(subject => subject.investigation_id === investigation.id).length})</summary><div className="mt-3 space-y-2">{data.investigationSubjects.filter(subject => subject.investigation_id === investigation.id).map(subject => <div key={subject.id} className="rounded border p-2"><UserSelectOption user={data.profiles.find(profile => profile.id === subject.profile_id) || subject.profile} detail={justiceStatus(subject.subject_status)}/>{subject.notes && <p className="mt-2 text-xs text-muted-foreground">{subject.notes}</p>}</div>)}</div></details>
                  <CaseEvidence evidence={data.evidence.filter(evidence => evidence.investigation_id === investigation.id)} onSeal={isDelegate ? item => setAction({type:'seal-evidence',item}) : undefined} />
                  <div className="flex flex-wrap gap-2">
                    {isPolice && ['open', 'in_progress', 'delegate_review', 'complement_requested'].includes(investigation.status) ? <Button size="sm" variant="outline" onClick={() => setAction({ type: 'evidence', item: investigation, title: '', seal: isDelegate })}>Registrar prova</Button> : null}
                    {isProsecutor && investigation.status === 'sent_to_prosecutor' && <Button size="sm" variant="outline" onClick={() => setAction({ type: 'archive-referred', item: investigation })}><Archive className="mr-2 h-4 w-4 text-slate-400"/>Arquivar no Ministério Público</Button>}
                    {isPolice ? <Button size="sm" variant="outline" onClick={() => setSubjectForm({ investigationId: investigation.id, investigationNumber: investigation.investigation_number, profileId: '', subjectStatus: 'under_review', notifySubject: false, notes: '' })}><Users className="mr-2 h-4 w-4" />Vincular pessoa</Button> : null}
                    {isDelegate && ['open', 'in_progress', 'delegate_review', 'complement_requested'].includes(investigation.status) ? <><Button size="sm" onClick={() => setAction({ type: 'resolve-investigation', item: investigation, outcome: 'indict' })}>Indiciar e remeter</Button><Button size="sm" variant="destructive" onClick={() => setAction({ type: 'resolve-investigation', item: investigation, outcome: 'no_indictment' })}>Arquivar sem indiciar</Button></> : null}
                    {isProsecutor && investigation.status === 'sent_to_prosecutor' ? <><Button size="sm" variant="outline" onClick={() => setAction({ type: 'complement-investigation', item: investigation })}><Search className="mr-2 h-4 w-4 text-cyan-400"/>Pedir diligências</Button><Button size="sm" onClick={() => setAction({ type: 'file-charge', item: investigation, title: '', defendantId: '', penalCodeId: '' })}><FileWarning className="mr-2 h-4 w-4 text-amber-300"/>Oferecer denúncia</Button></> : null}
                  </div>
                </div>
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
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Ministério Público e Justiça.</p>}
          {data.requests.length ? data.requests.map((request) => (
            <Card
              key={request.id}
              className={request.status === 'pending' ? 'border-amber-500/30 bg-amber-500/5' : 'glass-effect'}
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">
                      {justiceRequest(request.request_type)}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Pedido em {formatJusticeDate(request.created_at)}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{justiceStatus(request.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">{request.justification}</p>
                {isJudge && request.status === 'pending' && request.requested_by !== user.id && request.target_profile_id !== user.id ? (
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
                      {['arrest_warrant', 'search_warrant'].includes(request.request_type) ? 'Aprovar e emitir mandado' : 'Aprovar'}
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

        <TabsContent value="warrants" className="space-y-4">
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Polícia e Justiça.</p>}
          {data.warrants.length ? data.warrants.map((warrant) => {
            const target = data.profiles.find((profile) => profile.id === warrant.target_profile_id);
            const typeLabel = {
              arrest: 'Mandado de prisão',
              search: 'Mandado de busca',
              seizure: 'Mandado de apreensão',
              transfer: 'Mandado de transferência',
            }[warrant.warrant_type] || 'Mandado judicial';
            return (
              <Card key={warrant.id} className="glass-effect">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{typeLabel}</CardTitle>
                      <CardDescription className="mt-1">{warrant.warrant_number} · emitido em {formatJusticeDate(warrant.issued_at)}</CardDescription>
                    </div>
                    <Badge variant="outline">{justiceStatus(warrant.status)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><span className="text-muted-foreground">Pessoa relacionada</span><div className="mt-2"><UserSelectOption user={target} label={target?.full_name || 'Identidade protegida'} detail={target?.username ? `@${target.username}` : ''} /></div></div>
                  <p><span className="text-muted-foreground">Validade</span><br />{formatJusticeDate(warrant.expires_at)}</p>
                  {warrant.revocation_reason && <p className="sm:col-span-2">Motivo da revogação: {warrant.revocation_reason}</p>}
                  {isPolice && warrant.warrant_type === 'arrest' && warrant.status === 'issued' && new Date(warrant.expires_at).getTime() > now && warrant.target_profile_id !== user.id && <Button size="sm" className="w-fit" onClick={() => setAction({ type: 'execute-warrant', item: warrant, location: '' })}>Cumprir mandado de prisão</Button>}
                  {isJudge && warrant.status === 'issued' && new Date(warrant.expires_at).getTime() > now && warrant.target_profile_id !== user.id && (isAdmin || warrant.issued_by === user.id || data.cases.some(item => item.id === warrant.case_id && item.judge_id === user.id)) && <Button variant="outline" size="sm" className="w-fit" onClick={() => setAction({ type: 'revoke-warrant', item: warrant })}><XCircle className="mr-2 h-4 w-4" />Revogar mandado</Button>}
                </CardContent>
              </Card>
            );
          }) : <JusticeEmptyState title="Nenhum mandado disponível" description="Mandados compatíveis com sua competência aparecerão aqui." />}
        </TabsContent>

        <TabsContent value="cases" className="space-y-4">
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Promotores, Advogados e Juízes.</p>}
          {(isJudge || isProsecutor || isLawyer) && data.cases.length ? data.cases.map((criminalCase) => (
            <Card key={criminalCase.id} className="glass-effect">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{criminalCase.title}</CardTitle>
                    <CardDescription className="mt-1">
                      {criminalCase.case_number} · {criminalCase.court_name||'Supremo Tribunal Federal'}{criminalCase.court_level===2?' · Revisão interna':''}
                    </CardDescription>
                  </div>
                  <Badge variant="outline">
                    {justiceStatus(criminalCase.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm md:grid-cols-3">
                <div className="rounded-lg border border-border/70 p-3">
                  <BadgeCheck className="mb-2 h-5 w-5 text-violet-300" />
                  <p className="text-muted-foreground">Promotor</p>
                  <p>{data.profiles.find(profile => profile.id === criminalCase.prosecutor_id)?.full_name || (criminalCase.prosecutor_id ? 'Designado' : 'Pendente')}</p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <Gavel className="mb-2 h-5 w-5 text-amber-300" />
                  <p className="text-muted-foreground">Juiz Federal</p>
                  <p>{data.profiles.find(profile => profile.id === criminalCase.judge_id)?.full_name || (criminalCase.judge_id ? 'Distribuído a outro juiz' : 'Pendente de distribuição')}</p>
                </div>
                <div className="rounded-lg border border-border/70 p-3">
                  <CalendarClock className="mb-2 h-5 w-5 text-cyan-300" />
                  <p className="text-muted-foreground">Última atualização</p>
                  <p>{formatJusticeDate(criminalCase.updated_at)}</p>
                </div>
                <div className="space-y-4 md:col-span-3">
                  <CaseEvidence evidence={data.evidence.filter(evidence => evidence.criminal_case_id === criminalCase.id || (criminalCase.investigation_id && evidence.investigation_id === criminalCase.investigation_id))} onSeal={isJudge || isProsecutor ? item => setAction({type:'seal-evidence',item}) : undefined} />
                  <CaseTimeline status={criminalCase.status} events={data.timeline.filter((event) => event.case_id === criminalCase.id || (criminalCase.investigation_id && event.investigation_id === criminalCase.investigation_id))} />
                  <div className="flex flex-wrap gap-2">
                    {canDecideCase(criminalCase) && criminalCase.status === 'judicial_review' ? <><Button size="sm" onClick={() => setAction({ type: 'admission', item: criminalCase, admitted: true })}>Receber denúncia</Button><Button size="sm" variant="destructive" onClick={() => setAction({ type: 'admission', item: criminalCase, admitted: false })}>Rejeitar denúncia</Button></> : null}
                    {canDecideCase(criminalCase) && ['initial_defense', 'instruction'].includes(criminalCase.status) ? <Button size="sm" onClick={() => setAction({ type: 'schedule-case-hearing', item: criminalCase, location: '' })}>Agendar audiência</Button> : null}
                    {canDecideCase(criminalCase) && criminalCase.status === 'hearing_scheduled' ? <Button size="sm" onClick={() => setAction({ type: 'complete-case-hearing', item: criminalCase, hearing: data.caseHearings.find((hearing) => hearing.case_id === criminalCase.id && ['scheduled', 'open'].includes(hearing.status)) })} disabled={!data.caseHearings.some((hearing) => hearing.case_id === criminalCase.id && ['scheduled', 'open'].includes(hearing.status))}>Concluir audiência</Button> : null}
                    {canDecideCase(criminalCase) && criminalCase.status === 'awaiting_sentence' ? <><Button size="sm" variant="outline" onClick={() => setAction({ type: 'acquit', item: criminalCase })}>Absolver</Button><Button size="sm" onClick={() => setAction({ type: 'convict', item: criminalCase, defendantId: data.caseParties.find((party) => party.case_id === criminalCase.id && party.party_type === 'defendant')?.profile_id || '', sentenceUnits: 1, fineAmount: (data.caseCharges || []).filter(charge => charge.case_id === criminalCase.id && charge.status === 'admitted').reduce((total, charge) => total + Number(charge.legal_snapshot?.fine || 0), 0), prisonRegime: 'closed' })}>Condenar</Button></> : null}
                    {isJudge && data.caseAppeals.filter(appeal => appeal.case_id === criminalCase.id && ['filed', 'under_review'].includes(appeal.status) && (isAdmin || appeal.reviewing_judge_id === user.id)).map(appeal => <section key={appeal.id} className="w-full space-y-3 rounded-lg border p-3"><h4 className="font-semibold">{appeal.appeal_type === 'legal_sanction' ? 'Recurso de sanção legal' : 'Recurso do processo'}</h4><p className="whitespace-pre-wrap break-words text-sm">{appeal.arguments}</p><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setAction({type:'appeal-decision',item:criminalCase,appeal,outcome:'denied'})}>Manter decisão</Button><Button size="sm" variant="outline" onClick={() => setAction({type:'appeal-decision',item:criminalCase,appeal,outcome:'granted'})}>Dar provimento</Button></div></section>)}
                  </div>
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
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Sistema prisional e Justiça.</p>}
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
                    {justiceStatus(term.custody_status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Liberação prevista: {formatJusticeDate(term.expected_release_at)}
                </span>
                <div className="flex items-center gap-3"><span className="font-semibold text-red-200">
                  {formatRealDuration(getCountdown(term.expected_release_at, now))}
                </span>{hasAnyJusticeRole(user, ['Admin', 'Juiz Federal', 'Diretor Penitenciário']) ? <Button size="sm" variant="outline" onClick={() => setAction({ type: 'release', item: term })}>Registrar soltura</Button> : null}</div>
              </CardContent>
            </Card>
          )) : (
            <JusticeEmptyState
              title="Nenhuma custódia disponível"
              description="Agentes penitenciários, diretores e juízes acompanham aqui entradas, prazos e ordens de soltura."
            />
          )}
        </TabsContent>

        <TabsContent value="sanctions" className="space-y-4">{isJudge&&<JudicialOrders/>}
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Polícia e Justiça.</p>}
          {(isJudge || isPolice) && <div className="flex flex-wrap gap-2"><IssueFineDialog onFineIssued={()=>loadData({quiet:true})}/>{isJudge&&<LawSanctionDialog cases={data.cases} onApplied={()=>loadData({quiet:true})}/>}</div>}
          {(isJudge || isPolice) && (data.fineAppeals.length || data.fineHearings.length) ? (
            <>
              {data.fineAppeals.map((appeal) => {
                const fine = data.fines.find((item) => item.id === appeal.fine_id);
                return <Card key={appeal.id} className="glass-effect"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-lg"><Banknote className="h-5 w-5 text-amber-300" />Recurso {fine?.fine_code || appeal.fine_id}</CardTitle><CardDescription>{fine?.legal_snapshot?.target_snapshot?.name || fine?.legal_snapshot?.target_snapshot?.full_name || fine?.citizen?.full_name || ({business:'Empresa',party:'Partido'})[fine?.target_type] || 'Cidadão'} · {formatJusticeDate(appeal.created_at)}</CardDescription></div><Badge variant="outline">{justiceStatus(appeal.status)}</Badge></div></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{appeal.reason}</p>{['pending', 'under_review'].includes(appeal.status) ? <div className="flex gap-2"><Button size="sm" onClick={() => setAction({ type: 'fine-appeal', item: appeal, approved: true })}>Deferir</Button><Button size="sm" variant="destructive" onClick={() => setAction({ type: 'fine-appeal', item: appeal, approved: false })}>Indeferir</Button></div> : null}</CardContent></Card>;
              })}
              {data.fineHearings.map((hearing) => {
                const fine = data.fines.find((item) => item.id === hearing.fine_id);
                return <Card key={hearing.id} className="glass-effect"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">Audiência · {fine?.fine_code || hearing.fine_id}</CardTitle><CardDescription>{hearing.reason}</CardDescription></div><Badge variant="outline">{justiceStatus(hearing.status)}</Badge></div></CardHeader>{hearing.status === 'requested' ? <CardContent className="flex gap-2"><Button size="sm" onClick={() => setAction({ type: 'fine-hearing', item: hearing, status: 'scheduled' })}>Agendar</Button><Button size="sm" variant="destructive" onClick={() => setAction({ type: 'fine-hearing', item: hearing, status: 'denied' })}>Negar</Button></CardContent> : null}</Card>;
              })}
            </>
          ) : <JusticeEmptyState title="Nenhum recurso ou audiência pendente" description="As solicitações aparecerão aqui sem necessidade de atualizar a página." />}
        </TabsContent>

        <TabsContent value="citizen" className="space-y-4">
          {data.citizenRequests.length ? data.citizenRequests.map((request) => <Card key={request.id} className="glass-effect"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-lg">{request.subject}</CardTitle><CardDescription>{request.protocol_number} · {request.requester?.full_name || 'Cidadão'}</CardDescription></div><Badge variant="outline">{justiceStatus(request.status)}</Badge></div></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{request.description}</p>{!['approved', 'denied', 'completed', 'cancelled'].includes(request.status) ? <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setAction({ type: 'citizen-request', item: request, status: 'under_review' })}>Assumir análise</Button><Button size="sm" onClick={() => setAction({ type: 'citizen-request', item: request, status: 'approved' })}>Aprovar</Button><Button size="sm" variant="destructive" onClick={() => setAction({ type: 'citizen-request', item: request, status: 'denied' })}>Negar</Button></div> : null}</CardContent></Card>) : <JusticeEmptyState title="Nenhum pedido administrativo" description="Pedidos de investigação e liberação de bens aparecerão nesta fila." />}
        </TabsContent>



        <TabsContent value="integrity" className="space-y-4">
          {user?.admin_development?.mode==='total'&&<p className="text-xs text-amber-400">Normalmente disponível para: Autoridades de controle institucional.</p>}
          {data.integrityCases.length ? data.integrityCases.map((item) => <Card key={item.id} className="glass-effect"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{item.title}</CardTitle><CardDescription>{item.case_number} · fluxo sem presunção automática de culpa</CardDescription></div><Badge variant="outline">{justiceStatus(item.status)}</Badge></div></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">{item.summary}</p>{item.status === 'suspicion' ? <div className="flex gap-2"><Button size="sm" onClick={() => setAction({ type: 'integrity', item, status: 'police_investigation' })}>Abrir investigação</Button><Button size="sm" variant="outline" onClick={() => setAction({ type: 'integrity', item, status: 'archived' })}>Arquivar</Button></div> : null}</CardContent></Card>) : <JusticeEmptyState title="Nenhum caso de integridade" description="Suspeitas, investigações, processos e decisões finais ficam historicamente separados." />}
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(action)} onOpenChange={(open) => !open && !acting && closeAction()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionTitle}</DialogTitle>
            <DialogDescription>
              A justificativa será anexada à linha do tempo e ao registro imutável de auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {action?.type === 'execute-warrant' && <div><Label htmlFor="arrest-location">Local do cumprimento</Label><Input id="arrest-location" value={action.location} onChange={event => updateAction({ location: event.target.value })} /></div>}
            {action?.type === 'evidence' ? <><Label htmlFor="evidence-title">Identificação da prova</Label><Input id="evidence-title" value={action.title} onChange={(event) => updateAction({ title: event.target.value })} placeholder="Ex.: Laudo pericial nº 14" /><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={Boolean(action.seal)} disabled={!isDelegate} onChange={(event) => updateAction({ seal: event.target.checked })} />Lacrar prova ao registrar</label></> : null}
            {action?.type === 'file-charge' ? <><Label htmlFor="charge-title">Título da ação penal</Label><Input id="charge-title" value={action.title} onChange={(event) => updateAction({ title: event.target.value })} /><Label>Acusado</Label><Select value={action.defendantId} onValueChange={(value) => updateAction({ defendantId: value })}><SelectTrigger><SelectValue placeholder="Selecione o investigado" /></SelectTrigger><SelectContent>{data.investigationParties.filter((party) => party.investigation_id === action.item.id && party.party_type === 'suspect').map((party) => { const profile = data.profiles.find((item) => item.id === party.profile_id); return <SelectItem key={party.id} value={party.profile_id}><UserSelectOption user={profile || { id: party.profile_id, full_name: party.profile_id }} /></SelectItem>; })}</SelectContent></Select><Label>Tipo penal</Label><Select value={action.penalCodeId} onValueChange={(value) => updateAction({ penalCodeId: value })}><SelectTrigger><SelectValue placeholder="Selecione o enquadramento" /></SelectTrigger><SelectContent>{data.penalCodes.map((code) => <SelectItem key={code.id} value={code.id}>{code.code} — {code.name}</SelectItem>)}</SelectContent></Select></> : null}
            {action?.type === 'schedule-case-hearing' ? <><Label htmlFor="case-hearing-date">Data e hora (Brasília)</Label><Input id="case-hearing-date" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /><Label htmlFor="case-hearing-location">Local ou sala virtual</Label><Input id="case-hearing-location" value={action.location} onChange={(event) => updateAction({ location: event.target.value })} /></> : null}
            {action?.type === 'convict' ? <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="sentence-units">Pena (anos RP)</Label><Input id="sentence-units" type="number" min="0.1" step="0.1" value={action.sentenceUnits} onChange={(event) => updateAction({ sentenceUnits: event.target.value })} /></div><div><Label htmlFor="sentence-fine">Multa</Label><CurrencyInput decimal id="sentence-fine" min="0" step="0.01" value={action.fineAmount} onChange={(event) => updateAction({ fineAmount: event.target.value })} /></div><div className="col-span-2"><Label>Regime</Label><Select value={action.prisonRegime} onValueChange={(value) => updateAction({ prisonRegime: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Aberto</SelectItem><SelectItem value="semi_open">Semiaberto</SelectItem><SelectItem value="closed">Fechado</SelectItem><SelectItem value="maximum_security">Segurança máxima</SelectItem></SelectContent></Select></div></div> : null}
            {action?.type === 'fine-hearing' && action.status === 'scheduled' ? <><Label htmlFor="hearing-date">Data e hora (Brasília)</Label><Input id="hearing-date" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></> : null}
            {action?.type === 'issue-fine' && <><Label>Cidadão</Label><CitizenSelector value={action.userId} onChange={value => updateAction({userId:value})}/><Label htmlFor="fine-amount">Valor da multa (R$)</Label><CurrencyInput decimal id="fine-amount" min="0.01" step="0.01" value={action.amount} onChange={event => updateAction({ amount: event.target.value })} /><Label htmlFor="fine-due-date">Vencimento (Brasília)</Label><Input id="fine-due-date" type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} /></>}
            {action?.type === 'convict' && <div className="space-y-2"><Label htmlFor="sentence-special-justification">Justificativa especial para pena fora dos limites legais</Label><Textarea id="sentence-special-justification" value={action.specialJustification || ''} onChange={event => updateAction({ specialJustification: event.target.value })} minLength={40} rows={4} aria-describedby="sentence-special-help"/><p id="sentence-special-help" className="text-xs text-muted-foreground">Obrigatória quando a pena ultrapassa os limites da norma aplicável ao caso. Mínimo de 40 caracteres; não substitui a fundamentação da sentença. {(action.specialJustification || '').trim().length} / 40</p></div>}
            <Label htmlFor="authority-reason">Fundamentação (mínimo de {actionReasonMinimum} caracteres)</Label>
            <Textarea
              id="authority-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={6}
              minLength={actionReasonMinimum}
              aria-describedby="authority-reason-help"
              placeholder="Explique os fatos, a base da ação e o próximo passo esperado."
            />
            <p id="authority-reason-help" className="text-xs text-muted-foreground">{reason.trim().length} / {actionReasonMinimum} caracteres mínimos</p>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={acting} onClick={closeAction}><X className="mr-2 h-4 w-4" />Cancelar</Button>
            <Button
              onClick={performAction}
              disabled={acting
                || reason.trim().length < actionReasonMinimum
                || (action?.type === 'schedule-case-hearing' && !scheduledAt)
                || (action?.type === 'fine-hearing' && action.status === 'scheduled' && !scheduledAt)
                || (action?.type === 'evidence' && action.title?.trim().length < 5)
                || (action?.type === 'file-charge' && (!action.defendantId || !action.penalCodeId || action.title?.trim().length < 5))
                || (action?.type === 'convict' && (!action.defendantId || (action.specialJustification?.trim().length > 0 && action.specialJustification.trim().length < 40)))
                || (action?.type === 'issue-fine' && (!action.userId || !Number.isFinite(Number(action.amount)) || Number(action.amount) <= 0 || !scheduledAt || new Date(fromBrasiliaInput(scheduledAt)).getTime() <= now))}
            >
              {acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Briefcase className="mr-2 h-4 w-4" />}
              Confirmar ação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      <Dialog open={Boolean(subjectForm)} onOpenChange={(open) => !open && !acting && setSubjectForm(null)}>
        <DialogContent><DialogHeader><DialogTitle>Vincular pessoa à investigação</DialogTitle><DialogDescription>{subjectForm?.investigationNumber}. Investigações sigilosas não aparecem para o investigado até uma notificação formal.</DialogDescription></DialogHeader>{subjectForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Pessoa</Label><CitizenSelector value={subjectForm.profileId} onChange={value => setSubjectForm(current => ({...current,profileId:value}))}/></div><div className="space-y-2"><Label>Situação</Label><Select value={subjectForm.subjectStatus} onValueChange={(value) => setSubjectForm((current) => ({ ...current, subjectStatus: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="under_review">Em verificação preliminar</SelectItem><SelectItem value="investigated">Investigado</SelectItem><SelectItem value="cleared">Inocentado/retirado</SelectItem><SelectItem value="indicted">Indiciado</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Fundamentação interna</Label><Textarea value={subjectForm.notes} onChange={(event) => setSubjectForm((current) => ({ ...current, notes: event.target.value }))} /></div><label className="flex items-start gap-3 rounded-lg border border-white/10 p-3"><input type="checkbox" className="mt-1" checked={subjectForm.notifySubject} onChange={(event) => setSubjectForm((current) => ({ ...current, notifySubject: event.target.checked }))} /><span><span className="block font-medium">Notificar formalmente o cidadão</span><span className="text-xs text-muted-foreground">Ao marcar, a investigação deixa de ficar oculta para esta pessoa.</span></span></label></div> : null}<DialogFooter><Button variant="outline" onClick={() => setSubjectForm(null)}>Cancelar</Button><Button onClick={persistSubject} disabled={acting || !subjectForm?.profileId}>{acting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Vincular</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  );
};

export default AuthorityJusticeDashboard;
