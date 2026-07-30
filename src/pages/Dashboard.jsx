import React from 'react';
import { Link } from 'react-router-dom';
import { Crown, FolderKanban, Loader2, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import IntegratedCitizenDashboard from '@/components/dashboard/IntegratedCitizenDashboard';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const Dashboard = () => {
  const { user, loading } = useAuth();
  const effectiveRoles = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role].filter(Boolean);
  const hasPresidentAccess = effectiveRoles.includes('Presidente');
  const isAdmin = effectiveRoles.includes('Admin') || user?.role === 'Admin';

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (isAdmin || hasPresidentAccess) {
    return (
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle>Qual dashboard você deseja acessar?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os painéis já incluem os novos módulos de Economia e Justiça.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2">
            <Link to="/dashboard/citizen" className="w-full">
              <Button className="w-full justify-center gap-3 bg-blue-600 hover:bg-blue-700">
                <User className="h-5 w-5" />
                <span>Central do Cidadão</span>
              </Button>
            </Link>
            {(hasPresidentAccess || isAdmin) ? (
              <Link to="/dashboard/president" className="w-full">
                <Button
                  variant="secondary"
                  className="w-full justify-center gap-3 bg-yellow-500 text-black hover:bg-yellow-600"
                >
                  <FolderKanban className="h-5 w-5" />
                  <span>Painel Presidencial Integrado</span>
                </Button>
              </Link>
            ) : null}
            {isAdmin ? (
              <Link to="/admin-dashboard/systems" className="w-full">
                <Button
                  variant="secondary"
                  className="w-full justify-center gap-3 bg-slate-700 text-white hover:bg-slate-800"
                >
                  <Crown className="h-5 w-5" />
                  <span>Administração dos Sistemas</span>
                </Button>
              </Link>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return <IntegratedCitizenDashboard />;
};

export default Dashboard;
