import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Loader2, MessageCircle, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const XOnboarding = () => {
    const { refreshUser } = useAuth();
    const { toast } = useToast();
    const [xUsername, setXUsername] = useState('');
    const [xHandle, setXHandle] = useState('');
    const [isCreatingProfile, setIsCreatingProfile] = useState(false);
    const [showDialog, setShowDialog] = useState(true);

    const handleCreateXProfile = async (e) => {
        e.preventDefault();
        setIsCreatingProfile(true);
        const { data, error } = await supabase.rpc('create_x_profile', {
            p_x_username: xUsername,
            p_x_handle: xHandle
        });
        if (error || !data.success) {
            toast({ title: "Erro ao criar perfil", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Bem-vindo ao X!", description: data.message });
            setShowDialog(false);
            await refreshUser();
        }
        setIsCreatingProfile(false);
    };

    const handleCloseDialog = () => {
        setShowDialog(false);
    };

    if (!showDialog) {
        return (
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center glass-effect rounded-2xl p-12">
                    <MessageCircle className="mx-auto h-16 w-16 text-sky-400 mb-6" />
                    <h1 className="text-4xl font-bold text-white mb-4">Bem-vindo ao <span className="gradient-text">X</span></h1>
                    <p className="text-lg text-gray-300 mb-8">Crie seu perfil para começar a interagir com outros cidadãos. Escolha um nome de usuário e um @handle únicos.</p>
                    <Button size="lg" onClick={() => setShowDialog(true)}>
                        <UserPlus className="mr-2 h-5 w-5" />
                        Criar Perfil X
                    </Button>
                </motion.div>
            </div>
        );
    }

    return (
        <>
            <Helmet><title>Criar Perfil X - GOV.RP</title></Helmet>
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center glass-effect rounded-2xl p-12">
                    <MessageCircle className="mx-auto h-16 w-16 text-sky-400 mb-6" />
                    <h1 className="text-4xl font-bold text-white mb-4">Bem-vindo ao <span className="gradient-text">X</span></h1>
                    <p className="text-lg text-gray-300 mb-8">Crie seu perfil para começar a interagir com outros cidadãos. Escolha um nome de usuário e um @handle únicos.</p>
                    <Button size="lg" onClick={() => setShowDialog(true)}>
                        <UserPlus className="mr-2 h-5 w-5" />
                        Criar Perfil X
                    </Button>
                </motion.div>
            </div>

            <Dialog open={showDialog} onOpenChange={setShowDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MessageCircle className="h-6 w-6 text-sky-400" />
                            Criar Perfil X
                        </DialogTitle>
                        <DialogDescription>
                            Escolha como você quer ser conhecido na rede social X.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateXProfile} className="space-y-6">
                        <div>
                            <Label htmlFor="xUsername">Nome de Usuário (será exibido)</Label>
                            <Input id="xUsername" value={xUsername} onChange={(e) => setXUsername(e.target.value)} placeholder="Ex: João Silva" required />
                        </div>
                        <div>
                            <Label htmlFor="xHandle">@handle (seu identificador único)</Label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">@</span>
                                <Input id="xHandle" value={xHandle} onChange={(e) => setXHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))} placeholder="joao_silva" required className="pl-7" />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Apenas letras, números e underscores.</p>
                        </div>
                        <DialogFooter className="flex gap-2">
                            <Button type="button" variant="outline" onClick={handleCloseDialog}>
                                <X className="mr-2 h-4 w-4" />
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={isCreatingProfile}>
                                {isCreatingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                {isCreatingProfile ? 'Criando perfil...' : 'Criar Perfil'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default XOnboarding;