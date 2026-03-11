import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import CitizenDashboard from '@/components/dashboard/CitizenDashboard';
import { useNavigate } from 'react-router-dom';
import { Loader2, User, Crown, FolderKanban } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const Dashboard = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="w-16 h-16 animate-spin text-primary" /></div>;
  }

  if (user?.role === 'Admin' || user?.role === 'Presidente') {
    return (
      <AlertDialog open={true}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle>Qual dashboard você deseja acessar?</AlertDialogTitle>
            <AlertDialogDescription>
              Seu cargo permite acesso a múltiplos painéis. Por favor, escolha um.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2">
            <Link to="/dashboard/citizen" className="w-full">
              <Button className="w-full justify-center gap-3 bg-blue-600 hover:bg-blue-700">
                <User className="w-5 h-5" />
                <span>Dashboard do Cidadão</span>
              </Button>
            </Link>
            {(user?.role === 'Presidente' || user?.role === 'Admin') && (
              <Link to="/dashboard/president" className="w-full">
                <Button variant="secondary" className="w-full justify-center gap-3 bg-yellow-500 hover:bg-yellow-600 text-black">
                  <FolderKanban className="w-5 h-5" />
                  <span>Painel Presidencial</span>
                </Button>
              </Link>
            )}
            {user?.role === 'Admin' && (
              <Link to="/admin-dashboard" className="w-full">
                <Button variant="secondary" className="w-full justify-center gap-3 bg-slate-700 hover:bg-slate-800 text-white">
                  <Crown className="w-5 h-5" />
                  <span>Dashboard do Admin</span>
                </Button>
              </Link>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return <CitizenDashboard />;
};

export default Dashboard;