import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import ErrorPage from '@/pages/ErrorPage';
import AuthWall from '@/components/AuthWall';

const RoleProtectedRoute = ({ children, roles }) => {
  const { user, session, loading } = useAuth();
  const effectiveRoles = Array.isArray(user?.effective_roles) ? user.effective_roles : [user?.role].filter(Boolean);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[80vh]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <AuthWall serviceName="esta área restrita" />;
  }
  
  if (!user) {
    // If user data is still loading or couldn't be fetched, show loading or an error
    return (
      <div className="flex justify-center items-center min-h-[80vh]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!roles.some((role) => effectiveRoles.includes(role))) {
    return <ErrorPage 
              title="Acesso Negado" 
              message="Você não possui as permissões necessárias para visualizar esta página." 
              showHomeButton={true}
            />;
  }

  return <>{user?.admin_development?.mode==='total'&&<p className="mx-auto max-w-7xl px-4 py-2 text-sm text-amber-400">Normalmente disponível para: {roles.filter(role=>role!=='Admin').join(', ')||'Administração técnica'}.</p>}{children}</>;
};

export default RoleProtectedRoute;
