import React, { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Search as SearchIcon, User, MessageSquare } from 'lucide-react';
import PostCard from '@/components/social-x/PostCard';
import { Link } from 'react-router-dom';

const XSearch = () => {
    const { user } = useAuth();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSearch = useCallback(async (e) => {
        if (e) e.preventDefault();
        if (query.trim().length < 2) return;

        setLoading(true);
        const { data, error } = await supabase.rpc('search_x', { p_query_text: query });
        if (error) {
            console.error(error);
        } else {
            setResults(data);
        }
        setLoading(false);
    }, [query]);
    
    const handleDeletePost = (postId) => {
        setResults(prev => ({
            ...prev,
            posts: prev.posts.filter(p => p.id !== postId)
        }));
    };

    return (
        <>
            <Helmet><title>Pesquisar - X</title></Helmet>
            <form onSubmit={handleSearch} className="flex gap-2 mb-8">
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Pesquisar no X..."
                    className="text-lg"
                />
                <Button type="submit" disabled={loading}>
                    {loading ? <Loader2 className="animate-spin" /> : <SearchIcon />}
                </Button>
            </form>

            {loading && <div className="flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-blue-400" /></div>}

            {results && (
                <div className="space-y-8">
                    {results.users.length > 0 && (
                        <section>
                            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><User /> Usuários</h2>
                            <div className="space-y-3">
                                {results.users.map(u => (
                                    <Link key={u.id} to={`/services/x/profile/${u.x_handle}`} className="flex items-center gap-4 p-3 rounded-lg hover:bg-slate-800/50 transition-colors">
                                        <img src={u.avatar_url} alt={u.x_handle} className="w-12 h-12 rounded-full" />
                                        <div>
                                            <p className="font-bold text-white">{u.x_username}</p>
                                            <p className="text-sm text-gray-400">@{u.x_handle}</p>
                                            <p className="text-sm text-gray-300 mt-1">{u.x_bio}</p>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}
                    {results.posts.length > 0 && (
                        <section>
                            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2"><MessageSquare /> Posts</h2>
                            <div className="space-y-4">
                                <AnimatePresence>
                                    {results.posts.map(post => (
                                        <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                            <PostCard post={{...post, author: post.author}} onDelete={handleDeletePost} />
                                        </motion.div>
                                    ))}
                                </AnimatePresence>
                            </div>
                        </section>
                    )}
                     {results.users.length === 0 && results.posts.length === 0 && !loading && (
                        <div className="text-center py-20 text-gray-400">
                            <p className="text-lg font-semibold">Nenhum resultado encontrado.</p>
                            <p>Tente uma busca diferente.</p>
                        </div>
                    )}
                </div>
            )}
        </>
    );
};

export default XSearch;