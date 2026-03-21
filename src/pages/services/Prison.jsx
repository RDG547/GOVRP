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
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { formatPrisonCountdown, isPrisonSentenceActive } from '@/lib/prison';

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

const PrisonerLockScreen = ({ user, activeRecord, redirectedFrom, onRefresh }) => (
    <>
        <Helmet>
            <title>Custódia Federal - GOV.RP</title>
            <meta name="description" content="Área de custódia federal para usuários atualmente presos." />
        </Helmet>
        <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-slate-950 via-slate-900 to-red-950/60">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-3xl rounded-2xl border border-red-500/20 bg-slate-950/80 p-8 shadow-2xl backdrop-blur"
            >
                <Tally5 className="mx-auto mb-6 h-20 w-20 text-red-400" />
                <h1 className="mb-4 text-center text-4xl font-bold text-white">Você está sob custódia federal</h1>
                <p className="mx-auto mb-4 max-w-2xl text-center text-lg text-slate-300">
                    Seu acesso ao restante do GOV.RP foi temporariamente bloqueado. Aguarde o término da pena para voltar a circular livremente pela plataforma.
                </p>
                {redirectedFrom && (
                    <p className="mx-auto mb-8 max-w-2xl rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">
                        A tentativa de acessar <strong>{redirectedFrom}</strong> foi bloqueada porque você ainda está preso.
                    </p>
                )}

                <div className="grid gap-4 md:grid-cols-3">
                    <Card className="border-slate-800 bg-slate-900/70">
                        <CardContent className="p-5">
                            <p className="text-sm text-slate-400">Status</p>
                            <p className="mt-2 text-xl font-semibold text-red-300">Custódia ativa</p>
                        </CardContent>
                    </Card>
                    <Card className="border-slate-800 bg-slate-900/70">
                        <CardContent className="p-5">
                            <p className="text-sm text-slate-400">Tempo restante</p>
                            <p className="mt-2 text-xl font-semibold text-white">
                                {formatPrisonCountdown(user?.release_date)}
                            </p>
                        </CardContent>
                    </Card>
                    <Card className="border-slate-800 bg-slate-900/70">
                        <CardContent className="p-5">
                            <p className="text-sm text-slate-400">Situação penal</p>
                            <p className="mt-2 text-xl font-semibold text-white">
                                {user?.criminal_status || 'Condenado'}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-2">
                    <Card className="border-slate-800 bg-slate-900/70">
                        <CardHeader>
                            <CardTitle className="text-white">Dados da Pena</CardTitle>
                            <CardDescription>A contagem acompanha o tempo real.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-slate-200">
                            <p><strong>Crime:</strong> {activeRecord?.crime || 'Não informado'}</p>
                            <p><strong>Início:</strong> {activeRecord?.sentence_start_date ? format(new Date(activeRecord.sentence_start_date), 'dd/MM/yyyy HH:mm') : 'Não informado'}</p>
                            <p><strong>Término:</strong> {user?.release_date ? format(new Date(user.release_date), 'dd/MM/yyyy HH:mm') : 'Não informado'}</p>
                            <p><strong>Juiz responsável:</strong> {activeRecord?.judge?.full_name || 'Não informado'}</p>
                        </CardContent>
                    </Card>
                    <Card className="border-slate-800 bg-slate-900/70">
                        <CardHeader>
                            <CardTitle className="text-white">Orientação</CardTitle>
                            <CardDescription>Enquanto a pena estiver ativa, esta é sua única página acessível.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm text-slate-200">
                            <Badge variant="destructive" className="w-fit">Saída bloqueada</Badge>
                            <p>Ao tentar acessar outras áreas, você será redirecionado automaticamente de volta para esta página.</p>
                            <p>Assim que o prazo terminar, sua situação será atualizada e o acesso será liberado.</p>
                            <Button onClick={onRefresh} className="mt-2 w-full">Atualizar Situação</Button>
                        </CardContent>
                    </Card>
                </div>
            </motion.div>
        </div>
    </>
);

const Prison = () => {
    const location = useLocation();
    const { user, refreshUser } = useAuth();
    const { toast } = useToast();
    const [inmates, setInmates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeRecord, setActiveRecord] = useState(null);
    const [, setClockTick] = useState(0);
    const isCurrentUserImprisoned = isPrisonSentenceActive(user);
    const redirectedFrom = location.state?.prisonRedirectedFrom;

    const fetchActiveRecord = useCallback(async () => {
        if (!user?.id || !isCurrentUserImprisoned) {
            setActiveRecord(null);
            return;
        }

        const { data, error } = await supabase
            .from('criminal_records')
            .select('*, judge:profiles!criminal_records_judge_id_fkey(id, full_name)')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .order('sentence_end_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            toast({ title: 'Erro ao carregar dados da prisão', description: error.message, variant: 'destructive' });
            return;
        }

        setActiveRecord(data);
    }, [isCurrentUserImprisoned, toast, user?.id]);

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
        if (isCurrentUserImprisoned) {
            setLoading(false);
            fetchActiveRecord();
            return;
        }

        fetchInmates();
    }, [fetchActiveRecord, fetchInmates, isCurrentUserImprisoned]);

    useEffect(() => {
        if (!isCurrentUserImprisoned) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            setClockTick((currentTick) => currentTick + 1);
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isCurrentUserImprisoned]);

    useEffect(() => {
        if (!isCurrentUserImprisoned) {
            return undefined;
        }

        const intervalId = window.setInterval(() => {
            refreshUser();
            fetchActiveRecord();
        }, 60000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [fetchActiveRecord, isCurrentUserImprisoned, refreshUser]);

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

    if (isCurrentUserImprisoned) {
        return (
            <PrisonerLockScreen
                user={user}
                activeRecord={activeRecord}
                redirectedFrom={redirectedFrom}
                onRefresh={refreshUser}
            />
        );
    }

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
