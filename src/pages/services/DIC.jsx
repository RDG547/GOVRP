import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { FileText, Car, Globe, Briefcase as BriefcaseIcon, Building, Download, Image as ImageIcon, Eye, History, FilePlus, Files, Loader2, Flag, School, Star, Award, Vote, Heart, ShieldCheck, Fingerprint, X, Trash2, AtSign, Phone, Mail, Landmark } from 'lucide-react';
import { formatCPF, formatRG, formatCNPJ, formatPhone } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { OfficialDocument } from '@/components/dic/OfficialDocument';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

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

const DocumentCard = ({ doc, onVisualize, onGenerate, onDelete }) => {
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
                <div className="mt-4 flex gap-2 flex-wrap">
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
                    {doc.type === 'CNPJ' && doc.is_valid && (
                        <Button variant="destructive" size="sm" onClick={() => onDelete(doc)}>
                            <Trash2 className="w-4 h-4 mr-2" /> Encerrar
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const InfoCard = ({ icon: Icon, title, value, color }) => (
    <Card className="glass-effect overflow-hidden">
        <CardContent className="p-6 flex items-center gap-4">
            <div className={`p-3 rounded-full bg-${color}-500/20`}>
                <Icon className={`w-6 h-6 text-${color}-400`} />
            </div>
            <div>
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className="text-lg font-bold text-foreground">{value || 'Não informado'}</p>
            </div>
        </CardContent>
    </Card>
);

const DIC = () => {
    const { toast } = useToast();
    const { user, refreshUser } = useAuth();
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [requesting, setRequesting] = useState('');
    const [confirmingDoc, setConfirmingDoc] = useState(null);
    const [deletingDoc, setDeletingDoc] = useState(null);
    const [formValues, setFormValues] = useState({});
    const [visualizingDoc, setVisualizingDoc] = useState(null);
    const [activeTab, setActiveTab] = useState("documents");
    const [affiliation, setAffiliation] = useState(null);
    const [isGeneratingAllPdfs, setIsGeneratingAllPdfs] = useState(false);
    const docRefs = useRef({});

    const getDoc = useCallback((type, isValid = true) => documents.find(d => d.type === type && d.is_valid === isValid), [documents]);

    const fetchAllData = useCallback(async () => {
        if (!user?.id) { setLoading(false); return; }
        setLoading(true);
        try {
            await refreshUser();
            const { data, error } = await supabase.from('documents').select('*, user:user_id(*)').eq('user_id', user.id).order('created_at');
            if (error) throw error;
            setDocuments(data || []);

            const { data: affiliationData, error: affiliationError } = await supabase.rpc('get_user_party_affiliation', { p_user_id: user.id });
            if (affiliationError) {
                if (affiliationError.code === 'PGRST116') {
                    setAffiliation({ is_affiliated: false });
                } else {
                    throw affiliationError;
                }
            } else {
                setAffiliation(affiliationData);
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Erro", description: "Não foi possível carregar seus dados.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [user?.id, toast, refreshUser]);

    useEffect(() => {
        if (user?.id) {
            fetchAllData();
        } else {
            setLoading(false);
        }
    }, [user?.id, fetchAllData]);
    
    const handleTabChange = async (value) => {
        setActiveTab(value);
        if (value === 'history' && user) {
            await fetchAllData();
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

    const handleConfirmDelete = async () => {
        if (!deletingDoc) return;
        setRequesting(deletingDoc.id);
        const { data, error } = await supabase.rpc('close_cnpj', { p_document_id: deletingDoc.id });
        if (error) {
            toast({ title: "Erro ao Encerrar", description: error.message, variant: "destructive" });
        } else if (!data.success) {
            toast({ title: "Aviso", description: data.message, variant: "default" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            await fetchAllData();
        }
        setRequesting('');
        setDeletingDoc(null);
    };

    const handleGenerateDoc = async (doc, format) => {
        const hasTwoSides = !['Certidão de Casamento'].includes(doc.type);
        const frontElement = docRefs.current[`${doc.id}-front`];
        const backElement = hasTwoSides ? docRefs.current[`${doc.id}-back`] : null;

        if (!frontElement) {
            toast({ title: "Erro", description: "Elemento do documento não encontrado para gerar o arquivo.", variant: "destructive" });
            return;
        }

        try {
            const frontCanvas = await html2canvas(frontElement, { backgroundColor: null, scale: 3, useCORS: true });
            let backCanvas;
            if (backElement) {
                backCanvas = await html2canvas(backElement, { backgroundColor: null, scale: 3, useCORS: true });
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
        } catch (e) {
            console.error("Erro ao gerar documento:", e);
            toast({ title: "Erro ao Gerar", description: "Ocorreu um problema ao capturar o documento.", variant: "destructive" });
        }
    };
    
    const handleGenerateAllDocs = async () => {
        const validDocs = documents.filter(d => d.is_valid);
        if (validDocs.length === 0) {
            toast({ title: "Aviso", description: "Nenhum documento válido para gerar." });
            return;
        }
        
        setIsGeneratingAllPdfs(true);
        toast({ title: "Gerando PDF...", description: "Isso pode levar alguns segundos. O download começará em breve." });

        try {
            const pdf = new jsPDF({ orientation: 'p', unit: 'px' });
            let isFirstPage = true;
            const pagePadding = 40;
            const docSpacing = 20;
        
            for (const doc of validDocs) {
                const frontElement = docRefs.current[`${doc.id}-front`];
                const backElement = docRefs.current[`${doc.id}-back`];
        
                if (frontElement) {
                    if (!isFirstPage) {
                        pdf.addPage();
                    }
                    isFirstPage = false;
        
                    const frontCanvas = await html2canvas(frontElement, { scale: 2, backgroundColor: null, useCORS: true });
                    const pageWidth = pdf.internal.pageSize.getWidth();
                    const pageHeight = pdf.internal.pageSize.getHeight();
                    
                    const availableWidth = pageWidth - (pagePadding * 2);
                    
                    let yPos = pagePadding;
    
                    pdf.setFontSize(16);
                    pdf.text(`${docInfo[doc.type]?.name || 'Documento'} - Frente`, pagePadding, yPos);
                    yPos += 10;
    
                    const frontScale = availableWidth / frontCanvas.width;
                    const frontImgWidth = frontCanvas.width * frontScale;
                    const frontImgHeight = frontCanvas.height * frontScale;
                    
                    pdf.addImage(frontCanvas.toDataURL('image/png'), 'PNG', pagePadding, yPos, frontImgWidth, frontImgHeight);
                    yPos += frontImgHeight + docSpacing;
    
                    if (backElement) {
                        const backCanvas = await html2canvas(backElement, { scale: 2, backgroundColor: null, useCORS: true });
                        
                        pdf.setFontSize(16);
                        pdf.text(`${docInfo[doc.type]?.name || 'Documento'} - Verso`, pagePadding, yPos);
                        yPos += 10;
    
                        const backScale = availableWidth / backCanvas.width;
                        const backImgWidth = backCanvas.width * backScale;
                        const backImgHeight = backCanvas.height * backScale;
    
                        if (yPos + backImgHeight > pageHeight - pagePadding) {
                            pdf.addPage();
                            yPos = pagePadding;
                            pdf.setFontSize(16);
                            pdf.text(`${docInfo[doc.type]?.name || 'Documento'} - Verso`, pagePadding, yPos);
                            yPos += 10;
                        }
    
                        pdf.addImage(backCanvas.toDataURL('image/png'), 'PNG', pagePadding, yPos, backImgWidth, backImgHeight);
                    }
                }
            }
        
            pdf.save(`documentos_govrp_${user.username}.pdf`);
            toast({ title: "Sucesso", description: "PDF com todos os documentos gerado." });
        } catch (error) {
            toast({ title: "Erro ao gerar PDF", description: "Ocorreu um problema ao criar o arquivo.", variant: "destructive" });
        } finally {
            setIsGeneratingAllPdfs(false);
        }
    };

    const formatFee = (fee) => {
        if (fee === 0) return "Gratuita";
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(fee);
    };

    const availableDocsToRequest = Object.keys(docInfo).filter(type => {
        if (['CPF', 'RG'].includes(type)) return false;
        if (type === 'CNPJ') return !getDoc(type, true); // can request if no valid cnpj exists
        return !getDoc(type, true);
    });

    return (
        <>
            <Helmet><title>DIC - GOV.RP</title><meta name="description" content="Departamento de Identificação Civil do GOV.RP." /></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                {loading || !user ? <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div> :
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                        <PageHeader icon={FileText} title="Departamento de Identificação" gradientText="Civil" description="Sua carteira de documentos digitais e histórico de cidadania." iconColor="text-purple-400" centered={true} />
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
                                            <DocumentCard key={doc.id} doc={doc} onVisualize={setVisualizingDoc} onGenerate={handleGenerateDoc} onDelete={setDeletingDoc} />
                                        ))}
                                        {documents.filter(d => d.is_valid).length === 0 && <p className="text-muted-foreground col-span-full text-center py-8">Nenhum documento válido encontrado.</p>}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                            <TabsContent value="history">
                                <div className="mt-6 space-y-6">
                                    {/* Profile Hero Card */}
                                    <Card className="glass-effect overflow-hidden">
                                        <div className="relative h-28 bg-gradient-to-r from-purple-900/60 via-indigo-900/60 to-blue-900/60">
                                            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDYwIDYwIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjAzIj48cGF0aCBkPSJNMzYgMzRWMGgySHY2aDJWNGgyVjJoMlYwaDJ2MmgtMnYyaC0ydjJoLTJ2MmgtMnYyaC0yLjAxbC4wMSAySDM2eiIvPjwvZz48L2c+PC9zdmc+')] opacity-70"></div>
                                        </div>
                                        <CardContent className="relative px-6 pb-6">
                                            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 -mt-14">
                                                <img
                                                    src={user.avatar_url}
                                                    alt={user.full_name}
                                                    className="w-24 h-24 rounded-2xl object-cover border-4 border-background shadow-xl"
                                                />
                                                <div className="text-center sm:text-left flex-1">
                                                    <h2 className="text-2xl font-bold text-foreground">{user.full_name}</h2>
                                                    <p className="text-primary text-sm font-medium">@{user.username}</p>
                                                </div>
                                                <div className="flex gap-2 flex-wrap justify-center">
                                                    {(Array.isArray(user.role) ? user.role : [user.role]).map((r, i) => (
                                                        <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">{r}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {/* Informações Pessoais */}
                                        <Card className="glass-effect">
                                            <CardHeader className="pb-4">
                                                <CardTitle className="flex items-center gap-2 text-lg">
                                                    <div className="p-2 rounded-lg bg-purple-500/20"><Mail className="w-4 h-4 text-purple-400" /></div>
                                                    Informações Pessoais
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Mail className="w-3.5 h-3.5 text-purple-400" /><p className="text-xs text-muted-foreground">E-mail</p></div>
                                                        <p className="text-sm font-medium text-foreground truncate">{user.email || 'Não informado'}</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Phone className="w-3.5 h-3.5 text-green-400" /><p className="text-xs text-muted-foreground">Telefone</p></div>
                                                        <p className="text-sm font-medium text-foreground">{formatPhone(user.phone) || 'Não informado'}</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><AtSign className="w-3.5 h-3.5 text-sky-400" /><p className="text-xs text-muted-foreground">@ do X</p></div>
                                                        <p className="text-sm font-medium text-foreground">{user.x_handle ? `@${user.x_handle}` : 'Nenhum'}</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><School className="w-3.5 h-3.5 text-emerald-400" /><p className="text-xs text-muted-foreground">Escolaridade</p></div>
                                                        <p className="text-sm font-medium text-foreground">{user.education_level || 'Não informado'}</p>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        {/* Status Civil & Político */}
                                        <Card className="glass-effect">
                                            <CardHeader className="pb-4">
                                                <CardTitle className="flex items-center gap-2 text-lg">
                                                    <div className="p-2 rounded-lg bg-pink-500/20"><Heart className="w-4 h-4 text-pink-400" /></div>
                                                    Status Civil & Político
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Heart className="w-3.5 h-3.5 text-pink-400" /><p className="text-xs text-muted-foreground">Estado Civil</p></div>
                                                        <p className="text-sm font-medium text-foreground">{user.marital_status || 'Não informado'}</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Flag className="w-3.5 h-3.5 text-orange-400" /><p className="text-xs text-muted-foreground">Filiação Partidária</p></div>
                                                        <p className="text-sm font-medium text-foreground">{affiliation?.is_affiliated ? `${affiliation.name} (${affiliation.acronym})` : 'Nenhuma'}</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Star className="w-3.5 h-3.5 text-yellow-400" /><p className="text-xs text-muted-foreground">Reputação Civil</p></div>
                                                        <p className="text-sm font-medium text-foreground">{user.reputation_points} pontos</p>
                                                    </div>
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-1"><Landmark className="w-3.5 h-3.5 text-amber-400" /><p className="text-xs text-muted-foreground">Pontos Políticos</p></div>
                                                        <p className="text-sm font-medium text-foreground">{user.political_points || 0} PP</p>
                                                    </div>
                                                </div>
                                                {user.titles && user.titles.length > 0 && (
                                                    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                                                        <div className="flex items-center gap-2 mb-2"><Award className="w-3.5 h-3.5 text-purple-400" /><p className="text-xs text-muted-foreground">Títulos e Condecorações</p></div>
                                                        <div className="flex flex-wrap gap-2">
                                                            {user.titles.map((title, i) => (
                                                                <span key={i} className="px-2 py-1 rounded-full text-xs bg-purple-500/10 text-purple-300 border border-purple-500/20">{title}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </div>

                                    {/* Documentos Emitidos */}
                                    <Card className="glass-effect">
                                        <CardHeader className="pb-4">
                                            <CardTitle className="flex items-center gap-2 text-lg">
                                                <div className="p-2 rounded-lg bg-sky-500/20"><FileText className="w-4 h-4 text-sky-400" /></div>
                                                Documentos Emitidos
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                                {[
                                                    { icon: Fingerprint, type: 'CPF', label: 'CPF', format: (v) => formatCPF(v), color: 'purple' },
                                                    { icon: FileText, type: 'RG', label: 'RG', format: (v) => formatRG(v), color: 'sky' },
                                                    { icon: Car, type: 'CNH', label: 'CNH', format: (v) => v, color: 'blue' },
                                                    { icon: Globe, type: 'Passport', label: 'Passaporte', format: (v) => v, color: 'green' },
                                                    { icon: Building, type: 'CNPJ', label: 'CNPJ', format: (v) => formatCNPJ(v), color: 'yellow' },
                                                    { icon: BriefcaseIcon, type: 'CTD', label: 'CTD', format: (v) => v, color: 'indigo' },
                                                    { icon: Vote, type: 'Título de Eleitor', label: 'Título de Eleitor', format: (v) => v, color: 'teal' },
                                                    { icon: ShieldCheck, type: 'Certificado de Reservista', label: 'Cert. Reservista', format: (v) => v, color: 'orange' },
                                                ].map(docDef => {
                                                    const doc = getDoc(docDef.type, true);
                                                    const hasDoc = !!doc;
                                                    return (
                                                        <div key={docDef.type} className={`p-3 rounded-xl border transition-all ${hasDoc ? `bg-${docDef.color}-500/5 border-${docDef.color}-500/20` : 'bg-white/5 border-white/10 opacity-50'}`}>
                                                            <div className="flex items-center gap-2 mb-2">
                                                                <docDef.icon className={`w-4 h-4 ${hasDoc ? `text-${docDef.color}-400` : 'text-muted-foreground'}`} />
                                                                <p className="text-xs text-muted-foreground">{docDef.label}</p>
                                                                {hasDoc && <span className="ml-auto w-2 h-2 rounded-full bg-green-500"></span>}
                                                            </div>
                                                            <p className={`text-sm font-mono font-medium ${hasDoc ? 'text-foreground' : 'text-muted-foreground'}`}>
                                                                {hasDoc ? docDef.format(doc.document_number) : 'Não emitido'}
                                                            </p>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            </TabsContent>
                            <TabsContent value="requests">
                                <Card className="glass-effect mt-6">
                                    <CardHeader><CardTitle>Solicitar Novos Documentos</CardTitle></CardHeader>
                                    <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {availableDocsToRequest.map(docType => (
                                            <Button key={docType} variant="outline" onClick={() => setConfirmingDoc(docType)} disabled={!!requesting} className="h-auto py-3">
                                                <div className="flex items-center w-full">
                                                    {React.createElement(docInfo[docType].icon, { className: `w-5 h-5 mr-3 ${docInfo[docType].color}` })}
                                                    <div className="text-left">
                                                        <p>{docInfo[docType].name}</p>
                                                        <p className="text-xs text-muted-foreground">Taxa: {formatFee(docFees[docType] || 0)}</p>
                                                    </div>
                                                </div>
                                            </Button>
                                        ))}
                                        {availableDocsToRequest.length === 0 && <p className="text-muted-foreground col-span-full text-center">Você já emitiu todos os documentos disponíveis.</p>}
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                        {activeTab === 'documents' && documents.filter(d => d.is_valid).length > 0 && (
                            <div className="mt-8 flex justify-center">
                                <Button onClick={handleGenerateAllDocs} disabled={isGeneratingAllPdfs}>
                                    {isGeneratingAllPdfs ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Files className="w-4 h-4 mr-2" />}
                                    {isGeneratingAllPdfs ? 'Gerando...' : 'Gerar PDF com Todos os Documentos'}
                                </Button>
                            </div>
                        )}
                    </motion.div>}
            </div>
            <div style={{ position: 'fixed', left: '-9999px', top: '0px', pointerEvents: 'none', opacity: 0 }}>
                {documents.map(doc => {
                    const docUser = doc.user || user;
                    if (!docUser) return null;
                    const hasTwoSides = !['Certidão de Casamento'].includes(doc.type);
                    return (
                        <React.Fragment key={`offscreen-${doc.id}`}>
                            <div ref={el => docRefs.current[`${doc.id}-front`] = el}>
                                <OfficialDocument user={docUser} doc={doc} side="front" />
                            </div>
                            {hasTwoSides && (
                                <div ref={el => docRefs.current[`${doc.id}-back`] = el}>
                                    <OfficialDocument user={docUser} doc={doc} side="back" />
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
            
            <Dialog open={!!visualizingDoc} onOpenChange={() => setVisualizingDoc(null)}>
                <DialogContent className="max-w-fit overflow-visible p-0 border-0 bg-transparent shadow-none [&>button]:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
                    {visualizingDoc && <OfficialDocument user={visualizingDoc.user || user} doc={visualizingDoc} onBack={() => setVisualizingDoc(null)} />}
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
            <AlertDialog open={!!deletingDoc} onOpenChange={() => setDeletingDoc(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Encerrar Empresa</AlertDialogTitle>
                        <AlertDialogDescription>
                            Tem certeza que deseja encerrar a empresa com o CNPJ {deletingDoc?.document_number}? Esta ação é irreversível e todos os produtos associados serão removidos.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={!!requesting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmDelete} disabled={!!requesting} className="bg-destructive hover:bg-destructive/90">
                            {requesting ? <Loader2 className="animate-spin" /> : "Confirmar Encerramento"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export default DIC;
