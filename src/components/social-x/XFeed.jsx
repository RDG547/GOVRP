
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import CreatePostForm from './CreatePostForm';
import PostCard from './PostCard';
import TrendsSidebar from './TrendsSidebar';

const XFeed = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [posts, setPosts] = useState([]);
    const [newPostsAvailable, setNewPostsAvailable] = useState(false);
    const viewedPosts = useRef(new Set());

    const fetchPosts = useCallback(async (showLoading = true) => {
        if (!user || !user.x_handle) return;
        const { data, error } = await supabase.rpc('get_posts_with_interactions', { p_user_id: user.id });
        if (error) {
            toast({ title: "Erro ao carregar os posts", description: error.message, variant: "destructive" });
        } else {
            setPosts(data || []);
        }
        setNewPostsAvailable(false);
    }, [toast, user]);

    const handlePostCreated = (newPost) => {
        const formattedPost = { ...newPost, author: newPost.author || user, is_liked_by_user: false, is_reposted_by_user: false, likes_count: 0, reposts_count: 0, comments_count: 0, views_count: 0 };
        setPosts(current => [formattedPost, ...current]);
    };

    const handleDeletePost = (postId) => {
        setPosts(currentPosts => currentPosts.filter(p => p.id !== postId));
    };

    const handleInteraction = (updatedPost) => {
        setPosts(current => current.map(p => p.id === updatedPost.id ? updatedPost : p));
    };

    useEffect(() => {
        fetchPosts();
        const channel = supabase.channel('realtime:posts_and_interactions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => {
                if (payload.eventType === 'INSERT' && payload.new.user_id !== user.id) {
                    setNewPostsAvailable(true);
                } else if (payload.eventType === 'DELETE') {
                    handleDeletePost(payload.old.id);
                }
            }).subscribe();
        return () => supabase.removeChannel(channel);
    }, [fetchPosts, user]);

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                <main className="lg:col-span-3">
                    <h1 className="text-4xl font-bold text-white mb-6">Página Inicial</h1>
                    <CreatePostForm onPostCreated={handlePostCreated} />

                    <AnimatePresence>
                        {newPostsAvailable && (
                            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="mb-4">
                                <Button className="w-full" variant="outline" onClick={() => fetchPosts()}>
                                    Novas publicações disponíveis. Clique para atualizar!
                                </Button>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="space-y-4">
                        <AnimatePresence>
                            {posts.map(post => (
                                <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                                    <PostCard post={post} currentUser={user} onInteraction={handleInteraction} viewedPosts={viewedPosts} onDelete={handleDeletePost} />
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                </main>
                <TrendsSidebar />
            </div>
        </div>
    );
};

export default XFeed;
