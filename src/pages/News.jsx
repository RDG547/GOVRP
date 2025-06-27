import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Newspaper, Calendar, Loader2, Tag, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';

const News = () => {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchCategories = async () => {
      const { data, error } = await supabase
        .from('news_categories')
        .select('*')
        .order('name');
      
      if (error) {
        toast({ title: "Erro", description: "Não foi possível carregar as categorias.", variant: "destructive" });
      } else {
        setCategories([{ id: null, name: 'Todas' }, ...data]);
      }
    };
    fetchCategories();
  }, [toast]);

  useEffect(() => {
    const fetchArticles = async () => {
      setLoading(true);
      
      let query = supabase.from('news_articles')
        .select('*, author:profiles(full_name), category:news_categories(name, slug)');
      
      if (selectedCategory) {
        query = query.eq('category_id', selectedCategory);
      }
      
      const { data: articlesData, error: articlesError } = await query
        .order('created_at', { ascending: false });

      if (articlesError) {
        toast({ title: "Erro", description: "Não foi possível carregar as notícias.", variant: "destructive" });
      } else {
        setArticles(articlesData);
      }

      setLoading(false);
    };
    fetchArticles();
  }, [toast, selectedCategory]);

  const featuredArticle = articles.length > 0 ? articles[0] : null;
  const otherArticles = articles.length > 1 ? articles.slice(1) : [];

  return (
    <>
      <Helmet>
        <title>Notícias - GOV.RP</title>
        <meta name="description" content="Fique por dentro das últimas notícias e acontecimentos do universo GOV.RP." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Newspaper}
            title="Portal de"
            gradientText="Notícias"
            description="Os últimos acontecimentos, decisões políticas e movimentos econômicos do universo GOV.RP."
            iconColor="text-sky-400"
          />

          <div className="mb-12">
            <div className="flex flex-wrap justify-center gap-2">
              {categories.map(cat => (
                <Button 
                  key={cat.id || 'all'}
                  variant="ghost"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "rounded-full transition-all",
                    selectedCategory === cat.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {cat.name}
                </Button>
              ))}
            </div>
          </div>
          
          {loading ? (
            <div className="flex justify-center items-center min-h-[50vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>
          ) : (
            <div className="space-y-12">
              {featuredArticle && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
                    <Link to={`/news/${featuredArticle.id}`} className="block glass-effect rounded-2xl overflow-hidden group">
                        <div className="grid grid-cols-1 lg:grid-cols-2">
                            <div className="relative h-64 lg:h-auto">
                                <img src={featuredArticle.image_url || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c'} alt={featuredArticle.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                            </div>
                            <div className="p-8 flex flex-col justify-between">
                                <div>
                                    <p className="text-sm font-medium text-blue-400 mb-2">{featuredArticle.category.name}</p>
                                    <h2 className="text-3xl font-bold text-white mb-3 group-hover:text-blue-300 transition-colors">{featuredArticle.title}</h2>
                                    <p className="text-gray-300 leading-relaxed mb-4 line-clamp-4">{featuredArticle.content}</p>
                                </div>
                                <div className="flex items-center justify-between text-sm text-gray-400 mt-auto pt-4 border-t border-white/10">
                                    <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /><span>{new Date(featuredArticle.created_at).toLocaleDateString('pt-BR')}</span></div>
                                    <div className="flex items-center gap-2"><span>Ler mais</span><ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform"/></div>
                                </div>
                            </div>
                        </div>
                    </Link>
                </motion.div>
              )}

              {otherArticles.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {otherArticles.map((item, index) => (
                    <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * (index + 1) }}>
                      <Link to={`/news/${item.id}`} className="block glass-effect rounded-2xl overflow-hidden h-full group">
                        <div className="h-48 overflow-hidden">
                          <img src={item.image_url || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c'} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </div>
                        <div className="p-6 flex flex-col">
                          <p className="text-sm font-medium text-blue-400 mb-2">{item.category.name}</p>
                          <h2 className="text-xl font-bold text-white mb-3 group-hover:text-blue-300 transition-colors flex-grow">{item.title}</h2>
                          <div className="flex items-center text-sm text-gray-400 mt-auto pt-4 border-t border-white/10">
                            <Calendar className="w-4 h-4 mr-2" /><span>{new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              )}

              {articles.length === 0 && (
                <div className="text-center py-20 glass-effect rounded-2xl"><p className="text-gray-300 text-lg">Nenhuma notícia encontrada nesta categoria.</p></div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
};

export default News;