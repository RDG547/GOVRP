import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Banknote, Briefcase, Clock3, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  getLastPaymentDate,
  getLatestSalaryPayment,
  getSalaryInfoByRole,
  processWeeklySalaries,
  resolveSalaryInfoFromRolePool,
  shouldTriggerWeeklySalaryProcessing,
} from '@/lib/salary';
import { formatCurrency } from '@/lib/utils';

const PROCESS_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const PROCESS_ERROR_COOLDOWN_MS = 30 * 60 * 1000;
const PROCESS_STORAGE_KEY_PREFIX = 'govrp:last-salary-process-check-at';
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
  const [isVisible, setIsVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const errorCooldownUntilRef = useRef(0);

  const rolePool = useMemo(() => {
    if (Array.isArray(user?.effective_roles)) {
      return user.effective_roles;
    }

    if (Array.isArray(user?.role)) {
      return user.role.filter(Boolean);
    }

    return [user?.role].filter(Boolean);
  }, [user?.effective_roles, user?.role]);

  const popupStorageKey = user?.id ? `${POPUP_STORAGE_KEY_PREFIX}:${user.id}` : null;
  const processStorageKey = user?.id ? `${PROCESS_STORAGE_KEY_PREFIX}:${user.id}` : null;
  const currentSalaryInfo = useMemo(
    () => resolveSalaryInfoFromRolePool(rolePool),
    [rolePool]
  );

  const salaryInfo = useMemo(
    () =>
      getSalaryInfoByRole(payment?.role) ||
      currentSalaryInfo,
    [currentSalaryInfo, payment?.role]
  );

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
    (latestPayment) => {
      setPayment(latestPayment || null);

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

  const refreshLatestPayment = useCallback(async () => {
    if (!user?.id) {
      setPayment(null);
      setIsVisible(false);
      return;
    }

    const latestPayment = await getLatestSalaryPayment(user.id);
    syncPopupState(latestPayment);
  }, [syncPopupState, user?.id]);

  const attemptAutomaticSalaryProcessing = useCallback(
    async ({ force = false } = {}) => {
      if (!user?.id || isProcessing || !currentSalaryInfo) {
        return;
      }

      const now = Date.now();
      const lastCheckAt = Number(localStorage.getItem(processStorageKey || '') || 0);

      if (!force && lastCheckAt && now - lastCheckAt < PROCESS_CHECK_INTERVAL_MS) {
        return;
      }

      if (!force && errorCooldownUntilRef.current > now) {
        return;
      }

      if (processStorageKey) {
        localStorage.setItem(processStorageKey, String(now));
      }
      setIsProcessing(true);

      try {
        const lastPaymentDate = await getLastPaymentDate();

        if (!shouldTriggerWeeklySalaryProcessing(lastPaymentDate)) {
          return;
        }

        await processWeeklySalaries();
        await Promise.all([refreshUser(), refreshLatestPayment()]);
      } catch (error) {
        console.error('Erro ao processar salários automaticamente:', error);
        errorCooldownUntilRef.current = Date.now() + PROCESS_ERROR_COOLDOWN_MS;
      } finally {
        setIsProcessing(false);
      }
    },
    [currentSalaryInfo, isProcessing, processStorageKey, refreshLatestPayment, refreshUser, user?.id]
  );

  useEffect(() => {
    if (!user?.id) {
      setPayment(null);
      setIsVisible(false);
      return undefined;
    }

    const initialTimer = window.setTimeout(() => {
      refreshLatestPayment();
      attemptAutomaticSalaryProcessing({ force: true });
    }, 2500);

    return () => {
      window.clearTimeout(initialTimer);
    };
  }, [attemptAutomaticSalaryProcessing, refreshLatestPayment, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshLatestPayment();
      attemptAutomaticSalaryProcessing();
    }, PROCESS_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [attemptAutomaticSalaryProcessing, refreshLatestPayment, user?.id]);

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
          await Promise.all([refreshUser(), refreshLatestPayment()]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshLatestPayment, refreshUser, user?.id]);

  const handleDismiss = useCallback(() => {
    if (payment) {
      markPaymentAsSeen(payment);
    }

    setIsVisible(false);
  }, [markPaymentAsSeen, payment]);

  if (!user || !payment || !isVisible) {
    return null;
  }

  const paymentAmount = resolvePaymentAmount(payment) || salaryInfo?.salary || 0;
  const roleLabel = salaryInfo?.title || salaryInfo?.role || payment?.role || 'Cargo público';
  const paidAtLabel = formatPaidAt(payment.paid_at || payment.created_at);

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
        <div className="relative w-full max-w-md pointer-events-auto rounded-3xl border border-emerald-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/40 p-6 shadow-2xl shadow-emerald-500/10">
          <button
            onClick={handleDismiss}
            className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/25">
              <Banknote className="h-8 w-8 text-white" />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium uppercase tracking-[0.28em] text-emerald-300/90">
                Salário Depositado
              </p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(paymentAmount)}</h3>
              <p className="text-sm text-muted-foreground">
                O pagamento automático do seu cargo já caiu na conta.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <div className="flex items-center gap-3">
                <Briefcase className="h-4 w-4 text-emerald-300" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Cargo</p>
                  <p className="mt-1 text-sm text-foreground">{roleLabel}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Clock3 className="h-4 w-4 text-emerald-300" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Pagamento</p>
                  <p className="mt-1 text-sm text-foreground">{paidAtLabel}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Banknote className="h-4 w-4 text-emerald-300" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Situação</p>
                  <p className="mt-1 text-sm text-foreground">Repasse semanal concluído automaticamente.</p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleDismiss}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:from-emerald-700 hover:to-teal-600"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Atualizando...
                </>
              ) : (
                'Continuar'
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SalaryPaymentPopup;
