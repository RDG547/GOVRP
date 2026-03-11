import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Newspaper, Rss, ArrowRight, BookCheck, ScrollText } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button'; // Import the Button component

const NewsCard = ({ item, type }) => {
    const isArticle = type === 'article';
    const title = isArticle ? item.title : item.title;
    const description = isArticle ? item.content.substring(0, 100) + '...' : item.summary;
    const link = isArticle ? `/news/${item.id}` : '#';
    const imageUrl = isArticle ? item.image_url : null;
    const author = isArticle ? item.author?.full_name : null;
    const category = isArticle ? item.category?.name : item.type;
    const publishedAt = item.published_at || item.created_at;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="flex"
        >
            <Card className="glass-effect w-full flex flex-col hover:border-primary transition-all duration-300">
                {imageUrl && (
                    <div className="aspect-video overflow-hidden rounded-t-lg">
                        <img src={imageUrl} alt={title} className="w-full h-full object-cover" />
                    </div>
                )}
                <CardHeader>
                    {category && <Badge variant="secondary" className="mb-2 w-fit">{category}</Badge>}
                    <CardTitle className="text-xl font-bold leading-tight">{title}</CardTitle>
                    {author && <CardDescription>Por {author}</CardDescription>}
                </CardHeader>
                <CardContent className="flex-grow">
                    <p className="text-sm text-muted-foreground line-clamp-3">{description}</p>
                </CardContent>
                <CardFooter className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{format(new Date(publishedAt), "dd 'de' MMMM, yyyy", { locale: ptBR })}</span>
                    {isArticle && (
                        <Link to={link} className="flex items-center text-primary hover:underline">
                            Ler mais <ArrowRight className="w-4 h-4 ml-1" />
                        </Link>
                    )}
                </CardFooter>
            </Card>
        </motion.div>
    );
};

const News = () => {
    const [articles, setArticles] = useState([]);
    const [douEntries, setDouEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [categories, setCategories] = useState([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const { toast } = useToast();
    const activeTab = searchParams.get('tab') || 'news';

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: articlesData, error: articlesError } = await supabase
                .from('news_articles')
                .select('*, author:profiles(full_name), category:news_categories(name, slug)')
                .order('created_at', { ascending: false });

            if (articlesError) throw articlesError;
            setArticles(articlesData || []);

            const { data: douData, error: douError } = await supabase
                .from('dou_entries')
                .select('*')
                .order('published_at', { ascending: false });
            
            if (douError) throw douError;
            setDouEntries(douData || []);

            const { data: categoriesData, error: categoriesError } = await supabase
                .from('news_categories')
                .select('*');

            if (categoriesError) throw categoriesError;
            setCategories(categoriesData || []);

        } catch (error) {
            toast({ title: 'Erro ao carregar notícias', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleTabChange = (tab) => {
        setSearchParams({ tab });
    };

    const renderContent = () => {
        if (loading) {
            return (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                </div>
            );
        }

        const data = activeTab === 'news' ? articles : douEntries;
        const type = activeTab === 'news' ? 'article' : 'dou';

        if (data.length === 0) {
            return (
                <div className="text-center py-20 glass-effect rounded-lg">
                    <h3 className="text-2xl font-bold">Nenhuma publicação encontrada</h3>
                    <p className="text-muted-foreground mt-2">Volte mais tarde para conferir as novidades.</p>
                </div>
            );
        }

        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <AnimatePresence>
                    {data.map(item => <NewsCard key={item.id} item={item} type={type} />)}
                </AnimatePresence>
            </div>
        );
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