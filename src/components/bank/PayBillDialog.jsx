import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Receipt, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { formatCurrency, formatBoleto, validateBoleto } from '@/lib/utils';
import { parseCurrency } from '@/lib/utils';

const PayBillDialog = ({ isOpen, setIsOpen }) => {
    const { toast } = useToast();
    const [billCode, setBillCode] = useState('');
    const [amount, setAmount] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [billStatus, setBillStatus] = useState({ status: 'idle', message: '' }); 

    const handleBillCodeChange = (e) => {
        const formatted = formatBoleto(e.target.value);
        setBillCode(formatted);
        const isValid = validateBoleto(formatted);
        
        if (isValid) {
            setBillStatus({ status: 'checking', message: 'Verificando boleto...' });
            
            // Simulação de verificação
            setTimeout(() => {
                const random = Math.random();
                if (random < 0.6) {
                    setBillStatus({ status: 'valid', message: 'Boleto válido e pendente.' });
                } else if (random < 0.8) {
                    setBillStatus({ status: 'paid', message: 'Este boleto já foi pago.' });
                } else {
                    setBillStatus({ status: 'invalid', message: 'Boleto inexistente.' });
                }
            }, 1000);
        } else {
             setBillStatus({ status: 'idle', message: '' });
        }
    };

    const handlePay = (e) => {
        e.preventDefault();
        if (billStatus.status !== 'valid') {
            toast({ title: "Pagamento não permitido", description: "Verifique o status do boleto.", variant: "destructive" });
            return;
        }

        setIsProcessing(true);
        setTimeout(() => {
             toast({
                title: '🚧 Pagamento Simulado',
                description: `O pagamento de ${amount} para o boleto foi simulado com sucesso!`,
            });
            setIsProcessing(false);
            setIsOpen(false);
            setBillCode('');
            setAmount('');
            setBillStatus({status: 'idle', message: ''});
        }, 1500);
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
                        <Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value))} placeholder="R$ 0,00" required />
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