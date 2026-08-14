import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Cookie } from 'lucide-react';
import { Link } from 'react-router-dom';
import { COOKIE_CONSENT_EVENT } from '@/components/ConsentAwareAnalytics';

const CookieConsent = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie_consent');
    if (!['essential', 'all'].includes(consent)) {
      setIsVisible(true);
    }
  }, []);

  const savePreference = (preference) => {
    localStorage.setItem('cookie_consent', preference);
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, {
      detail: { preference },
    }));
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="fixed bottom-0 left-0 right-0 z-[200] p-4"
        >
          <div className="max-w-4xl mx-auto glass-effect rounded-xl p-6 shadow-2xl flex flex-col md:flex-row items-center gap-6">
            <Cookie className="w-10 h-10 text-primary flex-shrink-0" />
            <div className="flex-grow text-center md:text-left">
              <h3 className="text-lg font-semibold text-foreground">Privacidade e armazenamento local</h3>
              <p className="text-sm text-muted-foreground">
                O armazenamento essencial mantém login, segurança e preferências. A medição de uso só é ativada com sua autorização. Consulte nossa{' '}
                <Link to="/privacy" className="underline hover:text-primary">
                  Política de Privacidade e Cookies
                </Link>.
              </p>
            </div>
            <div className="flex-shrink-0 flex gap-3">
              <Button variant="outline" onClick={() => savePreference('essential')}>Somente essenciais</Button>
              <Button onClick={() => savePreference('all')}>Aceitar medição</Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CookieConsent;
