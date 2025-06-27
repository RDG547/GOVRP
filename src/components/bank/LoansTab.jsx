import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Coins, Clock, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const LoansTab = ({ loanApplications, onUpdate }) => {
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
    const [loanAmount, setLoanAmount] = useState('');
    const [isApplyingLoan, setIsApplyingLoan] = useState(false);
    const [isCanceling, setIsCanceling] = useState(null);
    const { user } = useAuth();
    const { toast } = useToast();

    const handleAmountChange = (e) => {
        setLoanAmount(formatCurrency(e.target.value));
    };

    const handleLoanApplication = async (e) => {
        e.preventDefault();
        setIsApplyingLoan(true);
        const { error } = await supabase.from('loan_applications').insert({ user_id: user.id, amount: parseCurrency(loanAmount), status: 'Pendente' });
        if (error) {
            toast({ title: "Erro", description: "Não foi possível enviar sua solicitação.", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: "Sua solicitação de empréstimo foi enviada para análise." });
            setIsLoanModalOpen(false);
            setLoanAmount('');
            onUpdate();
        }
        setIsApplyingLoan(false);
    };

    const handleCancelLoan = async (applicationId) => {
        setIsCanceling(applicationId);
        const { data, error } = await supabase.rpc('cancel_loan_application', { p_application_id: applicationId });
        if (error || !data.success) {
            toast({ title: "Erro", description: data?.message || "Não foi possível cancelar a solicitação.", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            onUpdate();
        }
        setIsCanceling(null);
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'Aprovado': return <CheckCircle className="w-5 h-5 text-green-400" />;
            case 'Rejeitado': return <XCircle className="w-5 h-5 text-red-400" />;
            default: return <Clock className="w-5 h-5 text-yellow-400" />;
        }
    }

    return (
        <TabsContent value="emprestimos" className="mt-4">
             <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="text-white flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <Coins className="h-6 w-6 text-yellow-400"/> Empréstimos
                        </div>
                        <Dialog open={isLoanModalOpen} onOpenChange={setIsLoanModalOpen}>
                            <DialogTrigger asChild><Button size="sm">Solicitar Empréstimo</Button></DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Solicitar Empréstimo</DialogTitle>
                                    <DialogDescription>Sua solicitação será enviada para análise de crédito.</DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleLoanApplication} className="space-y-4 pt-4">
                                    <div>
                                        <Label htmlFor="loanAmount">Valor desejado</Label>
                                        <Input id="loanAmount" value={loanAmount} onChange={handleAmountChange} placeholder="R$ 0,00" required />
                                    </div>
                                    <DialogFooter>
                                        <Button type="submit" disabled={isApplyingLoan}>
                                            {isApplyingLoan ? <Loader2 className="animate-spin" /> : 'Enviar Solicitação'}
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </CardTitle>
                    <CardDescription>Soluções de crédito para seus projetos.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {loanApplications && loanApplications.length > 0 ? (
                        loanApplications.map(app => (
                            <div key={app.id} className="p-4 rounded-lg bg-slate-800/50 flex justify-between items-center">
                                <div>
                                    <p className="text-lg font-bold text-white">{formatCurrency(app.amount * 100)}</p>
                                    <p className="text-xs text-gray-400">
                                        Solicitado {formatDistanceToNow(new Date(app.created_at), { addSuffix: true, locale: ptBR })}
                                    </p>
                                </div>
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2 text-sm font-medium text-white px-3 py-1 rounded-full"
                                        style={{
                                            backgroundColor: app.status === 'Aprovado' ? 'rgba(52, 211, 153, 0.1)' : app.status === 'Rejeitado' ? 'rgba(248, 113, 113, 0.1)' : 'rgba(250, 204, 21, 0.1)'
                                        }}
                                    >
                                        {getStatusIcon(app.status)}
                                        <span>{app.status}</span>
                                    </div>
                                    {app.status === 'Pendente' && (
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="icon" className="h-8 w-8" disabled={isCanceling === app.id}>
                                                    {isCanceling === app.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Cancelar Solicitação?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Esta ação não pode ser desfeita. Você tem certeza que deseja cancelar esta solicitação de empréstimo?
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleCancelLoan(app.id)}>Confirmar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="text-center py-8 text-gray-400">
                            <p>Você não possui solicitações de empréstimo.</p>
                            <p className="text-sm">Clique em "Solicitar Empréstimo" para começar.</p>
                        </div>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
    );
};

export default LoansTab;