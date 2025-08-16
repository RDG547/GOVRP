import React, { useRef } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Share2, ArrowLeft } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/components/ui/use-toast';
import { formatCPF } from '@/lib/utils';

const formatCurrency = (value) => {
  if (value === null || value === undefined) return 'N/A';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const getTransactionTypeInPortuguese = (type) => {
    const types = {
        transfer: 'Transferência',
        purchase: 'Compra',
        service_fee: 'Taxa de Serviço',
        investment_application: 'Aplicação em Investimento',
        investment_withdrawal: 'Resgate de Investimento',
        admin_credit: 'Crédito Administrativo',
        admin_debit: 'Débito Administrativo',
    };
    return types[type] || type;
};

const ReceiptContent = React.forwardRef(({ receipt, onBack }, ref) => {
    if (!receipt) return null;
    
    return (
        <div ref={ref} className="bg-background text-foreground font-sans text-sm w-full max-w-md mx-auto">
            <header className="text-center mb-6 p-6 border-b border-border relative">
                <Button variant="ghost" onClick={onBack} className="absolute top-4 left-4"><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
                <h1 className="text-2xl font-bold text-primary">GOV.RP Bank</h1>
                <p className="text-muted-foreground">Comprovante de Transação</p>
            </header>

            <div className="px-6 space-y-4">
                <div className="border-b border-dashed border-border pb-4">
                    <p className="flex justify-between"><span>Tipo:</span> <span className="font-semibold">{getTransactionTypeInPortuguese(receipt.type)}</span></p>
                    <p className="flex justify-between"><span>Data:</span> <span className="font-semibold">{format(new Date(receipt.created_at), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR })}</span></p>
                    <p className="flex justify-between items-start"><span className="flex-shrink-0 mr-2">ID Transação:</span> <span className="font-mono text-xs break-all text-right">{receipt.id}</span></p>
                </div>

                <div className="border-b border-dashed border-border pb-4 text-center">
                    <p className="text-muted-foreground">Valor da Transação</p>
                    <p className="text-4xl font-bold text-primary">{formatCurrency(receipt.amount)}</p>
                </div>

                {receipt.sender_name && (
                    <div className="border-b border-dashed border-border pb-4">
                        <h2 className="font-bold mb-2">Remetente</h2>
                        <p className="flex justify-between"><span>Nome:</span> <span>{receipt.sender_name}</span></p>
                        <p className="flex justify-between"><span>CPF:</span> <span className="font-mono">{formatCPF(receipt.sender_cpf)}</span></p>
                        <p className="flex justify-between"><span>Ag / Conta:</span> <span className="font-mono">{receipt.sender_agency} / {receipt.sender_account}</span></p>
                        {receipt.sender_key && <p className="flex justify-between"><span>Chave:</span> <span className="font-mono font-semibold">{receipt.sender_key}</span></p>}
                    </div>
                )}
                
                {receipt.recipient_name && (
                    <div className="border-b border-dashed border-border pb-4">
                        <h2 className="font-bold mb-2">Destinatário</h2>
                        <p className="flex justify-between"><span>Nome:</span> <span>{receipt.recipient_name}</span></p>
                        <p className="flex justify-between"><span>CPF:</span> <span className="font-mono">{formatCPF(receipt.recipient_cpf)}</span></p>
                        <p className="flex justify-between"><span>Ag / Conta:</span> <span className="font-mono">{receipt.recipient_agency} / {receipt.recipient_account}</span></p>
                        {receipt.recipient_key && <p className="flex justify-between"><span>Chave:</span> <span className="font-mono font-semibold">{receipt.recipient_key}</span></p>}
                    </div>
                )}
                 
                {receipt.description && (
                     <div className="pb-4">
                        <h2 className="font-bold mb-2">Descrição</h2>
                        <p className="text-muted-foreground">{receipt.description}</p>
                    </div>
                )}
            </div>
            
            <footer className="text-center mt-6 p-6 text-xs text-muted-foreground">
                <p>Este é um comprovante gerado pelo sistema. Autenticidade pode ser verificada com o ID da transação.</p>
                <p>&copy; {new Date().getFullYear()} GOV.RP Bank. Todos os direitos reservados.</p>
            </footer>
        </div>
    );
});

const ReceiptDownloadDialog = ({ receipt, isOpen, setIsOpen }) => {
    const receiptRef = useRef();
    const { toast } = useToast();

    const handleDownload = (format) => {
        if (!receiptRef.current) return;
        html2canvas(receiptRef.current, { scale: 2, backgroundColor: '#020817' }).then(canvas => {
            if (format === 'png') {
                const image = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = image;
                link.download = `comprovante-${receipt.id}.png`;
                link.click();
            } else if (format === 'pdf') {
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF('p', 'mm', 'a4');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const canvasWidth = canvas.width;
                const canvasHeight = canvas.height;
                const ratio = canvasWidth / canvasHeight;
                const width = pdfWidth;
                const height = width / ratio;
                pdf.addImage(imgData, 'PNG', 0, 0, width, height);
                pdf.save(`comprovante-${receipt.id}.pdf`);
            }
        });
    };

    const handleShare = async () => {
        if (!receiptRef.current) return;
        try {
            const canvas = await html2canvas(receiptRef.current, { scale: 2, backgroundColor: '#020817' });
            canvas.toBlob(async (blob) => {
                if (navigator.canShare && navigator.canShare({ files: [new File([blob], 'receipt.png', { type: 'image/png' })] })) {
                    try {
                        await navigator.share({
                            files: [new File([blob], `comprovante-${receipt.id}.png`, { type: 'image/png' })],
                            title: 'Comprovante de Transação',
                            text: `Comprovante da transação de ${formatCurrency(receipt.amount)}`,
                        });
                    } catch (error) {
                        if (error.name !== 'AbortError') {
                           toast({ title: "Erro ao compartilhar", description: "Não foi possível compartilhar o comprovante.", variant: "destructive" });
                        }
                    }
                } else {
                    toast({ title: "Não suportado", description: "Seu navegador não suporta o compartilhamento de arquivos.", variant: "destructive" });
                }
            }, 'image/png');
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível gerar a imagem para compartilhamento.", variant: "destructive" });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-md w-full p-0 border-0 flex flex-col h-[90vh] sm:h-[85vh] rounded-lg">
                <div className="flex-grow overflow-y-auto custom-scrollbar">
                    {receipt && <ReceiptContent receipt={receipt} ref={receiptRef} onBack={() => setIsOpen(false)}/>}
                </div>
                <DialogFooter className="p-4 bg-background/80 backdrop-blur-sm flex-col sm:flex-row sm:justify-end gap-2 mt-auto">
                    <Button variant="outline" onClick={() => handleDownload('png')} className="w-full sm:w-auto"><Download className="mr-2 h-4 w-4" />Baixar PNG</Button>
                    <Button onClick={() => handleDownload('pdf')} className="w-full sm:w-auto"><Download className="mr-2 h-4 w-4" />Baixar PDF</Button>
                    {navigator.share && <Button onClick={handleShare} className="w-full sm:w-auto bg-gradient-to-r from-pink-500 to-purple-600 text-white hover:from-pink-600 hover:to-purple-700"><Share2 className="mr-2 h-4 w-4" />Compartilhar</Button>}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ReceiptDownloadDialog;