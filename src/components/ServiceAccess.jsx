import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Shield, User } from 'lucide-react';

const ServiceAccess = ({ roleName, citizenPath, panelPath }) => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [showDialog, setShowDialog] = useState(false);

    useEffect(() => {
        if (!loading) {
            if (!user) {
                navigate('/login', { replace: true, state: { from: citizenPath } });
                return;
            }

            const userRoles = Array.isArray(user.role) ? user.role : [user.role];
            const requiredRoles = Array.isArray(roleName) ? roleName : [roleName];
            
            const hasAccess = requiredRoles.some(role => userRoles.includes(role));

            if (hasAccess) {
                setShowDialog(true);
            } else {
                navigate(citizenPath, { replace: true });
            }
        }
    }, [user, loading, roleName, citizenPath, panelPath, navigate]);

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Loader2 className="w-16 h-16 animate-spin text-blue-400" />
            </div>
        );
    }

    const handleNavigate = (path) => {
        setShowDialog(false);
        navigate(path, { replace: true });
    };

    return (
        <Dialog open={showDialog}>
            <DialogContent className="glass-effect" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>Selecione seu Acesso</DialogTitle>
                    <DialogDescription>
                        Detectamos que você tem permissões especiais. Como deseja acessar este serviço?
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
                    <Button variant="outline" onClick={() => handleNavigate(citizenPath)} className="w-full">
                        <User className="mr-2 h-4 w-4"/>
                        Acessar como Cidadão
                    </Button>
                    <Button onClick={() => handleNavigate(panelPath)} className="w-full">
                        <Shield className="mr-2 h-4 w-4"/>
                        Acessar Painel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ServiceAccess;