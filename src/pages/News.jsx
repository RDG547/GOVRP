import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { ArrowRight, CalendarDays, FileText, Filter, Loader2, Newspaper, Rss, ScrollText, Search, Sparkles, Users } from 'lucide-react';
import DailyNewspaper from '@/components/news/DailyNewspaper';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    fetchOfficialGazetteEntries,
    formatOfficialGazettePublicationDate,
    getOfficialGazetteTypeMeta,
} from '@/lib/officialGazette';

const normalizeSearchValue = (value = '') =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

const GazetteStatCard = ({ icon: Icon, label, value, tone = 'text-cyan-300' }) => (
    <Card className="glass-effect border-white/10">
        <CardContent className="flex items-center gap-4 p-5">
            <div className={`rounded-2xl bg-white/5 p-3 ${tone}`}>
                <Icon className="h-5 w-5" />
            </div>
            <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            </div>
        </CardContent>
    </Card>
);

const GazetteEntryDialog = ({ entry, children }) => {
    const typeMeta = getOfficialGazetteTypeMeta(entry.type);

    return (
        <Dialog>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-4xl border-white/10 bg-slate-950/95">
                <DialogHeader>
                    <div className="flex flex-wrap items-center gap-3">
                        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                            {typeMeta.label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            Publicado em {formatOfficialGazettePublicationDate(entry.published_at, {
                                includeTime: true,
                            })}
                        </span>
                    </div>
                    <DialogTitle className="text-2xl leading-tight">{entry.title}</DialogTitle>
                    <DialogDescription>{typeMeta.description}</DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[65vh] pr-6">
                    <div className="space-y-6 pb-4">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Ementa</p>
                            <p className="mt-3 text-sm leading-7 text-foreground">{entry.summary}</p>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Texto Integral</p>
                            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{entry.content}</div>
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};

const News = () => {
    const [douEntries, setDouEntries] = useState([]);
    const [gazetteSearchTerm, setGazetteSearchTerm] = useState('');
    const [selectedGazetteType, setSelectedGazetteType] = useState('Todos');
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();
    const { toast } = useToast();
    const activeTab = searchParams.get('tab') || 'news';

    const fetchData = useCallback(async () => {
        try {
            const douData = await fetchOfficialGazetteEntries(supabase);
            setDouEntries(douData || []);

        } catch (error) {
            toast({ title: 'Erro ao carregar notícias', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useDomainRealtime('gazette-news', 'public', ['dou_entries'], fetchData);

    const handleTabChange = (tab) => {
        const next = new URLSearchParams(searchParams); next.set('tab', tab); setSearchParams(next);
    };

    const availableGazetteTypes = useMemo(
        () => [...new Set(douEntries.map((entry) => entry.type).filter(Boolean))],
        [douEntries]
    );

    const filteredGazetteEntries = useMemo(() => {
        const normalizedSearch = normalizeSearchValue(gazetteSearchTerm);

        return douEntries.filter((entry) => {
            const matchesType = selectedGazetteType === 'Todos' || entry.type === selectedGazetteType;

            if (!matchesType) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            return normalizeSearchValue(`${entry.title} ${entry.summary} ${entry.content}`).includes(normalizedSearch);
        });
    }, [douEntries, gazetteSearchTerm, selectedGazetteType]);

    const gazetteTypeCounts = useMemo(
        () => douEntries.reduce((accumulator, entry) => {
            accumulator[entry.type] = (accumulator[entry.type] || 0) + 1;
            return accumulator;
        }, {}),
        [douEntries]
    );

    const featuredGazetteEntry = filteredGazetteEntries[0] || null;
    const secondaryGazetteEntries = featuredGazetteEntry ? filteredGazetteEntries.slice(1) : [];
    const appointmentsCount = douEntries.filter((entry) => entry.type === 'Nomeacao e Exoneracao').length;
    const latestGazettePublication = douEntries[0]?.published_at
        ? formatOfficialGazettePublicationDate(douEntries[0].published_at, {
            includeTime: true,
        })
        : 'Sem publicações';

    const renderGazetteContent = () => {
        if (!douEntries.length) {
            return (
                <div className="text-center py-20 glass-effect rounded-lg">
                    <h3 className="text-2xl font-bold">Nenhuma publicação encontrada</h3>
                    <p className="text-muted-foreground mt-2">Volte mais tarde para conferir as novidades.</p>
                </div>
            );
        }

        return (
            <div className="space-y-8">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <GazetteStatCard icon={FileText} label="Publicações" value={douEntries.length} tone="text-blue-300" />
                    <GazetteStatCard icon={Filter} label="Categorias" value={availableGazetteTypes.length} tone="text-violet-300" />
                    <GazetteStatCard icon={Users} label="Nomeações" value={appointmentsCount} tone="text-emerald-300" />
                    <GazetteStatCard icon={CalendarDays} label="Última edição" value={latestGazettePublication} tone="text-amber-300" />
                </div>

                <Card className="glass-effect overflow-hidden border-white/10">
                    <CardContent className="space-y-6 p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Consulta pública</p>
                                <h2 className="mt-2 text-2xl font-bold text-foreground">Diário Oficial com leitura editorial</h2>
                                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                                    Busque atos oficiais, filtre por tipo e acompanhe decretos, nomeações, sanções e demais publicações em um layout próprio dentro do Portal de Notícias.
                                </p>
                            </div>
                            <div className="relative w-full lg:w-[24rem]">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={gazetteSearchTerm}
                                    onChange={(event) => setGazetteSearchTerm(event.target.value)}
                                    placeholder="Buscar por título, ementa ou texto..."
                                    className="pl-9"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button variant={selectedGazetteType === 'Todos' ? 'default' : 'outline'} onClick={() => setSelectedGazetteType('Todos')}>
                                Todos
                            </Button>
                            {availableGazetteTypes.map((type) => (
                                <Button
                                    key={type}
                                    variant={selectedGazetteType === type ? 'default' : 'outline'}
                                    onClick={() => setSelectedGazetteType(type)}
                                >
                                    {getOfficialGazetteTypeMeta(type).label}
                                    <span className="ml-2 text-xs opacity-80">{gazetteTypeCounts[type] || 0}</span>
                                </Button>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {!filteredGazetteEntries.length ? (
                    <Card className="glass-effect border-dashed border-white/10">
                        <CardContent className="py-16 text-center">
                            <ScrollText className="mx-auto h-10 w-10 text-muted-foreground/60" />
                            <h3 className="mt-4 text-xl font-semibold text-foreground">Nenhum ato encontrado</h3>
                            <p className="mt-2 text-sm text-muted-foreground">Ajuste o filtro ou refine a busca para localizar a publicação desejada.</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-6">
                        {featuredGazetteEntry ? (
                            <GazetteEntryDialog entry={featuredGazetteEntry}>
                                <Card className="glass-effect cursor-pointer overflow-hidden border-cyan-500/20 transition-colors hover:border-cyan-400/40">
                                    <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-3">
                                                <Badge className="border border-cyan-500/30 bg-cyan-500/15 text-cyan-200">
                                                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Destaque do Diário Oficial
                                                </Badge>
                                                <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                                                    {getOfficialGazetteTypeMeta(featuredGazetteEntry.type).label}
                                                </Badge>
                                            </div>
                                            <h3 className="mt-4 text-3xl font-bold leading-tight text-foreground">{featuredGazetteEntry.title}</h3>
                                            <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">{featuredGazetteEntry.summary}</p>
                                        </div>
                                        <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                                            <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Publicação</p>
                                            <p className="mt-3 text-lg font-semibold text-foreground">
                                                {formatOfficialGazettePublicationDate(featuredGazetteEntry.published_at, {
                                                    includeTime: true,
                                                })}
                                            </p>
                                            <p className="mt-4 text-sm text-muted-foreground">Clique para abrir a íntegra e consultar o texto oficial completo.</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </GazetteEntryDialog>
                        ) : null}

                        <div className="space-y-4">
                            {secondaryGazetteEntries.length > 0 ? secondaryGazetteEntries.map((entry) => {
                                const typeMeta = getOfficialGazetteTypeMeta(entry.type);

                                return (
                                    <GazetteEntryDialog key={entry.id} entry={entry}>
                                        <Card className="glass-effect cursor-pointer border-white/10 transition-colors hover:border-primary/40">
                                            <CardContent className="p-5">
                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary">{typeMeta.label}</Badge>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatOfficialGazettePublicationDate(entry.published_at, {
                                                                    includeTime: true,
                                                                })}
                                                            </span>
                                                        </div>
                                                        <h3 className="mt-3 text-xl font-semibold text-foreground">{entry.title}</h3>
                                                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{entry.summary}</p>
                                                    </div>
                                                    <div className="lg:w-64 lg:pl-4">
                                                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Natureza do ato</p>
                                                        <p className="mt-2 text-sm text-foreground">{typeMeta.description}</p>
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </GazetteEntryDialog>
                                );
                            }) : featuredGazetteEntry ? (
                                <Card className="glass-effect border-dashed border-white/10">
                                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                                        Apenas uma publicação corresponde ao filtro atual.
                                    </CardContent>
                                </Card>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderContent = () => {
        if (activeTab === 'news') return <DailyNewspaper />;
        if (loading) {
            return (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>
            );
        }

        return renderGazetteContent();
    };

    return (
        <div className="container mx-auto p-4 md:p-8">
            <Helmet>
                <title>Notícias - GOV.RP</title>
                <meta name="description" content="Acompanhe as últimas notícias e publicações oficiais do GOV.RP." />
            </Helmet>

            <PageHeader
                icon={Newspaper}
                title="Portal de"
                gradientText="Notícias"
                description="As últimas notícias e publicações do Diário Oficial da União."
                iconColor="text-cyan-400"
                centered={true}
            />

            <div className="flex justify-center my-8">
                <div className="p-1 rounded-lg bg-muted inline-flex">
                    <Button
                        variant={activeTab === 'news' ? 'default' : 'ghost'}
                        onClick={() => handleTabChange('news')}
                        className="rounded-md"
                    >
                        <Rss className="w-4 h-4 mr-2" /> Notícias
                    </Button>
                    <Button
                        variant={activeTab === 'dou' ? 'default' : 'ghost'}
                        onClick={() => handleTabChange('dou')}
                        className="rounded-md"
                    >
                        <ScrollText className="w-4 h-4 mr-2" /> Diário Oficial
                    </Button>
                </div>
            </div>

            {renderContent()}
        </div>
    );
};

export default News;
