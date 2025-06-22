
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, UserCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCPF, formatCurrency, parseCurrency } from '@/lib/utils';

const TransferDialog = ({ children, isOpen, setIsOpen, onTransferSuccess }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [transferMethod, setTransferMethod] = useState('cpf');
    const [transferData, setTransferData] = useState({ recipient: '', agency: '', account: '', amount: '', description: '' });
    const [isTransferring, setIsTransferring] = useState(false);
    const [recipientInfo, setRecipientInfo] = useState({ status: 'idle', data: null, message: '' });
    const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);

    const resetTransferState = useCallback(() => {
        setTransferData({ recipient: '', agency: '', account: '', amount: '', description: '' });
        setRecipientInfo({ status: 'idle', data: null, message: '' });
    }, []);

    useEffect(() => {
        if (!isOpen) {
            resetTransferState();
        }
    }, [isOpen, resetTransferState]);

    useEffect(() => {
        const handler = setTimeout(async () => {
            const { recipient, agency, account } = transferData;
            if ((transferMethod === 'cpf' && recipient.replace(/\D/g, '').length === 11) || (transferMethod === 'account' && agency && account)) {
                setIsCheckingRecipient(true);
                const { data, error } = await supabase.rpc('func_check_recipient', {
                    p_method: transferMethod,
                    p_identifier: recipient || null,
                    p_agency: agency || null,
                    p_account: account || null,
                });
                if (error || !data.found) {
                    setRecipientInfo({ status: 'error', data: null, message: data?.message || 'Destinatário não encontrado.' });
                } else {
                    setRecipientInfo({ status: 'success', data: data, message: `Destinatário: ${data.name}` });
                }
                setIsCheckingRecipient(false);
            } else {
                setRecipientInfo({ status: 'idle', data: null, message: '' });
            }
        }, 800);
        return () => clearTimeout(handler);
    }, [transferData.recipient, transferData.agency, transferData.account, transferMethod]);

    const handleRecipientChange = (e, field) => {
        const { value } = e.target;
        if (field === 'recipient') {
            setTransferData({ ...transferData, recipient: formatCPF(value) });
        } else {
            setTransferData({ ...transferData, [field]: value });
        }
    };
    
    const handleAmountChange = (e) => {
        setTransferData({ ...transferData, amount: formatCurrency(e.target.value) });
    };

    const handleTransfer = async (e) => {
        e.preventDefault();
        if (recipientInfo.status !== 'success' || !recipientInfo.data?.user_id) {
            toast({ title: "Erro", description: "Verifique os dados do destinatário antes de transferir.", variant: "destructive" });
            return;
        }
        setIsTransferring(true);
        try {
            const { data, error } = await supabase.rpc('func_execute_transfer', {
                p_sender_id: user.id,
                p_recipient_id: recipientInfo.data.user_id,
                p_amount: parseCurrency(transferData.amount),
                p_description: transferData.description,
            });

            if (error) throw new Error("Ocorreu um erro de comunicação. Tente novamente.");

            if (data.success) {
                toast({ title: "Sucesso!", description: data.message });
                setIsOpen(false);
                onTransferSuccess();
            } else {
                toast({ title: "Erro na Transferência", description: data.message, variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Erro na Transferência", description: error.message, variant: "destructive" });
        } finally {
            setIsTransferring(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
                <DialogHeader><DialogTitle>Nova Transferência</DialogTitle><DialogDescription>Envie dinheiro para outro cidadão de forma segura.</DialogDescription></DialogHeader>
                <Tabs value={transferMethod} onValueChange={(val) => { setTransferMethod(val); resetTransferState(); }} className="w-full pt-4">
                    <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="cpf">Por CPF</TabsTrigger><TabsTrigger value="account">Por Conta</TabsTrigger></TabsList>
                    <form onSubmit={handleTransfer} className="space-y-4 pt-4">
                        <TabsContent value="cpf" className="space-y-4">
                            <div><Label htmlFor="recipient">CPF do Destinatário</Label>
                                <div className="relative"><Input id="recipient" value={transferData.recipient} onChange={(e) => handleRecipientChange(e, 'recipient')} placeholder="000.000.000-00" required /></div>
                            </div>
                        </TabsContent>
                        <TabsContent value="account" className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label htmlFor="agency">Agência</Label><Input id="agency" value={transferData.agency} onChange={(e) => handleRecipientChange(e, 'agency')} placeholder="0000" required /></div>
                                <div><Label htmlFor="account_num">Nº da Conta</Label><Input id="account_num" value={transferData.account} onChange={(e) => handleRecipientChange(e, 'account')} placeholder="0000000-0" required /></div>
                            </div>
                        </TabsContent>
                        
                        <div className="h-6 text-center text-sm flex items-center justify-center gap-2">
                            {isCheckingRecipient ? <><Loader2 className="h-4 w-4 animate-spin" /><span>Verificando...</span></> :
                                recipientInfo.status === 'success' ? <span className="text-green-400 flex items-center gap-2"><UserCheck className="h-4 w-4" /> {recipientInfo.message}</span> :
                                    recipientInfo.status === 'error' ? <span className="text-red-400">{recipientInfo.message}</span> : null
                            }
                        </div>

                        <div><Label htmlFor="amount">Valor</Label><Input id="amount" value={transferData.amount} onChange={handleAmountChange} placeholder="R$ 0,00" required /></div>
                        <div><Label htmlFor="description">Descrição (Opcional)</Label><Input id="description" value={transferData.description} onChange={e => setTransferData({ ...transferData, description: e.target.value })} placeholder="Ex: Pagamento de aluguel" /></div>
                        <DialogFooter><Button type="submit" disabled={isTransferring || recipientInfo.status !== 'success'} className="w-full">{isTransferring ? <Loader2 className="animate-spin" /> : 'Confirmar Transferência'}</Button></DialogFooter>
                    </form>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default TransferDialog;
