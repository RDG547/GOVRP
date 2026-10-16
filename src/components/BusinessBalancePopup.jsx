import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, Clock3, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  BUSINESS_BALANCE_NOTIFICATION_TYPE,
} from '@/lib/businessBalances';
import { formatCurrency } from '@/lib/utils';

const formatProcessedAt = (dateValue) => {
  if (!dateValue) {
    return 'Horário não informado';
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return 'Horário não informado';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
};

const BusinessBalancePopup = () => {
  const { user, refreshUser } = useAuth();
  const [notification, setNotification] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  const fetchPendingBalanceNotification = useCallback(async () => {
    if (!user?.id) {
      return null;
    }

    const { data, error } = await supabase
      .from('notifications')
      .select('id, content, created_at, metadata, is_read, type')
      .eq('user_id', user.id)
      .eq('type', BUSINESS_BALANCE_NOTIFICATION_TYPE)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Erro ao buscar notificacoes de balanco empresarial:', error);
      return null;
    }

    return (data || []).find((entry) => !entry?.metadata?.popup_shown_at) || null;
  }, [user?.id]);

  const refreshLatestStatus = useCallback(async () => {
    const latestNotification = await fetchPendingBalanceNotification();
    setNotification(latestNotification);
    setIsVisible(Boolean(latestNotification?.id));
  }, [fetchPendingBalanceNotification]);

  useEffect(() => {
    if (!user?.id) {
      setNotification(null);
      setIsVisible(false);
      return undefined;
    }

    const initialTimer = window.setTimeout(() => {
      refreshLatestStatus();
    }, 3200);

    return () => {
      window.clearTimeout(initialTimer);
    };
  }, [refreshLatestStatus, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    const channel = supabase
      .channel(`business-balance:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          if (payload.new?.type === BUSINESS_BALANCE_NOTIFICATION_TYPE) {
            await refreshLatestStatus();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshLatestStatus, user?.id]);

  const handleDismiss = useCallback(async () => {
    if (notification?.id && user?.id) {
      const nextMetadata = {
        ...(notification.metadata || {}),
        popup_pending: false,
        popup_shown_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          metadata: nextMetadata,
        })
        .eq('id', notification.id)
        .eq('user_id', user.id);

      if (error) {
        console.error('Erro ao marcar balanco empresarial como exibido:', error);
      }
    }

    setIsVisible(false);
  }, [notification, user?.id]);

  if (!user || !isVisible || !notification) {
    return null;
  }

  return <BusinessBalanceView notification={notification} onDismiss={handleDismiss} />;
};

export function BusinessBalanceView({ notification, onDismiss }) {
  const metadata = notification.metadata || {};
  const netResult = Number(metadata.net_result || 0);
  const isProfit = netResult >= 0;
  const Icon = isProfit ? TrendingUp : TrendingDown;
  const accentClassName = isProfit
    ? 'from-emerald-500 to-cyan-500 shadow-emerald-500/25'
    : 'from-red-500 to-amber-500 shadow-red-500/25';
  const containerClassName = isProfit
    ? 'border-emerald-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/40 shadow-emerald-500/10'
    : 'border-red-500/20 bg-gradient-to-b from-slate-900 via-slate-900 to-red-950/40 shadow-red-500/10';
  const headlineClassName = isProfit ? 'text-emerald-300/90' : 'text-red-300/90';
  const detailIconClassName = isProfit ? 'text-emerald-300' : 'text-amber-300';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[74] bg-black/65 backdrop-blur-sm"
        onClick={onDismiss}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 28 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 28 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="fixed inset-0 z-[75] flex items-center justify-center p-4 pointer-events-none"
      >
        <div className={`relative w-full max-w-md pointer-events-auto rounded-3xl border p-6 shadow-2xl ${containerClassName}`}>
          <button
            onClick={onDismiss}
            aria-label="Fechar balanço empresarial"
            className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-5 text-center">
            <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br shadow-lg ${accentClassName}`}>
              <Icon className="h-8 w-8 text-white" />
            </div>

            <div className="space-y-2">
              <p className={`text-sm font-medium uppercase tracking-[0.28em] ${headlineClassName}`}>
                {isProfit ? 'Lucro empresarial' : 'Prejuízo empresarial'}
              </p>
              <h3 className="text-2xl font-bold text-foreground">{formatCurrency(Math.abs(netResult))}</h3>
              <p className="text-sm text-muted-foreground">
                {notification.content || 'O balanço anual da sua empresa foi processado automaticamente.'}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
              <div className="flex items-center gap-3">
                <Building2 className={`h-4 w-4 ${detailIconClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Empresa</p>
                  <p className="mt-1 text-sm text-foreground">{metadata.business_name || 'Empresa'}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Wallet className={`h-4 w-4 ${detailIconClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Resultado</p>
                  <p className="mt-1 text-sm text-foreground">
                    Receita {formatCurrency(metadata.gross_revenue || 0)} - custos {formatCurrency(metadata.operating_cost || 0)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Clock3 className={`h-4 w-4 ${detailIconClassName}`} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Processamento</p>
                  <p className="mt-1 text-sm text-foreground">{formatProcessedAt(notification.created_at)}</p>
                </div>
              </div>
            </div>

            <Button
              onClick={onDismiss}
              className={`w-full text-white ${
                isProfit
                  ? 'bg-gradient-to-r from-emerald-600 to-cyan-500 hover:from-emerald-700 hover:to-cyan-600'
                  : 'bg-gradient-to-r from-red-600 to-amber-500 hover:from-red-700 hover:to-amber-600'
              }`}
            >
              Continuar
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default BusinessBalancePopup;
