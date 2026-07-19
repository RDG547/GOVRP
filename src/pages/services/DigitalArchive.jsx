import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { CalendarDays, FileText, Filter, Loader2, Newspaper, Search, Sparkles, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    fetchOfficialGazetteEntries,
    formatOfficialGazettePublicationDate,
    getOfficialGazetteTypeMeta,
    getOfficialGazetteTypes,
    isOfficialGazetteDecreeType,
} from '@/lib/officialGazette';

const normalizeSearchValue = (value = '') =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

const GazetteStatCard = ({ icon: Icon, label, value, tone = 'text-blue-300' }) => (
    <Card className="glass-effect border-white/10">
        <CardContent className="p-5 flex items-center gap-4">
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
                                includeTime: isOfficialGazetteDecreeType(entry.type),
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

const DigitalArchive = () => {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState('Todos');
    const [searchTerm, setSearchTerm] = useState('');
    const { toast } = useToast();

    useEffect(() => {
        const fetchEntries = async () => {
            setLoading(true);
            try {
                const data = await fetchOfficialGazetteEntries(supabase);
                setEntries(data);
            } catch (error) {
                toast({ title: 'Erro ao buscar Diário Oficial', description: error.message, variant: 'destructive' });
            }
            setLoading(false);
        };
        fetchEntries();
    }, [toast]);

    const availableTypes = useMemo(() => getOfficialGazetteTypes(entries), [entries]);
    const filteredEntries = useMemo(() => {
        const normalizedSearch = normalizeSearchValue(searchTerm);

        return entries.filter((entry) => {
            const matchesType = selectedType === 'Todos' || entry.type === selectedType;

            if (!matchesType) {
                return false;
            }

            if (!normalizedSearch) {
                return true;
            }

            const searchableContent = normalizeSearchValue(`${entry.title} ${entry.summary} ${entry.content}`);
            return searchableContent.includes(normalizedSearch);
        });
    }, [entries, searchTerm, selectedType]);
    const featuredEntry = filteredEntries[0] || null;
    const secondaryEntries = featuredEntry ? filteredEntries.slice(1) : [];
    const typeCounts = useMemo(
        () =>
            entries.reduce((accumulator, entry) => {
                accumulator[entry.type] = (accumulator[entry.type] || 0) + 1;
                return accumulator;
            }, {}),
        [entries]
    );
    const appointmentsCount = entries.filter((entry) => entry.type === 'Nomeacao e Exoneracao').length;
    const latestPublication = entries[0]?.published_at
        ? formatOfficialGazettePublicationDate(entries[0].published_at, {
            includeTime: isOfficialGazetteDecreeType(entries[0].type),
        })
        : 'Sem publicações';

    return (
        <>
            <Helmet>
                <title>Diário Oficial da União - GOV.RP</title>
                <meta name="description" content="Acesse todas as publicações oficiais do governo, incluindo leis, decretos e atos normativos." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Newspaper}
                    title="Diário Oficial da União"
                    gradientText="(DOU)"
                    description="Acompanhe leis, decretos, medidas provisorias, nomeacoes, contratos e demais atos oficiais do GOV.RP."
                    iconColor="text-blue-400"
                    centered={true}
                />

                <div className="mt-12 space-y-8">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <GazetteStatCard icon={FileText} label="Publicações" value={entries.length} tone="text-blue-300" />
                        <GazetteStatCard icon={Filter} label="Categorias" value={availableTypes.length} tone="text-violet-300" />
                        <GazetteStatCard icon={Users} label="Nomeações" value={appointmentsCount} tone="text-emerald-300" />
                        <GazetteStatCard icon={CalendarDays} label="Última edição" value={latestPublication} tone="text-amber-300" />
                    </div>

                    <Card className="glass-effect overflow-hidden border-white/10">
                        <CardContent className="p-6 space-y-6">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.24em] text-blue-300">Consulta pública</p>
                                    <h2 className="mt-2 text-2xl font-bold text-foreground">Edição contínua do Diário Oficial</h2>
                                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                                        Busque por termos, filtre por tipo de ato e acompanhe nomeações, decretos, medidas provisórias e demais publicações oficiais em ordem cronológica.
                                    </p>
                                </div>
                                <div className="relative w-full lg:w-[24rem]">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={searchTerm}
                                        onChange={(event) => setSearchTerm(event.target.value)}
                                        placeholder="Buscar por título, ementa ou texto..."
                                        className="pl-9"
                                    />
                                </div>
                            </div>

                            {availableTypes.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    <Button variant={selectedType === 'Todos' ? 'default' : 'outline'} onClick={() => setSelectedType('Todos')}>
                                        Todos
                                    </Button>
                                    {availableTypes.map((type) => (
                                        <Button
                                            key={type}
                                            variant={selectedType === type ? 'default' : 'outline'}
                                            onClick={() => setSelectedType(type)}
                                        >
                                            {getOfficialGazetteTypeMeta(type).label}
                                            <span className="ml-2 text-xs opacity-80">{typeCounts[type] || 0}</span>
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>

                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <Card className="glass-effect border-dashed border-white/10">
                            <CardContent className="py-16 text-center">
                                <Newspaper className="mx-auto h-10 w-10 text-muted-foreground/60" />
                                <h3 className="mt-4 text-xl font-semibold text-foreground">Nenhuma publicação encontrada</h3>
                                <p className="mt-2 text-sm text-muted-foreground">Ajuste os filtros ou a busca para encontrar atos oficiais específicos.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="space-y-6">
                            {featuredEntry ? (
                                <GazetteEntryDialog entry={featuredEntry}>
                                    <Card className="glass-effect cursor-pointer overflow-hidden border-blue-500/20 transition-colors hover:border-blue-400/40">
                                        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)] lg:items-end">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <Badge className="bg-blue-500/15 text-blue-200 border border-blue-500/30">
                                                        <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Destaque da edição
                                                    </Badge>
                                                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                                                        {getOfficialGazetteTypeMeta(featuredEntry.type).label}
                                                    </Badge>
                                                </div>
                                                <h3 className="mt-4 text-3xl font-bold leading-tight text-foreground">{featuredEntry.title}</h3>
                                                <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">{featuredEntry.summary}</p>
                                            </div>
                                            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                                                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Publicação</p>
                                                <p className="mt-3 text-lg font-semibold text-foreground">
                                                    {formatOfficialGazettePublicationDate(featuredEntry.published_at, {
                                                        includeTime: isOfficialGazetteDecreeType(featuredEntry.type),
                                                    })}
                                                </p>
                                                <p className="mt-4 text-sm text-muted-foreground">Clique para abrir a íntegra e consultar o texto oficial completo.</p>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </GazetteEntryDialog>
                            ) : null}

                            <div className="space-y-4">
                                {secondaryEntries.length > 0 ? secondaryEntries.map((entry) => {
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
                                                                        includeTime: isOfficialGazetteDecreeType(entry.type),
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
                                }) : featuredEntry ? (
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
            </div>
        </>
    );
};

export default DigitalArchive;
