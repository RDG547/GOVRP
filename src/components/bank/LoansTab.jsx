
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Coins as HandCoins } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';

const LoansTab = () => {
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
    const [loanAmount, setLoanAmount] = useState('');
    const [isApplyingLoan, setIsApplyingLoan] = useState(false);

    const { user } = useAuth();
    const { toast } = useToast();

    const handleAmountChange = (e) => {
        setLoanAmount(formatCurrency(e.target.value));
    };

    const handleLoanApplication = async (e) => {
        e.preventDefault();
        setIsApplyingLoan(true);
        const { error } = await supabase.from('loan_applications').insert({ user_id: user.id, amount: parseCurrency(loanAmount) });
        if (error) {
            toast({ title: "Erro", description: "Não foi possível enviar sua solicitação.", variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: "Sua solicitação de empréstimo foi enviada para análise." });
            setIsLoanModalOpen(false);
            setLoanAmount('');
        }
        setIsApplyingLoan(false);
    };

    return (
        <TabsContent value="emprestimos" className="bg-black/20 rounded-2xl p-6 mt-4 text-center">
            <HandCoins className="w-16 h-16 mx-auto text-blue-400 mb-4" />
            <h3 className="text-xl font-bold text-white mb-4">Empréstimos</h3>
            <p className="text-gray-300 mb-6">Soluções de crédito para seus projetos. Veja as opções disponíveis.</p>
            <Dialog open={isLoanModalOpen} onOpenChange={setIsLoanModalOpen}>
                <DialogTrigger asChild><Button>Simular Empréstimo</Button></DialogTrigger>
                <DialogContent>
                    <DialogHeader><DialogTitle>Solicitar Empréstimo</DialogTitle><DialogDescription>Sua solicitação será enviada para análise de crédito.</DialogDescription></DialogHeader>
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
        </TabsContent>
    );
};

export default LoansTab;
