import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Droplet, FileQuestion, AlertTriangle, CheckCircle, BarChart, Loader2 } from 'lucide-react';
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
    const [waterQuality, setWaterQuality] = useState(95);
    const serviceType = 'Água';

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

    const handleAction = (message) => {
        toast({
            title: 'Funcionalidade em Desenvolvimento',
            description: message,
        });
    };
    
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                     <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle>Qualidade da Água</CardTitle>
                            <CardDescription>Monitoramento em tempo real da qualidade da água em sua região.</CardDescription>
                        </CardHeader>
                        <CardContent className="text-center">
                           <p className="text-6xl font-bold text-primary">{waterQuality}%</p>
                           <p className="text-muted-foreground mb-4">Índice de Potabilidade</p>
                           <Progress value={waterQuality} />
                           <p className="text-sm mt-2 flex items-center justify-center gap-2"><CheckCircle className="text-green-400 h-4 w-4"/> Água segura para consumo.</p>
                        </CardContent>
                    </Card>
                    <Card className="glass-effect">
                        <CardHeader>
                            <CardTitle>Seu Contrato</CardTitle>
                             <CardDescription>Gerencie seu serviço de água e saneamento.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {loading ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> :
                            service ? (
                                <>
                                    <Alert>
                                        <Droplet className="h-4 w-4" />
                                        <AlertTitle>Serviço Essencial</AlertTitle>
                                        <AlertDescription>
                                            O fornecimento de água é um serviço essencial e obrigatório para todos os cidadãos.
                                        </AlertDescription>
                                    </Alert>
                                    <p>Plano Padrão Ativo - {formatCurrency(service.price)}/semana</p>
                                    <Button className="w-full justify-start" variant="outline" onClick={() => handleAction('Histórico de consumo em breve.')}><BarChart className="mr-2 h-5 w-5"/> Histórico de Consumo</Button>
                                    <Button className="w-full justify-start" variant="destructive" onClick={() => handleAction('Relato de vazamento em breve.')}><AlertTriangle className="mr-2 h-5 w-5"/> Relatar Vazamento</Button>
                                </>
                            ) : (
                                <div className="text-center">
                                    <p className="text-muted-foreground mb-4">Carregando informações do serviço...</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
};

export default Water;