import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ErrorPage from '@/pages/ErrorPage';

const AdminProtectedRoute = ({ children }) => {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="w-16 h-16 animate-spin text-blue-400" />
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (user.role !== 'Admin') {
        return <ErrorPage 
            errorCode="403" 
            errorTitle="Acesso Negado" 
            errorMessage="Você não tem permissão para acessar esta página." 
        />;
    }

    return children;
};

export default AdminProtectedRoute;