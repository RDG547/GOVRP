import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Droplet, FileQuestion, AlertTriangle, CheckCircle, BarChart, Loader2, Info, Activity, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const Water = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [service, setService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [waterQuality, setWaterQuality] = useState(98);
    const [currentPrice, setCurrentPrice] = useState(null);
    const serviceType = 'Água';

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
            const presidentialPrice = prices['Água'];

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

            // Simulate slight variation in water quality
            setWaterQuality(Math.floor(Math.random() * (100 - 95 + 1) + 95));
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
                <title>Água e Saneamento - GOV.RP</title>
                <meta name="description" content="Serviços de abastecimento de água e saneamento." />
            </Helmet>
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Droplet}
                    title="Água e"
                    gradientText="Saneamento"
                    description="Consulte informações sobre seu abastecimento, contas e qualidade da água."
                    iconColor="text-blue-400"
                    centered={true}
                />

                <div className="mt-12">
                     {loading ? (
                        <div className="flex justify-center py-20"><Loader2 className="h-12 w-12 text-blue-400 animate-spin" /></div>
                    ) : service ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="lg:col-span-2 space-y-6">
                                <Card className="glass-effect overflow-hidden border-blue-500/20 relative">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-400/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                                    <CardHeader className="pb-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-2xl flex items-center gap-2">
                                                    <Droplet className="w-6 h-6 text-blue-400" />
                                                    Meu Contrato de Água
                                                </CardTitle>
                                                <CardDescription className="text-base mt-2">Plano Padrão</CardDescription>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm text-muted-foreground mb-1">Custo Semanal</div>
                                                <div className="text-3xl font-bold text-blue-400">{formatCurrency(displayPrice)}</div>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    
                                    <CardContent className="space-y-6">
                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Fornecimento</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-green-400"><CheckCircle className="w-4 h-4"/> Normalizado</p>
                                                </div>
                                                <Activity className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Pressão da Rede</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-blue-400">Excelente</p>
                                                </div>
                                                <Droplet className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                        </div>

                                        <Alert className="bg-blue-500/10 border-blue-500/20">
                                            <Info className="h-5 w-5 text-blue-400" />
                                            <AlertTitle className="text-blue-400">Serviço Essencial</AlertTitle>
                                            <AlertDescription className="text-blue-400/80">
                                                O fornecimento de água é um serviço essencial e obrigatório para todos os cidadãos. Pratique o consumo consciente.
                                            </AlertDescription>
                                        </Alert>
                                    </CardContent>
                                </Card>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-blue-500/30 transition-all h-full" onClick={() => handleAction('Histórico de consumo em breve.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
                                                    <BarChart className="w-6 h-6 text-blue-400" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-lg text-foreground mb-1">Histórico de Consumo</h3>
                                                    <p className="text-sm text-muted-foreground">Acompanhe seu gasto mensal de metros cúbicos.</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>

                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-red-500/30 transition-all h-full" onClick={() => handleAction('Relato de vazamento em breve.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                                                    <AlertTriangle className="w-6 h-6 text-red-500" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-lg text-foreground mb-1">Relatar Vazamento</h3>
                                                    <p className="text-sm text-muted-foreground">Avise a companhia sobre problemas na rua ou cavalete.</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="space-y-6">
                                <Card className="glass-effect border-cyan-500/20 overflow-hidden relative">
                                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-cyan-400/10 rounded-full blur-3xl pointer-events-none" />
                                    <CardHeader>
                                        <CardTitle className="flex items-center gap-2">
                                            <ShieldCheck className="w-5 h-5 text-cyan-400" />
                                            Qualidade da Água
                                        </CardTitle>
                                        <CardDescription>Monitoramento em tempo real na sua região.</CardDescription>
                                    </CardHeader>
                                    <CardContent className="text-center pt-4 pb-8">
                                        <div className="relative inline-flex items-center justify-center mb-6">
                                            <svg className="w-32 h-32 transform -rotate-90">
                                                <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-muted/30" />
                                                <circle cx="64" cy="64" r="60" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-cyan-400" strokeDasharray={377} strokeDashoffset={377 - (377 * waterQuality) / 100} strokeLinecap="round" />
                                            </svg>
                                            <div className="absolute flex flex-col items-center justify-center">
                                                <span className="text-3xl font-bold text-foreground">{waterQuality}%</span>
                                                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Acima da média</span>
                                            </div>
                                        </div>
                                        <h4 className="font-semibold mb-2">Índice de Potabilidade</h4>
                                        <div className="bg-background/80 rounded-lg p-3 inline-flex items-center justify-center gap-2 border border-border">
                                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                                            <span className="text-sm">Água segura para consumo</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>

                        </div>
                    ) : (
                        <div className="text-center py-20">
                            <Droplet className="w-12 h-12 text-muted-foreground opacity-50 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-foreground">Aguardando Conexão</h3>
                            <p className="text-muted-foreground mt-2">Você ainda não possui um registro formal de ligação de água.</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Water;