import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Flame, Loader2 } from 'lucide-react';
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
    const serviceType = 'Gás';

    const fetchService = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('user_services')
            .select('*')
            .eq('user_id', user.id)
            .eq('service_type', serviceType);
        
        if (error) {
            toast({ title: 'Erro ao buscar serviço', variant: 'destructive' });
        } else {
            setService(data[0] || null);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchService();
    }, [fetchService]);

    const ServiceInfo = () => (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle>Seu Contrato de Gás</CardTitle>
                <CardDescription>Plano Padrão - {formatCurrency(service.price)}/semana</CardDescription>
            </CardHeader>
            <CardContent>
                <Alert>
                    <Flame className="h-4 w-4" />
                    <AlertTitle>Serviço Essencial</AlertTitle>
                    <AlertDescription>
                        O fornecimento de gás é um serviço essencial e obrigatório para todos os cidadãos.
                    </AlertDescription>
                </Alert>
                <p className="text-muted-foreground my-4">Seu fornecimento de gás está ativo. A cobrança é realizada semanalmente em sua conta bancária.</p>
            </CardContent>
        </Card>
    );

    return (
        <>
            <Helmet>
                <title>Gás - GOV.RP</title>
                <meta name="description" content="Serviços de fornecimento de gás encanado." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Flame}
                    title="Fornecimento de"
                    gradientText="Gás"
                    description="Gerencie seu contrato de gás encanado."
                    iconColor="text-orange-500"
                    centered={true}
                />
                <div className="mt-8">
                    {loading ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> : (service ? <ServiceInfo /> : <div className="text-center">Carregando informações...</div>)}
                </div>
            </div>
        </>
    );
};

export default Gas;