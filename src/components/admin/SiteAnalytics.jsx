import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, MessageSquare, DollarSign, CreditCard, Loader2, Activity, Clock, MousePointerClick } from 'lucide-react';
import StatCard from './StatCard';
import { supabase } from '@/lib/supabaseClient';

const ACTIVITY_ERROR_CODES = new Set(['42P01', '42501', 'PGRST205']);

const formatDuration = (seconds = 0) => {
  const totalSeconds = Number(seconds || 0);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}min ${remainingSeconds}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}min`;
};

const formatDateTime = (value) => {
  if (!value) return 'Sem registro';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const getActivityName = (session) =>
  session.profile?.full_name ||
  session.profile?.username ||
  'Usuario';

const getPageLabel = (view) => view?.page_title || view?.service_key || view?.path || 'Página';

const buildPageRanking = (views = []) => {
  const rankingMap = new Map();

  views.forEach((view) => {
    const key = view.service_key || view.path;
    if (!key) return;

    const current = rankingMap.get(key) || {
      key,
      label: getPageLabel(view),
      path: view.path,
      count: 0,
    };

    current.count += 1;
    rankingMap.set(key, current);
  });

  return [...rankingMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
};

// O componente agora recebe 'growthStats'
const SiteAnalytics = ({ stats, growthStats, loading }) => {
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [recentUserActivity, setRecentUserActivity] = useState([]);
  const [pageRanking, setPageRanking] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const fetchActivityData = async () => {
      setActivityLoading(true);
      setActivityError('');

      try {
        const { data: sessions, error: sessionsError } = await supabase
          .from('user_activity_sessions')
          .select(`
            id,
            user_id,
            started_at,
            ended_at,
            last_seen_at,
            duration_seconds,
            entry_path,
            exit_path,
            profile:profiles!user_activity_sessions_user_id_fkey(full_name, username, avatar_url)
          `)
          .order('started_at', { ascending: false })
          .limit(80);

        if (sessionsError) throw sessionsError;

        const sessionIds = (sessions || []).map((session) => session.id).filter(Boolean);
        const viewsResponse = sessionIds.length
          ? await supabase
              .from('user_page_views')
              .select('session_id, path, page_title, service_key, viewed_at')
              .in('session_id', sessionIds)
              .order('viewed_at', { ascending: false })
              .limit(1000)
          : { data: [], error: null };

        if (viewsResponse.error) throw viewsResponse.error;

        const rankingSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: rankingViews, error: rankingError } = await supabase
          .from('user_page_views')
          .select('path, page_title, service_key, viewed_at')
          .gte('viewed_at', rankingSince)
          .order('viewed_at', { ascending: false })
          .limit(1000);

        if (rankingError) throw rankingError;

        const viewsBySession = (viewsResponse.data || []).reduce((accumulator, view) => {
          if (!accumulator.has(view.session_id)) {
            accumulator.set(view.session_id, []);
          }
          accumulator.get(view.session_id).push(view);
          return accumulator;
        }, new Map());

        const latestByUser = new Map();
        (sessions || []).forEach((session) => {
          if (!latestByUser.has(session.user_id)) {
            latestByUser.set(session.user_id, {
              ...session,
              pages: viewsBySession.get(session.id) || [],
            });
          }
        });

        if (!isMounted) return;

        setRecentUserActivity([...latestByUser.values()].slice(0, 12));
        setPageRanking(buildPageRanking(rankingViews || []));
      } catch (error) {
        if (!isMounted) return;

        if (ACTIVITY_ERROR_CODES.has(error.code) || /user_activity_sessions|user_page_views/i.test(error.message || '')) {
          setActivityError('Aplique o SQL de telemetria no Supabase para liberar atividades e ranking de paginas.');
        } else {
          setActivityError(error.message || 'Não foi possível carregar as atividades.');
        }
      } finally {
        if (isMounted) {
          setActivityLoading(false);
        }
      }
    };

    fetchActivityData();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total de Usuários" value={stats.total_users ?? 0} icon={Users} color="text-blue-400" />
        <StatCard title="Posts Publicados" value={stats.total_posts ?? 0} icon={MessageSquare} color="text-green-400" />
        <StatCard title="Transações" value={stats.total_transactions ?? 0} icon={DollarSign} color="text-yellow-400" />
        <StatCard title="Contas Bancárias" value={stats.total_accounts ?? 0} icon={CreditCard} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Estatísticas Detalhadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Comentários Totais</span>
              <span className="font-bold">{stats.total_comments ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cartões Emitidos</span>
              <span className="font-bold">{stats.total_cards ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taxa de Engajamento</span>
              <span className="text-green-400 font-bold">
                {(stats.total_posts > 0 ? ((stats.total_comments / stats.total_posts) * 100).toFixed(1) : 0)}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Crescimento (Últimas 24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Removemos Math.random() e usamos os dados reais de growthStats */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novos Usuários</span>
              <span className="text-green-400 font-bold">+{growthStats.new_users_last_24h ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novos Posts</span>
              <span className="text-blue-400 font-bold">+{growthStats.new_posts_last_24h ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novas Transações</span>
              <span className="text-yellow-400 font-bold">+{growthStats.new_transactions_last_24h ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Ultimas Atividades dos Usuarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : activityError ? (
              <p className="text-sm text-muted-foreground">{activityError}</p>
            ) : recentUserActivity.length ? (
              <div className="space-y-3">
                {recentUserActivity.map((session) => {
                  const pages = session.pages || [];
                  return (
                    <div key={session.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{getActivityName(session)}</p>
                          <p className="text-xs text-muted-foreground">
                            Login: {formatDateTime(session.started_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          {formatDuration(session.duration_seconds)}
                        </div>
                      </div>
                      <div className="mt-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Páginas no último login</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {pages.length ? pages.slice(0, 6).map((page, index) => (
                            <span key={`${session.id}-${page.path}-${index}`} className="rounded-full border border-white/10 bg-background/60 px-2 py-1 text-xs text-muted-foreground">
                              {getPageLabel(page)}
                            </span>
                          )) : (
                            <span className="text-xs text-muted-foreground">Nenhuma página registrada.</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MousePointerClick className="h-5 w-5" />
              Ranking de Acessos
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : activityError ? (
              <p className="text-sm text-muted-foreground">{activityError}</p>
            ) : pageRanking.length ? (
              <div className="space-y-4">
                {pageRanking.map((item, index) => {
                  const maxCount = pageRanking[0]?.count || 1;
                  const width = `${Math.max(8, (item.count / maxCount) * 100)}%`;

                  return (
                    <div key={item.key} className="space-y-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium truncate">{index + 1}. {item.label}</span>
                        <span className="text-muted-foreground">{item.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10">
                        <div className="h-2 rounded-full bg-primary" style={{ width }} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{item.path}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum acesso registrado nos ultimos 30 dias.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SiteAnalytics;
