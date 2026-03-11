import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Receipt, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, formatBoleto, validateBoleto } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';

const PayBillDialog = ({ isOpen, setIsOpen, onPaymentSuccess, initialBillCode = '' }) => {
    const { toast } = useToast();
    const [billCode, setBillCode] = useState('');
    const [amount, setAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [billStatus, setBillStatus] = useState({ status: 'idle', message: '' });
    const [debounceTimeout, setDebounceTimeout] = useState(null);

    const validateBillWithDebounce = useCallback((code) => {
        if (debounceTimeout) clearTimeout(debounceTimeout);

        const newTimeout = setTimeout(async () => {
            setBillStatus({ status: 'checking', message: 'Verificando boleto...' });
            const { data, error } = await supabase.rpc('validate_and_get_bill', { p_bill_code: code });

            if (error) {
                setAmount('');
                setBillStatus({ status: 'invalid', message: 'Erro ao verificar boleto.' });
                toast({ title: "Erro", description: error.message, variant: "destructive" });
            } else if (data.success) {
                setAmount(formatCurrency(data.amount, true));
                setBillStatus({ status: 'valid', message: data.message });
            } else {
                setAmount('');
                setBillStatus({ status: data.status, message: data.message });
            }
        }, 1000);

        setDebounceTimeout(newTimeout);
    }, [debounceTimeout, toast]);

    useEffect(() => {
        if (isOpen) {
            const formatted = formatBoleto(initialBillCode);
            setBillCode(formatted);
            if (validateBoleto(formatted)) {
                validateBillWithDebounce(formatted);
            }
        } else {
            setBillCode('');
            setAmount('');
            setBillStatus({ status: 'idle', message: '' });
            if (debounceTimeout) clearTimeout(debounceTimeout);
        }
    }, [isOpen, initialBillCode, debounceTimeout, validateBillWithDebounce]);

    const handleBillCodeChange = (e) => {
        const formatted = formatBoleto(e.target.value);
        setBillCode(formatted);
        const isValid = validateBoleto(formatted);
        
        if (isValid) {
            validateBillWithDebounce(formatted);
        } else {
             if (debounceTimeout) clearTimeout(debounceTimeout);
             setBillStatus({ status: 'idle', message: '' });
             setAmount('');
        }
    };

    const handlePay = async (e) => {
        e.preventDefault();
        if (billStatus.status !== 'valid') {
            toast({ title: "Pagamento não permitido", description: "Verifique o status do boleto.", variant: "destructive" });
            return;
        }

        setIsProcessing(true);
        const { data, error } = await supabase.rpc('pay_boleto', { p_bill_code: billCode });

        if (error || !data.success) {
            toast({ title: "Erro no Pagamento", description: error?.message || data.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            if(onPaymentSuccess) onPaymentSuccess();
            setIsOpen(false);
        }
        setIsProcessing(false);
    };
    
    const BillStatusIndicator = () => {
        switch(billStatus.status) {
            case 'checking':
                return <span className="text-xs text-yellow-400 flex items-center gap-1"><Clock className="w-3 h-3"/> {billStatus.message}</span>
            case 'valid':
                 return <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3"/> {billStatus.message}</span>
            case 'paid':
                 return <span className="text-xs text-blue-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> {billStatus.message}</span>
            case 'invalid':
                 return <span className="text-xs text-red-400 flex items-center gap-1"><XCircle className="w-3 h-3"/> {billStatus.message}</span>
            case 'idle':
            default:
                const cleanCode = billCode.replace(/\D/g, '');
                if (cleanCode.length > 0 && cleanCode.length < 47) {
                    return <p className="text-xs text-red-400 mt-1">O código de barras deve ter 47 dígitos.</p>
                }
                return null;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Receipt /> Pagar Conta</DialogTitle>
                    <DialogDescription>Digite o código de barras para verificar e pagar uma conta.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handlePay} className="space-y-4 pt-4">
                    <div>
                        <Label htmlFor="billCode">Código de Barras</Label>
                        <div className="relative">
                            <Input id="billCode" value={billCode} onChange={handleBillCodeChange} placeholder="00000.00000 00000.000000..." required />
                        </div>
                        <div className="h-4 mt-1">
                            <BillStatusIndicator />
                        </div>
                    </div>
                     <div>
                        <Label htmlFor="amount">Valor a Pagar</Label>
                        <Input id="amount" value={amount} placeholder="R$ 0,00" readOnly disabled />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={isProcessing || billStatus.status !== 'valid' || !amount} className="w-full">
                            {isProcessing ? <Loader2 className="animate-spin" /> : 'Confirmar Pagamento'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default PayBillDialog;