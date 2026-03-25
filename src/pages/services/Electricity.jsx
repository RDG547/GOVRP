import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Zap, FileText, History, Wrench, Loader2, Gauge, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const Electricity = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [service, setService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPrice, setCurrentPrice] = useState(null);
    const serviceType = 'Energia Elétrica';

    const fetchService = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: serviceData, error: serviceError } = await supabase
                .from('user_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_type', serviceType);
            
            if (serviceError) throw serviceError;

            const { data: priceData, error: priceError } = await supabase
                .from('system_settings')
                .select('value')
                .eq('key', 'basic_service_prices')
                .limit(1)
                .maybeSingle();

            if (priceError && priceError.code !== 'PGRST116') throw priceError;

            const prices = priceData?.value || {};
            const presidentialPrice = prices['Energia Elétrica'];

            if (presidentialPrice !== undefined) {
                setCurrentPrice(presidentialPrice);
            }

            const currentService = serviceData?.[0] || null;
            setService(currentService);

            if (currentService && presidentialPrice !== undefined && currentService.price !== presidentialPrice) {
                await supabase
                    .from('user_services')
                    .update({ price: presidentialPrice })
                    .eq('id', currentService.id);
                setService({ ...currentService, price: presidentialPrice });
            }
        } catch (error) {
            toast({ title: 'Erro ao buscar serviço', variant: 'destructive', description: error.message });
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchService();
    }, [fetchService]);

    const handleAction = (message) => {
        toast({ title: 'Aviso', description: message });
    };

    const displayPrice = currentPrice !== null && currentPrice !== undefined ? currentPrice : service?.price;

    return (
        <>
            <Helmet>
                <title>Energia Elétrica - GOV.RP</title>
                <meta name="description" content="Gerencie seu contrato de energia elétrica, consulte faturas e histórico de consumo." />
            </Helmet>
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Zap}
                    title="Energia"
                    gradientText="Elétrica"
                    description="Gerencie seu contrato de energia elétrica, consulte faturas e histórico de consumo."
                    iconColor="text-yellow-400"
                    centered={true}
                />

                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center py-20"><Loader2 className="h-12 w-12 text-yellow-400 animate-spin" /></div>
                    ) : service ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="lg:col-span-2 space-y-6">
                                <Card className="glass-effect overflow-hidden border-yellow-500/20 relative">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-400/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                                    <CardHeader className="pb-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-2xl flex items-center gap-2">
                                                    <Zap className="w-6 h-6 text-yellow-400" />
                                                    Meu Contrato de Energia
                                                </CardTitle>
                                                <CardDescription className="text-base mt-2">Plano Padrão</CardDescription>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm text-muted-foreground mb-1">Custo Semanal</div>
                                                <div className="text-3xl font-bold text-yellow-400">{formatCurrency(displayPrice)}</div>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    
                                    <CardContent className="space-y-6">
                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Status da Rede</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-green-400"><CheckCircle2 className="w-4 h-4"/> Operante</p>
                                                </div>
                                                <Gauge className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Tensão</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-yellow-400">220V - Estável</p>
                                                </div>
                                                <Zap className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                        </div>

                                        <Alert className="bg-yellow-500/10 border-yellow-500/20">
                                            <AlertTriangle className="h-5 w-5 text-yellow-400" />
                                            <AlertTitle className="text-yellow-400">Serviço Essencial</AlertTitle>
                                            <AlertDescription className="text-yellow-400/80">
                                                O fornecimento de energia elétrica é um serviço essencial e obrigatório para todos os cidadãos. Mantenha seus pagamentos em dia.
                                            </AlertDescription>
                                        </Alert>
                                    </CardContent>
                                </Card>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-yellow-500/30 transition-all h-full" onClick={() => handleAction('Histórico de consumo em breve.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-yellow-400/10 flex items-center justify-center group-hover:bg-yellow-400/20 transition-colors">
                                                    <History className="w-6 h-6 text-yellow-400" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-lg text-foreground mb-1">Ver Histórico</h3>
                                                    <p className="text-sm text-muted-foreground">Consulte seu consumo passado.</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>

                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-blue-500/30 transition-all h-full" onClick={() => handleAction('Segunda via de fatura em breve.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                                    <FileText className="w-6 h-6 text-blue-400" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-lg text-foreground mb-1">Segunda Via da Fatura</h3>
                                                    <p className="text-sm text-muted-foreground">Emita a 2ª via da sua conta.</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="space-y-6">
                                <Card className="glass-effect border-red-500/20">
                                    <CardHeader>
                                        <CardTitle className="text-xl flex items-center gap-2">
                                            <Wrench className="w-5 h-5 text-red-400" />
                                            Manutenção e Suporte
                                        </CardTitle>
                                        <CardDescription>Teve algum problema com a sua rede? Queda de tensão ou fio partido?</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground mb-4">Caso identifique falhas na rede externa, acione os técnicos imediatamente.</p>
                                        <Button className="w-full bg-red-600 hover:bg-red-700 text-white" onClick={() => handleAction('Solicitação de manutenção em breve.')}>
                                            <Wrench className="w-4 h-4 mr-2" /> Solicitar Manutenção Urgente
                                        </Button>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>
                    ) : (
                        <div className="text-center py-20">
                            <Zap className="w-12 h-12 text-muted-foreground opacity-50 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-foreground">Aguardando Conexão</h3>
                            <p className="text-muted-foreground mt-2">Você ainda não possui um registro formal de ligação elétrica.</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Electricity;