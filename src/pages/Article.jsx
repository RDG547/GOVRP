import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Loader2, Calendar, User, ArrowLeft, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ErrorPage from './ErrorPage';

const Article = () => {
  const { articleId } = useParams();
  const [article, setArticle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchArticle = async () => {
      setLoading(true);
      setError(null);
      const { data, error: fetchError } = await supabase
        .from('news_articles')
        .select('*, author:profiles(full_name, username, avatar_url), category:news_categories(name, slug)')
        .eq('id', articleId)
        .single();
      
      if (fetchError || !data) {
        setError(fetchError || new Error('Article not found'));
        console.error("Error fetching article:", fetchError);
      } else {
        setArticle(data);
      }
      setLoading(false);
    };

    if (articleId) {
      fetchArticle();
    }
  }, [articleId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[calc(100vh-5rem)]">
        <Loader2 className="w-16 h-16 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return <ErrorPage />;
  }

  return (
    <>
      <Helmet>
        <title>{`${article.title} - Notícias GOV.RP`}</title>
        <meta name="description" content={article.content.substring(0, 160)} />
      </Helmet>

      <div className="py-20">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8"
        >
          <div className="mb-8">
            <Button as={Link} to="/news" variant="ghost" className="text-blue-300 hover:text-blue-200">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar para Notícias
            </Button>
          </div>

          <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <div className="mb-8">
              {article.category && (
                 <Link to={`/news?category=${article.category.slug}`} className="text-lg font-semibold text-blue-400 hover:underline">
                    {article.category.name}
                 </Link>
              )}
              <h1 className="text-4xl md:text-5xl font-extrabold text-white mt-2 mb-4 tracking-tight">{article.title}</h1>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-gray-400 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>{new Date(article.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                </div>
                {article.author && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>Por {article.author.full_name} (@{article.author.username})</span>
                  </div>
                )}
              </div>
            </div>

            {article.image_url && (
              <div className="mb-8 rounded-2xl overflow-hidden glass-effect">
                <img src={article.image_url} alt={article.title} className="w-full h-auto object-cover" />
              </div>
            )}
            
            <div className="prose prose-invert prose-lg max-w-none text-gray-300 leading-relaxed prose-p:mb-4 prose-headings:text-white prose-strong:text-white prose-a:text-blue-400 hover:prose-a:underline">
              {article.content.split('\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>

          </motion.article>
        </motion.div>
      </div>
    </>
  );
};

export default Article;