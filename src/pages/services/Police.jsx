import React, { useState, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { FileWarning, Siren, ShieldQuestion, Gavel, FileText, Search, BookUser, Award, Scale, Ticket, CalendarCheck, ShieldAlert, Info, FileBadge, Shield, Loader2, Coins, HeartHandshake as Handshake, Download, Image as ImageIcon, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatCurrency } from '@/lib/utils';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import PayBillDialog from '@/components/bank/PayBillDialog';

const ServiceActionDialog = ({ title, description, icon: Icon, children, onAction, actionLabel, actionLoading }) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleAction = async (e) => {
        e.preventDefault();
        const success = await onAction(e);
        if (success) {
            setIsOpen(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <button className="w-full text-left p-4 rounded-lg bg-white/5 hover:bg-white/10 transition-all duration-200 flex items-start gap-4">
                    <div className="p-2 bg-blue-500/20 rounded-md"><Icon className="w-6 h-6 text-blue-400" /></div>
                    <div><h4 className="font-semibold text-white">{title}</h4><p className="text-sm text-muted-foreground">{description}</p></div>
                </button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleAction}>
                    <div className="py-4">{children}</div>
                    <DialogFooter>
                        <Button type="submit" disabled={actionLoading}>
                            {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {actionLabel || title}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const WantedList = ({ wantedList }) => (
    <div className="space-y-4">
        {wantedList.length > 0 ? wantedList.map(person => (
            <Card key={person.id} className="bg-red-900/20 border-red-500/30">
                <CardHeader className="flex flex-row items-center gap-4 space-y-0">
                    <img src={person.profile.avatar_url} alt={person.profile.full_name} className="w-16 h-16 rounded-full border-2 border-red-500" />
                    <div>
                        <CardTitle className="text-red-400">{person.profile.full_name}</CardTitle>
                        <CardDescription>Crime: {person.crime}</CardDescription>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">{person.details}</p>
                    {person.reward > 0 && <p className="mt-2 font-bold text-lg text-green-400">Recompensa: {formatCurrency(person.reward)}</p>}
                </CardContent>
            </Card>
        )) : <p className="text-center text-muted-foreground py-4">Nenhum indivíduo procurado no momento.</p>}
    </div>
);

const FinesList = ({ fines, onPay }) => (
    <div className="space-y-4">
        {fines.length > 0 ? fines.map(fine => {
            const isOverdue = new Date(fine.due_date) < new Date();
            const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(fine.due_date)) / (1000 * 60 * 60 * 24)) : 0;
            const interest = isOverdue ? fine.amount * 0.0033 * daysOverdue : 0;
            const totalAmount = fine.amount + interest;

            return (
                <Card key={fine.id} className={`${fine.status === 'Paga' ? 'bg-green-900/20 border-green-500/30' : (isOverdue ? 'bg-red-900/20 border-red-500/30' : 'bg-yellow-900/20 border-yellow-500/30')}`}>
                    <CardHeader>
                        <CardTitle className={fine.status === 'Paga' ? 'text-green-400' : (isOverdue ? 'text-red-400' : 'text-yellow-400')}>{fine.reason}</CardTitle>
                        <CardDescription>Status: <span className={`font-semibold ${fine.status === 'Paga' ? 'text-green-400' : 'text-orange-400'}`}>{fine.status}</span></CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p>Valor Original: <span className="font-bold">{formatCurrency(fine.amount)}</span></p>
                        {isOverdue && fine.status === 'Pendente' && <p className="text-red-400">Juros por atraso ({daysOverdue} dias): {formatCurrency(interest)}</p>}
                        <p className="font-bold">Valor Total: <span className="font-bold">{formatCurrency(totalAmount)}</span></p>
                        <p>Vencimento: {new Date(fine.due_date).toLocaleDateString()}</p>
                    </CardContent>
                    {fine.status === 'Pendente' && (
                        <CardFooter>
                            <Button onClick={() => onPay(fine.id)}><Coins className="w-4 h-4 mr-2" />Pagar Multa</Button>
                        </CardFooter>
                    )}
                </Card>
            );
        }) : <p className="text-center text-muted-foreground py-4">Você não possui multas.</p>}
    </div>
);

const CertificateDocument = ({ doc, user }) => {
    if (!doc) return null;
    const title = 'Certidão Negativa de Débitos Criminais';
    const hasRecord = doc.metadata?.hasCriminalRecord;
    const dateOfBirth = new Date(user.date_of_birth.replace(/-/g, '\/')).toLocaleDateString('pt-BR');

    return (
        <div className="p-6 bg-white rounded-lg text-black font-serif max-w-2xl mx-auto border-4 border-blue-900">
            <header className="text-center mb-6">
                <img src="/gov-logo.png" alt="Brasão da República" className="w-20 h-20 mx-auto mb-2" />
                <h1 className="text-sm font-bold">REPÚBLICA FEDERATIVA DE GOV.RP</h1>
                <h2 className="text-xs">DEPARTAMENTO DE POLÍCIA</h2>
            </header>
            <h3 className="text-lg font-bold text-center mb-6">{title}</h3>
            <div className="text-sm space-y-3 text-justify leading-relaxed">
                <p>Certificamos, para os devidos fins, que, após consulta aos Sistemas de Informação deste Departamento de Polícia, em nome de <strong>{user.full_name?.toUpperCase()}</strong>, portador(a) do CPF nº <strong>{user.cpf}</strong> e RG nº <strong>{user.rg}</strong>, nascido(a) em <strong>{dateOfBirth}</strong>, filho(a) de FILIAÇÃO NÃO INFORMADA, natural de GOV - RP.</p>
                <p className="font-bold text-center text-base my-4">
                    {hasRecord ? `CONSTAM registros criminais em seu nome.` : `NADA CONSTA até a presente data.`}
                </p>
                <p>A presente certidão refere-se exclusivamente a informações constantes na base de dados do Departamento de Polícia de GOV.RP. Não abrange informações de outros órgãos.</p>
            </div>
            <footer className="mt-8 text-center">
                <p>Emitido em: {new Date(doc.issued_at).toLocaleString('pt-BR')}</p>
                <p className="text-xs mt-2">Documento Nº: {doc.document_number}</p>
            </footer>
        </div>
    );
};

const Police = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({});
    const [documentToVisualize, setDocumentToVisualize] = useState(null);
    const [wantedList, setWantedList] = useState([]);
    const [fines, setFines] = useState([]);
    const [openCollapsible, setOpenCollapsible] = useState(null);
    const docRef = useRef(null);
    const [payingFineId, setPayingFineId] = useState(null);

    const handleInputChange = (e) => {
        const { id, value } = e.target;
        setFormData(prev => ({ ...prev, [id]: value }));
    };

    const handleGenerateDoc = async (format) => {
        if (!docRef.current) return;
        const canvas = await html2canvas(docRef.current, { backgroundColor: null, scale: 3, useCORS: true });
        if (format === 'png') {
            const link = document.createElement('a');
            link.download = `certidao_negativa_${user.username}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } else {
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`certidao_negativa_${user.username}.pdf`);
        }
    };
    
    const fetchFines = async () => {
         const { data, error } = await supabase.from('police_fines').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
         if (error) throw error;
         setFines(data || []);
    }

    const handleAction = async (actionType, payload) => {
        setLoading(true);
        let result = { success: false, message: "🚧 This feature isn't implemented yet—but don't worry! You can request it in your next prompt! 🚀" };

        try {
            if (actionType === 'view_wanted_list') {
                 const { data, error } = await supabase.from('police_wanted_list').select('*, profile:profiles(*)').eq('status', 'Ativo');
                 if (error) throw error;
                 setWantedList(data || []);
                 setOpenCollapsible(openCollapsible === 'wanted' ? null : 'wanted');
                 result = { success: true, message: null };
            } else if (actionType === 'check_fines') {
                await fetchFines();
                setOpenCollapsible(openCollapsible === 'fines' ? null : 'fines');
                result = { success: true, message: null };
            } else if (actionType === 'request_clearance_certificate') {
                 const { data, error } = await supabase.from('criminal_records').select('*').eq('user_id', user.id).eq('is_active', true).maybeSingle();
                 if (error) throw error;
                 const docData = {
                     type: 'Certidão Negativa',
                     document_number: `Nº ${Math.floor(Math.random() * 900000) + 100000}`,
                     issued_at: new Date().toISOString(),
                     is_valid: true,
                     metadata: { hasCriminalRecord: !!data, crime: data?.crime }
                 };
                 setDocumentToVisualize(docData);
                 result = { success: true, message: `Sua Certidão Negativa foi gerada.` };
            }

        } catch (error) {
            result = { success: false, message: error.message };
        }

        if (result.message) {
            toast({ title: result.success ? 'Sucesso' : 'Aviso', description: result.message, variant: result.success ? 'default' : 'destructive' });
        }
        setLoading(false);
        return result.success;
    };

    const handlePayFine = async (fineId) => {
        setPayingFineId(fineId);
        const { data, error } = await supabase.rpc('pay_fine', { p_fine_id: fineId });

        if (error || !data.success) {
            toast({ title: "Erro ao pagar", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            await fetchFines();
        }
        setPayingFineId(null);
    };

    const serviceSections = [
        {
            value: "ocorrencias", label: "Ocorrências", icon: FileWarning,
            services: [
                { title: 'Denúncias de crimes', description: 'Registre um boletim de ocorrência para crimes comuns.', icon: Gavel, action: 'register_occurrence', form: <div className="space-y-4"><Label htmlFor="title">Título</Label><Input id="title" onChange={handleInputChange} /></div> },
                { title: 'Denúncias anônimas', description: 'Reporte atividades suspeitas sem se identificar.', icon: Shield, action: 'anonymous_report', form: <div className="space-y-4"><Label htmlFor="title">Título</Label><Input id="title" onChange={handleInputChange} /></div> },
            ]
        },
        {
            value: "consultas", label: "Consultas", icon: ShieldQuestion,
            services: [
                { title: 'Acompanhar boletim de ocorrência', description: 'Verifique o status de uma ocorrência.', icon: Search, action: 'check_occurrence_status', form: <div className="space-y-2"><Label htmlFor="occurrence_id">ID</Label><Input id="occurrence_id" onChange={handleInputChange} /></div> },
                { title: 'Consultar mandado de prisão', description: 'Verifique se há mandados em seu nome.', icon: Gavel, action: 'check_warrant', form: <p>Verificará seu nome no sistema.</p> },
                { title: 'Verificar nome em investigação', description: 'Consulte se seu nome está em investigações.', icon: Search, action: 'check_investigation', form: <p>Verificará seu nome no sistema.</p> },
            ]
        },
        {
            value: "solicitacoes", label: "Solicitações", icon: FileText,
            services: [
                { title: 'Solicitar certidão negativa', description: 'Emita uma certidão de "nada consta".', icon: FileBadge, action: 'request_clearance_certificate', form: <p>Será verificado se você possui registros criminais ativos.</p> },
                { title: 'Pedido de investigação formal', description: 'Solicite uma investigação.', icon: Scale, action: 'request_formal_investigation', form: <div className="space-y-4"><Label htmlFor="subject">Investigado</Label><Input id="subject" onChange={handleInputChange} /></div> },
                { title: 'Requisição de liberação de bens', description: 'Peça a devolução de itens apreendidos.', icon: Handshake, action: 'request_asset_release', form: <div className="space-y-4"><Label htmlFor="items">Itens</Label><Textarea id="items" onChange={handleInputChange} /></div> },
            ]
        },
         {
            value: "multas", label: "Multas", icon: Ticket,
            services: [
                { title: 'Consultar multas recebidas', description: 'Verifique todas as multas em seu nome.', icon: Coins, action: 'check_fines', form: <p>Serão listadas todas as suas multas.</p> },
                { title: 'Solicitar recurso de multa', description: 'Conteste uma multa.', icon: Gavel, action: 'appeal_fine', form: <div className="space-y-4"><Label htmlFor="fine_id">ID da Multa</Label><Input id="fine_id" onChange={handleInputChange} /></div> },
                { title: 'Agendar audiência com a corregedoria', description: 'Marque uma audiência.', icon: CalendarCheck, action: 'schedule_hearing', form: <div className="space-y-4"><Label htmlFor="case_id">ID do Caso</Label><Input id="case_id" onChange={handleInputChange} /></div> },
            ]
        },
        {
            value: "informacoes", label: "Informações", icon: Info,
            services: [
                { title: 'Ver lista de procurados', description: 'Acesse a lista pública de foragidos.', icon: ShieldAlert, action: 'view_wanted_list', form: <p>A lista de procurados será exibida.</p> },
                { title: 'Campanhas e Educação', description: 'Acesse informativos sobre leis.', icon: BookUser, action: 'view_campaigns', form: <p>Materiais educativos serão exibidos.</p> },
                { title: 'Ranking de eficiência da polícia', description: 'Veja as estatísticas de desempenho.', icon: Award, action: 'view_police_stats', form: <p>As estatísticas serão exibidas.</p> },
            ]
        },
    ];

    return (
        <>
            <Helmet><title>Serviços da Polícia - GOV.RP</title><meta name="description" content="Acesse os serviços online do Departamento de Polícia." /></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader icon={Siren} title="Delegacia de" gradientText="Polícia" description="Utilize os serviços da polícia para registrar e consultar ocorrências, solicitar documentos e muito mais, de forma rápida e segura." iconColor="text-blue-500" centered={true} />
                
                <Tabs defaultValue="ocorrencias" className="w-full mt-8">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto">
                        {serviceSections.map((section) => (
                            <TabsTrigger key={section.value} value={section.value} className="flex flex-col sm:flex-row gap-2 items-center justify-center py-3">
                                <section.icon className="w-5 h-5" /><span>{section.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {serviceSections.map((section) => (
                        <TabsContent key={section.value} value={section.value}>
                            <Card className="glass-effect mt-6">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-3 text-2xl"><section.icon className="w-8 h-8 text-blue-400" />{section.label}</CardTitle>
                                    <CardDescription>Selecione um dos serviços abaixo para continuar.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {section.services.map((service, index) => (
                                            <ServiceActionDialog key={index} {...service} onAction={() => handleAction(service.action, formData)} actionLoading={loading}>
                                                {service.form}
                                            </ServiceActionDialog>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    ))}
                </Tabs>

                <div className="mt-6 space-y-4">
                    <Collapsible open={openCollapsible === 'wanted'}>
                        <CollapsibleContent><Card className="glass-effect mt-4"><CardHeader><CardTitle>Lista de Procurados</CardTitle></CardHeader><CardContent><WantedList wantedList={wantedList} /></CardContent></Card></CollapsibleContent>
                    </Collapsible>

                    <Collapsible open={openCollapsible === 'fines'}>
                        <CollapsibleContent><Card className="glass-effect mt-4"><CardHeader><CardTitle>Minhas Multas</CardTitle></CardHeader><CardContent><FinesList fines={fines} onPay={handlePayFine} /></CardContent></Card></CollapsibleContent>
                    </Collapsible>
                </div>
            </div>
            <Dialog open={!!documentToVisualize} onOpenChange={() => setDocumentToVisualize(null)}>
                <DialogContent className="max-w-3xl w-full data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                    <DialogHeader>
                        <DialogTitle>{documentToVisualize?.type}</DialogTitle>
                        <DialogDescription>Seu documento foi gerado com sucesso.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 overflow-y-auto max-h-[70vh]">
                        <div ref={docRef} className="flex justify-center">
                           <CertificateDocument doc={documentToVisualize} user={user} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => handleGenerateDoc('png')}><ImageIcon className="w-4 h-4 mr-2" />Gerar PNG</Button>
                        <Button onClick={() => handleGenerateDoc('pdf')}><FileText className="w-4 h-4 mr-2" />Gerar PDF</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default Police;