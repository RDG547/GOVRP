import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRight, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency, formatCPF } from '@/lib/utils';
import ReceiptDownloadDialog from './ReceiptDownloadDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TransferDialog = ({ isOpen, setIsOpen, onTransferSuccess }) => {
    const { user } = useAuth();
    const { toast } = useToast();

    const [step, setStep] = useState(1); // 1: Form, 2: Confirmation
    
    // Form state
    const [method, setMethod] = useState('key');
    const [key, setKey] = useState('');
    const [cpf, setCpf] = useState('');
    const [agency, setAgency] = useState('');
    const [account, setAccount] = useState('');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');

    const [isChecking, setIsChecking] = useState(false);
    const [recipientInfo, setRecipientInfo] = useState(null);
    const [lastTransactionId, setLastTransactionId] = useState(null);
    const [showReceiptDialog, setShowReceiptDialog] = useState(false);
    const [isTransferring, setIsTransferring] = useState(false);

    const resetForm = useCallback(() => {
        setStep(1);
        setMethod('key');
        setKey('');
        setCpf('');
        setAgency('');
        setAccount('');
        setAmount('');
        setDescription('');
        setIsChecking(false);
        setRecipientInfo(null);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            resetForm();
        }
    }, [isOpen, resetForm]);

    const handleCheckRecipient = async (e) => {
        e.preventDefault();
        setIsChecking(true);
        
        let rpcParams = { p_method: method };
        if (method === 'key') rpcParams.p_value1 = key;
        else if (method === 'cpf') rpcParams.p_value1 = cpf.replace(/\D/g, '');
        else if (method === 'account') {
            rpcParams.p_value1 = agency;
            rpcParams.p_value2 = account;
        }

        const { data, error } = await supabase.rpc('find_recipient', rpcParams);

        if (error || !data.found) {
            toast({ title: "Erro", description: data?.message || 'Destinatário não encontrado.', variant: "destructive" });
        } else {
            setRecipientInfo(data);
            setStep(2);
        }
        setIsChecking(false);
    };
    
    const handleConfirmTransfer = async () => {
        setIsTransferring(true);
        const { data, error } = await supabase.rpc('execute_transfer', {
            p_sender_id: user.id,
            p_recipient_id: recipientInfo.user_id,
            p_amount: parseCurrency(amount),
            p_description: description
        });

        if(error || !data.success){
            toast({ title: "Erro na Transferência", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setLastTransactionId(data.transaction_id);
            setIsOpen(false);
            onTransferSuccess();
            setShowReceiptDialog(true);
        }
        setIsTransferring(false);
    };

    return (
        <>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent>
                    {step === 1 && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Nova Transferência</DialogTitle>
                                <DialogDescription>Envie dinheiro para outro cidadão.</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleCheckRecipient} className="space-y-4 pt-4">
                                <Tabs value={method} onValueChange={setMethod} className="w-full">
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger value="key">Chave</TabsTrigger>
                                        <TabsTrigger value="cpf">CPF</TabsTrigger>
                                        <TabsTrigger value="account">Conta</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="key" className="pt-2"><Input value={key} onChange={e => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="Chave de 5 dígitos" maxLength={5} /></TabsContent>
                                    <TabsContent value="cpf" className="pt-2"><Input value={cpf} onChange={e => setCpf(formatCPF(e.target.value))} placeholder="000.000.000-00" /></TabsContent>
                                    <TabsContent value="account" className="pt-2 grid grid-cols-2 gap-2">
                                        <Input value={agency} onChange={e => setAgency(e.target.value)} placeholder="Agência" />
                                        <Input value={account} onChange={e => setAccount(e.target.value)} placeholder="Conta" />
                                    </TabsContent>
                                </Tabs>
                                <div><Label htmlFor="amount">Valor</Label><Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value))} placeholder="R$ 0,00" required /></div>
                                <div><Label htmlFor="description">Descrição (Opcional)</Label><Input id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Pagamento de aluguel" /></div>
                                <DialogFooter>
                                    <Button type="submit" disabled={isChecking} className="w-full">
                                        {isChecking ? <Loader2 className="animate-spin" /> : <>Continuar <ArrowRight className="ml-2 h-4 w-4"/></>}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </>
                    )}
                    {step === 2 && recipientInfo && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Confirmar Transferência</DialogTitle>
                                <DialogDescription>Revise os dados antes de confirmar.</DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                                <div className="p-4 rounded-lg bg-slate-800/50">
                                    <div className="flex items-center gap-3 mb-3">
                                        <User className="w-6 h-6 text-blue-400" />
                                        <p className="text-lg font-bold text-white">{recipientInfo.full_name}</p>
                                    </div>
                                    <div className="text-sm text-gray-300 space-y-1">
                                        <p><strong>CPF:</strong> {formatCPF(recipientInfo.cpf)}</p>
                                        <p><strong>Agência:</strong> {recipientInfo.agency_number} / <strong>Conta:</strong> {recipientInfo.account_number}</p>
                                        <p><strong>Chave:</strong> {recipientInfo.transfer_key}</p>
                                    </div>
                                </div>
                                <div className="text-center">
                                    <p className="text-gray-400">Valor da Transferência</p>
                                    <p className="text-3xl font-bold text-green-400">{formatCurrency(parseCurrency(amount) * 100)}</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
                                <Button onClick={handleConfirmTransfer} disabled={isTransferring}>
                                    {isTransferring ? <Loader2 className="animate-spin" /> : 'Confirmar'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            {lastTransactionId && (
                <ReceiptDownloadDialog
                    isOpen={showReceiptDialog}
                    setIsOpen={setShowReceiptDialog}
                    transactionId={lastTransactionId}
                />
            )}
        </>
    );
};

export default TransferDialog;