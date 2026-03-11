import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Shield, User, Crown, LayoutDashboard } from 'lucide-react';

const ServiceAccess = ({ requiredRoles, citizenPath, panelPath, isDashboard = false }) => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [showDialog, setShowDialog] = useState(false);

    useEffect(() => {
        if (!loading && user) {
            const userRoles = Array.isArray(user.role) ? user.role : [user.role];
            const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));
            
            if (hasRequiredRole) {
                setShowDialog(true);
            } else {
                navigate(citizenPath, { replace: true });
            }
        }
    }, [user, loading, requiredRoles, citizenPath, panelPath, navigate]);

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

    const dialogTitle = isDashboard ? "Selecionar Dashboard" : "Selecione seu Acesso";
    const dialogDescription = isDashboard 
        ? "Como administrador, você pode acessar tanto o seu dashboard de cidadão quanto o painel administrativo."
        : "Detectamos que você tem permissões especiais. Como deseja acessar este serviço?";

    const citizenButtonText = isDashboard ? "Dashboard do Cidadão" : "Acessar como Cidadão";
    const panelButtonText = isDashboard ? "Dashboard do Admin" : "Acessar Painel";

    const citizenButtonIcon = isDashboard ? <LayoutDashboard className="mr-2 h-4 w-4"/> : <User className="mr-2 h-4 w-4"/>;
    const panelButtonIcon = isDashboard ? <Crown className="mr-2 h-4 w-4"/> : <Shield className="mr-2 h-4 w-4"/>;

    return (
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogContent className="glass-effect" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
                    <Button variant="outline" onClick={() => handleNavigate(citizenPath)} className="w-full">
                        {citizenButtonIcon}
                        {citizenButtonText}
                    </Button>
                    <Button onClick={() => handleNavigate(panelPath)} className="w-full">
                        {panelButtonIcon}
                        {panelButtonText}
                    </Button>
                </DialogFooter>
                <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                </DialogClose>
            </DialogContent>
        </Dialog>
    );
};

export default ServiceAccess;