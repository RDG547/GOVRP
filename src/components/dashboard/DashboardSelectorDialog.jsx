import React from 'react';
import { Crown, FolderKanban, User } from 'lucide-react';
import { Link } from 'react-router-dom';
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
  hasPresidentAccess = false,
  isAdmin = false,
}) => {
  const close = () => onOpenChange?.(false);

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
          <Button asChild className="w-full justify-center gap-3 bg-blue-600 hover:bg-blue-700">
            <Link to="/dashboard/citizen" onClick={close}>
              <User className="h-5 w-5" />
              <span>Central do Cidadão</span>
            </Link>
          </Button>
          {(hasPresidentAccess || isAdmin) && (
            <Button
              asChild
              variant="secondary"
              className="w-full justify-center gap-3 bg-yellow-500 text-black hover:bg-yellow-600"
            >
              <Link to="/dashboard/president" onClick={close}>
                <FolderKanban className="h-5 w-5" />
                <span>Painel Presidencial Integrado</span>
              </Link>
            </Button>
          )}
          {isAdmin && (
            <Button
              asChild
              variant="secondary"
              className="w-full justify-center gap-3 bg-slate-700 text-white hover:bg-slate-800"
            >
              <Link to="/admin-dashboard/systems" onClick={close}>
                <Crown className="h-5 w-5" />
                <span>Administração dos Sistemas</span>
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DashboardSelectorDialog;
