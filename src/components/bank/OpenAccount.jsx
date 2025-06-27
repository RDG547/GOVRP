import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Banknote, Landmark, X } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';

const OpenAccount = ({ onAccountCreated }) => {
    const [isCreatingAccount, setIsCreatingAccount] = useState(false);
    const [showDialog, setShowDialog] = useState(true);
    const { toast } = useToast();

    const handleCreateAccount = async () => {
        setIsCreatingAccount(true);
        const { data, error } = await supabase.rpc('create_bank_account');
        if (error || !data.success) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setShowDialog(false);
            await onAccountCreated();
        }
        setIsCreatingAccount(false);
    };

    const handleCloseDialog = () => {
        setShowDialog(false);
    };

    if (!showDialog) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center glass-effect rounded-2xl p-12">
                    <Landmark className="mx-auto h-16 w-16 text-blue-400 mb-6" />
                    <h1 className="text-4xl font-bold text-white mb-4">Bem-vindo ao Banco Nacional</h1>
                    <p className="text-lg text-gray-300 mb-8">Para começar a usar nossos serviços financeiros, você precisa abrir sua conta. É rápido, fácil e seguro.</p>
                    <Button size="lg" onClick={() => setShowDialog(true)}>
                        <Banknote className="mr-2 h-5 w-5" />
                        Abrir Conta Agora
                    </Button>
                </motion.div>
            </div>
        );
    }

    return (
        <>
            <Helmet><title>Abrir Conta - Banco Nacional</title></Helmet>
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center glass-effect rounded-2xl p-12">
                    <Landmark className="mx-auto h-16 w-16 text-blue-400 mb-6" />
                    <h1 className="text-4xl font-bold text-white mb-4">Bem-vindo ao Banco Nacional</h1>
                    <p className="text-lg text-gray-300 mb-8">Para começar a usar nossos serviços financeiros, você precisa abrir sua conta. É rápido, fácil e seguro.</p>
                    <Button size="lg" onClick={() => setShowDialog(true)}>
                        <Banknote className="mr-2 h-5 w-5" />
                        Abrir Conta Agora
                    </Button>
                </motion.div>
            </div>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Landmark className="h-6 w-6 text-blue-400" />
                            Abrir Conta Bancária
                        </DialogTitle>
                        <DialogDescription>
                            Sua conta será criada instantaneamente com R$ 1.000,00 de saldo inicial para você começar a usar nossos serviços.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <div className="space-y-3 text-sm text-gray-300">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                <span>Conta corrente gratuita</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                <span>Transferências ilimitadas</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                <span>Cartões de crédito disponíveis</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                                <span>Investimentos e empréstimos</span>
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex gap-2">
                        <Button variant="outline" onClick={handleCloseDialog}>
                            <X className="mr-2 h-4 w-4" />
                            Cancelar
                        </Button>
                        <Button onClick={handleCreateAccount} disabled={isCreatingAccount}>
                            {isCreatingAccount ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Banknote className="mr-2 h-4 w-4" />}
                            {isCreatingAccount ? 'Criando conta...' : 'Confirmar Abertura'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default OpenAccount;