import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Search as SearchIcon, User, MessageSquare, Hash } from 'lucide-react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import PostCard from '@/components/social-x/PostCard';
import { Link, useSearchParams } from 'react-router-dom';

const FILTERS = [
    { key: 'all', label: 'Todos', icon: SearchIcon },
    { key: 'users', label: 'Usuários', icon: User },
    { key: 'posts', label: 'Posts', icon: MessageSquare },
];

const XSearch = () => {
    const { user } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const initialQuery = searchParams.get('q') || '';
    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeFilter, setActiveFilter] = useState('all');
    const debounceTimer = useRef(null);

    const doSearch = useCallback(async (searchQuery) => {
        if (!searchQuery || searchQuery.trim().length < 2) {
            setResults(null);
            return;
        }

        setLoading(true);
        const { data, error } = await supabase.rpc('search_x', { p_query_text: searchQuery.trim() });
        if (error) {
            console.error(error);
            setResults(null);
        } else {
            setResults(data);
        }
        setLoading(false);
    }, []);

    // Debounced search on query change
    useEffect(() => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        
        if (query.trim().length < 2) {
            setResults(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        debounceTimer.current = setTimeout(() => {
            doSearch(query);
        }, 400);

        return () => {
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
        };
    }, [query, doSearch]);

    useEffect(() => { setQuery(initialQuery); }, [initialQuery]);
    useDomainRealtime('x-search', user?.id, ['posts','profiles'], () => { if(query.trim().length>=2) void doSearch(query); });

    const handleDeletePost = (postId) => {
        setResults(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                posts: prev.posts.filter(p => p.id !== postId)
            };
        });
    };

    const filteredUsers = results?.users || [];
    const filteredPosts = results?.posts || [];
    const showUsers = activeFilter === 'all' || activeFilter === 'users';
    const showPosts = activeFilter === 'all' || activeFilter === 'posts';
    const hasResults = (showUsers && filteredUsers.length > 0) || (showPosts && filteredPosts.length > 0);

    return (
        <>
            <Helmet><title>Pesquisar - X</title></Helmet>
            
            {/* Search input */}
            <div className="sticky top-0 bg-background/80 backdrop-blur-md z-10 p-4 border-b border-border">
                <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Pesquisar no X..."
                        className="pl-10 text-base bg-secondary/50 border-none focus:ring-2 focus:ring-primary rounded-full h-11"
                        autoFocus
                    />
                    {loading && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 animate-spin text-primary" />
                    )}
                </div>

                {/* Filter tabs */}
                <div className="flex mt-3 border-b border-border -mx-4 px-4">
                    {FILTERS.map(filter => (
                        <button
                            key={filter.key}
                            onClick={() => setActiveFilter(filter.key)}
                            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                                activeFilter === filter.key 
                                    ? 'text-primary' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <filter.icon className="w-4 h-4" />
                            {filter.label}
                            {activeFilter === filter.key && (
                                <motion.div 
                                    layoutId="searchFilter"
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Results */}
            <div className="p-4">
                {!query.trim() && (
                    <div className="text-center py-20 text-muted-foreground">
                        <SearchIcon className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p className="text-lg font-semibold">Explore o X</p>
                        <p>Comece a digitar para pesquisar usuários e posts.</p>
                    </div>
                )}

                {query.trim().length >= 2 && !loading && results && !hasResults && (
                    <div className="text-center py-20 text-muted-foreground">
                        <p className="text-lg font-semibold">Nenhum resultado encontrado.</p>
                        <p>Tente uma busca diferente.</p>
                    </div>
                )}

                {results && (
                    <div className="space-y-6">
                        {showUsers && filteredUsers.length > 0 && (
                            <section>
                                {activeFilter === 'all' && (
                                    <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                                        <User className="w-5 h-5" /> Usuários
                                    </h2>
                                )}
                                <div className="space-y-1">
                                    {filteredUsers.map(u => (
                                        <Link 
                                            key={u.id} 
                                            to={`/services/x/profile/${u.x_handle}`} 
                                            className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary/50 transition-colors"
                                        >
                                            <img 
                                                src={u.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${u.x_handle}`} 
                                                alt={u.x_handle} 
                                                className="w-12 h-12 rounded-full bg-secondary" 
                                            />
                                            <div className="min-w-0">
                                                <p className="font-bold text-foreground truncate">{u.x_username}</p>
                                                <p className="text-sm text-muted-foreground truncate">@{u.x_handle}</p>
                                                {u.x_bio && (
                                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{u.x_bio}</p>
                                                )}
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            </section>
                        )}

                        {showPosts && filteredPosts.length > 0 && (
                            <section>
                                {activeFilter === 'all' && (
                                    <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                                        <MessageSquare className="w-5 h-5" /> Posts
                                    </h2>
                                )}
                                <div className="space-y-0 -mx-4">
                                    <AnimatePresence>
                                        {filteredPosts.map(post => (
                                            <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-border">
                                                <PostCard post={{...post, author: post.author}} onPostDelete={handleDeletePost} />
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default XSearch;