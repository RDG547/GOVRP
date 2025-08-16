import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Siren, Search, PlusCircle, FileText } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';

const ReportDialog = ({ report, dialogOpen, setDialogOpen }) => {
    return (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{report ? report.title : "Nova Ocorrência"}</DialogTitle>
                    {report && <DialogDescription>Registrado por: {report.officer?.full_name || 'N/A'} em {format(new Date(report.report_time), 'dd/MM/yyyy HH:mm')}</DialogDescription>}
                </DialogHeader>
                {report && (
                    <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                        <div><Label>Detalhes</Label><p className="text-sm p-2 bg-slate-800 rounded-md whitespace-pre-wrap">{report.details}</p></div>
                        <div><Label>Partes Envolvidas</Label><p className="text-sm p-2 bg-slate-800 rounded-md">{report.involved_parties?.join(', ') || 'Nenhuma'}</p></div>
                        <div><Label>Local</Label><p className="text-sm p-2 bg-slate-800 rounded-md">{report.location || 'Não informado'}</p></div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

const NewReportDialog = ({ onReportAdded }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ title: '', details: '', involved_parties: '', location: '' });
    
    const handleChange = (e) => {
        setFormData(prev => ({...prev, [e.target.id]: e.target.value}));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const reportData = {
            officer_id: user.id,
            title: formData.title,
            details: formData.details,
            location: formData.location,
            involved_parties: formData.involved_parties.split(',').map(p => p.trim()),
            report_time: new Date().toISOString()
        };

        const { error } = await supabase.from('police_reports').insert(reportData);
        if (error) {
            toast({ title: 'Erro ao registrar ocorrência', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Ocorrência registrada.' });
            onReportAdded();
            setIsOpen(false);
            setFormData({ title: '', details: '', involved_parties: '', location: '' });
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button><PlusCircle className="mr-2 h-4 w-4" /> Nova Ocorrência</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Registrar Nova Ocorrência</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2"><Label htmlFor="title">Título</Label><Input id="title" value={formData.title} onChange={handleChange} required /></div>
                    <div className="grid gap-2"><Label htmlFor="details">Detalhes</Label><Textarea id="details" value={formData.details} onChange={handleChange} required /></div>
                    <div className="grid gap-2"><Label htmlFor="involved_parties">Partes Envolvidas (separadas por vírgula)</Label><Input id="involved_parties" value={formData.involved_parties} onChange={handleChange} /></div>
                    <div className="grid gap-2"><Label htmlFor="location">Local</Label><Input id="location" value={formData.location} onChange={handleChange} /></div>
                    <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Registrar</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const PolicePanel = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedReport, setSelectedReport] = useState(null);
    const [isReportOpen, setIsReportOpen] = useState(false);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('police_reports')
            .select('*, officer:profiles(full_name)')
            .order('report_time', { ascending: false });

        if (searchTerm) {
            query = query.ilike('title', `%${searchTerm}%`);
        }
        
        const { data, error } = await query;
        if (error) {
            toast({ title: "Erro ao carregar ocorrências", variant: "destructive" });
        } else {
            setReports(data || []);
        }
        
        setLoading(false);
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const handleViewDetails = (report) => {
        setSelectedReport(report);
        setIsReportOpen(true);
    };

    const isAuthorized = user && (Array.isArray(user.role) ? user.role.includes('Admin') || user.role.includes('Police') : user.role === 'Admin' || user.role === 'Police');

    return (
        <>
            <Helmet>
                <title>Painel da Polícia - GOV.RP</title>
                <meta name="description" content="Painel de controle do departamento de polícia." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Siren}
                    title="Painel do Departamento de"
                    gradientText="Polícia"
                    description="Servir e proteger a comunidade. Registre e consulte ocorrências."
                    iconColor="text-blue-500"
                />
                
                <div className="flex justify-between items-center mb-8">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por título da ocorrência..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 text-lg"
                        />
                    </div>
                    {isAuthorized && <NewReportDialog onReportAdded={fetchReports} />}
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-border">
                                    <TableHead>Título</TableHead>
                                    <TableHead>Oficial Responsável</TableHead>
                                    <TableHead>Data</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {reports.length > 0 ? reports.map(report => (
                                    <TableRow key={report.id} className="border-b-border">
                                        <TableCell className="font-medium">{report.title}</TableCell>
                                        <TableCell>{report.officer?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{format(new Date(report.report_time), 'dd/MM/yyyy HH:mm')}</TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleViewDetails(report)}><FileText className="w-4 h-4 mr-2"/>Ver Detalhes</Button>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow><TableCell colSpan="4" className="text-center py-10 text-muted-foreground">Nenhuma ocorrência encontrada.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
            {selectedReport && <ReportDialog report={selectedReport} dialogOpen={isReportOpen} setDialogOpen={setIsReportOpen} />}
        </>
    );
};

export default PolicePanel;