import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import AuthWall from '@/components/AuthWall';

const ServiceProtectedRoute = ({ children }) => {
  const { user, session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[80vh]">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <AuthWall serviceName="este serviço" />;
  }

  if (user && user.role === 'Usuário') {
    return <Navigate to="/beta-access" replace />;
  }

  return children;
};

export default ServiceProtectedRoute;