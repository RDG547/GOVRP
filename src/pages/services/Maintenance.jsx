import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Wrench, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';

const serviceTypes = [
    { name: 'Elétrica', price: 150.00 },
    { name: 'Hidráulica', price: 120.00 },
    { name: 'Pintura', price: 250.00 },
    { name: 'Alvenaria', price: 300.00 },
    { name: 'Limpeza Geral', price: 100.00 },
    { name: 'Jardinagem', price: 80.00 }
];

const Maintenance = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [requests, setRequests] = useState([]);
    const [serviceType, setServiceType] = useState('');
    const [description, setDescription] = useState('');
    const [address, setAddress] = useState('');
    const [loading, setLoading] = useState(true);
    const serviceIdentifier = 'Manutenção';

    useEffect(() => {
        const fetchRequests = async () => {
            if (!user) return;
            setLoading(true);
            const { data, error } = await supabase
                .from('user_services')
                .select('*')
                .eq('user_id', user.id)
                .eq('service_type', serviceIdentifier)
                .order('contracted_at', { ascending: false });

            if (error) {
                toast({ title: 'Erro ao buscar solicitações', variant: 'destructive' });
            } else {
                setRequests(data);
            }
            setLoading(false);
        };
        fetchRequests();
    }, [user, toast]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const selectedService = serviceTypes.find(s => s.name === serviceType);
        if (!selectedService || !description || !address) {
            toast({ title: 'Campos obrigatórios', variant: 'destructive' });
            return;
        }

        setLoading(true);
        const { data, error } = await supabase.from('user_services').insert({
            user_id: user.id,
            service_type: serviceIdentifier,
            plan_name: `${selectedService.name} em ${address}`,
            price: selectedService.price,
            is_active: false, // One-time service
            metadata: { description, address, status: 'Pendente' }
        }).select().single();

        if (error) {
            toast({ title: 'Erro ao enviar solicitação', variant: 'destructive' });
        } else {
            toast({ title: 'Solicitação Enviada', description: `Sua solicitação de ${serviceType} foi enviada.` });
            setRequests(prev => [data, ...prev]);
            setServiceType('');
            setDescription('');
            setAddress('');
        }
        setLoading(false);
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'Concluído': return 'text-green-400';
            case 'Pendente': return 'text-yellow-400';
            default: return 'text-gray-400';
        }
    };
    
    const getStatusIcon = (status) => {
        switch (status) {
            case 'Concluído': return <CheckCircle className="w-4 h-4" />;
            case 'Pendente': return <Clock className="w-4 h-4" />;
            default: return null;
        }
    };

    return (
        <>
            <Helmet>
                <title>Manutenção - GOV.RP</title>
                <meta name="description" content="Contrate serviços de manutenção para sua casa ou empresa." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Wrench}
                    title="Serviços de"
                    gradientText="Manutenção"
                    description="Contrate profissionais para reparos e manutenção geral."
                    iconColor="text-gray-400"
                    centered={true}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
                    <Card className="glass-effect">
                        <CardHeader><CardTitle>Nova Solicitação de Manutenção</CardTitle></CardHeader>
                        <form onSubmit={handleSubmit}>
                            <CardContent className="space-y-4">
                                <div><Label>Tipo de Serviço</Label><Select value={serviceType} onValueChange={setServiceType}><SelectTrigger><SelectValue placeholder="Selecione o tipo de serviço" /></SelectTrigger><SelectContent>{serviceTypes.map(type => <SelectItem key={type.name} value={type.name}>{type.name} - {formatCurrency(type.price)}</SelectItem>)}</SelectContent></Select></div>
                                <div><Label htmlFor="address">Endereço</Label><Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Ex: Rua das Flores, 123" /></div>
                                <div><Label htmlFor="description">Descrição do Problema</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o que precisa ser feito." /></div>
                            </CardContent>
                            <CardFooter><Button type="submit" className="w-full" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar Solicitação</Button></CardFooter>
                        </form>
                    </Card>

                    <Card className="glass-effect">
                        <CardHeader><CardTitle>Minhas Solicitações</CardTitle></CardHeader>
                        <CardContent>
                            {loading ? <div className="flex justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div> :
                            requests.length > 0 ? (
                                <ul className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                                    {requests.map(req => (
                                        <li key={req.id} className="p-4 bg-secondary rounded-lg flex justify-between items-center">
                                            <div>
                                                <p className="font-bold">{req.plan_name}</p>
                                                <p className="text-sm text-muted-foreground">{formatCurrency(req.price)}</p>
                                            </div>
                                            <div className={`flex items-center gap-2 text-sm font-medium ${getStatusVariant(req.metadata?.status)}`}>
                                                {getStatusIcon(req.metadata?.status)}
                                                {req.metadata?.status || 'N/A'}
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-center text-muted-foreground py-8">Nenhuma solicitação de manutenção encontrada.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
};

export default Maintenance;