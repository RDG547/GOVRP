import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { User, Fingerprint, Calendar, Loader2, FileText, Car, Globe, Briefcase as BriefcaseIcon, Building, Wallet, Download, Image as ImageIcon, QrCode, CheckCircle, Clock, Edit3, ShieldCheck, Star, Award, BookUser, Vote, Heart, School, Flag, FilePlus, FileClock, History, Files, Eye, ArrowLeft } from 'lucide-react';
import { formatCPF, formatRG } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import QRCode from "qrcode.react";
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { OfficialDocument } from '@/components/dic/OfficialDocument';

const docFees = {
    CNH: 0.00, Passport: 0.00, CNPJ: 0.00, CTD: 0.00,
    'Título de Eleitor': 0.00, 'Certificado de Reservista': 0.00, 'Certidão de Casamento': 0.00, 'Registro Profissional': 0.00,
};

const docInfo = {
    CPF: { name: 'Cadastro de Pessoa Física', icon: Fingerprint, color: 'text-purple-400' },
    RG: { name: 'Registro Geral', icon: FileText, color: 'text-purple-400' },
    CNH: { name: 'Carteira Nacional de Habilitação', icon: Car, color: 'text-blue-400' },
    Passport: { name: 'Passaporte', icon: Globe, color: 'text-green-400' },
    CNPJ: { name: 'Cadastro Nacional da Pessoa Jurídica', icon: Building, color: 'text-yellow-400' },
    CTD: { name: 'Carteira de Trabalho Digital', icon: BriefcaseIcon, color: 'text-indigo-400' },
    'Título de Eleitor': { name: 'Título de Eleitor', icon: Vote, color: 'text-teal-400' },
    'Certificado de Reservista': { name: 'Certificado de Reservista', icon: ShieldCheck, color: 'text-orange-400' },
    'Certidão de Casamento': { name: 'Certidão de Casamento', icon: Heart, color: 'text-pink-400' },
    'Registro Profissional': { name: 'Registro Profissional', icon: Award, color: 'text-cyan-400' },
};

const DocumentCard = ({ doc, onVisualize, onGenerate }) => {
    const info = docInfo[doc.type];
    if (!info) return null;
    const Icon = info.icon;
    const formatValue = (type, value) => {
        if (type === 'CPF') return formatCPF(value);
        if (type === 'RG') return formatRG(value);
        return value;
    };

    return (
        <Card className="glass-effect flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium flex items-center">
                    <Icon className={`w-4 h-4 mr-2 ${info.color}`} /> {info.name}
                </CardTitle>
                <span className={`text-xs px-2 py-1 rounded-full ${doc.is_valid ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>{doc.is_valid ? 'Válido' : 'Inválido'}</span>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col justify-between">
                <div>
                    <div className="text-2xl font-bold font-mono">{formatValue(doc.type, doc.document_number)}</div>
                    <p className="text-xs text-muted-foreground">Emissão: {new Date(doc.issued_at).toLocaleDateString()}</p>
                    {doc.expires_at && <p className="text-xs text-muted-foreground">Validade: {new Date(doc.expires_at).toLocaleDateString()}</p>}
                </div>
                <div className="mt-4 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => onVisualize(doc)}><Eye className="w-4 h-4 mr-2" />Visualizar</Button>
                    <Dialog>
                        <DialogTrigger asChild><Button variant="secondary" size="sm"><Download className="w-4 h-4 mr-2" />Gerar</Button></DialogTrigger>
                        <DialogContent>
                            <DialogHeader><DialogTitle>Gerar Documento</DialogTitle></DialogHeader>
                            <div className="flex justify-center gap-4 py-4">
                                <Button onClick={() => onGenerate(doc, 'png')}><ImageIcon className="w-4 h-4 mr-2" />Gerar PNG</Button>
                                <Button onClick={() => onGenerate(doc, 'pdf')}><FileText className="w-4 h-4 mr-2" />Gerar PDF</Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            </CardContent>
        </Card>
    )
};

const DIC = () => {
    const { toast } = useToast();
    const { user, refreshUser } = useAuth();
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [requesting, setRequesting] = useState('');
    const [confirmingDoc, setConfirmingDoc] = useState(null);
    const [formValues, setFormValues] = useState({});
    const [visualizingDoc, setVisualizingDoc] = useState(null);
    const [activeTab, setActiveTab] = useState("documents");
    const docRefs = useRef({});

    const fetchAllData = useCallback(async () => {
        if (!user?.id) { setLoading(false); return; }
        setLoading(true);
        try {
            await refreshUser();
            const { data, error } = await supabase.from('documents').select('*, user:user_id(*)').eq('user_id', user.id).order('created_at');
            if (error) throw error;
            setDocuments(data);
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível carregar seus documentos.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [user?.id, toast, refreshUser]);

    useEffect(() => { 
        if(user?.id) {
            fetchAllData();
        }
    }, [user?.id, fetchAllData]);
    
    const handleTabChange = async (value) => {
        setActiveTab(value);
        if (value === 'history' && user) {
            await refreshUser();
        }
    };

    const handleFormChange = (e) => setFormValues(prev => ({...prev, [e.target.id]: e.target.value}));

    const handleRequestDocument = async () => {
        if (!confirmingDoc) return;
        setRequesting(confirmingDoc);
        const { data, error } = await supabase.rpc('issue_document_request', { p_document_type: confirmingDoc, p_metadata: formValues });
        if (error) toast({ title: "Erro na Solicitação", description: error.message, variant: "destructive" });
        else if (!data.success) toast({ title: "Aviso", description: data.message, variant: "default" });
        else {
            toast({ title: "Sucesso!", description: data.message });
            await fetchAllData();
        }
        setRequesting(''); setConfirmingDoc(null); setFormValues({});
    };

    const handleGenerateDoc = async (doc, format) => {
        const hasTwoSides = ['CNH', 'RG', 'CTD', 'Passport'].includes(doc.type);
        const frontElement = docRefs.current[`${doc.id}-front`];
        const backElement = hasTwoSides ? docRefs.current[`${doc.id}-back`] : null;

        if (!frontElement) return;

        const frontCanvas = await html2canvas(frontElement, { backgroundColor: null, scale: 3 });
        let backCanvas;
        if (backElement) {
            backCanvas = await html2canvas(backElement, { backgroundColor: null, scale: 3 });
        }

        if (format === 'png') {
            const combinedCanvas = document.createElement('canvas');
            const ctx = combinedCanvas.getContext('2d');
            const spacing = 20;
            combinedCanvas.width = frontCanvas.width + (backCanvas ? backCanvas.width + spacing : 0);
            combinedCanvas.height = Math.max(frontCanvas.height, backCanvas ? backCanvas.height : 0);
            
            ctx.drawImage(frontCanvas, 0, 0);
            if (backCanvas) {
                ctx.drawImage(backCanvas, frontCanvas.width + spacing, 0);
            }

            const link = document.createElement('a');
            link.download = `doc_${doc.type}_${user.username}.png`;
            link.href = combinedCanvas.toDataURL('image/png');
            link.click();
        } else { // PDF
            const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [frontCanvas.width, frontCanvas.height] });
            pdf.addImage(frontCanvas.toDataURL('image/png'), 'PNG', 0, 0, frontCanvas.width, frontCanvas.height);
            if (backCanvas) {
                pdf.addPage([backCanvas.width, backCanvas.height]);
                pdf.addImage(backCanvas.toDataURL('image/png'), 'PNG', 0, 0, backCanvas.width, backCanvas.height);
            }
            pdf.save(`doc_${doc.type}_${user.username}.pdf`);
        }
    };
    
    const handleGenerateAllDocs = async () => {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px' });
        const validDocs = documents.filter(d => d.is_valid);
        for (let i = 0; i < validDocs.length; i++) {
            const doc = validDocs[i];
            const frontElement = docRefs.current[`${doc.id}-front`];
            if (frontElement) {
                const canvas = await html2canvas(frontElement, { scale: 3, backgroundColor: null });
                if (i > 0) pdf.addPage([canvas.width, canvas.height]);
                pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
            }
        }
        pdf.save(`documentos_govrp_${user.username}.pdf`);
        toast({ title: "Sucesso", description: "PDF com todos os documentos gerado." });
    };

    const formatFee = (fee) => {
        if (fee === 0) return "Gratuita";
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fee);
    };

    const getDoc = (type) => documents.find(d => d.type === type);
    const availableDocsToRequest = Object.keys(docInfo).filter(type => !['CPF', 'RG'].includes(type) && !getDoc(type));

    const InfoCard = ({ icon: Icon, title, value }) => (
        <div className="flex items-start gap-3 text-sm">
            <Icon className="w-4 h-4 mt-1 text-muted-foreground" />
            <div className="flex-1">
                <p className="font-semibold text-foreground">{title}</p>
                <p className="text-muted-foreground">{value || 'Não informado'}</p>
            </div>
        </div>
    );

    return (
        <>
            <Helmet><title>DIC - GOV.RP</title><meta name="description" content="Departamento de Identificação Civil do GOV.RP." /></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                {loading || !user ? <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div> :
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <PageHeader icon={FileText} title="Departamento de Identificação" gradientText="Civil" description="Sua carteira de documentos digitais e histórico de cidadania." iconColor="text-purple-400" />
                         <Tabs defaultValue="documents" value={activeTab} className="w-full mt-8" onValueChange={handleTabChange}>
                            <TabsList className="flex flex-wrap h-auto sm:h-10">
                                <TabsTrigger value="documents" className="flex-1 text-center"><FileText className="w-4 h-4 mr-2"/>Meus Documentos</TabsTrigger>
                                <TabsTrigger value="history" className="flex-1 text-center"><History className="w-4 h-4 mr-2"/>Informações do Cidadão</TabsTrigger>
                                <TabsTrigger value="requests" className="flex-1 text-center"><FilePlus className="w-4 h-4 mr-2"/>Solicitações</TabsTrigger>
                            </TabsList>
                            <TabsContent value="documents">
                                <Card className="glass-effect mt-6">
                                    <CardHeader><CardTitle>Documentos Válidos</CardTitle></CardHeader>
                                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {documents.filter(d => d.is_valid).map(doc => (
                                            <DocumentCard key={doc.id} doc={doc} onVisualize={setVisualizingDoc} onGenerate={handleGenerateDoc} />
                                        ))}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                            <TabsContent value="history">
                                <Card className="glass-effect mt-6">
                                    <CardHeader><CardTitle>Informações do Cidadão</CardTitle></CardHeader>
                                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        <InfoCard icon={Flag} title="Filiação Partidária" value={user.party_affiliation || 'Nenhuma'}/>
                                        <InfoCard icon={BriefcaseIcon} title="Ocupação Atual" value={user.occupation || 'Não informado'}/>
                                        <InfoCard icon={School} title="Escolaridade" value={user.education_level || 'Não informado'}/>
                                        <InfoCard icon={Star} title="Reputação Civil" value={user.reputation_points === null || user.reputation_points === undefined ? 'Não informado' : user.reputation_points}/>
                                        <InfoCard icon={Award} title="Títulos" value={user.titles?.join(', ') || 'Nenhum'}/>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                            <TabsContent value="requests">
                                <Card className="glass-effect mt-6">
                                    <CardHeader><CardTitle>Solicitar Novos Documentos</CardTitle></CardHeader>
                                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {availableDocsToRequest.map(docType => (
                                            <Button key={docType} variant="outline" onClick={() => setConfirmingDoc(docType)} disabled={!!requesting} className="justify-start h-auto py-3">
                                                {React.createElement(docInfo[docType].icon, { className: `w-5 h-5 mr-3 ${docInfo[docType].color}` })}
                                                <div><p>{docInfo[docType].name}</p><p className="text-xs text-muted-foreground">Taxa: {formatFee(docFees[docType] || 0)}</p></div>
                                            </Button>
                                        ))}
                                        {availableDocsToRequest.length === 0 && <p className="text-muted-foreground col-span-full text-center">Você já emitiu todos os documentos disponíveis.</p>}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                        {activeTab === 'documents' && documents.filter(d => d.is_valid).length > 0 && (
                            <div className="mt-8 flex justify-center">
                                <Button onClick={handleGenerateAllDocs}>
                                    <Files className="w-4 h-4 mr-2" /> Gerar PDF com Todos os Documentos
                                </Button>
                            </div>
                        )}
                    </motion.div>}
            </div>
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                {documents.map(doc => {
                    const hasTwoSides = ['CNH', 'RG', 'CTD', 'Passport'].includes(doc.type);
                    return (
                        <React.Fragment key={doc.id}>
                            <div ref={el => docRefs.current[`${doc.id}-front`] = el}><OfficialDocument user={doc.user} doc={doc} side="front" /></div>
                            {hasTwoSides && <div ref={el => docRefs.current[`${doc.id}-back`] = el}><OfficialDocument user={doc.user} doc={doc} side="back" /></div>}
                        </React.Fragment>
                    )
                })}
            </div>
            <Dialog open={!!visualizingDoc} onOpenChange={() => setVisualizingDoc(null)}>
                <DialogContent className="max-w-fit p-0 border-0 bg-transparent shadow-none">
                    {visualizingDoc && <OfficialDocument user={visualizingDoc.user} doc={visualizingDoc} onBack={() => setVisualizingDoc(null)} />}
                </DialogContent>
            </Dialog>
            <Dialog open={!!confirmingDoc} onOpenChange={() => { setConfirmingDoc(null); setFormValues({}); }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar Emissão: {docInfo[confirmingDoc]?.name}</DialogTitle>
                        <DialogDescription>Preencha os dados e confirme a emissão pela taxa de {formatFee(docFees[confirmingDoc] || 0)}.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        {confirmingDoc === 'CNPJ' && (<><Label htmlFor="company_name">Nome da Empresa</Label><Input id="company_name" onChange={handleFormChange} /></>)}
                        {confirmingDoc === 'Certidão de Casamento' && (<><Label htmlFor="spouse_name">Nome do Cônjuge</Label><Input id="spouse_name" onChange={handleFormChange} /></>)}
                        {confirmingDoc === 'Registro Profissional' && (<><Label htmlFor="profession">Profissão (Ex: Engenheiro)</Label><Input id="profession" onChange={handleFormChange} /></>)}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => { setConfirmingDoc(null); setFormValues({}); }}>Cancelar</Button>
                        <Button onClick={handleRequestDocument} disabled={!!requesting}>{requesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default DIC;