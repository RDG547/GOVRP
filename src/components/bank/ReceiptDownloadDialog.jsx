import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { Loader2, FileText, Image as ImageIcon, ArrowLeft, Share2 } from 'lucide-react';
import { formatCurrency, formatCPF, formatAgency, formatAccount } from '@/lib/utils';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useToast } from '../ui/use-toast';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogTrigger } from '../ui/alert-dialog';

const ReceiptInfoRow = ({ label, value, valueClass = '' }) => (
    <div className="flex justify-between items-start">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`text-sm text-right font-medium text-foreground ${valueClass}`}>{value}</span>
    </div>
);

const ReceiptParticipant = ({ title, data }) => {
    if (!data || !data.name) return null;
    return (
        <div>
            <h3 className="font-semibold text-lg mb-2">{title}</h3>
            <div className="space-y-2">
                <ReceiptInfoRow label="Nome:" value={data.name} />
                {data.cpf && <ReceiptInfoRow label="CPF:" value={formatCPF(data.cpf)} />}
                {data.agency && data.account && <ReceiptInfoRow label="Ag / Conta:" value={`${formatAgency(data.agency)} / ${formatAccount(data.account)}`} />}
                {data.key && <ReceiptInfoRow label="Chave:" value={data.key} />}
                {data.metadata?.seller_cnpj_details?.cnpj && <ReceiptInfoRow label="CNPJ:" value={data.metadata.seller_cnpj_details.cnpj} />}
                {data.metadata?.seller_cnpj_details?.trade_name && <ReceiptInfoRow label="Nome Fantasia:" value={data.metadata.seller_cnpj_details.trade_name} />}
            </div>
        </div>
    );
};

const ReceiptContent = React.forwardRef(({ receipt }, ref) => {
    if (!receipt) return null;

    const getTransactionTypeName = (type) => {
        const typeMap = {
            'transfer': 'Transferência',
            'purchase': 'Compra',
            'purchase_card': 'Compra (Cartão)',
            'subscription_payment': 'Assinatura',
            'subscription_payment_card': 'Assinatura (Cartão)',
            'admin_credit': 'Crédito Admin',
            'admin_debit': 'Débito Admin',
            'service_fee': 'Taxa de Serviço',
            'investment_application': 'Investimento',
            'investment_withdrawal': 'Resgate',
            'deposit': 'Depósito',
            'withdrawal': 'Saque',
        };
        return typeMap[type] || 'Transação';
    };

    const senderData = {
        name: receipt.sender_name,
        cpf: receipt.sender_cpf,
        agency: receipt.sender_agency,
        account: receipt.sender_account,
        key: receipt.sender_key,
        metadata: receipt.metadata,
    };

    const recipientData = {
        name: receipt.recipient_name,
        cpf: receipt.recipient_cpf,
        agency: receipt.recipient_agency,
        account: receipt.recipient_account,
        key: receipt.recipient_key,
        metadata: receipt.metadata,
    };

    const taxAmount = receipt.tax_amount || receipt.metadata?.tax_amount;
    const baseAmount = receipt.amount;
    const totalAmount = receipt.total_amount || baseAmount + (taxAmount || 0);

    return (
        <div ref={ref} className="bg-[#0D1117] text-white w-full max-w-md mx-auto p-6 font-sans">
            <div className="text-center mb-6">
                <h1 className="text-2xl font-bold text-blue-400">GOV.RP Bank</h1>
                <p className="text-muted-foreground">Comprovante de Transação</p>
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <ReceiptInfoRow label="Tipo:" value={getTransactionTypeName(receipt.type)} />
                    <ReceiptInfoRow label="Data:" value={new Date(receipt.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })} />
                    <ReceiptInfoRow label="ID Transação:" value={receipt.id} valueClass="font-mono text-xs break-all" />
                </div>

                <div className="border-t border-dashed border-gray-600 my-4"></div>

                <div className="text-center">
                    <p className="text-sm text-muted-foreground">Valor Total Debitado</p>
                    <p className="text-4xl font-bold text-blue-400">{formatCurrency(totalAmount)}</p>
                </div>
                
                <div className="space-y-2 text-center text-sm">
                    <ReceiptInfoRow label="Valor da Transação:" value={formatCurrency(baseAmount)} />
                    {taxAmount > 0 && <ReceiptInfoRow label="Impostos:" value={formatCurrency(taxAmount)} />}
                </div>


                <div className="border-t border-dashed border-gray-600 my-4"></div>

                {receipt.sender_name && <ReceiptParticipant title="Remetente" data={senderData} />}

                {receipt.sender_name && receipt.recipient_name && <div className="border-t border-dashed border-gray-600 my-4"></div>}

                {receipt.recipient_name && <ReceiptParticipant title="Destinatário" data={recipientData} />}

                <div className="border-t border-dashed border-gray-600 my-4"></div>

                <div>
                    <h3 className="font-semibold text-lg mb-2">Descrição</h3>
                    <p className="text-sm text-muted-foreground">{receipt.description || 'Sem descrição'}</p>
                </div>
            </div>

            <div className="text-center mt-8 text-xs text-gray-500 space-y-2">
                <p>Este é um comprovante gerado pelo sistema. Autenticidade pode ser verificada com o ID da transação.</p>
                <p>© {new Date().getFullYear()} GOV.RP Bank. Todos os direitos reservados.</p>
            </div>
        </div>
    );
});

const ReceiptDownloadDialog = ({ receipt, onBack }) => {
    const { toast } = useToast();
    const receiptRef = useRef();
    const [loading, setLoading] = useState('');

    const generateCanvas = (scale) => {
        const input = receiptRef.current;
        if (!input) return Promise.reject('Receipt element not found');
        return html2canvas(input, {
            scale,
            backgroundColor: '#0D1117',
            useCORS: true,
            logging: false,
        });
    };

    const downloadFile = async (format) => {
        setLoading(format);
        try {
            if (format === 'pdf') {
                const canvas = await generateCanvas(2);
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                pdf.save(`comprovante-${receipt.id}.pdf`);
            } else { // png
                const canvas = await generateCanvas(3);
                const link = document.createElement('a');
                link.download = `comprovante-${receipt.id}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            }
        } catch (error) {
            console.error(`Error generating ${format}:`, error);
            toast({ title: "Erro", description: `Não foi possível gerar o ${format.toUpperCase()}.`, variant: "destructive" });
        }
        setLoading('');
    };

    const shareFile = async (format) => {
         setLoading(`share-${format}`);
        try {
            const canvas = await generateCanvas(2);
            let blob;
            let fileName;
            let fileType;
            
            if (format === 'pdf') {
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
                pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
                blob = pdf.output('blob');
                fileName = `comprovante-${receipt.id}.pdf`;
                fileType = 'application/pdf';
            } else { // png
                blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                fileName = `comprovante-${receipt.id}.png`;
                fileType = 'image/png';
            }

            if (navigator.share && blob) {
                try {
                    await navigator.share({
                        files: [new File([blob], fileName, { type: fileType })],
                        title: 'Comprovante de Transação',
                        text: `Comprovante da transação`,
                    });
                } catch (shareError) {
                    if (shareError.name !== 'AbortError') {
                        throw shareError;
                    }
                }
            } else {
                 toast({ title: "Não suportado", description: "Seu navegador não suporta o compartilhamento de arquivos.", variant: "destructive" });
            }

        } catch (error) {
            console.error(`Error sharing ${format}:`, error);
            toast({ title: "Erro", description: `Não foi possível compartilhar o ${format.toUpperCase()}.`, variant: "destructive" });
        }
        setLoading('');
    };


    return (
        <Dialog open={!!receipt} onOpenChange={(isOpen) => !isOpen && onBack()}>
            <DialogContent className="sm:max-w-md p-0 bg-transparent border-none shadow-none data-[state=open]:animate-none">
                <div className="max-h-[85vh] overflow-y-auto custom-scrollbar rounded-lg">
                    <div className="p-4 bg-[#0D1117] sticky top-0 z-10">
                        <Button onClick={onBack} variant="ghost" size="sm" className="text-white hover:bg-white/10">
                            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                        </Button>
                    </div>
                    <ReceiptContent receipt={receipt} ref={receiptRef} />
                    <div className="p-4 bg-[#0D1117] space-y-2 sticky bottom-0 z-10">
                        <div className="flex gap-2 w-full">
                            <Button onClick={() => downloadFile('png')} disabled={!!loading} className="w-full bg-gray-700 hover:bg-gray-600 text-white">
                                {loading === 'png' ? <Loader2 className="animate-spin mr-2" /> : <ImageIcon className="mr-2 h-4 w-4" />} Baixar PNG
                            </Button>
                            <Button onClick={() => downloadFile('pdf')} disabled={!!loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white">
                                {loading === 'pdf' ? <Loader2 className="animate-spin mr-2" /> : <FileText className="mr-2 h-4 w-4" />} Baixar PDF
                            </Button>
                        </div>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button disabled={!!loading} className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white">
                                    {(loading === 'share-png' || loading === 'share-pdf') ? <Loader2 className="animate-spin mr-2" /> : <Share2 className="mr-2 h-4 w-4" />} Compartilhar
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Compartilhar Comprovante</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        Escolha o formato em que deseja compartilhar o comprovante.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                                    <DialogClose asChild><Button onClick={() => shareFile('png')} className="bg-gray-700 hover:bg-gray-600">PNG</Button></DialogClose>
                                    <DialogClose asChild><Button onClick={() => shareFile('pdf')} className="bg-blue-600 hover:bg-blue-500">PDF</Button></DialogClose>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ReceiptDownloadDialog;