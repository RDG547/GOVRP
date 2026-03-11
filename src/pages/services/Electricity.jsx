import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Zap, FileText, History, Wrench, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
                .single();

            if (priceError && priceError.code !== 'PGRST116') throw priceError;

            const prices = priceData?.value || {};
            const presidentialPrice = prices['Energia Elétrica'];

            if (presidentialPrice !== undefined) {
                setCurrentPrice(presidentialPrice);
            }

            const currentService = serviceData?.[0] || null;
            setService(currentService);

            // Sync price with presidential setting if it changed
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
        toast({
            title: 'Funcionalidade em Desenvolvimento',
            description: message,
        });
    };

    const displayPrice = currentPrice !== null && currentPrice !== undefined ? currentPrice : service?.price;

    const ContractInfo = () => (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle>Meu Contrato de Energia</CardTitle>
                <CardDescription>Plano Padrão - {formatCurrency(displayPrice)}/semana</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                 <Alert>
                    <Zap className="h-4 w-4" />
                    <AlertTitle>Serviço Essencial</AlertTitle>
                    <AlertDescription>
                        O fornecimento de energia elétrica é um serviço essencial e obrigatório para todos os cidadãos.
                    </AlertDescription>
                </Alert>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Button variant="outline" onClick={() => handleAction('Histórico de consumo em breve.')}><History className="mr-2 h-4 w-4" /> Ver Histórico</Button>
                    <Button variant="outline" onClick={() => handleAction('Segunda via de fatura em breve.')}><FileText className="mr-2 h-4 w-4" /> Segunda Via da Fatura</Button>
                    <Button variant="outline" onClick={() => handleAction('Solicitação de manutenção em breve.')} className="sm:col-span-2"><Wrench className="mr-2 h-4 w-4" /> Solicitar Manutenção</Button>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <>
            <Helmet>
                <title>Energia Elétrica - GOV.RP</title>
                <meta name="description" content="Serviços de energia elétrica para sua residência ou negócio." />
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
                <div className="mt-8">
                    {loading ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : (service ? <ContractInfo /> :  <div className="text-center">Carregando informações...</div>)}
                </div>
            </div>
        </>
    );
};

export default Electricity;