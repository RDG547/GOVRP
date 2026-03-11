import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Wifi, Signal, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const Internet = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [currentService, setCurrentService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [plans, setPlans] = useState([]);
    const serviceType = 'Internet';

    const fetchServiceAndPlans = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data: serviceData, error: serviceError } = await supabase
                .from('user_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_type', serviceType)
                .single();
            
            if (serviceError && serviceError.code !== 'PGRST116') throw serviceError;
            
            const { data: priceData, error: priceError } = await supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').single();
            if (priceError) throw priceError;
            
            const prices = priceData.value || {};
            const defaultPlans = [
                { id: 1, name: 'Básico', speed: '100 Mbps', price: prices['Internet_Básico'] !== undefined ? prices['Internet_Básico'] : 79.90, description: 'Ideal para navegar e redes sociais.' },
                { id: 2, name: 'Ultra', speed: '500 Mbps', price: prices['Internet_Ultra'] !== undefined ? prices['Internet_Ultra'] : 99.90, description: 'Perfeito para streaming 4K e jogos online.' },
                { id: 3, name: 'Mega', speed: '1 Gbps', price: prices['Internet_Mega'] !== undefined ? prices['Internet_Mega'] : 149.90, description: 'Para uso intenso e múltiplos dispositivos.' },
            ];
            setPlans(defaultPlans);

            if(serviceData){
                setCurrentService(serviceData);
            } else {
                // Auto-contract basic plan if none exists
                const basicPlan = defaultPlans.find(p => p.name === 'Básico');
                if (basicPlan) {
                    const { data: newService, error: insertError } = await supabase.from('user_services').insert({
                        user_id: user.id,
                        service_type: serviceType,
                        plan_name: basicPlan.name,
                        price: basicPlan.price,
                    }).select().single();

                    if(insertError) throw insertError;
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

    const handlePlanChange = async (plan) => {
        if (!currentService) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('user_services')
            .update({ plan_name: plan.name, price: plan.price })
            .eq('id', currentService.id)
            .select()
            .single();

        if (error) {
            toast({ title: 'Erro ao mudar de plano', variant: 'destructive' });
        } else {
            toast({ title: 'Plano Alterado!', description: `Seu plano agora é o ${plan.name}.` });
            setCurrentService(data);
        }
        setLoading(false);
    };

    return (
        <>
            <Helmet>
                <title>Internet - GOV.RP</title>
                <meta name="description" content="Contrate planos de internet para sua residência ou negócio." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Wifi}
                    title="Serviços de"
                    gradientText="Internet"
                    description="Gerencie seu plano de internet e mantenha-se conectado."
                    iconColor="text-cyan-400"
                    centered={true}
                />

                <div className="mt-8">
                    {loading ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> :
                    <>
                        <Alert className="mb-8">
                            <Wifi className="h-4 w-4" />
                            <AlertTitle>Serviço Essencial</AlertTitle>
                            <AlertDescription>
                                O serviço de Internet é obrigatório. Você pode escolher o plano que melhor se adapta às suas necessidades.
                            </AlertDescription>
                        </Alert>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            {plans.map(plan => (
                                <Card key={plan.id} className={`glass-effect flex flex-col transition-all ${currentService?.plan_name === plan.name ? 'border-primary' : ''}`}>
                                    <CardHeader className="text-center">
                                        <Signal className="mx-auto h-12 w-12 text-cyan-400 mb-4" />
                                        <CardTitle className="text-2xl">{plan.name}</CardTitle>
                                        <p className="text-4xl font-bold text-primary">{plan.speed}</p>
                                    </CardHeader>
                                    <CardContent className="flex-grow">
                                        <p className="text-center text-muted-foreground">{plan.description}</p>
                                    </CardContent>
                                    <CardFooter className="flex-col gap-4">
                                        <p className="text-2xl font-semibold">{formatCurrency(plan.price)}/semana</p>
                                        <Button 
                                            className="w-full" 
                                            onClick={() => handlePlanChange(plan)} 
                                            disabled={loading || currentService?.plan_name === plan.name}
                                        >
                                            {loading && currentService?.plan_name !== plan.name ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 
                                            currentService?.plan_name === plan.name ? 'Plano Atual' : 'Mudar para este Plano'}
                                        </Button>
                                    </CardFooter>
                                </Card>
                            ))}
                        </div>
                    </>
                    }
                </div>
            </div>
        </>
    );
};

export default Internet;