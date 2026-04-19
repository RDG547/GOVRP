import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Newspaper } from 'lucide-react';
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

const DigitalArchive = () => {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedType, setSelectedType] = useState('Todos');
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

    const availableTypes = getOfficialGazetteTypes(entries);
    const filteredEntries =
        selectedType === 'Todos'
            ? entries
            : entries.filter((entry) => entry.type === selectedType);

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

                <div className="mt-12">
                    {availableTypes.length > 0 && (
                        <div className="mb-8 flex flex-wrap gap-3">
                            <Button
                                variant={selectedType === 'Todos' ? 'default' : 'outline'}
                                onClick={() => setSelectedType('Todos')}
                            >
                                Todos
                            </Button>
                            {availableTypes.map((type) => (
                                <Button
                                    key={type}
                                    variant={selectedType === type ? 'default' : 'outline'}
                                    onClick={() => setSelectedType(type)}
                                >
                                    {getOfficialGazetteTypeMeta(type).label}
                                </Button>
                            ))}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <p className="text-center text-muted-foreground">Nenhuma publicação encontrada no Diário Oficial.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {filteredEntries.map(entry => {
                                const typeMeta = getOfficialGazetteTypeMeta(entry.type);

                                return (
                                <Dialog key={entry.id}>
                                    <DialogTrigger asChild>
                                        <Card className="glass-effect cursor-pointer hover:border-primary transition-colors h-full flex flex-col">
                                            <CardHeader>
                                                <CardTitle className="text-xl line-clamp-2">{entry.title}</CardTitle>
                                                <CardDescription className="text-sm">
                                                    {typeMeta.description}
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="flex-grow">
                                                <p className="line-clamp-4 text-muted-foreground">{entry.summary}</p>
                                            </CardContent>
                                            <CardFooter>
                                                <div className="flex w-full items-center justify-between gap-3">
                                                    <span className="text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary px-2 py-1 rounded-full">{typeMeta.label}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatOfficialGazettePublicationDate(entry.published_at, {
                                                            includeTime: isOfficialGazetteDecreeType(entry.type),
                                                        })}
                                                    </span>
                                                </div>
                                            </CardFooter>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-3xl">
                                        <DialogHeader>
                                            <DialogTitle className="text-2xl">{entry.title}</DialogTitle>
                                            <DialogDescription>
                                                Publicado em:{' '}
                                                {formatOfficialGazettePublicationDate(entry.published_at, {
                                                    includeTime: isOfficialGazetteDecreeType(entry.type),
                                                })}
                                                <br />
                                                Tipo: {typeMeta.label}
                                            </DialogDescription>
                                        </DialogHeader>
                                        <ScrollArea className="max-h-[60vh] mt-4">
                                            <div className="prose prose-invert max-w-none pr-6 whitespace-pre-wrap">
                                                <p className="font-semibold">{entry.summary}</p>
                                                <hr className="my-4" />
                                                <p>{entry.content}</p>
                                            </div>
                                        </ScrollArea>
                                    </DialogContent>
                                </Dialog>
                            )})}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default DigitalArchive;
