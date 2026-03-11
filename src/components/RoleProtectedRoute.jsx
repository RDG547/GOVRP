import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import ErrorPage from '@/pages/ErrorPage';
import AuthWall from '@/components/AuthWall';

const RoleProtectedRoute = ({ children, roles }) => {
  const { user, session, loading } = useAuth();

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

  if (!roles.includes(user.role)) {
    return <ErrorPage 
              title="Acesso Negado" 
              message="Você não possui as permissões necessárias para visualizar esta página." 
              showHomeButton={true}
            />;
  }

  return children;
};

export default RoleProtectedRoute;