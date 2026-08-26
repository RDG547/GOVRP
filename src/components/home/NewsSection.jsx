import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, TrendingUp, Newspaper, Loader2, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

const NewsSection = () => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [interactionVersion, setInteractionVersion] = useState(0);
  const touchStartX = useRef(null);
  const pointerStartX = useRef(null);

  const fetchNews = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase
      .from('news_articles')
      .select('id, title, content, image_url, created_at, category:news_categories(name)')
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) {
      console.error('Erro ao buscar notícias:', error);
    } else {
      setNews(data || []);
      setCurrentIndex((index) => Math.min(index, Math.max((data || []).length - 1, 0)));
    }
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    void fetchNews();

    const channel = supabase
      .channel('home-latest-news')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'news_articles',
      }, () => void fetchNews({ quiet: true }))
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchNews]);

  useEffect(() => {
    if (news.length < 2) return undefined;
    const intervalId = window.setInterval(() => {
      setCurrentIndex((index) => (index + 1) % news.length);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [interactionVersion, news.length]);

  const goTo = (index) => {
    if (!news.length) return;
    setCurrentIndex((index + news.length) % news.length);
    setInteractionVersion((version) => version + 1);
  };

  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event) => {
    if (touchStartX.current == null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    goTo(delta < 0 ? currentIndex + 1 : currentIndex - 1);
  };

  const handlePointerDown = (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    pointerStartX.current = event.clientX;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerUp = (event) => {
    if (pointerStartX.current == null) return;
    const delta = event.clientX - pointerStartX.current;
    pointerStartX.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (Math.abs(delta) < 40) return;
    goTo(delta < 0 ? currentIndex + 1 : currentIndex - 1);
  };

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
        ) : news.length ? (
          <div className="mx-auto max-w-3xl" aria-roledescription="carrossel" aria-label="Três notícias mais recentes">
            <div
              className="cursor-grab overflow-hidden rounded-2xl active:cursor-grabbing"
              style={{ touchAction: 'pan-y' }}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onDragStart={(event) => event.preventDefault()}
            >
              <div
                className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
                style={{ transform: `translateX(-${currentIndex * 100}%)` }}
              >
            {news.map((item) => {
              const Icon = iconMap[item.category?.name] || Newspaper;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45 }}
                  className="glass-effect flex min-w-full flex-col overflow-hidden rounded-2xl transition-colors hover:bg-white/5 sm:flex-row"
                >
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className="h-48 w-full object-cover sm:h-auto sm:w-2/5" />
                  ) : null}
                  <div className="flex flex-1 flex-col p-6 sm:p-8">
                  <div className="mb-4 flex items-center gap-4">
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
                    <Link to={`/news/${item.id}`} className="flex items-center text-blue-400 hover:underline">
                      Ler mais <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </div>
                  </div>
                </motion.div>
              );
            })}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-center gap-3">
              <Button type="button" size="icon" variant="outline" onClick={() => goTo(currentIndex - 1)} aria-label="Notícia anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2" aria-label={`Notícia ${currentIndex + 1} de ${news.length}`}>
                {news.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={`Ir para a notícia ${index + 1}`}
                    aria-current={currentIndex === index ? 'true' : undefined}
                    onClick={() => goTo(index)}
                    className={`h-2.5 rounded-full transition-all ${currentIndex === index ? 'w-7 bg-blue-400' : 'w-2.5 bg-white/30 hover:bg-white/50'}`}
                  />
                ))}
              </div>
              <Button type="button" size="icon" variant="outline" onClick={() => goTo(currentIndex + 1)} aria-label="Próxima notícia">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="glass-effect mx-auto max-w-3xl rounded-2xl p-10 text-center text-gray-300">
            Nenhuma notícia publicada ainda.
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
