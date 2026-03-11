import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Smartphone, Check, Plus, Minus, Loader2, Signal } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const PhoneService = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [currentService, setCurrentService] = useState(null);
    const [loading, setLoading] = useState(true);
    const [plans, setPlans] = useState([]);
    const serviceType = 'Telefonia';

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
            if (priceError && priceError.code !== 'PGRST116') throw priceError;
            
            const prices = priceData?.value || {};
            const defaultPlans = [
                { id: 1, name: 'Básico', data: '5 GB', calls: 'Ilimitadas', price: prices['Telefonia_Básico'] !== undefined ? prices['Telefonia_Básico'] : 29.90 },
                { id: 2, name: 'Intermediário', data: '15 GB', calls: 'Ilimitadas', price: prices['Telefonia_Intermediário'] !== undefined ? prices['Telefonia_Intermediário'] : 49.90 },
                { id: 3, name: 'Premium', data: '50 GB', calls: 'Ilimitadas', price: prices['Telefonia_Premium'] !== undefined ? prices['Telefonia_Premium'] : 79.90 },
            ];
            setPlans(defaultPlans);

            if(serviceData){
                setCurrentService(serviceData);
            } else {
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
                <title>Telefonia - GOV.RP</title>
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
                
                <div className="mt-8">
                    {loading ? (
                        <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <>
                            <Alert className="mb-8">
                                <Smartphone className="h-4 w-4" />
                                <AlertTitle>Serviço Essencial</AlertTitle>
                                <AlertDescription>
                                    O serviço de Telefonia é obrigatório. Você pode escolher o plano que melhor se adapta às suas necessidades.
                                </AlertDescription>
                            </Alert>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                               {plans.map(plan => (
                                   <Card key={plan.id} className={`glass-effect flex flex-col transition-all ${currentService?.plan_name === plan.name ? 'border-primary' : ''}`}>
                                       <CardHeader className="text-center">
                                           <Signal className="mx-auto h-12 w-12 text-violet-400 mb-4" />
                                           <CardTitle className="text-2xl">{plan.name}</CardTitle>
                                           <p className="text-lg font-semibold text-primary">{plan.data}</p>
                                       </CardHeader>
                                       <CardContent className="flex-grow">
                                           <p className="text-center text-muted-foreground">{plan.calls}</p>
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
                    )}
                </div>
            </div>
        </>
    );
};

export default PhoneService;