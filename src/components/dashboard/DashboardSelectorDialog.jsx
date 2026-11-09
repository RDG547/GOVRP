import React from 'react';
import { Crown, FolderKanban, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const DashboardSelectorDialog = ({
  open,
  onOpenChange,
  onSelect,
  hasPresidentAccess = false,
  isAdmin = false,
  realRole = null,
}) => {
  const navigate = useNavigate();

  const selectDashboard = (path) => {
    if (onSelect) {
      onSelect(path);
      return;
    }

    onOpenChange?.(false);
    navigate(path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#07101f]/95 text-white sm:max-w-lg">
        <DialogHeader className="pr-8 text-center sm:text-center">
          <DialogTitle>Qual dashboard você deseja acessar?</DialogTitle>
          <DialogDescription className="text-gray-400">
            Todos os painéis autorizados incluem os módulos integrados de Economia e Justiça.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            type="button"
            onClick={() => selectDashboard('/dashboard/citizen')}
            className="w-full justify-center gap-3 bg-blue-600 hover:bg-blue-700"
          >
            <User className="h-5 w-5" />
            <span>Central do Cidadão</span>
          </Button>
          {realRole&&!['Cidadão','Usuário','Admin','Presidente'].includes(realRole)&&<Button type="button" variant="outline" className="w-full justify-center gap-3" onClick={()=>selectDashboard('/role-dashboard')}><FolderKanban className="h-5 w-5"/>Painel de {realRole}</Button>}
          {hasPresidentAccess && (
            <Button
              type="button"
              onClick={() => selectDashboard('/dashboard/president')}
              variant="secondary"
              className="w-full justify-center gap-3 bg-yellow-500 text-black hover:bg-yellow-600"
            >
              <FolderKanban className="h-5 w-5" />
              <span>Painel Presidencial</span>
            </Button>
          )}
          {isAdmin && <Button type="button" variant="outline" className="w-full justify-center gap-3" onClick={() => selectDashboard('/role-dashboard')}>
            <FolderKanban className="h-5 w-5" />
            <span>Painéis de todos os cargos</span>
          </Button>}
          {isAdmin && (
            <Button
              type="button"
              onClick={() => selectDashboard('/admin-dashboard/systems')}
              variant="secondary"
              className="w-full justify-center gap-3 bg-slate-700 text-white hover:bg-slate-800"
            >
              <Crown className="h-5 w-5" />
              <span>Administração dos Sistemas</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DashboardSelectorDialog;
