import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Wrench, CheckCircle, Clock, Loader2, PenTool, Zap, Droplet, Send, UserCog, Briefcase, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const serviceTypes = [
    { name: 'Elétrica', price: 150.00, icon: Zap, color: 'text-yellow-400' },
    { name: 'Hidráulica', price: 120.00, icon: Droplet, color: 'text-blue-400' },
    { name: 'Pintura', price: 250.00, icon: PenTool, color: 'text-pink-400' },
    { name: 'Alvenaria', price: 300.00, icon: Wrench, color: 'text-orange-400' },
    { name: 'Limpeza Geral', price: 100.00, icon: Briefcase, color: 'text-emerald-400' },
    { name: 'Jardinagem', price: 80.00, icon: Briefcase, color: 'text-green-400' }
];

const Maintenance = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [requests, setRequests] = useState([]);
    const [serviceType, setServiceType] = useState('');
    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const serviceIdentifier = 'Manutenção';

    useEffect(() => {
        const fetchRequests = async () => {
            if (!user) return;
            setLoading(true);
            const { data, error } = await supabase
                .from('user_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_type', serviceIdentifier)
                .order('contracted_at', { ascending: false });

            if (error) {
                toast({ title: 'Erro ao buscar solicitações', variant: 'destructive' });
            } else {
                setRequests(data);
            }
            setLoading(false);
        };
        fetchRequests();
    }, [user, toast]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const selectedService = serviceTypes.find(s => s.name === serviceType);
        if (!selectedService || !description || !address) {
            toast({ title: 'Campos obrigatórios', variant: 'destructive' });
            return;
        }

        setActionLoading(true);
        const { data, error } = await supabase.from('user_services').insert({
            user_id: user.id,
            service_type: serviceIdentifier,
            plan_name: `${selectedService.name} em ${address}`,
            price: selectedService.price,
            is_active: false,
            metadata: { description, address, status: 'Pendente', iconType: selectedService.name }
        }).select().single();

        if (error) {
            toast({ title: 'Erro ao enviar solicitação', variant: 'destructive' });
        } else {
            toast({ title: 'Solicitação Enviada', description: `Sua OS de ${serviceType} foi gerada com sucesso.` });
            setRequests(prev => [data, ...prev]);
            setServiceType('');
            setDescription('');
            setAddress('');
        }
        setActionLoading(false);
    };

    const getStatusStyle = (status) => {
        switch (status) {
            case 'Concluído': return { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
            case 'Pendente': return { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' };
            default: return { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20' };
        }
    };
    
    const getStatusIcon = (status) => {
        switch (status) {
            case 'Concluído': return <CheckCircle className="w-4 h-4" />;
            case 'Pendente': return <Clock className="w-4 h-4 animate-pulse" />;
            default: return null;
        }
    };

    const getServiceIcon = (name) => {
        const found = serviceTypes.find(s => s.name === name);
        if(found) {
            const Icon = found.icon;
            return <Icon className={`w-5 h-5 ${found.color}`} />;
        }
        return <Wrench className="w-5 h-5 text-gray-400" />;
    };

    return (
        <>
            <Helmet>
                <title>Manutenção - GOV.RP</title>
                <meta name="description" content="Contrate serviços de manutenção para sua casa ou empresa." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Wrench}
                    title="Serviços de"
                    gradientText="Manutenção"
                    description="Contrate profissionais para reparos e manutenção geral."
                    iconColor="text-gray-400"
                    centered={true}
                />
                
                <div className="mt-12">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }}>
                            <Card className="glass-effect border-gray-500/20 bg-gradient-to-br from-background to-gray-900/10 overflow-hidden relative">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-gray-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                                <CardHeader className="pb-4 border-b border-white/5 bg-black/20">
                                    <CardTitle className="flex items-center gap-2 text-2xl"><UserCog className="w-6 h-6 text-gray-400" /> Abertura de O.S.</CardTitle>
                                    <CardDescription>Crie uma ordem de serviço técnico.</CardDescription>
                                </CardHeader>
                                <form onSubmit={handleSubmit}>
                                    <CardContent className="space-y-5 pt-6 relative z-10">
                                        <div className="space-y-2">
                                            <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">Especialidade Necessária</Label>
                                            <Select value={serviceType} onValueChange={setServiceType}>
                                                <SelectTrigger className="h-12 bg-black/40 border-gray-500/20 focus:ring-gray-500">
                                                    <SelectValue placeholder="Selecione o tipo de serviço" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {serviceTypes.map(type => (
                                                        <SelectItem key={type.name} value={type.name}>
                                                            <div className="flex items-center gap-2">
                                                                <type.icon className={`w-4 h-4 ${type.color}`} />
                                                                <span>{type.name} - {formatCurrency(type.price)}</span>
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="address" className="text-muted-foreground uppercase text-xs font-bold tracking-wider">Local do Atendimento</Label>
                                            <Input id="address" className="h-12 bg-black/40 border-gray-500/20 focus-visible:ring-gray-500" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ex: Rua das Flores, 123 - Centro" />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="description" className="text-muted-foreground uppercase text-xs font-bold tracking-wider">Relato do Problema</Label>
                                            <Textarea id="description" className="min-h-[120px] bg-black/40 border-gray-500/20 focus-visible:ring-gray-500 resize-none" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva os detalhes do que precisa ser reparado, vazamentos, curtos, etc." />
                                        </div>
                                    </CardContent>
                                    <CardFooter className="bg-black/20 border-t border-white/5 p-4">
                                        <Button type="submit" className="w-full h-12 text-lg font-bold bg-white text-black hover:bg-gray-200" disabled={actionLoading}>
                                            {actionLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                                            Emitir Chamado
                                        </Button>
                                    </CardFooter>
                                </form>
                            </Card>
                        </motion.div>

                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="flex flex-col h-full">
                            <Card className="glass-effect border-gray-500/20 flex-grow flex flex-col">
                                <CardHeader className="bg-black/20 border-b border-white/5">
                                    <CardTitle className="flex items-center gap-2 text-xl"><FileText className="w-5 h-5 text-gray-400" /> Histórico de OS</CardTitle>
                                </CardHeader>
                                <CardContent className="flex-grow p-0">
                                    {loading ? (
                                        <div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 text-gray-400 animate-spin" /></div>
                                    ) : requests.length > 0 ? (
                                        <div className="overflow-y-auto max-h-[500px] custom-scrollbar p-6 space-y-4 relative">
                                            <div className="absolute left-10 top-6 bottom-6 w-px bg-white/5 z-0 hidden sm:block"></div>
                                            <AnimatePresence>
                                                {requests.map((req, idx) => {
                                                    const style = getStatusStyle(req.metadata?.status);
                                                    return (
                                                        <motion.div key={req.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }} className="relative z-10 flex gap-4 sm:gap-6 items-start">
                                                            <div className={`hidden sm:flex shrink-0 w-10 h-10 rounded-full bg-black/60 border ${style.border} items-center justify-center`}>
                                                                {getServiceIcon(req.metadata?.iconType || req.plan_name.split(' ')[0])}
                                                            </div>
                                                            <div className={`flex-1 p-5 rounded-xl border ${style.border} ${style.bg} backdrop-blur-sm bg-black/40 hover:bg-black/60 transition-colors`}>
                                                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 mb-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="sm:hidden shrink-0 w-8 h-8 rounded-full bg-black/40 flex items-center justify-center">
                                                                             {getServiceIcon(req.metadata?.iconType || req.plan_name.split(' ')[0])}
                                                                        </div>
                                                                        <h4 className="font-bold text-lg leading-tight text-white">{req.plan_name}</h4>
                                                                    </div>
                                                                    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${style.border} ${style.color} bg-black/40 w-fit`}>
                                                                        {getStatusIcon(req.metadata?.status)}
                                                                        {req.metadata?.status || 'N/A'}
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-2 mt-2 pt-3 border-t border-white/5">
                                                                    <p className="text-sm text-gray-300 line-clamp-2">{req.metadata?.description}</p>
                                                                    <div className="flex justify-between items-center text-xs mt-2">
                                                                        <span className="text-muted-foreground">{new Date(req.contracted_at).toLocaleDateString('pt-BR')}</span>
                                                                        <span className="font-bold text-gray-300 bg-black/50 px-2 py-1 rounded">{formatCurrency(req.price)}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    );
                                                })}
                                            </AnimatePresence>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
                                            <div className="w-20 h-20 bg-black/20 rounded-full flex items-center justify-center border border-white/5 mb-4">
                                                <ToolsIcon className="h-10 w-10 text-muted-foreground/30" />
                                            </div>
                                            <h3 className="text-xl font-bold text-white mb-2">Histórico Limpo</h3>
                                            <p className="text-muted-foreground max-w-sm">Nenhuma solicitação de manutenção foi feita por você até o momento.</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </motion.div>
                    </div>
                </div>
            </div>
        </>
    );
};

const ToolsIcon = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
);

export default Maintenance;