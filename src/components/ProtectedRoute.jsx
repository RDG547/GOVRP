import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import AuthWall from '@/components/AuthWall';

const ProtectedRoute = ({ children, serviceName }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[80vh]">
        <Loader2 className="w-16 h-16 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!session) {
    return <AuthWall serviceName={serviceName} />;
  }

  return children;
};

export default ProtectedRoute;