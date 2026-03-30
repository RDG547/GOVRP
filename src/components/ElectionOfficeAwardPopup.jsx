import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Loader2, Scale, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';

const OFFICE_LINKS = {
  Presidente: '/dashboard',
  'Vice-Presidente': '/dashboard',
  Deputado: '/services/parliament',
  Senador: '/services/parliament',
};

const OFFICE_LABELS = {
  Presidente: 'Presidente da República',
  'Vice-Presidente': 'Vice-Presidente da República',
  Deputado: 'Deputado Federal',
  Senador: 'Senador',
};

const resolveOfficeIcon = (officeRole) =>
  officeRole === 'Presidente' || officeRole === 'Vice-Presidente' ? Crown : Scale;

const formatTermLabel = (metadata) => {
  const termStartAt = metadata?.term_start_at;
  const termEndAt = metadata?.term_end_at;

  if (!termStartAt || !termEndAt) {
    return 'O mandato foi registrado automaticamente no sistema.';
  }

  return `${format(new Date(termStartAt), 'dd/MM/yyyy HH:mm', {
    locale: ptBR,
  })} ate ${format(new Date(termEndAt), 'dd/MM/yyyy HH:mm', {
    locale: ptBR,
  })}`;
};

const ElectionOfficeAwardPopup = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notification, setNotification] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchPendingPopup = useCallback(async () => {
    if (!user?.id) {
      setNotification(null);
      return;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, content, link, created_at, type, metadata, is_read')
      .eq('user_id', user.id)
      .eq('type', 'office_awarded')
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      console.error('Error fetching office award notifications:', error);
      return;
    }

    const nextNotification = (data || []).find(
      (entry) => !entry?.metadata?.popup_shown_at
    );

    setNotification(nextNotification || null);
  }, [user?.id]);

  useEffect(() => {
    fetchPendingPopup();
  }, [fetchPendingPopup]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const channel = supabase
      .channel(`office-awards:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.new?.type === 'office_awarded') {
            fetchPendingPopup();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPendingPopup, user?.id]);

  const markNotificationAsShown = useCallback(async (entry) => {
    if (!entry?.id) {
      return;
    }

    const mergedMetadata = {
      ...(entry.metadata || {}),
      popup_pending: false,
      popup_shown_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('notifications')
      .update({
        is_read: true,
        metadata: mergedMetadata,
      })
      .eq('id', entry.id)
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }
  }, [user?.id]);

  const closeCurrentPopup = useCallback(async () => {
    if (!notification) {
      return;
    }

    setSubmitting(true);

    try {
      await markNotificationAsShown(notification);
      setNotification(null);
      await fetchPendingPopup();
    } catch (error) {
      console.error('Error marking office popup as shown:', error);
    } finally {
      setSubmitting(false);
    }
  }, [fetchPendingPopup, markNotificationAsShown, notification]);

  const handleNavigate = useCallback(async () => {
    if (!notification) {
      return;
    }

    const officeRole = notification.metadata?.office_role;
    const destination = notification.link || OFFICE_LINKS[officeRole] || '/dashboard';

    setSubmitting(true);

    try {
      await markNotificationAsShown(notification);
      setNotification(null);
      navigate(destination);
    } catch (error) {
      console.error('Error completing office award popup action:', error);
    } finally {
      setSubmitting(false);
    }
  }, [markNotificationAsShown, navigate, notification]);

  if (!user || !notification) {
    return null;
  }

  const officeRole = notification.metadata?.office_role;
  const officeLabel = notification.metadata?.office_label || OFFICE_LABELS[officeRole] || officeRole;
  const electionName = notification.metadata?.election_name || 'Eleicao encerrada';
  const OfficeIcon = resolveOfficeIcon(officeRole);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm"
        onClick={() => {
          if (!submitting) {
            closeCurrentPopup();
          }
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 24 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
        className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="relative w-full max-w-md pointer-events-auto rounded-3xl border border-amber-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-amber-950/40 p-6 shadow-2xl shadow-amber-500/10">
          <button
            onClick={closeCurrentPopup}
            disabled={submitting}
            className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/25">
              <OfficeIcon className="h-8 w-8 text-white" />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.28em] text-amber-300/90">
                Cargo Oficializado
              </p>
              <h3 className="text-2xl font-bold text-foreground">{officeLabel}</h3>
              <p className="text-sm text-muted-foreground">
                {notification.content}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Eleicao
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">{electionName}</p>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Vigencia
              </p>
              <p className="mt-1 text-sm text-foreground">{formatTermLabel(notification.metadata)}</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={handleNavigate}
                disabled={submitting}
                className="w-full bg-amber-500 text-black hover:bg-amber-400"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Abrindo...
                  </>
                ) : (
                  'Ir para meu painel'
                )}
              </Button>
              <Button
                variant="outline"
                onClick={closeCurrentPopup}
                disabled={submitting}
                className="w-full"
              >
                Ver depois
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default ElectionOfficeAwardPopup;
