import React, { useState, useEffect } from 'react';
import { Navigate, useLocation, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Building2, MessageSquare, FileText, ShoppingBag, LogIn, UserPlus } from 'lucide-react';

const ServiceProtectedRoute = ({ children, service }) => {
  const { session, user, loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  
  const [xUsername, setXUsername] = useState('');
  const [xHandle, setXHandle] = useState('');

  const serviceConfig = {
    bank: {
      name: 'Banco Nacional',
      icon: <Building2 className="w-16 h-16 text-blue-400" />,
      description: 'Para acessar o Banco Nacional, você precisa abrir uma conta bancária.',
      checkFunction: async () => {
        const { data, error } = await supabase.from('accounts').select('id').eq('user_id', user.id).maybeSingle();
        if (error && error.code !== 'PGRST116') throw error;
        return !!data;
      },
      createFunction: async () => {
        const { data, error } = await supabase.rpc('create_bank_account');
        if (error) throw error;
        return data;
      }
    },
    x: {
      name: 'Social X',
      icon: <MessageSquare className="w-16 h-16 text-purple-400" />,
      description: 'Para acessar o Social X, você precisa criar seu perfil na rede social.',
      checkFunction: async () => {
        const { data } = await supabase.from('profiles').select('x_handle').eq('id', user.id).single();
        return !!data?.x_handle;
      },
      createFunction: async () => {
        const { data, error } = await supabase.rpc('create_x_profile', {
          p_x_handle: xHandle,
          p_x_username: xUsername
        });
        if (error) throw error;
        return data;
      }
    },
    dic: { name: 'DIC', icon: <FileText className="w-16 h-16 text-green-400" />, description: 'O DIC está disponível para todos os cidadãos registrados.', checkFunction: async () => true, createFunction: async () => ({ success: true }) },
    business: { name: 'Negócios Livres', icon: <ShoppingBag className="w-16 h-16 text-orange-400" />, description: 'O Negócios Livres está disponível para todos os cidadãos registrados.', checkFunction: async () => true, createFunction: async () => ({ success: true }) }
  };

  const currentService = serviceConfig[service];

  useEffect(() => {
    const checkAccess = async () => {
      if (!user || !currentService) {
        setLoading(false);
        return;
      }
      try {
        const hasServiceAccess = await currentService.checkFunction();
        setHasAccess(hasServiceAccess);
      } catch (error) {
        console.error('Error checking service access:', error);
        setHasAccess(false);
      } finally {
        setLoading(false);
      }
    };

    if (!authLoading) {
      checkAccess();
    }
  }, [user, authLoading, service]);

  const handleCreateAccount = async () => {
    if (service === 'x' && (!xUsername.trim() || !xHandle.trim() || xHandle.trim().length < 4)) {
      toast({ title: 'Erro', description: 'Preencha todos os campos. O @handle deve ter pelo menos 4 caracteres.', variant: 'destructive' });
      return;
    }
    setIsCreating(true);
    try {
      const result = await currentService.createFunction();
      if (result.success) {
        toast({ title: 'Sucesso!', description: result.message });
        await refreshUser();
        setShowSetupModal(false);
        setHasAccess(true);
      } else {
        toast({ title: 'Erro', description: result.message, variant: 'destructive' });
      }
    } catch (error) {
      toast({ title: 'Erro', description: error.message || 'Não foi possível criar a conta. Tente novamente.', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelSetup = () => {
    setShowSetupModal(false);
    navigate(-1);
  };

  if (authLoading || loading) {
    return <div className="flex justify-center items-center min-h-[80vh]"><Loader2 className="w-16 h-16 animate-spin text-blue-400" /></div>;
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><div className="text-center">
        <div className="flex justify-center mb-6">{currentService?.icon}</div>
        <h1 className="text-4xl font-bold text-white mb-4">Acesso Restrito</h1>
        <p className="text-lg text-gray-300 mb-8">Para acessar o <span className="font-semibold">{currentService?.name}</span>, você precisa estar logado em sua conta GOV.RP.</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/login" state={{ from: location }}><Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600"><LogIn className="w-5 h-5 mr-2" /> Fazer Login</Button></Link>
          <Link to="/register"><Button size="lg" variant="outline"><UserPlus className="w-5 h-5 mr-2" /> Criar Conta</Button></Link>
        </div>
      </div></div>
    );
  }

  if (!hasAccess && (service === 'bank' || service === 'x')) {
    return (
      <>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <div className="flex justify-center mb-6">{currentService?.icon}</div>
            <h1 className="text-4xl font-bold text-white mb-4">Configuração Necessária</h1>
            <p className="text-lg text-gray-300 mb-8">{currentService?.description}</p>
            <Button size="lg" onClick={() => setShowSetupModal(true)} className="bg-gradient-to-r from-blue-600 to-purple-600">
              {service === 'bank' ? 'Abrir Conta Bancária' : 'Criar Perfil X'}
            </Button>
          </div>
        </div>

        <Dialog open={showSetupModal} onOpenChange={setShowSetupModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{service === 'bank' ? 'Abrir Conta Bancária' : 'Criar Perfil X'}</DialogTitle>
              <DialogDescription>{service === 'bank' ? 'Sua conta bancária será criada automaticamente com um saldo inicial de R$ 1.000,00.' : 'Escolha seu nome de usuário e @handle para o Social X. Estes devem ser únicos.'}</DialogDescription>
            </DialogHeader>
            {service === 'x' && (
              <div className="space-y-4 py-4">
                <div>
                  <Label htmlFor="xUsername">Nome de Usuário no X</Label>
                  <Input id="xUsername" value={xUsername} onChange={(e) => setXUsername(e.target.value)} placeholder="Ex: João Silva" required />
                </div>
                <div>
                  <Label htmlFor="xHandle">@Handle (identificador único)</Label>
                  <Input id="xHandle" value={xHandle} onChange={(e) => setXHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} placeholder="Ex: joaosilva123" required />
                  <p className="text-xs text-gray-400 mt-1">Mínimo 4 caracteres. Apenas letras, números e underscore.</p>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelSetup}>Cancelar</Button>
              <Button onClick={handleCreateAccount} disabled={isCreating}>{isCreating && <Loader2 className="animate-spin w-4 h-4 mr-2" />}{service === 'bank' ? 'Abrir Conta' : 'Criar Perfil'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return children;
};

export default ServiceProtectedRoute;