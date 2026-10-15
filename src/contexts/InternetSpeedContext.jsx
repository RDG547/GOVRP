import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, Zap, Loader2 } from 'lucide-react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { getInternetDelay, remainingInternetDelay, isInternetDelayExempt } from '@/lib/internetPlans';
import { Button } from '@/components/ui/button';

const InternetSpeedContext = createContext();

export const useInternetSpeed = () => useContext(InternetSpeedContext);

const LoadingOverlay = ({ plan, delay, onUpgrade }) => {
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(delay / 1000));

  useEffect(() => {
    setProgress(0);
    setSecondsLeft(Math.ceil(delay / 1000));
    const interval = setInterval(() => {
      setProgress(prev => {
        const newVal = prev + (100 / (delay / 100));
        return Math.min(newVal, 100);
      });
    }, 100);

    const secondsInterval = setInterval(() => {
      setSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(secondsInterval);
    };
  }, [delay]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-background flex items-center justify-center"
    >
      <div className="text-center max-w-md mx-auto px-6">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="mx-auto mb-6 flex justify-center"
        >
          <Loader2 className="w-16 h-16 text-primary" />
        </motion.div>

        <h2 className="text-2xl font-bold text-foreground mb-4">Carregando a página...</h2>

        <p className="text-muted-foreground mb-6">
          A demora é devido ao seu plano de internet atual (<strong className="text-primary">{plan}</strong>).
        </p>

        {/* Progress bar */}
        <div className="w-full bg-secondary rounded-full h-2 mb-3 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>

        <p className="text-sm text-primary font-medium mb-8">
          {secondsLeft > 0 ? `Aguarde ${secondsLeft} segundos...` : 'Conectando...'}
        </p>

        {plan !== 'Mega' && (
          <div className="p-5 rounded-xl border border-blue-500/30 bg-blue-500/10 mb-4">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Zap className="w-5 h-5 text-blue-400" />
              <p className="font-semibold text-blue-300 text-sm uppercase tracking-wider">Sugestão de Upgrade</p>
            </div>
            <p className="text-sm text-blue-100 mb-4">
              Para navegar sem essa tela de espera e acessar em velocidade máxima, sugerimos que adquira um plano melhor.
              {plan === 'Básico' ? ' O plano Ultra reduz a espera, e o plano Mega elimina totalmente o tempo de carregamento.' : ' Faça upgrade para o plano Mega e navegue na velocidade máxima.'}
            </p>
            <Button
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white shadow-lg shadow-blue-500/25"
              onClick={onUpgrade}
            >
               Adquirir Plano Melhor
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export const InternetSpeedProvider = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Default to Básico so new users get the delay before they buy a plan
  const [serviceState, setServiceState] = useState(null);
  // Missing session and service IDs must not match as undefined === undefined.
  const currentService = serviceState && user?.id && serviceState.userId === user.id ? serviceState.value : null;
  const userPlan = currentService?.is_active ? currentService.plan_name : 'Básico';
  const [isLoading, setIsLoading] = useState(false);
  const [currentDelay, setCurrentDelay] = useState(0);
  const previousPath = useRef(location.pathname);
  const loadingTimeout = useRef(null);
  const waitingStarted = useRef(null);
  const planRequest = useRef(0);

  const fetchPlan = useCallback(async () => {
    const sequence = ++planRequest.current;
    if (!user?.id) { setServiceState(null); return null; }
    const { data, error } = await supabase.from('user_services').select('*')
      .eq('user_id', user.id).eq('service_type', 'Internet').limit(1).maybeSingle();
    if (error) throw error;
    if (sequence === planRequest.current) setServiceState({ userId: user.id, value: data });
    return data;
  }, [user?.id]);
  useEffect(() => { void fetchPlan().catch(error => console.warn('Plano de internet indisponível:', error)); return () => { planRequest.current++; }; }, [fetchPlan]);
  useDomainRealtime('internet', user?.id, [
    { table: 'user_services', filter: `user_id=eq.${user?.id}` },
  ], fetchPlan, Boolean(user?.id));

  useEffect(() => {
    const currentPath = location.pathname;
    const changedPath = previousPath.current !== currentPath;
    if (changedPath) {
      const sameXSection = previousPath.current.startsWith('/services/x') && currentPath.startsWith('/services/x');
      previousPath.current = currentPath;
      waitingStarted.current = sameXSection || isInternetDelayExempt(currentPath, user) || getInternetDelay(userPlan) === 0 ? null : Date.now();
    }
    clearTimeout(loadingTimeout.current);
    const delay = waitingStarted.current === null || isInternetDelayExempt(currentPath, user)
      ? 0 : remainingInternetDelay(userPlan, Date.now() - waitingStarted.current);
    setCurrentDelay(delay);
    setIsLoading(delay > 0);
    if (delay > 0) loadingTimeout.current = setTimeout(() => { waitingStarted.current = null; setIsLoading(false); }, delay);
    else waitingStarted.current = null;
  }, [location.pathname, user?.id, user?.onboarding_completed, userPlan]);
  useEffect(() => () => clearTimeout(loadingTimeout.current), []);

  const handleUpgrade = () => {
    waitingStarted.current = null;
    setIsLoading(false);
    if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
    navigate('/services/internet');
  };

  return (
    <InternetSpeedContext.Provider value={{ userPlan, currentService, isLoading, refreshPlan: fetchPlan }}>
      {children}
      <AnimatePresence>
        {isLoading && (
          <LoadingOverlay
            key={location.pathname}
            plan={userPlan}
            delay={currentDelay}
            onUpgrade={handleUpgrade}
          />
        )}
      </AnimatePresence>
    </InternetSpeedContext.Provider>
  );
};
