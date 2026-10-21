import {CurrencyInput} from '@/components/ui/currency-input';
import { formatLocaleBR } from '@/lib/dateTime';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { bankRealtimeTables } from '@/lib/bankRealtime';
import { CARD_SECTIONS, bankSectionsForEvents, fetchBankSections } from '@/lib/bankData';
import { useSectionLoader } from '@/hooks/use-section-loader';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Loader2, Trash2, ArrowLeft, CreditCard, RefreshCw, CalendarDays, DollarSign, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Clock, XCircle, CheckCircle } from 'lucide-react';
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
import CardBrandLogo from './CardBrandLogo';

const ResponsiveBankCard = ({ children }) => {
    const frame = useRef(null);
    const [width, setWidth] = useState(290);
    useEffect(() => {
        const observer = new ResizeObserver(([entry]) => setWidth(Math.min(290, entry.contentRect.width)));
        observer.observe(frame.current);
        return () => observer.disconnect();
    }, []);
    return <div ref={frame} className="relative mx-auto w-full max-w-[290px] overflow-hidden" style={{ height: width * 183 / 290 }}><div className="w-[290px] origin-top-left" style={{ transform: `scale(${width / 290})` }}>{children}</div></div>;
};

const INVOICES_PER_PAGE = 5;

const normalizeCardBrand = (brand = '') => brand.trim().toLowerCase();

const getCardBrandLabel = (brand) => {
  const normalizedBrand = normalizeCardBrand(brand);
  if (normalizedBrand === 'visa') return 'Visa';
  if (normalizedBrand === 'mastercard') return 'Mastercard';
  return brand || 'Cartão';
};

// Componente para pagar a fatura (inalterado)
const PayInvoiceDialog = ({ isOpen, setIsOpen, card, onPaymentSuccess }) => {
    const { toast } = useToast();
    const [amount, setAmount] = useState('');
    const [payFull, setPayFull] = useState(true);
    const paymentKey=useRef(null);
    useEffect(()=>{if(isOpen)paymentKey.current=crypto.randomUUID();},[isOpen]);
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
            p_idempotency_key: paymentKey.current,
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
                <DialogHeader className="text-center sm:text-center">
                    <DialogTitle>Pagamento Antecipado de Fatura</DialogTitle>
                    <DialogDescription>Pague o valor utilizado no seu cartão {card.brand} final {card.card_number.slice(-4)}.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handlePay} className="space-y-4 pt-4">
                    <div className="flex items-center justify-center space-x-2">
                        <input type="radio" id="payFull" name="paymentType" checked={payFull} onChange={() => setPayFull(true)} />
                        <Label htmlFor="payFull">Pagar valor total ({formatCurrency(card.used_limit)})</Label>
                    </div>
                    <div className="flex items-center justify-center space-x-2">
                        <input type="radio" id="payPartial" name="paymentType" checked={!payFull} onChange={() => setPayFull(false)} />
                        <Label htmlFor="payPartial">Pagar outro valor</Label>
                    </div>
                    {!payFull && (
                        <div>
                            <Label htmlFor="amount">Valor a pagar</Label>
                            <CurrencyInput id="amount" value={amount} onChange={(e) => setAmount(formatCurrency(e.target.value, true))} placeholder="R$ 0,00" />
                        </div>
                    )}
                    <DialogFooter className="justify-center sm:justify-center">
                        <Button type="submit" disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4"/>}Confirmar Pagamento</Button>
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
const InvoiceItems = ({ invoiceId, revision }) => {
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
    }, [invoiceId, revision, toast]);

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
                            <TableCell>{formatLocaleBR(new Date(item.created_at), 'toLocaleDateString', 'pt-BR')}</TableCell>
                            <TableCell>{item.description}{item.charge_type&&<p className="text-xs text-muted-foreground">{({late_interest:'Juros por atraso',financing_interest:'Financiamento da fatura',late_fee:'Multa por atraso',additional_charge:'Encargo adicional',legacy_interest:'Encargo histórico'})[item.charge_type]}{item.rate_snapshot!=null&&` · Taxa: ${Number(item.rate_snapshot).toLocaleString('pt-BR')}%`}{item.base_amount!=null&&` · Base: ${formatCurrency(item.base_amount)}`}</p>}</TableCell>
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
    const [cancelingCard, setCancelingCard] = useState(null);
    const [invoices, setInvoices] = useState([]);
    const [cardApplications, setCardApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFlipped, setIsFlipped] = useState({});
    const [isRequesting, setIsRequesting] = useState(false);
    const [cardToPay, setCardToPay] = useState(null);
    const [isPayModalOpen, setIsPayModalOpen] = useState(false);
    const [expandedInvoice, setExpandedInvoice] = useState(null);
    const [invoiceBrand, setInvoiceBrand] = useState('');
    const [invoicePage, setInvoicePage] = useState(1);

    const [itemRevisions, setItemRevisions] = useState({});
    const refreshSections = useSectionLoader(user?.id,
        sections => fetchBankSections(supabase, user.id, sections),
        ({ values, errors }) => {
            if ('cards' in values) setCards(values.cards || []);
            if ('invoices' in values) setInvoices(values.invoices || []);
            if ('cardApplications' in values) setCardApplications(values.cardApplications || []);
            if (errors.length) toast({ title: 'Não foi possível atualizar os cartões', description: 'Tente novamente para consultar os dados mais recentes.', variant: 'destructive' });
            setLoading(false);
        }, () => setLoading(false),
    );
    const fetchData = useCallback(() => refreshSections(CARD_SECTIONS), [refreshSections]);
    useEffect(() => {
        setCards([]); setInvoices([]); setCardApplications([]); setItemRevisions({}); setLoading(true);
        const load = async () => {
            await supabase.rpc('close_due_invoices');
            await fetchData();
        };
        void load().catch(() => setLoading(false));
    }, [fetchData]);
    useDomainRealtime('bank', user?.id, bankRealtimeTables(user?.id), events => {
        void refreshSections(bankSectionsForEvents(events, CARD_SECTIONS));
        const changed = events.filter(event => event.table === 'card_invoice_items');
        if (changed.length || events.some(event => event.eventType === 'SYNC')) setItemRevisions(previous => {
            const next = { ...previous };
            for (const event of changed) {
                const invoiceId = event.new?.invoice_id || event.old?.invoice_id;
                if (invoiceId) next[invoiceId] = (next[invoiceId] || 0) + 1;
            }
            if (events.some(event => event.eventType === 'SYNC' || (event.eventType === 'DELETE' && !event.old?.invoice_id))) next.all = (next.all || 0) + 1;
            return next;
        });
    }, Boolean(user?.id));

    useEffect(() => {
        const availableBrands = [...new Set(cards.map((card) => normalizeCardBrand(card.brand)).filter(Boolean))];
        setInvoiceBrand((currentBrand) => (
            availableBrands.includes(currentBrand) ? currentBrand : (availableBrands[0] || '')
        ));
    }, [cards]);

    useEffect(() => {
        setInvoicePage(1);
        setExpandedInvoice(null);
    }, [invoiceBrand]);

    const handleRequestCard = async (brand) => {
        setIsRequesting(true);
        try {
            const normalizedBrand = brand.toLowerCase();
            const hasExistingCard = cards.some((card) => card.brand.toLowerCase() === normalizedBrand);
            const hasPendingRequest = cardApplications.some((application) =>
                application.brand?.toLowerCase() === normalizedBrand &&
                ['Pendente', 'pending'].includes(application.status)
            );

            if (hasExistingCard || hasPendingRequest) {
                throw new Error('Você já possui ou solicitou um cartão desta bandeira.');
            }

            const { error } = await supabase
                .from('credit_card_applications')
                .insert({
                    user_id: user.id,
                    brand: normalizedBrand,
                    status: 'Pendente',
                });
            if (error) throw error;
            toast({ title: 'Solicitação enviada', description: 'O Banco Nacional analisará seu pedido de cartão.' });
            await refreshSections(['cardApplications']);
        } catch (error) {
            toast({ title: 'Erro ao solicitar cartão', description: error.message, variant: 'destructive' });
        } finally {
            setIsRequesting(false);
        }
    };

    const handleCancelCard = async (cardId) => {
        if (cancelingCard) return;
        setCancelingCard(cardId);
        try {
            const { data, error } = await supabase.rpc('cancel_credit_card', { p_card_id: cardId });
            if (error) throw error;
            if (data && !data.success) {
                toast({ title: 'Ação não permitida', description: data.message, variant: 'destructive' });
                return;
            };
            toast({ title: 'Sucesso', description: data.message });
            await refreshSections(['cards', 'invoices']);
            if (onUpdate) onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao cancelar cartão', description: error.message, variant: 'destructive' });
        } finally { setCancelingCard(null); }
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
        const texts = { paid: 'Quitada', open: 'Aberta', closed: 'Fechada', overdue: 'Vencida' };
        return texts[status] || status;
    }

    const getApplicationStatusIcon = (status) => {
      if (['Aprovado', 'approved'].includes(status)) return <CheckCircle className="w-4 h-4 text-green-400" />;
      if (['Rejeitado', 'rejected'].includes(status)) return <XCircle className="w-4 h-4 text-red-400" />;
      return <Clock className="w-4 h-4 text-yellow-400" />;
    };

    const getApplicationBadgeClass = (status) => {
      if (['Aprovado', 'approved'].includes(status)) return 'border-green-500/30 bg-green-500/15 text-green-300';
      if (['Rejeitado', 'rejected'].includes(status)) return 'border-red-500/30 bg-red-500/15 text-red-300';
      return 'border-yellow-500/30 bg-yellow-500/15 text-yellow-300';
    };

    const getFormattedDate = (day) => {
        let date = setDate(new Date(), day);
        if (new Date().getDate() > day) {
            date = addMonths(date, 1);
        }
        return format(date, 'dd/MMM', { locale: ptBR });
    }

    const pendingCardApplications = cardApplications.filter((application) => ['Pendente', 'pending'].includes(application.status));
    const canRequestMoreCards = cards.length + pendingCardApplications.length < 2;
    const availableInvoiceBrands = [...new Set(cards.map((card) => normalizeCardBrand(card.brand)).filter(Boolean))];
    const selectedInvoiceCardIds = new Set(
        cards
            .filter((card) => normalizeCardBrand(card.brand) === invoiceBrand)
            .map((card) => card.id)
    );
    const selectedCardInvoices = invoices.filter((invoice) => selectedInvoiceCardIds.has(invoice.card_id));
    const totalInvoicePages = Math.max(1, Math.ceil(selectedCardInvoices.length / INVOICES_PER_PAGE));
    const safeInvoicePage = Math.min(invoicePage, totalInvoicePages);
    const paginatedInvoices = selectedCardInvoices.slice(
        (safeInvoicePage - 1) * INVOICES_PER_PAGE,
        safeInvoicePage * INVOICES_PER_PAGE
    );

    useEffect(() => {
        setInvoicePage((currentPage) => Math.min(currentPage, totalInvoicePages));
    }, [totalInvoicePages]);

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
                                <div key={card.id} className="min-w-0">
                                    <ResponsiveBankCard>
                                    <Cards
                                        preview
                                        issuer={['visa','mastercard'].includes(normalizeCardBrand(card.brand)) ? normalizeCardBrand(card.brand) : 'unknown'}
                                        number={card.card_number}
                                        expiry={card.expiry_date}
                                        cvc={isFlipped[card.id] ? card.cvv : ''}
                                        name={card.card_holder_name}
                                        focused={isFlipped[card.id] ? 'cvc' : ''}
                                    />
                                    </ResponsiveBankCard>
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
                                                <AlertDialogHeader className="items-center text-center sm:text-center">
                                                    <CreditCard className="h-10 w-10 text-destructive" aria-hidden="true"/>
                                                    <AlertDialogTitle>Cancelar cartão {getCardBrandLabel(card.brand)}</AlertDialogTitle>
                                                    <AlertDialogDescription>
                                                        Final {String(card.card_number).slice(-4)}. Esta ação não pode ser desfeita. O cartão será cancelado permanentemente.
                                                        Se houver faturas em aberto, elas deverão ser pagas antes do cancelamento.
                                                    </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter className="sm:justify-center">
                                                    <AlertDialogCancel disabled={Boolean(cancelingCard)}><ArrowLeft className="mr-2 h-4 w-4"/>Voltar</AlertDialogCancel>
                                                    <AlertDialogAction disabled={Boolean(cancelingCard)} onClick={event => { event.preventDefault(); void handleCancelCard(card.id); }} className="bg-destructive hover:bg-destructive/90">{cancelingCard === card.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Trash2 className="mr-2 h-4 w-4"/>}Sim, Cancelar</AlertDialogAction>
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
                  <CardDescription>Visualize até 5 faturas por página para cada cartão.</CardDescription>
                </CardHeader>
                <CardContent>
                   <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                       <div className="flex flex-wrap gap-2" role="tablist" aria-label="Alternar bandeira das faturas">
                           {availableInvoiceBrands.map((brand) => (
                               <Button
                                   key={brand}
                                   type="button"
                                   size="sm"
                                   variant={invoiceBrand === brand ? 'default' : 'outline'}
                                   role="tab"
                                   aria-selected={invoiceBrand === brand}
                                   onClick={() => setInvoiceBrand(brand)}
                               >
                                   <CardBrandLogo brand={brand} className="mr-2 h-5 w-7" />
                                   {getCardBrandLabel(brand)}
                               </Button>
                           ))}
                       </div>
                       {selectedCardInvoices.length > 0 && (
                           <span className="text-xs text-muted-foreground">
                               {selectedCardInvoices.length} {selectedCardInvoices.length === 1 ? 'fatura' : 'faturas'} em {getCardBrandLabel(invoiceBrand)}
                           </span>
                       )}
                   </div>
                   {paginatedInvoices.length > 0 ? (
                      <>
                        <Table page={invoicePage}>
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
                              {paginatedInvoices.map(invoice => {
                                  const card = cards.find(c => c.id === invoice.card_id);
                                  const isExpanded = expandedInvoice === invoice.id;
                                  return (
                                    <React.Fragment key={invoice.id}>
                                        <TableRow>
                                            <TableCell>{card ? `${card.brand} final ${card.card_number.slice(-4)}` : '-'}</TableCell>
                                            <TableCell>{formatLocaleBR(new Date(invoice.due_date), 'toLocaleDateString', 'pt-BR')}</TableCell>
                                            <TableCell>{formatCurrency(invoice.amount)}<p className="text-xs text-muted-foreground">Compras: {formatCurrency(invoice.charges_total??invoice.amount)} · Pagamentos: {formatCurrency(invoice.payments_total||0)}</p></TableCell>
                                            <TableCell><Badge variant={getStatusVariant(Number(invoice.amount)<=0?'paid':invoice.status)}>{getStatusText(Number(invoice.amount)<=0?'paid':invoice.status)}</Badge></TableCell>
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
                                                            <InvoiceItems revision={`${invoice.amount}:${invoice.status}:${invoice.updated_at}:${itemRevisions[invoice.id] || 0}:${itemRevisions.all || 0}`} invoiceId={invoice.id} />
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
                        {totalInvoicePages > 1 && (
                            <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Paginação do histórico de faturas">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setInvoicePage((page) => Math.max(1, page - 1));
                                        setExpandedInvoice(null);
                                    }}
                                    disabled={safeInvoicePage === 1}
                                >
                                    <ChevronLeft className="mr-1 h-4 w-4" />Anterior
                                </Button>
                                <span className="min-w-24 text-center text-sm text-muted-foreground">
                                    Página {safeInvoicePage} de {totalInvoicePages}
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        setInvoicePage((page) => Math.min(totalInvoicePages, page + 1));
                                        setExpandedInvoice(null);
                                    }}
                                    disabled={safeInvoicePage === totalInvoicePages}
                                >
                                    Próxima<ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </nav>
                        )}
                      </>
                  ) : (
                      <p className="text-muted-foreground text-center py-8">
                          Nenhuma fatura encontrada para o cartão {getCardBrandLabel(invoiceBrand)}.
                      </p>
                  )}
                </CardContent>
              </Card>
            )}

            {cardApplications.length > 0 && (
                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle>Solicitações de Cartão</CardTitle>
                        <CardDescription>Acompanhe a análise dos seus pedidos junto ao Banco Nacional.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {cardApplications.map((application) => (
                            <div key={application.id} className="flex flex-col gap-3 rounded-lg bg-slate-800/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="font-semibold capitalize">Cartão {application.brand}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Solicitado em {formatLocaleBR(new Date(application.created_at), 'toLocaleDateString', 'pt-BR')}
                                    </p>
                                    {application.feedback ? <p className="mt-1 text-xs text-muted-foreground">Feedback: {application.feedback}</p> : null}
                                </div>
                                <Badge className={`w-fit gap-1 border ${getApplicationBadgeClass(application.status)}`}>
                                    {getApplicationStatusIcon(application.status)}
                                    {application.status}
                                </Badge>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

             {canRequestMoreCards && (
                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle>Solicitar Novo Cartão</CardTitle>
                        <CardDescription>Escolha a bandeira e envie o pedido para análise do Banco Nacional.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col sm:flex-row gap-4">
                        <Button onClick={() => handleRequestCard('visa')} disabled={isRequesting || cards.some(c => c.brand.toLowerCase() === 'visa') || pendingCardApplications.some(c => c.brand?.toLowerCase() === 'visa')}>
                            {isRequesting && <Loader2 className="animate-spin mr-2 h-4 w-4"/>}
                            <CardBrandLogo brand="visa" className="mr-2 h-5 w-7" /> Solicitar Cartão Visa
                        </Button>
                         <Button onClick={() => handleRequestCard('mastercard')} disabled={isRequesting || cards.some(c => c.brand.toLowerCase() === 'mastercard') || pendingCardApplications.some(c => c.brand?.toLowerCase() === 'mastercard')}>
                            {isRequesting && <Loader2 className="animate-spin mr-2 h-4 w-4"/>}
                            <CardBrandLogo brand="mastercard" className="mr-2 h-5 w-7" /> Solicitar Cartão Mastercard
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
