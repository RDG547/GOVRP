import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Loader2, Shield, User, Crown, LayoutDashboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';

const ServiceAccess = ({ requiredRoles, citizenPath, panelPath, isDashboard = false, title, panelLabel }) => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();
    const [showDialog, setShowDialog] = useState(false);

    useEffect(() => {
        if (!loading && user) {
            const userRoles = Array.isArray(user?.effective_roles)
                ? user.effective_roles
                : Array.isArray(user.role)
                    ? user.role
                    : [user.role].filter(Boolean);
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

    const dialogTitle = title || (isDashboard ? "Selecionar Dashboard" : "Selecione seu Acesso");
    const dialogDescription = isDashboard
        ? "Como administrador, você pode acessar tanto o seu dashboard de cidadão quanto o painel administrativo."
        : "Detectamos que você tem permissões especiais. Como deseja acessar este serviço?";

    const citizenButtonText = isDashboard ? "Dashboard do Cidadão" : "Acessar como Cidadão";
    const panelButtonText = panelLabel || (isDashboard ? "Dashboard do Admin" : "Acessar Painel");

    const citizenButtonIcon = isDashboard ? <LayoutDashboard className="mr-2 h-4 w-4"/> : <User className="mr-2 h-4 w-4"/>;
    const panelButtonIcon = isDashboard ? <Crown className="mr-2 h-4 w-4"/> : <Shield className="mr-2 h-4 w-4"/>;

    return (
        <Dialog open={showDialog} onOpenChange={(open) => { if (!open) handleNavigate(citizenPath); else setShowDialog(true); }}>
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
            </DialogContent>
        </Dialog>
    );
};

export default ServiceAccess;
