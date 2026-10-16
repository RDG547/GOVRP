import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, Gift, Flame, X, Loader2, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Link } from 'react-router-dom';

const DailyCheckInPopup = () => {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [featureAvailable, setFeatureAvailable] = useState(true);

  const checkStatus = useCallback(async () => {
    if (!user || dismissed) return;

    try {
      const { data, error } = await supabase.rpc('get_daily_check_in_status');

      if (error) {
        if (error.code === 'PGRST202' || /daily_check_in/i.test(`${error.message || ''} ${error.details || ''}`)) {
          setFeatureAvailable(false);
        }
        return;
      }

      setStatus(data);
      setFeatureAvailable(true);

      if (data && data.can_claim_today && !data.has_checked_in_today && data.has_bank_account) {
        setIsVisible(true);
      }
    } catch {
      // silent
    }
  }, [user, dismissed]);

  useEffect(() => {
    if (!user) return;

    const sessionDismissKey = `checkin_dismissed_${user.id}:${user.citizen_id || 'pending'}`;
    if (sessionStorage.getItem(sessionDismissKey)) {
      setDismissed(true);
      return;
    }

    const timer = setTimeout(() => {
      checkStatus();
    }, 2000);

    return () => clearTimeout(timer);
  }, [user, checkStatus]);

  useEffect(() => {
    if (!user || dismissed || !featureAvailable) return;

    const interval = setInterval(() => {
      checkStatus();
    }, 60000);

    return () => clearInterval(interval);
  }, [user, dismissed, featureAvailable, checkStatus]);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const { data: claimResult, error } = await supabase.rpc('claim_daily_check_in');

      if (error) throw error;

      if (!claimResult?.success) {
        toast({
          title: claimResult?.already_claimed ? 'Check-in já registrado' : 'Não foi possível registrar',
          description: claimResult?.message || 'Tente novamente.',
          variant: claimResult?.already_claimed ? 'default' : 'destructive',
        });
        if (claimResult?.already_claimed) {
          handleDismiss();
        }
        return;
      }

      toast({
        title: '✅ Check-in diário realizado!',
        description: claimResult.message,
      });

      await refreshUser();
      handleDismiss();
    } catch (error) {
      toast({
        title: 'Erro ao registrar check-in',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setClaiming(false);
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setDismissed(true);
    if (user) {
      sessionStorage.setItem(`checkin_dismissed_${user.id}:${user.citizen_id || 'pending'}`, 'true');
    }
  };

  if (!featureAvailable || !user) return null;

  return isVisible ? <DailyCheckInView status={status} claiming={claiming} onClaim={handleClaim} onDismiss={handleDismiss} /> : null;
};

export function DailyCheckInView({ status, claiming = false, onClaim, onDismiss }) {
  return (
    <AnimatePresence>
      {status && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={onDismiss}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 40 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none"
          >
            <div className="relative w-full max-w-sm pointer-events-auto rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-slate-900 via-slate-900 to-emerald-950/50 p-6 shadow-2xl shadow-emerald-500/10">
              <button
                onClick={onDismiss}
                aria-label="Fechar check-in diário"
                className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="text-center space-y-4">
                <div className="relative inline-flex">
                  <motion.div
                    animate={{ rotate: [0, -10, 10, -10, 0] }}
                    transition={{ duration: 0.6, delay: 0.3 }}
                    className="rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 p-4 shadow-lg shadow-emerald-500/30"
                  >
                    <Calendar className="h-8 w-8 text-white" />
                  </motion.div>
                </div>

                <div>
                  <h3 className="text-xl font-bold text-foreground">Check-in Diário</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sua recompensa diária está disponível!
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                    <Flame className="h-5 w-5 text-orange-400 mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Sequência</p>
                    <p className="text-lg font-bold text-foreground">{status.current_streak || 0} dias</p>
                  </div>
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3">
                    <Gift className="h-5 w-5 text-blue-400 mx-auto mb-1" />
                    <p className="text-xs text-muted-foreground">Recompensa</p>
                    <p className="text-lg font-bold text-foreground">{formatCurrency(status.reward_preview_amount || 0)}</p>
                    <p className="text-xs text-muted-foreground">+{status.reputation_reward || 0} rep</p>
                  </div>
                </div>

                {status.weekly_bonus_amount > 0 && (
                  <p className="text-xs text-amber-300 bg-amber-500/10 rounded-lg px-3 py-2 border border-amber-500/20">
                    🎉 Inclui bônus semanal de {formatCurrency(status.weekly_bonus_amount)}!
                  </p>
                )}

                {status.current_streak > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Este será o dia {status.next_streak} da sua sequência.
                  </p>
                )}

                <Button
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white font-semibold py-5"
                  onClick={onClaim}
                  disabled={claiming}
                >
                  {claiming ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registrando...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4" />
                      Fazer Check-in Agora
                    </>
                  )}
                </Button>

                <button
                  onClick={onDismiss}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Lembrar mais tarde
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default DailyCheckInPopup;
