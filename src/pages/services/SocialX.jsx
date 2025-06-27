import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import XOnboarding from '@/components/social-x/XOnboarding';
import XSidebar from '@/components/social-x/XSidebar';
import TrendsSidebar from '@/components/social-x/TrendsSidebar';

const SocialX = () => {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading) {
      setLoading(false);
    }
  }, [authLoading]);

  const handlePostClick = () => {
    navigate('/services/x');
    setTimeout(() => {
      const textarea = document.getElementById('main-post-textarea');
      if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };
  
  if (loading || authLoading) {
    return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.x_handle) {
    return <XOnboarding />;
  }

  return (
    <>
      <Helmet><title>Social X - GOV.RP</title><meta name="description" content="Conecte-se, compartilhe e debata na rede social oficial do GOV.RP." /></Helmet>
      <div className="w-full max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-10 lg:grid-cols-12 gap-0 md:gap-4">
            <div className="col-span-2 lg:col-span-3">
                <XSidebar onPostClick={handlePostClick} />
            </div>
            <main className="col-span-8 lg:col-span-6 border-x border-slate-700/50 min-h-screen">
                <Outlet />
            </main>
            <aside className="hidden lg:block lg:col-span-3">
                <div className="sticky top-0 py-2 h-screen overflow-y-auto custom-scrollbar">
                   <TrendsSidebar />
                </div>
            </aside>
        </div>
      </div>
    </>
  );
};

export default SocialX;