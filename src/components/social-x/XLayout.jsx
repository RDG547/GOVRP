import React from 'react';
import XSidebar from '@/components/social-x/XSidebar';
import TrendsSidebar from '@/components/social-x/TrendsSidebar';
import { useAuth } from '@/contexts/AuthContext';
import XOnboarding from '@/components/social-x/XOnboarding';

const XLayout = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return null; 
  }

  if (!user?.x_handle) {
    return <XOnboarding />;
  }
  
  return (
    <div className="container mx-auto max-w-7xl">
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-10 gap-4">
        <aside className="hidden md:block md:col-span-1 lg:col-span-2 sticky top-20 self-start">
          <XSidebar />
        </aside>

        <main className="md:col-span-3 lg:col-span-5 min-h-screen">
          {children}
        </main>

        <aside className="hidden lg:block lg:col-span-3 sticky top-20 self-start">
          <TrendsSidebar />
        </aside>
      </div>
    </div>
  );
};

export default XLayout;