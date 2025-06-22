
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Landmark, MessageCircle, Building, FileText, LogIn, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

const ServiceProtectedRoute = ({ children, service }) => {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [userDismissed, setUserDismissed] = useState(false);

  const serviceConfig = {
    bank: {
      icon: Landmark,
      name: 'Banco Nacional',
      description: 'Acesse sua conta bancária, faça transferências e gerencie seus cartões.',
      checkField: 'account',
      onboardingComponent: null
    },
    x: {
      icon: MessageCircle,
      name: 'Social X',
      description: 'Conecte-se com outros cidadãos e compartilhe suas ideias.',
      checkField: 'x_handle',
      onboardingComponent: null
    },
    business: {
      icon: Building,
      name: 'Negócios Livres',
      description: 'Marketplace para comprar e vender produtos e serviços.',
      checkField: 'account',
      onboardingComponent: null
    },
    dic: {
      icon: FileText,
      name: 'DIC - Documentos',
      description: 'Gerencie seus documentos oficiais de forma digital.',
      checkField: 'account',
      onboardingComponent: null
    }
  };

  const config = serviceConfig[service];

  useEffect(() => {
    if (!loading && !user && !userDismissed) {
      setShowAuthDialog(true);
    }
  }, [loading, user, userDismissed]);

  const handleDialogClose = () => {
    setShowAuthDialog(false);
    setUserDismissed(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center glass-effect rounded-2xl p-12">
            {config && <config.icon className="mx-auto h-16 w-16 text-blue-400 mb-6" />}
            <h1 className="text-4xl font-bold text-white mb-4">Acesso Restrito</h1>
            <p className="text-lg text-gray-300 mb-8">
              Para acessar o {config?.name || 'serviço'}, você precisa estar logado em sua conta GOV.RP.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/login">
                <Button size="lg" className="w-full sm:w-auto">
                  <LogIn className="mr-2 h-5 w-5" />
                  Fazer Login
                </Button>
              </Link>
              <Link to="/register">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  <UserPlus className="mr-2 h-5 w-5" />
                  Criar Conta
                </Button>
              </Link>
            </div>
          </div>
        </div>

        <Dialog open={showAuthDialog && !userDismissed} onOpenChange={handleDialogClose}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {config && <config.icon className="h-6 w-6 text-blue-400" />}
                {config?.name}
              </DialogTitle>
              <DialogDescription className="text-base">
                {config?.description}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <p className="text-sm text-gray-400">
                Para continuar, você precisa estar autenticado no GOV.RP.
              </p>
              <div className="flex flex-col gap-3">
                <Link to="/login" onClick={handleDialogClose}>
                  <Button className="w-full">
                    <LogIn className="mr-2 h-4 w-4" />
                    Fazer Login
                  </Button>
                </Link>
                <Link to="/register" onClick={handleDialogClose}>
                  <Button variant="outline" className="w-full">
                    <UserPlus className="mr-2 h-4 w-4" />
                    Criar Nova Conta
                  </Button>
                </Link>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return children;
};

export default ServiceProtectedRoute;
