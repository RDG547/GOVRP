import { useInternetSpeed } from '@/contexts/InternetSpeedContext';
import { getInternetDelay } from '@/lib/internetPlans';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Wifi, Signal, Loader2, Globe, Cpu, Zap, Radio, ShieldCheck, Activity } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

const Internet = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const { currentService, refreshPlan } = useInternetSpeed();
    const [loading, setLoading] = useState(true);
    const [changingPlan, setChangingPlan] = useState(false);
    const [plans, setPlans] = useState([]);
    const serviceType = 'Internet';

    const fetchServiceAndPlans = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const serviceData = await refreshPlan();

            let prices = {};
            try {
                const { data: priceData, error: priceError } = await supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').limit(1).maybeSingle();
                if (!priceError && priceData) {
                    prices = priceData.value || {};
                }
            } catch (e) {
                console.warn("Falha ao buscar preços do backend, usando valores padrão", e);
            }

            const defaultPlans = [
                { id: 1, name: 'Básico', speed: '100 Mbps', price: prices['Internet_Básico'] !== undefined ? prices['Internet_Básico'] : 79.90, description: 'Navegação estável para uso cotidiano e redes sociais.', icon: Wifi, color: 'text-cyan-400', progress: 33 },
                { id: 2, name: 'Ultra', speed: '500 Mbps', price: prices['Internet_Ultra'] !== undefined ? prices['Internet_Ultra'] : 99.90, description: 'Banda larga otimizada para streaming 4K e nuvem.', icon: Zap, color: 'text-blue-400', progress: 66 },
                { id: 3, name: 'Mega', speed: '1 Gbps', price: prices['Internet_Mega'] !== undefined ? prices['Internet_Mega'] : 149.90, description: 'Velocidade extrema, ping zero para jogos e alta performance.', icon: Cpu, color: 'text-purple-400', progress: 100 },
            ];
            setPlans(defaultPlans);

            if (!serviceData) {
                const basicPlan = defaultPlans[0];
                const { error: insertError } = await supabase.from('user_services').upsert({
                    user_id: user.id, service_type: serviceType,
                    plan_name: basicPlan.name, price: basicPlan.price,
                }, { onConflict: 'user_id,service_type', ignoreDuplicates: true });
                if (insertError) throw insertError;
                await refreshPlan();
            }

        } catch (error) {
            toast({ title: 'Erro ao buscar dados', variant: 'destructive', description: error.message });
        } finally {
            setLoading(false);
        }
    }, [user?.id, toast, refreshPlan]);

    useEffect(() => {
        fetchServiceAndPlans();
    }, [fetchServiceAndPlans]);

    const handlePlanChange = async (plan) => {
        if (!currentService) return;
        setChangingPlan(plan.id);
        try {
            const { data, error } = await supabase
                .from('user_services')
                .update({ plan_name: plan.name, price: plan.price })
                .eq('id', currentService.id)
                .select()
                .maybeSingle();

            if (error || !data) {
                toast({ title: 'Erro na atualização de rede', description: error?.message || 'O plano não foi atualizado. Tente novamente.', variant: 'destructive' });
            } else {
                toast({ title: 'Uplink Concluído!', description: `Módulo de rede atualizado para ${plan.name}.` });
                await refreshPlan();
            }
        } catch (error) {
            toast({ title: 'Não foi possível atualizar o plano', description: error.message, variant: 'destructive' });
        } finally {
            setChangingPlan(false);
        }

    };

    return (
        <>
            <Helmet>
                <title>GlobalNet (Internet) - GOV.RP</title>
                <meta name="description" content="Acesse o hub cibernético nacional. Planos de internet de altíssima velocidade." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Wifi}
                    title="Serviços de"
                    gradientText="Internet"
                    description="Hub central de conectividade da nação. Ajuste seu roteamento e banda larga abaixo."
                    iconColor="text-cyan-400"
                    centered={true}
                />

                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center items-center py-20">
                            <div className="relative">
                                <Activity className="h-16 w-16 text-cyan-500 animate-pulse" />
                                <div className="absolute inset-0 border-4 border-cyan-500/20 rounded-full animate-ping"></div>
                            </div>
                        </div>
                    ) : (
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-10">
                            <Card className="lg:col-span-3 glass-effect border-cyan-500/20 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-[40rem] h-[40rem] bg-cyan-500/5 rounded-full blur-3xl -mr-64 -mt-64 pointer-events-none" />
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <div className="space-y-1">
                                        <CardTitle className="text-2xl font-bold flex items-center gap-2">
                                            <Radio className="w-6 h-6 text-cyan-400" /> Rede Doméstica <span className="text-xs uppercase bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded-full ml-2">Online</span>
                                        </CardTitle>
                                        <CardDescription>Gateway de conexão e tráfego criptografado</CardDescription>
                                    </div>
                                    <ShieldCheck className="w-12 h-12 text-cyan-500/20" />
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div className="bg-black/40 rounded-lg p-4 border border-cyan-500/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Módulo Atual</p>
                                            <p className="text-2xl font-bold text-white mt-1">{currentService?.plan_name || 'Desconectado'}</p>
                                        </div>
                                        <div className="bg-black/40 rounded-lg p-4 border border-cyan-500/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Largura de Banda</p>
                                            <p className="text-2xl font-bold text-cyan-400 mt-1">{plans.find(p => p.name === currentService?.plan_name)?.speed || '--'}</p>
                                        </div>
                                        <div className="bg-black/40 rounded-lg p-4 border border-cyan-500/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Custo Semanal</p>
                                            <p className="text-2xl font-bold text-white mt-1">{formatCurrency(currentService?.price || 0)}</p>
                                        </div>
                                        <div className="bg-black/40 rounded-lg p-4 border border-cyan-500/10">
                                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Latência (Ping)</p>
                                            <p className="text-2xl font-bold text-emerald-400 mt-1">12ms</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="glass-effect border-purple-500/20 bg-gradient-to-br from-background to-purple-900/10">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Cpu className="w-5 h-5 text-purple-400" /> Data Center</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-xs mb-1">
                                            <span className="text-muted-foreground">Estabilidade Nacional</span>
                                            <span className="text-purple-400">99.8%</span>
                                        </div>
                                        <Progress value={99.8} className="h-1 bg-black/40" indicatorClassName="bg-purple-500" />
                                    </div>
                                    <Alert className="bg-cyan-500/10 border-cyan-500/20 py-2">
                                        <AlertDescription className="text-xs text-cyan-100/70">
                                            A conexão virtual é requisito cívico de comunicação com o Estado.
                                        </AlertDescription>
                                    </Alert>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-white">Upgrade de Hardware de Fibra</h2>
                            <p className="text-muted-foreground">Selecione um terminal de velocidade maior para necessidades complexas.</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <AnimatePresence>
                                {plans.map((plan, idx) => {
                                    const PlanIcon = plan.icon;
                                    const isCurrent = currentService?.plan_name === plan.name;
                                    const isUpgrading = changingPlan === plan.id;
                                    return (
                                        <motion.div key={plan.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.1 }}>
                                            <Card className={`glass-effect flex flex-col h-full relative overflow-hidden transition-all duration-300 ${isCurrent ? 'border-cyan-500 ring-1 ring-cyan-500 shadow-[0_0_30px_-5px_rgba(6,182,212,0.3)]' : 'hover:border-cyan-500/30'}`}>
                                                {isCurrent && <div className="absolute top-0 inset-x-0 h-1 bg-cyan-500 shadow-[0_0_10px_#06b6d4]"></div>}
                                                <CardHeader className="text-center pb-2">
                                                    <div className={`mx-auto w-16 h-16 rounded-2xl bg-black/50 border border-white/5 flex items-center justify-center mb-4 ${isCurrent ? 'shadow-[inset_0_0_20px_rgba(6,182,212,0.2)]' : ''}`}>
                                                        <PlanIcon className={`h-8 w-8 ${plan.color}`} />
                                                    </div>
                                                    <CardTitle className="text-2xl font-bold tracking-tight">{plan.name}</CardTitle>
                                                    <div className={`text-3xl font-black tracking-tighter ${plan.color} mt-2 drop-shadow-md`}>{plan.speed}</div>
                                                </CardHeader>
                                                <CardContent className="flex-grow pt-4">
                                                    <p className="text-center text-sm text-gray-400 mb-6">{getInternetDelay(plan.name) === 0 ? 'Navegação instantânea, sem espera.' : `Espera de ${getInternetDelay(plan.name) / 1000} segundos ao acessar outro serviço.`}</p>

                                                    <div className="space-y-1 mb-6">
                                                        <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
                                                            <span>Potência de Transmissão</span>
                                                            <span>{plan.progress}%</span>
                                                        </div>
                                                        <Progress value={plan.progress} className="h-1.5 bg-black/50" indicatorClassName={`bg-gradient-to-r from-transparent to-${plan.color.split('-')[1]}-500`} />
                                                    </div>
                                                </CardContent>
                                                <CardFooter className="flex-col gap-4 mt-auto">
                                                    <div className="text-2xl font-bold text-white">{formatCurrency(plan.price)}<span className="text-sm font-normal text-muted-foreground">/sem</span></div>
                                                    <Button
                                                        variant={isCurrent ? 'secondary' : 'default'}
                                                        className={`w-full font-bold uppercase tracking-wider ${isCurrent ? 'bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20' : ''}`}
                                                        onClick={() => handlePlanChange(plan)}
                                                        disabled={changingPlan || isCurrent}
                                                    >
                                                        {isUpgrading ? (
                                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando...</>
                                                        ) : isCurrent ? (
                                                            <><ShieldCheck className="mr-2 h-4 w-4" /> Ativo</>
                                                        ) : (
                                                            <><Signal className="mr-2 h-4 w-4" /> Alterar Plano</>
                                                        )}
                                                    </Button>
                                                </CardFooter>
                                            </Card>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                    )}
                </div>
            </div>
        </>
    );
};

export default Internet;
