import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, Newspaper } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from '@/components/ui/scroll-area';

const DigitalArchive = () => {
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchEntries = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('dou_entries')
                .select('*')
                .order('published_at', { ascending: false });

            if (error) {
                toast({ title: 'Erro ao buscar Diário Oficial', description: error.message, variant: 'destructive' });
            } else {
                setEntries(data);
            }
            setLoading(false);
        };
        fetchEntries();
    }, [toast]);

    const formatPublicationDate = (dateString, includeTime = false) => {
        if (!dateString) return 'Data não disponível';
        const date = new Date(dateString);
        const options = {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Sao_Paulo'
        };
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
            options.second = '2-digit';
        }
        return new Intl.DateTimeFormat('pt-BR', options).format(date);
    };

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
                    description="O registro oficial de todos os atos do governo."
                    iconColor="text-blue-400"
                    centered={true}
                />

                <div className="mt-12">
                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <Loader2 className="w-12 h-12 animate-spin text-primary" />
                        </div>
                    ) : entries.length === 0 ? (
                        <p className="text-center text-muted-foreground">Nenhuma publicação encontrada no Diário Oficial.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {entries.map(entry => (
                                <Dialog key={entry.id}>
                                    <DialogTrigger asChild>
                                        <Card className="glass-effect cursor-pointer hover:border-primary transition-colors h-full flex flex-col">
                                            <CardHeader>
                                                <CardTitle className="text-xl line-clamp-2">{entry.title}</CardTitle>
                                                <CardDescription className="text-sm">
                                                    {formatPublicationDate(entry.published_at, entry.type === 'Decreto')}
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="flex-grow">
                                                <p className="line-clamp-4 text-muted-foreground">{entry.summary}</p>
                                            </CardContent>
                                            <CardFooter>
                                                <span className="text-xs font-semibold uppercase tracking-wider bg-primary/10 text-primary px-2 py-1 rounded-full">{entry.type}</span>
                                            </CardFooter>
                                        </Card>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-3xl">
                                        <DialogHeader>
                                            <DialogTitle className="text-2xl">{entry.title}</DialogTitle>
                                            <DialogDescription>
                                                Publicado em: {formatPublicationDate(entry.published_at, entry.type === 'Decreto')}
                                                <br />
                                                Tipo: {entry.type}
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
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default DigitalArchive;