import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Search, User, Users, AlertTriangle, Shield, Calendar, Info, Scale, Clock, Tally5 } from 'lucide-react'; // Ícones corrigidos
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion } from 'framer-motion';

const StatCard = ({ icon: Icon, title, value, color }) => (
    <Card className="glass-effect">
        <CardContent className="p-6 flex items-center gap-4">
            <div className={`p-3 rounded-full bg-slate-800 ${color}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-sm text-muted-foreground">{title}</p>
            </div>
        </CardContent>
    </Card>
);

const InmateProfileModal = ({ inmate }) => (
    <DialogContent className="glass-effect max-w-2xl">
        <CardHeader className="flex flex-row items-center gap-6 p-6">
            <img src={inmate.profile.avatar_url} alt={inmate.profile.full_name} className="w-24 h-24 rounded-full border-4 border-destructive object-cover" />
            <div>
                <CardTitle className="text-3xl">{inmate.profile.full_name}</CardTitle>
                <CardDescription>ID do Detento: {inmate.id}</CardDescription>
                <div className="flex gap-2 mt-2">
                    <Badge variant="destructive">{inmate.crime}</Badge>
                    <Badge variant="secondary">{getSecurityLevel(inmate.crime).text}</Badge>
                </div>
            </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h4 className="font-semibold text-lg border-b border-border pb-2">Informações da Pena</h4>
                    <p className="flex items-center gap-2 text-sm"><Calendar className="w-4 h-4 text-muted-foreground"/> <strong>Início:</strong> {format(new Date(inmate.sentence_start_date), 'dd/MM/yyyy')}</p>
                    <p className="flex items-center gap-2 text-sm"><Calendar className="w-4 h-4 text-muted-foreground"/> <strong>Término:</strong> {format(new Date(inmate.sentence_end_date), 'dd/MM/yyyy HH:mm')}</p>
                    <p className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-muted-foreground"/> <strong>Tempo restante:</strong> {formatDistanceToNow(new Date(inmate.sentence_end_date), { locale: ptBR })}</p>
                    <p className="flex items-center gap-2 text-sm"><Scale className="w-4 h-4 text-muted-foreground"/> <strong>Juiz:</strong> {inmate.judge_name || 'Não informado'}</p>
                </div>
                 <div className="space-y-4">
                    <h4 className="font-semibold text-lg border-b border-border pb-2">Histórico de Reabilitação</h4>
                    <p className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-muted-foreground"/> <strong>Participação em Programas:</strong> 2 (Trabalho e Educação)</p>
                    <p className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-muted-foreground"/> <strong>Avaliação Comportamental:</strong> Bom</p>
                    <p className="flex items-center gap-2 text-sm"><Info className="w-4 h-4 text-muted-foreground"/> <strong>Visitas Recebidas:</strong> 12</p>
                </div>
            </div>
        </CardContent>
    </DialogContent>
);

const getSecurityLevel = (crime) => {
    const lowerCaseCrime = crime.toLowerCase();
    if (['assassinato', 'terrorismo', 'tráfico de armas'].some(c => lowerCaseCrime.includes(c))) {
        return { text: 'Máxima Segurança', color: 'bg-red-500/20 text-red-300', icon: AlertTriangle };
    }
    if (['roubo a banco', 'sequestro', 'tráfico de drogas'].some(c => lowerCaseCrime.includes(c))) {
        return { text: 'Alta Segurança', color: 'bg-orange-500/20 text-orange-300', icon: Shield };
    }
    return { text: 'Média Segurança', color: 'bg-yellow-500/20 text-yellow-300', icon: Users };
};

const Prison = () => {
    const { toast } = useToast();
    const [inmates, setInmates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchInmates = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_inmates');
            if (error) throw error;
            setInmates(data);
        } catch (error) {
            toast({ title: 'Erro ao buscar detentos', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchInmates();
    }, [fetchInmates]);

    const filteredInmates = useMemo(() => {
        if (!searchTerm) return inmates;
        return inmates.filter(inmate =>
            inmate.profile.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            inmate.crime.toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(inmate.id).includes(searchTerm)
        );
    }, [inmates, searchTerm]);
    
    const stats = useMemo(() => {
        const total = inmates.length;
        const maxSecurity = inmates.filter(i => getSecurityLevel(i.crime).text === 'Máxima Segurança').length;
        const highSecurity = inmates.filter(i => getSecurityLevel(i.crime).text === 'Alta Segurança').length;
        return { total, maxSecurity, highSecurity };
    }, [inmates]);

    return (
        <>
            <Helmet>
                <title>Prisão Federal - GOV.RP</title>
                <meta name="description" content="Informações sobre o sistema prisional e seus detentos." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Tally5}
                    title="Prisão"
                    gradientText="Federal"
                    description="Informações públicas sobre os detentos do sistema prisional."
                    iconColor="text-slate-400"
                    centered={true}
                />
                
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <StatCard icon={Users} title="População Carcerária" value={stats.total} color="text-blue-400" />
                    <StatCard icon={AlertTriangle} title="Máxima Segurança" value={stats.maxSecurity} color="text-red-400" />
                    <StatCard icon={Shield} title="Alta Segurança" value={stats.highSecurity} color="text-orange-400" />
                </div>

                <div className="mb-8">
                    <div className="relative w-full max-w-lg mx-auto">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="text"
                            placeholder="Buscar por nome, crime ou ID do detento..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-6 text-lg"
                        />
                    </div>
                </div>

                {loading ? (
                    <div className="flex justify-center items-center py-20"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredInmates.length > 0 ? (
                            filteredInmates.map(inmate => (
                                <Dialog key={inmate.id}>
                                    <DialogTrigger asChild>
                                        <motion.div whileHover={{ y: -5, scale: 1.02 }} className="cursor-pointer">
                                            <Card className="glass-effect h-full flex flex-col">
                                                <CardHeader className="flex flex-row items-center gap-4">
                                                    <img src={inmate.profile.avatar_url} alt={inmate.profile.full_name} className="w-16 h-16 rounded-full border-2 border-destructive object-cover" />
                                                    <div>
                                                        <CardTitle>{inmate.profile.full_name}</CardTitle>
                                                        <CardDescription>ID: {inmate.id}</CardDescription>
                                                    </div>
                                                </CardHeader>
                                                <CardContent className="space-y-3 flex-grow">
                                                    <Badge variant="destructive" className="w-full justify-center py-1">{inmate.crime}</Badge>
                                                    <div>
                                                        <p className="text-sm font-semibold text-muted-foreground">Tempo de Pena</p>
                                                        <p>{formatDistanceToNow(new Date(inmate.sentence_end_date), { locale: ptBR })} restantes</p>
                                                    </div>
                                                </CardContent>
                                                <CardFooter>
                                                     <div className={`w-full text-center p-2 rounded-lg text-sm font-semibold ${getSecurityLevel(inmate.crime).color}`}>
                                                        {React.createElement(getSecurityLevel(inmate.crime).icon, { className: "inline-block w-4 h-4 mr-2" })}
                                                        {getSecurityLevel(inmate.crime).text}
                                                     </div>
                                                </CardFooter>
                                            </Card>
                                        </motion.div>
                                    </DialogTrigger>
                                    <InmateProfileModal inmate={inmate} />
                                </Dialog>
                            ))
                        ) : (
                            <div className="col-span-full text-center py-20 text-muted-foreground glass-effect rounded-lg">
                                <User className="w-16 h-16 mx-auto mb-4" />
                                <p className="text-lg">Nenhum detento encontrado com os critérios de busca.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default Prison;