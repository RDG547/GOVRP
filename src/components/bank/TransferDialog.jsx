import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, UserCheck, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import ReceiptDownloadDialog from './ReceiptDownloadDialog';

const TransferDialog = ({ isOpen, setIsOpen, onTransferSuccess }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    
    const [transferKey, setTransferKey] = useState('');
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');

    const [isTransferring, setIsTransferring] = useState(false);
    const [recipientInfo, setRecipientInfo] = useState({ status: 'idle', data: null, message: '' });
    const [isCheckingRecipient, setIsCheckingRecipient] = useState(false);
    
    const [lastTransactionId, setLastTransactionId] = useState(null);
    const [showReceiptDialog, setShowReceiptDialog] = useState(false);

    const resetState = useCallback(() => {
        setTransferKey('');
        setAmount('');
        setDescription('');
        setRecipientInfo({ status: 'idle', data: null, message: '' });
        setLastTransactionId(null);
    }, []);

    useEffect(() => {
        if (!isOpen) {
            resetState();
        }
    }, [isOpen, resetState]);

    useEffect(() => {
        const handler = setTimeout(async () => {
            if (transferKey.length === 5) {
                setIsCheckingRecipient(true);
                setRecipientInfo({ status: 'idle', data: null, message: '' });

                const { data, error } = await supabase.rpc('check_recipient_by_key', {
                    p_transfer_key: transferKey,
                });
                
                if (error || !data.found) {
                    setRecipientInfo({ status: 'error', data: null, message: data?.message || 'Destinatário não encontrado.' });
                } else {
                     if(data.user_id === user.id) {
                        setRecipientInfo({ status: 'error', data: null, message: 'Você não pode transferir para si mesmo.' });
                    } else {
                        setRecipientInfo({ status: 'success', data: data, message: `Destinatário: ${data.name}` });
                    }
                }
                setIsCheckingRecipient(false);
            } else {
                setRecipientInfo({ status: 'idle', data: null, message: '' });
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [transferKey, user.id]);
    
    const handleTransfer = async (e) => {
        e.preventDefault();
        if (recipientInfo.status !== 'success' || !recipientInfo.data?.user_id) {
            toast({ title: "Erro", description: "Verifique a chave de transferência antes de continuar.", variant: "destructive" });
            return;
        }
        setIsTransferring(true);
        try {
            const { data, error } = await supabase.rpc('execute_transfer', {
                p_sender_id: user.id,
                p_recipient_key: transferKey,
                p_amount: parseCurrency(amount),
                p_description: description,
            });

            if (error) throw new Error("Ocorreu um erro de comunicação. Tente novamente.");

            if (data.success) {
                toast({ title: "Sucesso!", description: data.message });
                setLastTransactionId(data.transaction_id);
                setIsOpen(false);
                onTransferSuccess();
                setShowReceiptDialog(true);
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
        <>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nova Transferência</DialogTitle>
                        <DialogDescription>Envie dinheiro para outro cidadão usando a Chave de Transferência.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleTransfer} className="space-y-4 pt-4">
                        <div>
                            <Label htmlFor="transferKey">Chave de Transferência do Destinatário</Label>
                            <Input
                                id="transferKey"
                                value={transferKey}
                                onChange={(e) => setTransferKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                placeholder="XXXXX"
                                maxLength={5}
                                required
                            />
                        </div>

                        <div className="h-6 text-center text-sm flex items-center justify-center gap-2">
                            {isCheckingRecipient ? <><Loader2 className="h-4 w-4 animate-spin" /><span>Verificando...</span></> :
                                recipientInfo.status === 'success' ? <span className="text-green-400 flex items-center gap-2"><UserCheck className="h-4 w-4" /> {recipientInfo.message}</span> :
                                    recipientInfo.status === 'error' ? <span className="text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{recipientInfo.message}</span> : null
                            }
                        </div>

                        <div><Label htmlFor="amount">Valor</Label><Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value))} placeholder="R$ 0,00" required /></div>
                        <div><Label htmlFor="description">Descrição (Opcional)</Label><Input id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ex: Pagamento de aluguel" /></div>
                        
                        <DialogFooter>
                            <Button type="submit" disabled={isTransferring || recipientInfo.status !== 'success'} className="w-full">
                                {isTransferring ? <Loader2 className="animate-spin" /> : 'Confirmar Transferência'}
                            </Button>
                        </DialogFooter>
                    </form>
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