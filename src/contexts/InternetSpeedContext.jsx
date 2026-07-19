import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from './AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { Wifi, WifiOff, Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const InternetSpeedContext = createContext();

export const useInternetSpeed = () => useContext(InternetSpeedContext);

// Plan delay ranges in milliseconds
const PLAN_DELAYS = {
  'Básico': { min: 5000, max: 7000 },
  'Ultra':  { min: 3000, max: 5000 },
  'Mega':   { min: 0, max: 0 },
};

const getRandomDelay = (plan) => {
  const config = PLAN_DELAYS[plan] || PLAN_DELAYS['Básico'];
  if (config.min === 0 && config.max === 0) return 0;
  return Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;
};

const LoadingOverlay = ({ plan, delay, onUpgrade }) => {
  const [progress, setProgress] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(delay / 1000));

  useEffect(() => {
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
  const [userPlan, setUserPlan] = useState('Básico'); 
  const [isLoading, setIsLoading] = useState(false);
  const [currentDelay, setCurrentDelay] = useState(0);
  const previousPath = useRef(location.pathname);
  const loadingTimeout = useRef(null);

  // Fetch user's internet plan
  useEffect(() => {
    const fetchPlan = async () => {
      if (!user?.id) {
        setUserPlan('Básico');
        return;
      }
      
      const { data, error } = await supabase
        .from('user_services')
        .select('plan_name')
        .eq('user_id', user.id)
        .eq('service_type', 'Internet')
        .limit(1)
        .maybeSingle();
      
      if (data?.plan_name) {
        setUserPlan(data.plan_name);
      } else {
        setUserPlan('Básico');
      }
    };
    
    fetchPlan();
  }, [user?.id]);

  // Detect navigation and apply delay
  useEffect(() => {
    const currentPath = location.pathname;
    
    // Skip if same path or first load
    if (previousPath.current === currentPath) return;

    if (!user?.id) {
      previousPath.current = currentPath;
      setIsLoading(false);
      if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
      return;
    }
    
    const skipPaths = [
      '/login', '/register', '/auth/callback', '/update-password', '/forgot-password',
      '/community', '/help', '/about', '/donate', '/country-info',
      '/contact', '/support', '/faq', '/docs', '/account-deletion',
      '/admin-dashboard'
    ];
    if (skipPaths.some(p => currentPath.startsWith(p))) {
      previousPath.current = currentPath;
      setIsLoading(false);
      if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
      return;
    }

    // Don't delay within the same section (e.g., within /services/x/*)
    const prevSection = previousPath.current.split('/').slice(0, 3).join('/');
    const currSection = currentPath.split('/').slice(0, 3).join('/');
    if (prevSection === currSection && prevSection === '/services/x') {
      previousPath.current = currentPath;
      return;
    }

    const delay = getRandomDelay(userPlan);
    previousPath.current = currentPath;

    if (delay > 0) {
      setCurrentDelay(delay);
      setIsLoading(true);

      if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
      loadingTimeout.current = setTimeout(() => {
        setIsLoading(false);
      }, delay);
    }
    
    // IMPORTANT: Clear on unmount or re-render
    return () => {
      if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
    };
  }, [location.pathname, user?.id, userPlan]);

  const handleUpgrade = () => {
    setIsLoading(false);
    if (loadingTimeout.current) clearTimeout(loadingTimeout.current);
    navigate('/services/internet');
  };

  return (
    <InternetSpeedContext.Provider value={{ userPlan, isLoading }}>
      {children}
      <AnimatePresence>
        {isLoading && (
          <LoadingOverlay 
            plan={userPlan} 
            delay={currentDelay} 
            onUpgrade={handleUpgrade}
          />
        )}
      </AnimatePresence>
    </InternetSpeedContext.Provider>
  );
};
