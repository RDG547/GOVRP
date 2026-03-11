import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Loader2, Trash2, CreditCard, RefreshCw, CalendarDays, DollarSign, ChevronDown, ChevronUp } from 'lucide-react';
import Cards from 'react-credit-cards-2'; // Importando o componente da biblioteca
import 'react-credit-cards-2/dist/es/styles-compiled.css'; // Importando o estilo da biblioteca
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
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format, addMonths, setDate } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AnimatePresence, motion } from 'framer-motion';

// Componente para pagar a fatura (inalterado)
const PayInvoiceDialog = ({ isOpen, setIsOpen, card, onPaymentSuccess }) => {
    const { toast } = useToast();
    const [amount, setAmount] = useState('');
    const [payFull, setPayFull] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setAmount('');
            setPayFull(true);
        }
    }, [isOpen]);

    const handlePay = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        const amountToPay = payFull ? card.used_limit : parseCurrency(amount);

        if (!payFull && (amountToPay <= 0 || amountToPay > card.used_limit)) {
            toast({ title: 'Valor Inválido', description: 'O valor a pagar deve ser maior que zero e menor ou igual ao total utilizado.', variant: 'destructive' });
            setIsLoading(false);
            return;
        }

        const { data, error } = await supabase.rpc('pay_card_bill', {
            p_card_id: card.id,
            p_amount_to_pay: amountToPay
        });

        if (error || (data && !data.success)) {
            toast({ title: 'Erro no Pagamento', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            onPaymentSuccess();
            setIsOpen(false);
        }
        setIsLoading(false);
    };

    if (!card) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pagamento Antecipado de Fatura</DialogTitle>
                    <DialogDescription>Pague o valor utilizado no seu cartão {card.brand} final {card.card_number.slice(-4)}.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handlePay} className="space-y-4 pt-4">
                    <div className="flex items-center space-x-2">
                        <input type="radio" id="payFull" name="paymentType" checked={payFull} onChange={() => setPayFull(true)} />
                        <Label htmlFor="payFull">Pagar valor total ({formatCurrency(card.used_limit)})</Label>
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

// Componente da barra de limite (inalterado)
const CreditLimitBar = ({ used, limit }) => {
  const usedPercent = limit > 0 ? (used / limit) * 100 : 0;
  const available = limit - used;

  return (
    <div className="space-y-2 mt-4">
      <Progress value={usedPercent} />
      <div className="text-xs text-muted-foreground grid grid-cols-3 gap-2">
        <div className="text-left">
          <p>Utilizado</p>
          <p className="font-bold text-foreground">{formatCurrency(used)}</p>
        </div>
        <div className="text-center">
          <p>Disponível</p>
          <p className="font-bold text-foreground">{formatCurrency(available)}</p>
        </div>
        <div className="text-right">
          <p>Total</p>
          <p className="font-bold text-foreground">{formatCurrency(limit)}</p>
        </div>
      </div>
    </div>
  );
};

// Componente dos itens da fatura (inalterado)
const InvoiceItems = ({ invoiceId }) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchItems = async () => {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_invoice_items', { p_invoice_id: invoiceId });
            if (error) {
                toast({ title: "Erro ao buscar itens da fatura", description: error.message, variant: "destructive" });
            } else {
                setItems(data);
            }
            setLoading(false);
        };
        if (invoiceId) {
            fetchItems();
        }
    }, [invoiceId, toast]);

    if (loading) return <div className="flex justify-center p-4"><Loader2 className="animate-spin" /></div>;
    if (items.length === 0) return <p className="text-center text-sm text-muted-foreground p-4">Nenhum gasto nesta fatura.</p>;

    return (
        <div className="p-4 bg-background/30">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map(item => (
                        <TableRow key={item.id}>
                            <TableCell>{new Date(item.created_at).toLocaleDateString('pt-BR')}</TableCell>
                            <TableCell>{item.description}</TableCell>
                            <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
};

// Componente principal da aba de cartões
const CardsTab = ({ onUpdate }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [cards, setCards] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFlipped, setIsFlipped] = useState({});
    const [isRequesting, setIsRequesting] = useState(false);
    const [cardToPay, setCardToPay] = useState(null);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [expandedInvoice, setExpandedInvoice] = useState(null);

    // Funções de busca de dados, solicitação e cancelamento (inalteradas)
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data: cardsData, error: cardsError } = await supabase
            .from('cards')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });
        
        if (cardsError) {
            toast({ title: 'Erro ao buscar cartões', description: cardsError.message, variant: 'destructive' });
        } else {
            setCards(cardsData || []);
            if (cardsData && cardsData.length > 0) {
              const cardIds = cardsData.map(c => c.id);
              const { data: invoicesData, error: invoicesError } = await supabase
                .from('card_invoices')
                .select('*')
                .in('card_id', cardIds)
                .order('due_date', { ascending: false });

              if (invoicesError) {
                toast({ title: 'Erro ao buscar faturas', description: invoicesError.message, variant: 'destructive' });
              } else {
                setInvoices(invoicesData || []);
              }
            }
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleRequestCard = async (brand) => {
        setIsRequesting(true);
        try {
            const { data, error } = await supabase.rpc('request_credit_card', { p_card_brand: brand });
            if (error) throw error;
            if (data && !data.success) throw new Error(data.message);
            toast({ title: 'Sucesso', description: data.message });
            fetchData();
            if (onUpdate) onUpdate(true);
        } catch (error) {
            toast({ title: 'Erro ao solicitar cartão', description: error.message, variant: 'destructive' });
        } finally {
            setIsRequesting(false);
        }
    };

    const handleCancelCard = async (cardId) => {
        try {
            const { data, error } = await supabase.rpc('cancel_credit_card', { p_card_id: cardId });
            if (error) throw error;
            if (data && !data.success) {
                toast({ title: 'Ação não permitida', description: data.message, variant: 'destructive' });
                return;
            };
            toast({ title: 'Sucesso', description: data.message });
            fetchData();
            if (onUpdate) onUpdate(true);
        } catch (error) {
            toast({ title: 'Erro ao cancelar cartão', description: error.message, variant: 'destructive' });
        }
    };
    
    const toggleFlip = (cardId) => {
      setIsFlipped(prev => ({ ...prev, [cardId]: !prev[cardId] }));
    };

    const handleOpenPayModal = (card) => {
        setCardToPay(card);
        setIsPayModalOpen(true);
    };

    const handlePaymentSuccess = () => {
        fetchData();
        if (onUpdate) onUpdate(true);
    }

    // Funções de formatação e status (inalteradas)
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
        const texts = { paid: 'Paga', open: 'Aberta', closed: 'Fechada', overdue: 'Vencida' };
        return texts[status] || status;
    }
    
    const getFormattedDate = (day) => {
        let date = setDate(new Date(), day);
        if (new Date().getDate() > day) {
            date = addMonths(date, 1);
        }
        return format(date, 'dd/MMM', { locale: ptBR });
    }

    return (
        <div className="space-y-6">
            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle>Meus Cartões de Crédito</CardTitle>
                    <CardDescription>Visualize e gerencie seus cartões de crédito.</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center items-center h-40">
                            <Loader2 className="animate-spin h-8 w-8 text-primary" />
                        </div>
                    ) : cards.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {cards.map(card => (
                                <div key={card.id}>
                                    {/* /// SUBSTITUIÇÃO ACONTECEU AQUI /// */}
                                    <Cards
                                        number={card.card_number}
                                        expiry={card.expiry_date}
                                        cvc={isFlipped[card.id] ? card.cvv : ''}
                                        name={card.card_holder_name}
                                        focused={isFlipped[card.id] ? 'cvc' : ''}
                                    />
                                    {/* /////////////////////////////////// */}
                                    <div className="mt-4 p-4 bg-background/50 rounded-lg space-y-4">
                                        <div className="flex justify-between items-center">
                                            <p className="font-semibold capitalize">{card.brand} - Final {card.card_number.slice(-4)}</p>
                                            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => toggleFlip(card.id)}>
                                                <RefreshCw className="w-4 h-4" />
                                            </Button>
                                        </div>
                                        
                                        <div className="flex justify-between text-xs text-muted-foreground border-t border-b border-white/10 py-2">
                                           <div className="flex items-center gap-1.5">
                                               <CalendarDays className="w-3.5 h-3.5" />
                                               <span>Fecha em: <strong>{getFormattedDate(card.closing_day)}</strong></span>
                                           </div>
                                            <div className="flex items-center gap-1.5">
                                               <CalendarDays className="w-3.5 h-3.5" />
                                               <span>Vence em: <strong>{getFormattedDate(card.due_day)}</strong></span>
                                           </div>
                                        </div>

                                        <CreditLimitBar used={card.used_limit} limit={card.card_limit} />

                                        <div className="flex gap-2">
                                         {card.used_limit > 0 && (
                                            <Button variant="default" size="sm" onClick={() => handleOpenPayModal(card)}>
                                                <DollarSign className="w-4 h-4 mr-2"/>Pagar Fatura
                                            </Button>
                                         )}
                                         <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="destructive" size="sm">
                                                  <Trash2 className="w-4 h-4 mr-2"/>Cancelar Cartão
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Esta ação não pode ser desfeita. O cartão será cancelado permanentemente.
                                                        Se houver faturas em aberto, elas deverão ser pagas antes do cancelamento.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleCancelCard(card.id)} className="bg-destructive hover:bg-destructive/90">Sim, cancelar</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-8">Você ainda não possui cartões de crédito.</p>
                    )}
                </CardContent>
            </Card>

            {cards.length > 0 && (
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle>Histórico de Faturas</CardTitle>
                  <CardDescription>Visualize o histórico de faturas dos seus cartões.</CardDescription>
                </CardHeader>
                <CardContent>
                   {invoices.length > 0 ? (
                      <Table>
                          <TableHeader>
                              <TableRow>
                                  <TableHead>Cartão</TableHead>
                                  <TableHead>Vencimento</TableHead>
                                  <TableHead>Valor</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead className="text-right">Ações</TableHead>
                              </TableRow>
                          </TableHeader>
                          <TableBody>
                              {invoices.map(invoice => {
                                  const card = cards.find(c => c.id === invoice.card_id);
                                  const isExpanded = expandedInvoice === invoice.id;
                                  return (
                                    <React.Fragment key={invoice.id}>
                                        <TableRow>
                                            <TableCell>{card ? `${card.brand} final ${card.card_number.slice(-4)}` : '-'}</TableCell>
                                            <TableCell>{new Date(invoice.due_date).toLocaleDateString('pt-BR')}</TableCell>
                                            <TableCell>{formatCurrency(invoice.amount)}</TableCell>
                                            <TableCell><Badge variant={getStatusVariant(invoice.status)}>{getStatusText(invoice.status)}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                <Button size="icon" variant="ghost" onClick={() => setExpandedInvoice(isExpanded ? null : invoice.id)}>
                                                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                        {isExpanded && (
                                            <TableRow>
                                                <TableCell colSpan={5} className="p-0">
                                                    <AnimatePresence>
                                                        <motion.div
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: 0.3 }}
                                                            className="overflow-hidden"
                                                        >
                                                            <InvoiceItems invoiceId={invoice.id} />
                                                        </motion.div>
                                                    </AnimatePresence>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                  )
                              })}
                          </TableBody>
                      </Table>
                  ) : (
                      <p className="text-muted-foreground text-center py-8">Nenhuma fatura encontrada.</p>
                  )}
                </CardContent>
              </Card>
            )}

             {cards.length < 2 && (
                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle>Solicitar Novo Cartão</CardTitle>
                        <CardDescription>Escolha a bandeira e solicite um novo cartão de crédito com limite pré-aprovado.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col sm:flex-row gap-4">
                        <Button onClick={() => handleRequestCard('visa')} disabled={isRequesting || cards.some(c => c.brand.toLowerCase() === 'visa')}>
                            {isRequesting && <Loader2 className="animate-spin mr-2 h-4 w-4"/>}
                            <CreditCard className="mr-2 h-4 w-4"/> Solicitar Cartão Visa
                        </Button>
                         <Button onClick={() => handleRequestCard('mastercard')} disabled={isRequesting || cards.some(c => c.brand.toLowerCase() === 'mastercard')}>
                            {isRequesting && <Loader2 className="animate-spin mr-2 h-4 w-4"/>}
                            <CreditCard className="mr-2 h-4 w-4"/> Solicitar Cartão Mastercard
                        </Button>
                    </CardContent>
                </Card>
            )}
             <PayInvoiceDialog 
                isOpen={isPayModalOpen}
                setIsOpen={setIsPayModalOpen}
                card={cardToPay}
                onPaymentSuccess={handlePaymentSuccess}
            />
        </div>
    );
};

export default CardsTab;