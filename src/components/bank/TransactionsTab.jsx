import React, { useState, useCallback } from 'react';
import { ArrowUp, ArrowDown, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReceiptDownloadDialog from './ReceiptDownloadDialog';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';

const TransactionsTab = ({ transactions, accountId }) => {
    const [selectedReceipt, setSelectedReceipt] = useState(null);
    const [isReceiptOpen, setIsReceiptOpen] = useState(false);
    const { toast } = useToast();

    const handleReceiptClick = useCallback(async (txId) => {
        const { data, error } = await supabase.rpc('generate_transaction_receipt', { p_transaction_id: txId });
        if (error || !data.success) {
            toast({ title: "Erro", description: error?.message || data?.message, variant: "destructive" });
        } else {
            setSelectedReceipt(data);
            setIsReceiptOpen(true);
        }
    }, [toast]);

    const getTransactionTypeLabel = (type) => {
        const labels = {
            transfer: 'Transferência',
            purchase: 'Compra',
            service_fee: 'Taxa de Serviço',
            investment_application: 'Aplicação',
            investment_withdrawal: 'Resgate',
            admin_credit: 'Crédito Admin',
            admin_debit: 'Débito Admin',
        };
        return labels[type] || 'Transação';
    };

    return (
        <>
            <div className="bg-black/20 rounded-2xl p-6 mt-4">
                <h3 className="text-xl font-bold text-white mb-4">Últimas Transações</h3>
                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                    {transactions.length > 0 ? transactions.map(tx => (
                        <div key={tx.id} className="flex justify-between items-center p-3 rounded-lg hover:bg-white/5 transition-colors">
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.to_account_id === accountId ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                    {tx.to_account_id === accountId ? <ArrowDown className="w-5 h-5 text-green-400" /> : <ArrowUp className="w-5 h-5 text-red-400" />}
                                </div>
                                <div>
                                    <p className="font-semibold text-white">{getTransactionTypeLabel(tx.type)}</p>
                                    <p className="text-sm text-gray-400">{tx.description || new Date(tx.created_at).toLocaleString('pt-BR')}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <p className={`font-bold text-lg ${tx.to_account_id === accountId ? 'text-green-400' : 'text-red-400'}`}>
                                    {tx.to_account_id === accountId ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tx.amount)}
                                </p>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleReceiptClick(tx.id)}>
                                    <Download className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )) : (
                        <p className="text-gray-400 text-center py-8">Nenhuma transação recente.</p>
                    )}
                </div>
            </div>
            {selectedReceipt && (
                <ReceiptDownloadDialog 
                    isOpen={isReceiptOpen}
                    setIsOpen={setIsReceiptOpen}
                    receipt={selectedReceipt}
                />
            )}
        </>
    );
};

export default TransactionsTab;