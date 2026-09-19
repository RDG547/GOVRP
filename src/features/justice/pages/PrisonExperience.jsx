import { getServiceByKey } from '@/lib/serviceCatalog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Briefcase,
  Building2,
  CheckCircle2,
  Clock3,
  HeartPulse,
  Loader2,
  RefreshCw,
  Scale,
  Shield,
  Sparkles,
  Sun,
  Users,
} from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  completePrisonActivity,
  fetchPrisonExperience,
  startPrisonActivity,
  subscribeToJusticeChanges,
} from '@/lib/justice/api';
import { CUSTODY_STATUS_LABELS, hasAnyJusticeRole } from '@/lib/justice/constants';
import {
  clampProgress,
  formatJusticeDate,
  formatRealDuration,
  getCountdown,
} from '@/lib/justice/time';
import JusticeEmptyState from '@/features/justice/components/JusticeEmptyState';
import JusticeStatCard from '@/features/justice/components/JusticeStatCard';

const activityIcons = {
  work: Briefcase,
  education: BookOpen,
  yard: Sun,
  health: HeartPulse,
  legal: Scale,
  social: Users,
};

const PrisonExperience = () => {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState({
    term: null,
    activities: [],
    runs: [],
    events: [],
    inmates: [],
    serverNow: null,
  });
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const isPrisonStaff = hasAnyJusticeRole(user, [
    'Admin',
    'Agente Penitenciário',
    'Diretor Penitenciário',
  ]);

  const loadData = useCallback(async ({ quiet = false } = {}) => {
    if (!user?.id) return;
    if (!quiet) setLoading(true);
    try {
      const nextData = await fetchPrisonExperience(user.id);
      setData(nextData);
      if (nextData.serverNow) {
        const nextOffset = new Date(nextData.serverNow).getTime() - Date.now();
        setServerOffset(nextOffset);
        setNow(Date.now() + nextOffset);
      }
    } catch (error) {
      toast({
        title: 'Falha ao carregar a área prisional',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast, user?.id]);

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

  const currentRun = useMemo(
    () => data.runs.find((run) => run.status === 'in_progress') || null,
    [data.runs]
  );
  const remaining = data.term ? getCountdown(data.term.expected_release_at, now) : null;
  const elapsed = data.term
    ? now - new Date(data.term.admitted_at).getTime()
    : 0;
  const total = data.term?.original_duration_seconds
    ? Number(data.term.original_duration_seconds) * 1000
    : 1;
  const progress = data.term?.expected_release_at ? clampProgress((elapsed / total) * 100) : 0;

  const handleStart = async (activity) => {
    setActingId(activity.id);
    try {
      await startPrisonActivity(activity.id);
      toast({
        title: `${activity.name} iniciada`,
        description: 'Conclua a atividade quando o tempo terminar para receber a recompensa.',
      });
      await loadData({ quiet: true });
    } catch (error) {
      toast({
        title: 'Não foi possível iniciar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setActingId(null);
    }
  };

  const handleComplete = async (run) => {
    setActingId(run.id);
    try {
      await completePrisonActivity(run.id);
      await Promise.all([loadData({ quiet: true }), refreshUser()]);
      toast({
        title: 'Atividade concluída',
        description: 'Pontos e eventual redução foram calculados automaticamente dentro do limite.',
      });
    } catch (error) {
      toast({
        title: 'Ainda não foi possível concluir',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setActingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!data.term) {
    return (
      <>
        <Helmet><title>Sistema Prisional - GOV.RP</title></Helmet>
        <div className="mx-auto max-w-5xl px-4 py-12">
          <PageHeader
            icon={getServiceByKey('/services/prison').icon}
            title="Sistema"
            gradientText="Prisional"
            description="Custódia, ressocialização e acompanhamento penitenciário do GOVRP."
            iconColor="text-slate-300"
            centered
          />
          <JusticeEmptyState
            title={isPrisonStaff ? 'Nenhum prontuário pessoal ativo' : 'Você não está sob custódia'}
            description={
              isPrisonStaff
                ? 'Use o painel de autoridade para administrar entradas, atividades, visitas e ordens de soltura.'
                : 'Você pode circular normalmente pelo GOVRP. Uma prisão só poderá existir após flagrante ou ordem válida.'
            }
          />
          <div className="mt-6 flex justify-center">
            <Button asChild>
              <Link to={`/services/justice?view=${isPrisonStaff ? 'authority' : 'citizen'}`}>
                {isPrisonStaff ? 'Abrir painel penitenciário' : 'Abrir minha vida jurídica'}
              </Link>
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>Área Prisional - GOV.RP</title>
        <meta
          name="description"
          content="Ambiente jogável de cumprimento de pena do GOVRP."
        />
      </Helmet>

      <div className="min-h-screen bg-gradient-to-b from-slate-950/95 via-slate-950/90 to-background px-4 py-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <Badge className="mb-3 bg-red-500/15 text-red-200">
                  {CUSTODY_STATUS_LABELS[data.term.custody_status]}
                </Badge>
                <h1 className="text-3xl font-bold text-white">Área de custódia do GOVRP</h1>
                <p className="mt-2 text-slate-300">
                  Você continua jogando: participe de atividades, acompanhe seu caso e interaja com sua ala.
                </p>
              </div>
              <div className="rounded-xl border border-red-500/25 bg-slate-950/70 px-6 py-4 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tempo restante</p>
                <p className="mt-2 text-3xl font-bold text-red-200">
                  {data.term.expected_release_at ? formatRealDuration(remaining) : 'Prazo indeterminado'}
                </p>
              </div>
            </div>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <JusticeStatCard
              icon={Building2}
              label="Unidade"
              value={data.term.facility?.name || 'A definir'}
              tone="red"
            />
            <JusticeStatCard
              icon={getServiceByKey('/services/prison').icon}
              label="Cela"
              value={data.term.cell?.code || 'Triagem'}
              tone="amber"
            />
            <JusticeStatCard
              icon={Sparkles}
              label="Comportamento"
              value={data.term.behavior_points}
              tone="green"
            />
            <JusticeStatCard
              icon={Clock3}
              label="Crédito obtido"
              value={formatRealDuration(Number(data.term.sentence_credit_seconds) * 1000)}
              tone="violet"
            />
          </div>

          {currentRun ? (
            <Card className="border-cyan-500/30 bg-cyan-500/5">
              <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Clock3 className="h-5 w-5 text-cyan-300" />
                    {currentRun.activity?.name}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    {currentRun.activity?.description}
                  </CardDescription>
                </div>
                <Button
                  className="mt-4 sm:mt-0"
                  disabled={
                    actingId === currentRun.id
                    || getCountdown(currentRun.completes_at, now) > 0
                  }
                  onClick={() => handleComplete(currentRun)}
                >
                  {actingId === currentRun.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {getCountdown(currentRun.completes_at, now) > 0
                    ? formatRealDuration(getCountdown(currentRun.completes_at, now))
                    : 'Concluir atividade'}
                </Button>
              </CardHeader>
            </Card>
          ) : null}

          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Rotina da unidade</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Atividades possuem duração e intervalo. A redução automática nunca ultrapassa 10% da pena.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => loadData()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.activities.map((activity) => {
                const Icon = activityIcons[activity.activity_type] || Sparkles;
                return (
                  <Card key={activity.id} className="border-slate-800 bg-slate-900/70">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-lg bg-slate-800 p-3 text-cyan-200">
                          <Icon className="h-6 w-6" />
                        </div>
                        <Badge variant="outline">
                          {formatRealDuration(activity.duration_seconds * 1000)}
                        </Badge>
                      </div>
                      <CardTitle className="pt-3 text-white">{activity.name}</CardTitle>
                      <CardDescription>{activity.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {activity.behavior_points > 0 ? (
                          <Badge className="bg-emerald-500/15 text-emerald-200">
                            +{activity.behavior_points} comportamento
                          </Badge>
                        ) : null}
                        {activity.sentence_credit_seconds > 0 ? (
                          <Badge className="bg-violet-500/15 text-violet-200">
                            até {formatRealDuration(activity.sentence_credit_seconds * 1000)} de crédito
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        className="w-full"
                        variant="secondary"
                        disabled={Boolean(currentRun) || actingId === activity.id}
                        onClick={() => handleStart(activity)}
                      >
                        {actingId === activity.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 h-4 w-4" />
                        )}
                        Iniciar
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-slate-800 bg-slate-900/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Users className="h-5 w-5 text-cyan-200" />
                  Pessoas na mesma unidade
                </CardTitle>
                <CardDescription>
                  Perfis ativos na unidade, respeitando a classificação de segurança.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.inmates.map((inmate) => (
                  <div
                    key={inmate.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 p-3"
                  >
                    {inmate.inmate?.avatar_url ? (
                      <img
                        src={inmate.inmate.avatar_url}
                        alt=""
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : <Users className="h-8 w-8 text-slate-500" />}
                    <div>
                      <p className="font-medium text-white">
                        {inmate.inmate?.full_name || 'Detento'}
                      </p>
                      <p className="text-xs text-slate-400">
                        {inmate.cell_id ? 'Cela designada' : 'Em triagem'}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-800 bg-slate-900/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Shield className="h-5 w-5 text-amber-200" />
                  Histórico disciplinar
                </CardTitle>
                <CardDescription>
                  Atividades, comportamento, transferências e decisões permanecem registradas.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.events.length ? data.events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-white">{event.title}</p>
                      <span className="text-xs text-slate-500">
                        {formatJusticeDate(event.created_at)}
                      </span>
                    </div>
                    {event.description ? (
                      <p className="mt-2 text-sm text-slate-400">{event.description}</p>
                    ) : null}
                  </div>
                )) : (
                  <p className="text-sm text-slate-400">Nenhum evento registrado ainda.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-violet-500/25 bg-violet-500/5">
            <CardHeader className="sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Scale className="h-5 w-5 text-violet-200" />
                  Atendimento jurídico e seu processo
                </CardTitle>
                <CardDescription className="mt-2">
                  Consulte decisões, prazos e recursos sem sair da área prisional.
                </CardDescription>
              </div>
              <Button asChild variant="outline" className="mt-4 sm:mt-0">
                <Link to="/services/justice?view=citizen">Abrir vida jurídica</Link>
              </Button>
            </CardHeader>
          </Card>

          <p className="text-center text-xs text-slate-500">
            Entrada: {formatJusticeDate(data.term.admitted_at)} · liberação prevista:{' '}
            {data.term.expected_release_at ? formatJusticeDate(data.term.expected_release_at) : 'mediante decisão da autoridade responsável'}
          </p>
        </div>
      </div>
    </>
  );
};

export default PrisonExperience;
