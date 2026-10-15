import RecurringBillingStatus from '@/components/RecurringBillingStatus';
import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { Smartphone, Check, Plus, Minus, Loader2, Signal, RadioTower, PhoneCall, Wifi, MessageSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';

const PhoneService = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [currentService, setCurrentService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [changingPlan, setChangingPlan] = useState(false);
    const [plans, setPlans] = useState([]);
    const serviceType = 'Telefonia';

    const fetchServiceAndPlans = useCallback(async () => {
        if (!user) return;
        try {
            const { data: serviceData, error: serviceError } = await supabase
                .from('user_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_type', serviceType)
                .limit(1)
                .maybeSingle();
            
            if (serviceError && serviceError.code !== 'PGRST116') throw serviceError;
            
            let prices = {};
            try {
                const { data: priceData, error: priceError } = await supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').limit(1).maybeSingle();
                if (!priceError && priceData) {
                    prices = priceData.value || {};
                }
            } catch(e) {
                console.warn("Falha ao buscar config de preço de telefonia", e);
            }
            
            const defaultPlans = [
                { id: 1, name: 'Básico', data: '5 GB', calls: 'Ilimitadas', price: prices['Telefonia_Básico'] !== undefined ? prices['Telefonia_Básico'] : 29.90, desc: 'Pacote 3G/4G para WhatsApp e ligações locais.', icon: Signal, color: 'text-violet-400', progress: 25 },
                { id: 2, name: 'Intermediário', data: '15 GB', calls: 'Ilimitadas', price: prices['Telefonia_Intermediário'] !== undefined ? prices['Telefonia_Intermediário'] : 49.90, desc: 'Internet 4G+ rápida para redes sociais e GPS.', icon: Wifi, color: 'text-fuchsia-400', progress: 60 },
                { id: 3, name: 'Premium', data: '50 GB', calls: 'Internacionais', price: prices['Telefonia_Premium'] !== undefined ? prices['Telefonia_Premium'] : 79.90, desc: 'Acesso 5G global, roaming e máxima franquia livre.', icon: RadioTower, color: 'text-pink-400', progress: 100 },
            ];
            setPlans(defaultPlans);

            if(serviceData){
                const matchingPlan = defaultPlans.find(p => p.name === serviceData.plan_name);
                if (matchingPlan && matchingPlan.price !== undefined && serviceData.price !== matchingPlan.price) {
                    await supabase
                        .from('user_services')
                        .update({ price: matchingPlan.price })
                        .eq('id', serviceData.id);
                    serviceData.price = matchingPlan.price;
                }
                setCurrentService(serviceData);
            } else if(!user.is_admin_preview) {
                const basicPlan = defaultPlans.find(p => p.name === 'Básico');
                if (basicPlan) {
                    const { data: newService, error: insertError } = await supabase.from('user_services').insert({
                        user_id: user.id,
                        service_type: serviceType,
                        plan_name: basicPlan.name,
                        price: basicPlan.price,
                    }).select().maybeSingle();

                    if(insertError && insertError.code !== 'PGRST116') throw insertError;
                    setCurrentService(newService);
                }
            }

        } catch (error) {
            toast({ title: 'Erro ao buscar dados', variant: 'destructive', description: error.message });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        fetchServiceAndPlans();
    }, [fetchServiceAndPlans]);
    useDomainRealtime('recurring-phoneservice',user?.id,[{table:'user_services',filter:`user_id=eq.${user?.id}`},'system_settings'],fetchServiceAndPlans,Boolean(user?.id));

    const handlePlanChange = async (plan) => {
        if (!currentService) return;
        setChangingPlan(plan.id);
        const { data, error } = await supabase
            .from('user_services')
            .update({ plan_name: plan.name, price: plan.price })
            .eq('id', currentService.id)
            .select()
            .maybeSingle();
        
        if (error && error.code !== 'PGRST116') {
            toast({ title: 'Erro ao mudar de plano', variant: 'destructive' });
        } else {
            toast({ title: 'Sinal Atualizado!', description: `Seu chip agora está no plano ${plan.name}.` });
            setCurrentService({ ...currentService, plan_name: plan.name, price: plan.price });
        }
        setChangingPlan(false);
    };

    return (
        <>
            <Helmet>
                <title>Telefonia Móvel - GOV.RP</title>
                <meta name="description" content="Planos de telefonia móvel para se manter conectado." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Smartphone}
                    title="Serviços de"
                    gradientText="Telefonia"
                    description="Gerencie sua linha de telefone e consulte os planos disponíveis."
                    iconColor="text-violet-400"
                    centered={true}
                />
                <RecurringBillingStatus service={currentService?{...currentService,price:plans.find(plan=>plan.name===currentService.plan_name)?.price??currentService.price}:null} onChanged={fetchServiceAndPlans}/>
                
                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center items-center py-20">
                            <div className="flex gap-2">
                                <div className="w-4 h-4 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-4 h-4 rounded-full bg-fuchsia-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-4 h-4 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    ) : (
                        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-10">
                                <Card className="lg:col-span-3 glass-effect border-violet-500/20 relative overflow-hidden bg-gradient-to-br from-background to-violet-900/10">
                                    <div className="absolute top-0 right-0 w-[40rem] h-[40rem] bg-violet-500/5 rounded-full blur-3xl -mr-64 -mt-64 pointer-events-none" />
                                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                                        <div className="space-y-1">
                                            <CardTitle className="text-2xl font-bold flex items-center gap-2">
                                                <Smartphone className="w-6 h-6 text-violet-400" /> Meu Chip <span className="text-xs uppercase bg-green-500/20 text-green-400 px-2 py-1 rounded-full ml-2">Sinal Alto</span>
                                            </CardTitle>
                                            <CardDescription>Status atual da rede móvel e franquia de dados</CardDescription>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="pt-6">
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div className="bg-black/30 rounded-xl p-4 border border-violet-500/20">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Plano Vigente</p>
                                                <p className="text-2xl font-bold text-white mt-1">{currentService?.plan_name || 'Inexistente'}</p>
                                            </div>
                                            <div className="bg-black/30 rounded-xl p-4 border border-violet-500/20">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Franquia</p>
                                                <p className="text-2xl font-bold text-violet-400 mt-1">{plans.find(p => p.name === currentService?.plan_name)?.data || '--'}</p>
                                            </div>
                                            <div className="bg-black/30 rounded-xl p-4 border border-violet-500/20">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Ligações</p>
                                                <p className="text-2xl font-bold text-fuchsia-400 mt-1">{plans.find(p => p.name === currentService?.plan_name)?.calls || '--'}</p>
                                            </div>
                                            <div className="bg-black/30 rounded-xl p-4 border border-violet-500/20">
                                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Mensalidade</p>
                                                <p className="text-2xl font-bold text-white mt-1">{formatCurrency(currentService?.price || 0)}</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="glass-effect border-fuchsia-500/20">
                                    <CardHeader className="pb-4">
                                        <CardTitle className="flex items-center gap-2 text-lg"><PhoneCall className="w-5 h-5 text-fuchsia-400" /> Minutos</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="flex flex-col items-center justify-center py-4">
                                            <MessageSquare className="w-12 h-12 text-muted-foreground opacity-30 mb-2" />
                                            <p className="text-sm font-semibold text-center mt-2">VoLTE Ativo</p>
                                            <p className="text-xs text-muted-foreground text-center">Ligações garantem voz em HD.</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <Alert className="mb-8 border-violet-500/30 bg-violet-500/5">
                                <RadioTower className="h-5 w-5 text-violet-400" />
                                <AlertTitle className="text-violet-400 font-semibold">Tributação Especial de Telefonia</AlertTitle>
                                <AlertDescription className="text-muted-foreground">
                                    O serviço de Telefonia Móvel é regulado e obrigatório. Escalonamentos de banda possuem diferentes faixas de valores impostos pela agência de telecomunicação.
                                </AlertDescription>
                            </Alert>

                            <div className="text-center mb-8">
                                <h2 className="text-2xl font-bold text-white">Planos de Dados Móveis</h2>
                                <p className="text-muted-foreground">Altere a franquia do seu chip. A mudança é efetivada na hora via e-sim.</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                               <AnimatePresence>
                                   {plans.map((plan, idx) => {
                                       const PlanIcon = plan.icon;
                                       const isCurrent = currentService?.plan_name === plan.name;
                                       const isChanging = changingPlan === plan.id;
                                       
                                       return (
                                           <motion.div key={plan.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.1 }}>
                                               <Card className={`glass-effect flex flex-col h-full relative overflow-hidden transition-all duration-300 ${isCurrent ? 'border-violet-500 ring-1 ring-violet-500 shadow-[0_0_20px_-5px_rgba(139,92,246,0.3)]' : 'hover:border-violet-500/30 hover:-translate-y-1'}`}>
                                                   {isCurrent && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-violet-500 to-fuchsia-500"></div>}
                                                   
                                                   <CardHeader className="text-center pb-2">
                                                       <div className={`mx-auto w-16 h-16 rounded-full bg-black/40 flex items-center justify-center mb-4 ${isCurrent ? 'shadow-[inset_0_0_15px_rgba(139,92,246,0.2)]' : ''}`}>
                                                           <PlanIcon className={`h-8 w-8 ${plan.color}`} />
                                                       </div>
                                                       <CardTitle className="text-2xl">{plan.name}</CardTitle>
                                                       <div className={`text-4xl font-black mt-2 bg-clip-text text-transparent bg-gradient-to-r from-${plan.color.split('-')[1]}-400 to-${plan.color.split('-')[1]}-600`}>{plan.data}</div>
                                                       <p className="text-sm font-semibold text-white/80 mt-1 border border-white/10 rounded-full px-3 py-1 inline-block bg-white/5">{plan.calls}</p>
                                                   </CardHeader>
                                                   
                                                   <CardContent className="flex-grow pt-4">
                                                       <p className="text-center text-muted-foreground mb-6">{plan.desc}</p>
                                                       <div className="space-y-1">
                                                            <div className="flex justify-between text-[10px] uppercase text-muted-foreground">
                                                                <span>Cobertura de Sinal</span>
                                                                <span>{plan.progress}%</span>
                                                            </div>
                                                            <Progress value={plan.progress} className="h-1 bg-black/50" indicatorClassName={`bg-${plan.color.split('-')[1]}-500`} />
                                                        </div>
                                                   </CardContent>
                                                   
                                                   <CardFooter className="flex-col gap-4 mt-auto">
                                                       <div className="text-2xl font-bold bg-black/30 w-full text-center py-2 rounded-lg border border-white/5">
                                                           {formatCurrency(plan.price)}<span className="text-sm font-normal text-muted-foreground">/sem</span>
                                                        </div>
                                                        <Button 
                                                            className={`w-full font-bold uppercase ${isCurrent ? 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 border border-violet-500/50' : ''}`} 
                                                            variant={isCurrent ? "outline" : "default"}
                                                            onClick={() => handlePlanChange(plan)} 
                                                            disabled={changingPlan || isCurrent}
                                                        >
                                                            {isChanging ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Atualizando...</> : 
                                                            isCurrent ? <><Check className="mr-2 h-4 w-4" /> Chip Ativo</> : 'Contratar Plano'}
                                                        </Button>
                                                   </CardFooter>
                                               </Card>
                                           </motion.div>
                                       )
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

export default PhoneService;