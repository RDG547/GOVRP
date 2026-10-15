import RecurringBillingStatus from '@/components/RecurringBillingStatus';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Flame, FileText, History, Wrench, Loader2, Gauge, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const Gas = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [service, setService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [currentPrice, setCurrentPrice] = useState(null);
    const serviceType = 'Gás';

    const fetchService = useCallback(async () => {
        if (!user) return;
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
            const presidentialPrice = prices['Gás'];

            if (presidentialPrice !== undefined) {
                setCurrentPrice(presidentialPrice);
            }

            const currentService = serviceData?.[0] || null;
            setService(currentService);

            if (currentService && presidentialPrice !== undefined && currentService.price !== presidentialPrice) {

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
    useDomainRealtime('recurring-gas',user?.id,[{table:'user_services',filter:`user_id=eq.${user?.id}`},'system_settings'],fetchService,Boolean(user?.id));

    const handleAction = (message) => {
        toast({ title: 'Aviso', description: message });
    };

    const displayPrice = currentPrice !== null && currentPrice !== undefined ? currentPrice : service?.price;

    return (
        <>
            <Helmet>
                <title>Gás Natural - GOV.RP</title>
                <meta name="description" content="Gerencie seu contrato de gás natural, consulte faturas e histórico de consumo." />
            </Helmet>
            
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Flame}
                    title="Fornecimento de"
                    gradientText="Gás Natural"
                    description="Gerencie seu contrato de fornecimento de gás, segurança e histórico."
                    iconColor="text-orange-500"
                    centered={true}
                />
                <RecurringBillingStatus service={service} onChanged={fetchService}/>

                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center py-20"><Loader2 className="h-12 w-12 text-orange-500 animate-spin" /></div>
                    ) : service ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="lg:col-span-2 space-y-6">
                                <Card className="glass-effect overflow-hidden border-orange-500/20 relative">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                                    <CardHeader className="pb-4">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <CardTitle className="text-2xl flex items-center gap-2">
                                                    <Flame className="w-6 h-6 text-orange-500" />
                                                    Meu Contrato de Gás
                                                </CardTitle>
                                                <CardDescription className="text-base mt-2">Plano Residencial Padrão</CardDescription>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm text-muted-foreground mb-1">Custo Semanal</div>
                                                <div className="text-3xl font-bold text-orange-500">{formatCurrency(displayPrice)}</div>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    
                                    <CardContent className="space-y-6">
                                        <div className="flex flex-col sm:flex-row gap-4">
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Pressão da Rede</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-green-400"><CheckCircle2 className="w-4 h-4"/> 1.5 bar (Segura)</p>
                                                </div>
                                                <Gauge className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                            <div className="flex-1 bg-background/50 rounded-xl p-4 border border-border flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm text-muted-foreground">Integridade da Linha</p>
                                                    <p className="font-medium flex items-center gap-2 mt-1 text-orange-400">Sem Vazamentos</p>
                                                </div>
                                                <Flame className="w-8 h-8 text-muted-foreground opacity-50" />
                                            </div>
                                        </div>

                                        <Alert className="bg-orange-500/10 border-orange-500/20">
                                            <AlertTriangle className="h-5 w-5 text-orange-500" />
                                            <AlertTitle className="text-orange-500">Serviço Essencial e Perigoso</AlertTitle>
                                            <AlertDescription className="text-orange-500/80">
                                                O fornecimento restrito de gás natural encanado é vital. Reporte cheiro forte imediatamente às autoridades e mantenha seu pagamento em dia.
                                            </AlertDescription>
                                        </Alert>
                                    </CardContent>
                                </Card>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-orange-500/30 transition-all h-full" onClick={() => handleAction('Histórico de consumo em breve.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                                                    <History className="w-6 h-6 text-orange-500" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-foreground">Ver Histórico</p>
                                                    <p className="text-sm text-muted-foreground mt-1">Consumo de metros cúbicos</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                    
                                    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                        <Card className="glass-effect cursor-pointer group hover:border-orange-500/30 transition-all h-full" onClick={() => handleAction('Segunda via indisponível no momento.')}>
                                            <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                                                <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                                                    <FileText className="w-6 h-6 text-orange-500" />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-foreground">Segunda Via</p>
                                                    <p className="text-sm text-muted-foreground mt-1">Imprimir fatura da semana</p>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                </div>
                            </motion.div>

                            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, delay: 0.2 }} className="space-y-6">
                                <Card className="glass-effect border-red-500/20">
                                    <CardHeader>
                                        <CardTitle className="text-lg flex items-center gap-2"><Wrench className="w-5 h-5 text-red-400" /> Emergência</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <p className="text-sm text-muted-foreground">
                                            Sentiu cheiro de gás ou há suspeita de vazamento? Não ligue interruptores. Acione o Esquadrão Químico dos Bombeiros IMEDIATAMENTE.
                                        </p>
                                        <Button className="w-full bg-red-500 hover:bg-red-600 text-white" onClick={() => handleAction('Bombeiros acionados. Funcionalidade em desenvolvimento.')}>
                                            <Flame className="w-4 h-4 mr-2" /> Reportar Vazamento
                                        </Button>
                                    </CardContent>
                                </Card>

                                <Card className="glass-effect relative overflow-hidden">
                                     <div className="absolute bottom-0 right-0 p-4 opacity-5 pointer-events-none">
                                         <Flame className="w-24 h-24" />
                                     </div>
                                    <CardHeader>
                                        <CardTitle className="text-lg">Infraestrutura Nacional</CardTitle>
                                        <CardDescription>Status geral da distribuição via gasodutos no país.</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-4">
                                             <div className="flex justify-between items-center text-sm">
                                                <span className="text-muted-foreground">Reservatório Nacional</span>
                                                <span className="font-bold text-orange-400">76%</span>
                                            </div>
                                            <div className="w-full bg-background rounded-full h-2">
                                                <div className="bg-orange-500 h-2 rounded-full" style={{ width: '76%' }}></div>
                                            </div>
                                            
                                            <div className="flex justify-between items-center text-sm mt-4">
                                                <span className="text-muted-foreground">Demanda Setorial</span>
                                                <span className="font-bold text-green-400">Baixa</span>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        </div>
                    ) : (
                        <div className="text-center py-20">
                            <Flame className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-20" />
                            <h3 className="text-xl font-semibold mb-2">Sem Serviço de Gás</h3>
                            <p className="text-muted-foreground">Você ainda não possui um contrato de fornecimento de gás ativo no seu nome.</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Gas;