import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Newspaper, Calendar, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';

const News = () => {
  const [articles, setArticles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('news_categories')
        .select('*');
      
      if (categoriesError) {
        toast({ title: "Erro", description: "Não foi possível carregar as categorias.", variant: "destructive" });
      } else {
        setCategories(categoriesData);
      }

      let query = supabase.from('news_articles').select('*, author:profiles(username), category:news_categories(name, slug)');
      if (selectedCategory) {
        query = query.eq('category_id', selectedCategory);
      }
      const { data: articlesData, error: articlesError } = await query.order('created_at', { ascending: false });

      if (articlesError) {
        toast({ title: "Erro", description: "Não foi possível carregar as notícias.", variant: "destructive" });
      } else {
        setArticles(articlesData);
      }

      setLoading(false);
    };
    fetchData();
  }, [toast, selectedCategory]);

  return (
    <>
      <Helmet>
        <title>Notícias - GOV.RP</title>
        <meta name="description" content="Fique por dentro das últimas notícias e acontecimentos do universo GOV.RP." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-16">
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">Portal de <span className="gradient-text">Notícias</span></h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">Os últimos acontecimentos, decisões políticas e movimentos econômicos do universo GOV.RP.</p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            <aside className="lg:col-span-1 space-y-8">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-effect rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Categorias</h3>
                <ul className="space-y-2">
                  <li><button onClick={() => setSelectedCategory(null)} className={`w-full text-left ${!selectedCategory ? 'text-blue-400' : 'text-gray-300 hover:text-blue-400'}`}>Todas</button></li>
                  {categories.map(cat => (
                    <li key={cat.id}><button onClick={() => setSelectedCategory(cat.id)} className={`w-full text-left ${selectedCategory === cat.id ? 'text-blue-400' : 'text-gray-300 hover:text-blue-400'}`}>{cat.name}</button></li>
                  ))}
                </ul>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-effect rounded-2xl p-6">
                <h3 className="text-xl font-bold text-white mb-4">Seja um Correspondente</h3>
                <p className="text-gray-300 mb-4">Tem um furo de reportagem? Entre em contato e faça parte da nossa equipe de jornalismo.</p>
                <Button as={Link} to="/contact" className="w-full">Enviar Matéria</Button>
              </motion.div>
            </aside>

            <div className="lg:col-span-3 space-y-8">
              {loading ? (
                <div className="flex justify-center items-center min-h-[50vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>
              ) : articles.length > 0 ? (
                articles.map((item, index) => (
                  <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} className="glass-effect rounded-2xl overflow-hidden flex flex-col md:flex-row group">
                    <div className="md:w-1/3 h-48 md:h-auto overflow-hidden">
                      <img src={item.image_url || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c'} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <div className="p-6 flex flex-col justify-between md:w-2/3">
                      <div>
                        <p className="text-sm font-medium text-blue-400 mb-2">{item.category.name}</p>
                        <h2 className="text-2xl font-bold text-white mb-3">{item.title}</h2>
                        <p className="text-gray-300 leading-relaxed mb-4 line-clamp-3">{item.content}</p>
                      </div>
                      <div className="flex items-center justify-between text-sm text-gray-400 mt-auto">
                        <div className="flex items-center"><Calendar className="w-4 h-4 mr-2" /><span>{new Date(item.created_at).toLocaleDateString('pt-BR')}</span></div>
                        <span>Por @{item.author.username}</span>
                      </div>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-20 glass-effect rounded-2xl"><p className="text-gray-300">Nenhuma notícia encontrada nesta categoria.</p></div>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  );
};

export default News;