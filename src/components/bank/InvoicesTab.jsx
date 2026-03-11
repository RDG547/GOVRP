import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import 'react-credit-cards-2/dist/es/styles-compiled.css';
import Cards from 'react-credit-cards-2';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PayInvoiceDialog = ({ isOpen, setIsOpen, invoice, onPaymentSuccess }) => {
    const { toast } = useToast();
    const [amount, setAmount] = useState('');
    const [payFull, setPayFull] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (invoice) {
            setAmount(formatCurrency(invoice.amount, true));
        }
    }, [invoice]);

    const handlePay = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        const amountToPay = payFull ? invoice.amount : parseCurrency(amount);

        const { data, error } = await supabase.rpc('pay_card_invoice', {
            p_invoice_id: invoice.id,
            p_pay_full: payFull,
            p_amount_to_pay: amountToPay
        });

        if (error || !data.success) {
            toast({ title: 'Erro no Pagamento', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            onPaymentSuccess();
            setIsOpen(false);
        }
        setIsLoading(false);
    };

    if (!invoice) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pagar Fatura</DialogTitle>
                    <DialogDescription>Fatura com vencimento em {new Date(invoice.due_date).toLocaleDateString('pt-BR')}</DialogDescription>
                </DialogHeader>
                <form onSubmit={handlePay} className="space-y-4 pt-4">
                    <div className="flex items-center space-x-2">
                        <input type="radio" id="payFull" name="paymentType" checked={payFull} onChange={() => setPayFull(true)} />
                        <Label htmlFor="payFull">Pagar valor total ({formatCurrency(invoice.amount)})</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <input type="radio" id="payPartial" name="paymentType" checked={!payFull} onChange={() => setPayFull(false)} />
                        <Label htmlFor="payPartial">Pagar outro valor</Label>
                    </div>
                    {!payFull && (
                        <div>
                            <Label htmlFor="amount">Valor a pagar</Label>
                            <Input id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value, true))} placeholder="R$ 0,00" />
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="animate-spin" /> : 'Confirmar Pagamento'}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

const InvoicesTab = ({ cards, onUpdate }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [selectedCardId, setSelectedCardId] = useState(cards[0]?.id || '');
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    
    const fetchInvoices = useCallback(async () => {
        if (!selectedCardId || !user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('card_invoices')
            .select('*')
            .eq('card_id', selectedCardId)
            .order('due_date', { ascending: false });

        if (error) {
            toast({ title: 'Erro', description: 'Falha ao buscar faturas.', variant: 'destructive' });
        } else {
            setInvoices(data);
        }
        setLoading(false);
    }, [selectedCardId, user, toast]);

    useEffect(() => {
        if (cards.length > 0 && !selectedCardId) {
            setSelectedCardId(cards[0].id);
        }
    }, [cards, selectedCardId]);
    
    useEffect(() => {
        fetchInvoices();
    }, [fetchInvoices]);

    const handleOpenPayModal = (invoice) => {
        setSelectedInvoice(invoice);
        setIsPayModalOpen(true);
    };

    const handlePaymentSuccess = () => {
        fetchInvoices();
        onUpdate();
    }

    const getStatusVariant = (status) => {
        switch (status) {
            case 'paid': return 'success';
            case 'open': return 'default';
            case 'closed': return 'secondary';
            case 'overdue': return 'destructive';
            default: return 'outline';
        }
    };
    
    const getStatusText = (status) => {
        const texts = {
            paid: 'Paga',
            open: 'Aberta',
            closed: 'Fechada',
            overdue: 'Vencida'
        };
        return texts[status] || status;
    }

    const selectedCard = cards.find(c => c.id === selectedCardId);

    return (
        <>
            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle>Faturas do Cartão de Crédito</CardTitle>
                    <CardDescription>Visualize e pague as faturas dos seus cartões.</CardDescription>
                </CardHeader>
                <CardContent>
                    {cards.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">Você não possui cartões de crédito.</p>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex flex-col md:flex-row gap-6">
                                 <div className="flex-shrink-0">
                                    {selectedCard && (
                                        <Cards
                                            number={selectedCard.card_number}
                                            name={selectedCard.card_holder_name}
                                            expiry={selectedCard.expiry_date}
                                            cvc=""
                                            focused=""
                                            preview={true}
                                        />
                                    )}
                                </div>
                                <div className="flex-1">
                                    <Select onValueChange={setSelectedCardId} value={selectedCardId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione um cartão" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {cards.map(card => (
                                                <SelectItem key={card.id} value={card.id}>
                                                    <span className="font-bold">{card.brand}</span> - final {card.card_number.slice(-4)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            
                            {loading ? (
                                <div className="flex justify-center items-center py-8"><Loader2 className="animate-spin w-8 h-8" /></div>
                            ) : invoices.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Vencimento</TableHead>
                                            <TableHead>Fechamento</TableHead>
                                            <TableHead>Valor</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {invoices.map(invoice => (
                                            <TableRow key={invoice.id}>
                                                <TableCell>{new Date(invoice.due_date).toLocaleDateString('pt-BR')}</TableCell>
                                                <TableCell>{new Date(invoice.closing_date).toLocaleDateString('pt-BR')}</TableCell>
                                                <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                                                <TableCell><Badge variant={getStatusVariant(invoice.status)}>{getStatusText(invoice.status)}</Badge></TableCell>
                                                <TableCell>
                                                    {invoice.status !== 'paid' && (
                                                        <Button size="sm" onClick={() => handleOpenPayModal(invoice)}>Pagar</Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            ) : (
                                <p className="text-muted-foreground text-center py-8">Nenhuma fatura encontrada para este cartão.</p>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
            <PayInvoiceDialog 
                isOpen={isPayModalOpen}
                setIsOpen={setIsPayModalOpen}
                invoice={selectedInvoice}
                onPaymentSuccess={handlePaymentSuccess}
            />
        </>
    );
};

export default InvoicesTab;