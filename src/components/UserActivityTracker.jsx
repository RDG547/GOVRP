import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';

const SERVICE_LABELS = {
  '/': 'Inicio',
  '/about': 'Sobre Nos',
  '/admin-dashboard': 'Painel Admin',
  '/community': 'Comunidade',
  '/country-info': 'Sobre o Pais',
  '/dashboard': 'Dashboard',
  '/docs': 'Documentacao',
  '/faq': 'Ajuda',
  '/news': 'Noticias',
  '/services': 'Servicos',
  '/services/agies': 'AGIES',
  '/services/armed-forces': 'Forcas Armadas',
  '/services/bank': 'Banco',
  '/services/business': 'Empresas',
  '/services/dic': 'DIC',
  '/services/digital-archive': 'Arquivo Digital',
  '/services/elections': 'Eleicoes',
  '/services/electricity': 'Energia Eletrica',
  '/services/gas': 'Gas',
  '/services/internet': 'Internet',
  '/services/library': 'Biblioteca',
  '/services/parliament': 'Parlamento',
  '/services/penal-system': 'Sistema Penal',
  '/services/phone': 'Telefonia',
  '/services/police': 'Policia',
  '/services/political-parties': 'Partidos',
  '/services/prison': 'Prisao',
  '/services/rent': 'Aluguel',
  '/services/water': 'Agua',
  '/services/x': 'Social X',
  '/settings': 'Configuracoes',
};

const IGNORED_ERROR_CODES = new Set(['42P01', '42501', 'PGRST205', 'PGRST116']);
let missingActivitySchemaWarned = false;

const getServiceKey = (pathname = '/') => {
  if (pathname === '/') {
    return '/';
  }

  if (pathname.startsWith('/admin-dashboard')) {
    return '/admin-dashboard';
  }

  if (pathname.startsWith('/dashboard')) {
    return '/dashboard';
  }

  if (pathname.startsWith('/services/')) {
    const [, servicesSegment, serviceSegment] = pathname.split('/');
    return `/${servicesSegment}/${serviceSegment}`;
  }

  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return firstSegment ? `/${firstSegment}` : pathname;
};

const getPageTitle = (pathname) => {
  const serviceKey = getServiceKey(pathname);
  const helmetTitle = typeof document !== 'undefined' ? document.title.replace(/\s+-\s+GOV\.RP$/i, '').trim() : '';
  return helmetTitle || SERVICE_LABELS[serviceKey] || pathname;
};

const getDurationSeconds = (startedAt) => {
  if (!startedAt) {
    return 0;
  }

  return Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
};

const shouldDisableTracking = (error) => {
  if (!error) {
    return false;
  }

  if (IGNORED_ERROR_CODES.has(error.code)) {
    return true;
  }

  return /user_activity_sessions|user_page_views|permission denied|does not exist/i.test(error.message || '');
};

const warnOnce = (error) => {
  if (missingActivitySchemaWarned) {
    return;
  }

  missingActivitySchemaWarned = true;
  console.warn('Activity tracking disabled until the Supabase activity SQL is applied.', error);
};

const UserActivityTracker = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [activitySessionId, setActivitySessionId] = useState(null);
  const sessionRef = useRef(null);
  const disabledRef = useRef(false);
  const currentPath = `${location.pathname}${location.search || ''}`;
  const currentPathRef = useRef(currentPath);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    let cancelled = false;

    const startSession = async () => {
      if (!user?.id || disabledRef.current) {
        setActivitySessionId(null);
        return;
      }

      const nowIso = new Date().toISOString();
      const entryPath = currentPathRef.current;
      const { data, error } = await supabase
        .from('user_activity_sessions')
        .insert({
          user_id: user.id,
          started_at: nowIso,
          last_seen_at: nowIso,
          entry_path: entryPath,
          exit_path: entryPath,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        })
        .select('id, started_at')
        .single();

      if (cancelled) {
        return;
      }

      if (error) {
        if (shouldDisableTracking(error)) {
          disabledRef.current = true;
          warnOnce(error);
        } else {
          console.warn('Could not start activity session.', error);
        }
        setActivitySessionId(null);
        return;
      }

      sessionRef.current = {
        id: data.id,
        userId: user.id,
        startedAt: data.started_at || nowIso,
      };
      setActivitySessionId(data.id);
    };

    startSession();

    return () => {
      cancelled = true;
      const currentSession = sessionRef.current;
      sessionRef.current = null;
      setActivitySessionId(null);

      if (!currentSession?.id || disabledRef.current) {
        return;
      }

      const endedAt = new Date().toISOString();
      supabase
        .from('user_activity_sessions')
        .update({
          ended_at: endedAt,
          last_seen_at: endedAt,
          duration_seconds: getDurationSeconds(currentSession.startedAt),
          exit_path: currentPathRef.current,
        })
        .eq('id', currentSession.id)
        .eq('user_id', currentSession.userId)
        .then(({ error }) => {
          if (error && !shouldDisableTracking(error)) {
            console.warn('Could not finish activity session.', error);
          }
        });
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activitySessionId || !user?.id || disabledRef.current) {
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      const session = sessionRef.current;

      if (!session?.id) {
        return;
      }

      const nowIso = new Date().toISOString();
      const pageTitle = getPageTitle(location.pathname);
      const serviceKey = getServiceKey(location.pathname);

      const [{ error: viewError }, { error: sessionError }] = await Promise.all([
        supabase.from('user_page_views').insert({
          session_id: session.id,
          user_id: user.id,
          path: location.pathname,
          page_title: pageTitle,
          service_key: serviceKey,
          viewed_at: nowIso,
        }),
        supabase
          .from('user_activity_sessions')
          .update({
            last_seen_at: nowIso,
            duration_seconds: getDurationSeconds(session.startedAt),
            exit_path: currentPath,
          })
          .eq('id', session.id)
          .eq('user_id', user.id),
      ]);

      const error = viewError || sessionError;
      if (error) {
        if (shouldDisableTracking(error)) {
          disabledRef.current = true;
          warnOnce(error);
        } else {
          console.warn('Could not record page activity.', error);
        }
      }
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [activitySessionId, currentPath, location.pathname, user?.id]);

  useEffect(() => {
    if (!activitySessionId || !user?.id || disabledRef.current) {
      return undefined;
    }

    const heartbeat = async (endedAt = null) => {
      const session = sessionRef.current;

      if (!session?.id) {
        return;
      }

      const nowIso = endedAt || new Date().toISOString();
      const patch = {
        last_seen_at: nowIso,
        duration_seconds: getDurationSeconds(session.startedAt),
        exit_path: currentPathRef.current,
      };

      if (endedAt) {
        patch.ended_at = endedAt;
      }

      const { error } = await supabase
        .from('user_activity_sessions')
        .update(patch)
        .eq('id', session.id)
        .eq('user_id', user.id);

      if (error && !shouldDisableTracking(error)) {
        console.warn('Could not update activity heartbeat.', error);
      }
    };

    const intervalId = window.setInterval(() => {
      heartbeat();
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        heartbeat();
      }
    };

    const handlePageHide = () => {
      heartbeat(new Date().toISOString());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [activitySessionId, user?.id]);

  return null;
};

export default UserActivityTracker;
