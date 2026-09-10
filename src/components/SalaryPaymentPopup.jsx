import { canonicalRole } from '@/lib/roleIcons';
import { useOfficialSalaries, currentSalary } from '@/hooks/use-official-salaries';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Banknote, Briefcase, Clock3, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  getLatestSalaryPayment,
} from '@/lib/salary';
import { formatCurrency } from '@/lib/utils';

const POPUP_STORAGE_KEY_PREFIX = 'govrp:salary-popup-seen';

const resolvePaymentAmount = (payment = {}) => {
  const amountFields = ['amount', 'salary_amount', 'paid_amount', 'value', 'net_amount', 'gross_amount'];

  for (const fieldName of amountFields) {
    const numericValue = Number(payment?.[fieldName]);

    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }
  }

  return 0;
};

const resolvePaymentKey = (payment = {}) =>
  payment?.id || payment?.paid_at || payment?.created_at || null;

const formatPaidAt = (dateValue) => {
  if (!dateValue) {
    return 'Horário não informado';
  }

  const formattedDate = new Date(dateValue);

  if (Number.isNaN(formattedDate.getTime())) {
    return 'Horário não informado';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(formattedDate);
};

const SalaryPaymentPopup = () => {
  const { user, refreshUser } = useAuth();
  const [payment, setPayment] = useState(null);
  const [failureNotification, setFailureNotification] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  const { roles } = useOfficialSalaries();
  const popupStorageKey = user?.id ? `${POPUP_STORAGE_KEY_PREFIX}:${user.id}:${user.citizen_id || 'pending'}` : null;
  const role = canonicalRole(payment?.role || failureNotification?.metadata?.role || user?.role);
  const configured = roles.find(item => item.role === role);
  const salaryInfo = { role, title: payment?.title || payment?.salary_snapshot?.title || configured?.title || role, salary: configured ? currentSalary(configured) : 0 };

  const markPaymentAsSeen = useCallback(
    (entry) => {
      const paymentKey = resolvePaymentKey(entry);

      if (!popupStorageKey || !paymentKey) {
        return;
      }

      localStorage.setItem(popupStorageKey, String(paymentKey));
    },
    [popupStorageKey]
  );

  const syncPopupState = useCallback(
    (latestPayment, latestFailureNotification = null) => {
      setPayment(latestPayment || null);
      setFailureNotification(latestFailureNotification || null);

      if (latestFailureNotification?.id) {
        setIsVisible(true);
        return;
      }

      if (!latestPayment || !popupStorageKey) {
        setIsVisible(false);
        return;
      }

      const paymentKey = resolvePaymentKey(latestPayment);
      const seenPaymentKey = localStorage.getItem(popupStorageKey);

      setIsVisible(Boolean(paymentKey) && seenPaymentKey !== String(paymentKey));
    },
    [popupStorageKey]
  );

  const fetchPendingFailureNotification = useCallback(async () => {
    if (!user?.id) {
      return null;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, content, created_at, type, metadata, is_read')
      .eq('user_id', user.id)
      .eq('type', 'salary_payment_failed')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Erro ao buscar notificacoes de falha salarial:', error);
      return null;
    }

    return (data || []).find((entry) => !entry?.metadata?.popup_shown_at) || null;
  }, [user?.id]);

  const refreshLatestStatus = useCallback(async () => {
    if (!user?.id) {
      setPayment(null);
      setFailureNotification(null);
      setIsVisible(false);
      return;
    }

    const [latestPayment, latestFailureNotification] = await Promise.all([
      getLatestSalaryPayment(user.id),
      fetchPendingFailureNotification(),
    ]);

    syncPopupState(latestPayment, latestFailureNotification);
  }, [fetchPendingFailureNotification, syncPopupState, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setPayment(null);
      setIsVisible(false);
      return undefined;
    }

    const initialTimer = window.setTimeout(() => {
      refreshLatestStatus();
    }, 2500);

    return () => {
      window.clearTimeout(initialTimer);
    };
  }, [refreshLatestStatus, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const channel = supabase
      .channel(`salary-payments:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'salary_payments',
          filter: `user_id=eq.${user.id}`,
        },
        async () => {
          await Promise.all([refreshUser(), refreshLatestStatus()]);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          if (payload.new?.type === 'salary_payment_failed') {
            await refreshLatestStatus();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshLatestStatus, refreshUser, user?.id]);

  const handleDismiss = useCallback(() => {
    if (failureNotification?.id) {
      const nextMetadata = {
        ...(failureNotification.metadata || {}),
        popup_pending: false,
        popup_shown_at: new Date().toISOString(),
      };

      supabase
        .from('notifications')
        .update({
          is_read: true,
          metadata: nextMetadata,
        })
        .eq('id', failureNotification.id)
        .eq('user_id', user.id)
        .then(({ error }) => {
          if (error) {
            console.error('Erro ao marcar aviso de salario como exibido:', error);
          }
        });
    } else if (payment) {
      markPaymentAsSeen(payment);
    }

    setIsVisible(false);
  }, [failureNotification, markPaymentAsSeen, payment, user?.id]);

  if (!user || !isVisible || (!payment && !failureNotification)) {
    return null;
  }

  const popupMode = failureNotification ? 'failure' : 'success';
  const paymentAmount =
    popupMode === 'failure'
      ? Number(failureNotification?.metadata?.expected_amount || salaryInfo?.salary || 0)
      : resolvePaymentAmount(payment);
  const roleLabel =
    salaryInfo?.title ||
    salaryInfo?.role ||
    failureNotification?.metadata?.role ||
    payment?.role ||
    'Cargo público';
  const paidAtLabel = formatPaidAt(
    popupMode === 'failure'
      ? failureNotification?.created_at
      : payment?.paid_at || payment?.created_at
  );
  const popupTitle = popupMode === 'failure' ? 'Salário não processado' : 'Salário depositado';
  const popupDescription =
    popupMode === 'failure'
      ? failureNotification?.content || 'Não foi possível pagar o seu salário semanal por falta de verba.'
      : 'O pagamento automático do seu cargo já caiu na conta.';
  const popupStatusText =
    popupMode === 'failure'
      ? 'Não foi possível concluir o repasse semanal por falta de verba no governo.'
      : 'Repasse semanal concluído automaticamente.';
  const Icon = popupMode === 'failure' ? AlertTriangle : Banknote;
  const accentClassName =
    popupMode === 'failure'
      ? 'from-red-500 to-amber-500 shadow-red-500/25'
      : 'from-emerald-500 to-teal-500 shadow-emerald-500/25';
  const containerClassName =
    popupMode === 'failure'
      ? 'border-red-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-red-950/40 shadow-red-500/10'
      : 'border-emerald-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/40 shadow-emerald-500/10';
  const iconAccentClassName = popupMode === 'failure' ? 'text-amber-300' : 'text-emerald-300';
  const headlineAccentClassName = popupMode === 'failure' ? 'text-red-300/90' : 'text-emerald-300/90';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[72] bg-black/65 backdrop-blur-sm"
        onClick={handleDismiss}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 28 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 28 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="fixed inset-0 z-[73] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className={`relative w-full max-w-md pointer-events-auto rounded-3xl border p-6 shadow-2xl ${containerClassName}`}>
          <button
            onClick={handleDismiss}
            className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-5 text-center">
            <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-lg ${accentClassName}`}>
              <Icon className="h-8 w-8 text-white" />
            </div>

            <div className="space-y-2">
              <p className={`text-sm font-medium uppercase tracking-[0.28em] ${headlineAccentClassName}`}>
                {popupTitle}
              </p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(paymentAmount)}</h3>
              <p className="text-sm text-muted-foreground">
                {popupDescription}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <div className="flex items-center gap-3">
                <Briefcase className={`h-4 w-4 ${iconAccentClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cargo</p>
                  <p className="mt-1 text-sm text-foreground">{roleLabel}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Clock3 className={`h-4 w-4 ${iconAccentClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {popupMode === 'failure' ? 'Registro' : 'Pagamento'}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{paidAtLabel}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Icon className={`h-4 w-4 ${iconAccentClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Situação</p>
                  <p className="mt-1 text-sm text-foreground">{popupStatusText}</p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleDismiss}
              className={`w-full text-white ${
                popupMode === 'failure'
                  ? 'bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-700 hover:to-amber-600'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600'
              }`}
            >
              Continuar
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SalaryPaymentPopup;
