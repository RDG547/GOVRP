import React, { useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import XOnboarding from '@/components/social-x/XOnboarding';
import XSidebar from '@/components/social-x/XSidebar';
import TrendsSidebar from '@/components/social-x/TrendsSidebar';
import XHeader from '@/components/social-x/XHeader';

const SocialX = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const postInputRef = useRef(null);

  const handlePostClick = () => {
    navigate('/services/x/feed');
    setTimeout(() => {
      postInputRef.current?.focus();
    }, 100);
  };
  
  if (authLoading) {
    return <div className="flex justify-center items-center min-h-[calc(100vh-5rem)]"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
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
      <div className="w-full max-w-screen-2xl mx-auto md:px-4">
        <div className="flex md:gap-4">
            <header className="fixed bottom-0 left-0 right-0 z-40 md:sticky md:top-0 md:w-20 xl:w-72 flex-shrink-0 md:h-screen">
              <XSidebar onPostClick={handlePostClick} />
            </header>
            <main className="flex-1 border-x border-border min-h-screen mb-16 md:mb-0">
                <div className="md:hidden sticky top-20 z-30">
                    <XHeader />
                </div>
                <Outlet context={{ postInputRef }} />
            </main>
            <aside className="hidden lg:block w-96 flex-shrink-0">
                <div className="sticky top-0 py-2 h-screen overflow-y-auto custom-scrollbar px-4">
                   <TrendsSidebar />
                </div>
            </aside>
        </div>
      </div>
    </>
  );
};

export default SocialX;