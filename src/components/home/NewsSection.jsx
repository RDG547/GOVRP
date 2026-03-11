import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, TrendingUp, Newspaper, Loader2, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

const NewsSection = () => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('news_articles')
        .select('id, title, content, created_at, category:news_categories(name)')
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) {
        console.error("Error fetching news:", error);
      } else {
        setNews(data);
      }
      setLoading(false);
    };
    fetchNews();
  }, []);

  const iconMap = {
    'Política': Megaphone,
    'Economia': TrendingUp,
    'Geral': Newspaper,
  };

  return (
    <section className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Últimas <span className="gradient-text">Notícias</span></h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">Fique por dentro dos acontecimentos mais recentes no universo RP.</p>
        </motion.div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {news.map((item, index) => {
              const Icon = iconMap[item.category?.name] || Newspaper;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: index * 0.1 }}
                  className="glass-effect rounded-2xl p-6 flex flex-col hover:bg-white/5 transition-colors group"
                >
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-400">{item.category?.name || 'Geral'}</p>
                      <h3 className="text-xl font-bold text-white leading-tight">{item.title}</h3>
                    </div>
                  </div>
                  <p className="text-gray-300 mb-4 flex-grow line-clamp-3">{item.content}</p>
                  <div className="flex justify-between items-center mt-auto">
                    <p className="text-sm text-gray-400">{new Date(item.created_at).toLocaleDateString('pt-BR')}</p>
                    <Link to={`/news/${item.id}`} className="flex items-center text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      Ler mais <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
        <motion.div 
            className="text-center mt-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
        >
            <Link to="/news">
                <Button size="lg" className="bg-gradient-to-r from-blue-500 to-purple-500 text-white">
                    Ver Todas as Notícias
                </Button>
            </Link>
        </motion.div>
      </div>
    </section>
  );
};

export default NewsSection;