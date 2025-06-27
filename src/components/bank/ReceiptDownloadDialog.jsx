import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from '@/components/ui/button';
import { Loader2, Download, FileText, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatCurrency } from '@/lib/utils';

const TransactionReceipt = React.forwardRef(({ receipt }, ref) => {
    if (!receipt) return null;

    return (
        <div ref={ref} className="bg-slate-800 text-white p-8 font-sans">
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold">GOV.RP - Banco Nacional</h2>
                <p className="text-lg">Comprovante de Transação</p>
            </div>
            <div className="border-t border-b border-slate-600 py-4 my-4">
                <div className="flex justify-between py-2">
                    <span className="text-slate-400">Tipo de Transação:</span>
                    <span className="font-semibold">{receipt.description || 'Transferência'}</span>
                </div>
                <div className="flex justify-between py-2">
                    <span className="text-slate-400">Valor:</span>
                    <span className="font-bold text-2xl text-green-400">{formatCurrency(receipt.amount * 100)}</span>
                </div>
                <div className="flex justify-between py-2">
                    <span className="text-slate-400">Data e Hora:</span>
                    <span className="font-semibold">{new Date(receipt.created_at).toLocaleString('pt-BR')}</span>
                </div>
                <div className="flex justify-between py-2">
                    <span className="text-slate-400">ID da Transação:</span>
                    <span className="font-mono text-xs">{receipt.id}</span>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-8">
                <div>
                    <h3 className="font-bold text-lg mb-2 text-slate-300">Remetente</h3>
                    <p>{receipt.sender_name}</p>
                    <p className="text-sm text-slate-400">Chave: {receipt.sender_key}</p>
                </div>
                <div>
                    <h3 className="font-bold text-lg mb-2 text-slate-300">Destinatário</h3>
                    <p>{receipt.recipient_name}</p>
                    <p className="text-sm text-slate-400">Chave: {receipt.recipient_key}</p>
                </div>
            </div>
        </div>
    );
});

const ReceiptDownloadDialog = ({ isOpen, setIsOpen, transactionId }) => {
    const { toast } = useToast();
    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const receiptRef = useRef();

    useEffect(() => {
        if (isOpen && transactionId) {
            const fetchReceipt = async () => {
                setLoading(true);
                const { data, error } = await supabase.rpc('generate_transaction_receipt', { p_transaction_id: transactionId });
                if (error || !data.success) {
                    toast({ title: "Erro", description: data?.message || "Não foi possível carregar o comprovante.", variant: "destructive" });
                    setIsOpen(false);
                } else {
                    setReceipt(data);
                }
                setLoading(false);
            };
            fetchReceipt();
        }
    }, [isOpen, transactionId, toast, setIsOpen]);

    const handleDownload = async (format) => {
        if (!receiptRef.current) return;
        setIsDownloading(true);
        try {
            const canvas = await html2canvas(receiptRef.current, { scale: 2, backgroundColor: '#1E293B' });
            const imgData = canvas.toDataURL('image/png');

            if (format === 'png') {
                const link = document.createElement('a');
                link.download = `comprovante-${transactionId}.png`;
                link.href = imgData;
                link.click();
            } else {
                const pdf = new jsPDF({
                    orientation: 'portrait',
                    unit: 'px',
                    format: [canvas.width, canvas.height]
                });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save(`comprovante-${transactionId}.pdf`);
            }
        } catch (err) {
            toast({ title: "Erro no Download", description: "Não foi possível gerar o arquivo.", variant: "destructive" });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Comprovante de Transação</DialogTitle>
                    <DialogDescription>Visualize e baixe o comprovante da sua transação.</DialogDescription>
                </DialogHeader>
                {loading ? (
                    <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>
                ) : (
                    <div className="my-4">
                        <TransactionReceipt ref={receiptRef} receipt={receipt} />
                    </div>
                )}
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => handleDownload('png')} disabled={isDownloading || loading}>
                        {isDownloading ? <Loader2 className="animate-spin mr-2" /> : <ImageIcon className="mr-2 h-4 w-4" />} Baixar PNG
                    </Button>
                    <Button onClick={() => handleDownload('pdf')} disabled={isDownloading || loading}>
                        {isDownloading ? <Loader2 className="animate-spin mr-2" /> : <FileText className="mr-2 h-4 w-4" />} Baixar PDF
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ReceiptDownloadDialog;