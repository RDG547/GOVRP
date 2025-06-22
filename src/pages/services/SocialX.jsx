
import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import XOnboarding from '@/components/social-x/XOnboarding';
import XFeed from '@/components/social-x/XFeed';

const SocialX = () => {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState(sessionStorage.getItem('onboardingDismissed_x') === 'true');

  useEffect(() => {
    if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading]);

  if (loading || authLoading) {
    return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;
  }

  if (!user.x_handle) {
    if (onboardingDismissed) {
        return <Navigate to="/dashboard" replace />;
    }
    return <XOnboarding />;
  }

  return (
    <>
      <Helmet><title>Social X - GOV.RP</title><meta name="description" content="Conecte-se, compartilhe e debata na rede social oficial do GOV.RP." /></Helmet>
      <XFeed />
    </>
  );
};

export default SocialX;
