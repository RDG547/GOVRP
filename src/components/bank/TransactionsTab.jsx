import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { ArrowUpRight, ArrowDownLeft, Banknote, ShoppingCart, Landmark, Coins as HandCoins, Repeat, Loader2, ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReceiptDownloadDialog from './ReceiptDownloadDialog';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '../ui/use-toast';

const TransactionRow = ({ transaction, onShowReceipt }) => {
    const isSent = transaction.direction === 'sent';
    const isExchange = transaction.type === 'exchange';

    const getTransactionTypeDetails = (type) => {
        switch (type) {
            case 'transfer':
                if (isSent) {
                    return { icon: ArrowUpRight, text: 'Transferência Enviada' };
                } else {
                    return { icon: ArrowDownLeft, text: 'Transferência Recebida' };
                }
            case 'deposit':
                return { icon: ArrowDownLeft, text: 'Depósito' };
            case 'withdrawal':
                return { icon: ArrowUpRight, text: 'Saque' };
            case 'purchase':
            case 'purchase_card':
                return { icon: ShoppingCart, text: 'Compra' };
            case 'subscription_payment':
            case 'subscription_payment_card':
                return { icon: Repeat, text: 'Assinatura' };
            case 'service_fee':
                return { icon: Landmark, text: 'Taxa de Serviço' };
            case 'investment_application':
                return { icon: HandCoins, text: 'Investimento' };
            case 'investment_withdrawal':
                return { icon: Banknote, text: 'Resgate' };
            case 'admin_credit':
                return { icon: ArrowDownLeft, text: 'Crédito Admin' };
            case 'admin_debit':
                return { icon: ArrowUpRight, text: 'Débito Admin' };
            case 'exchange':
                return { icon: ArrowRightLeft, text: 'Câmbio' };
            default:
                return { icon: Banknote, text: 'Transação' };
        }
    };

    const { icon: Icon, text: typeText } = getTransactionTypeDetails(transaction.type);

    const getFullDescription = () => {
        if (transaction.type === 'transfer') {
            if (isSent) return `Para: ${transaction.other_party_name || 'Desconhecido'}`;
            return `De: ${transaction.other_party_name || 'Desconhecido'}`;
        }
        
        if (transaction.metadata?.platform) {
            return `Compra em ${transaction.metadata.platform}`;
        }
        return transaction.description || '';
    };
    
    const getBadgeVariant = () => {
        if (isExchange) return 'secondary';
        return isSent ? 'destructive' : 'success';
    };

    return (
        <TableRow className="flex flex-col sm:table-row p-4 sm:p-0 border-b last:border-b-0">
            <TableCell className="p-0 sm:p-4 font-medium flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isExchange ? 'bg-blue-500/10 text-blue-500' :
                        isSent ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                    }`}>
                        <Icon className="w-5 h-5" />
                    </div>
                    <div>
                        <p className="font-bold">{typeText}</p>
                        <p className="text-xs text-muted-foreground">{getFullDescription()}</p>
                    </div>
                </div>
                 <Button variant="outline" size="sm" className="sm:hidden" onClick={() => onShowReceipt(transaction.id)}>Ver Comprovante</Button>
            </TableCell>
            <TableCell className="p-0 sm:p-4 mt-2 sm:mt-0 flex justify-between items-center sm:table-cell sm:text-right">
                <span className="sm:hidden text-muted-foreground text-xs">Valor</span>
                <Badge variant={getBadgeVariant()} className="font-mono text-sm">
                    {isExchange ? '' : (isSent ? '-' : '+')} {formatCurrency(transaction.amount)}
                </Badge>
            </TableCell>
            <TableCell className="p-0 sm:p-4 mt-2 sm:mt-0 flex justify-between items-center sm:table-cell sm:text-right text-muted-foreground">
                <span className="sm:hidden text-muted-foreground text-xs">Data</span>
                <div className="text-right">
                    <div>{new Date(transaction.created_at).toLocaleDateString('pt-BR')}</div>
                    <div className="text-xs text-muted-foreground">{new Date(transaction.created_at).toLocaleTimeString('pt-BR')}</div>
                </div>
            </TableCell>
             <TableCell className="p-0 sm:p-4 text-right hidden sm:table-cell">
                <Button variant="outline" size="sm" onClick={() => onShowReceipt(transaction.id)}>Ver Comprovante</Button>
            </TableCell>
        </TableRow>
    );
};

const TransactionsTab = ({ transactions }) => {
    const { toast } = useToast();
    const [selectedReceipt, setSelectedReceipt] = useState(null);
    const [loadingReceipt, setLoadingReceipt] = useState(false);

    const handleShowReceipt = async (transactionId) => {
        setLoadingReceipt(true);
        const { data, error } = await supabase.rpc('generate_transaction_receipt', {
            p_transaction_id: transactionId
        });

        if (error || !data.success) {
            toast({
                title: 'Erro',
                description: data?.message || error?.message || 'Não foi possível gerar o comprovante.',
                variant: 'destructive',
            });
        } else {
            setSelectedReceipt(data);
        }
        setLoadingReceipt(false);
    };
    
    return (
        <>
        <Card className="glass-effect overflow-hidden">
            <CardHeader>
                <CardTitle>Extrato de Transações</CardTitle>
                <CardDescription>Suas movimentações mais recentes.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader className="hidden sm:table-header-group">
                            <TableRow>
                                <TableHead>Descrição</TableHead>
                                <TableHead className="text-right">Valor</TableHead>
                                <TableHead className="text-right">Data</TableHead>
                                <TableHead className="w-[150px] text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loadingReceipt && (
                                <TableRow>
                                    <TableCell colSpan="4" className="text-center py-8">
                                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                                    </TableCell>
                                </TableRow>
                            )}
                            {transactions && transactions.length > 0 ? (
                                transactions.map(tx => <TransactionRow key={tx.id} transaction={tx} onShowReceipt={handleShowReceipt}/>)
                            ) : (
                                <TableRow>
                                    <TableCell colSpan="4" className="text-center text-muted-foreground py-8">
                                        Nenhuma transação encontrada.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
        <ReceiptDownloadDialog 
            receipt={selectedReceipt} 
            onBack={() => setSelectedReceipt(null)}
        />
        </>
    );
};

export default TransactionsTab;