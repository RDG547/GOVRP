import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import CreatePostForm from './CreatePostForm';
import PostCard from './PostCard';

const XFeed = ({ postInputRef }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [posts, setPosts] = useState([]);
    const [newPostsAvailable, setNewPostsAvailable] = useState(false);
    
    const fetchPosts = useCallback(async () => {
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
        const formattedPost = { 
            ...newPost, 
            author: newPost.author || user, 
            is_liked_by_user: false, 
            is_reposted_by_user: false, 
            likes_count: 0, 
            reposts_count: 0, 
            comments_count: 0, 
            views_count: 0 
        };
        setPosts(current => [formattedPost, ...current]);
    };

    const handleDeletePost = (postId) => {
        setPosts(currentPosts => currentPosts.filter(p => p.id !== postId));
    };

    useEffect(() => {
        fetchPosts();
        
        const channel = supabase.channel('realtime:posts')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, (payload) => {
                if (payload.eventType === 'INSERT' && payload.new.user_id !== user.id) {
                    setNewPostsAvailable(true);
                } else if (payload.eventType === 'DELETE') {
                    handleDeletePost(payload.old.id);
                } else if (payload.eventType === 'UPDATE') {
                    setPosts(currentPosts => 
                        currentPosts.map(p => {
                            if (p.id === payload.new.id) {
                                return {
                                    ...p,
                                    likes_count: payload.new.likes_count,
                                    comments_count: payload.new.comments_count,
                                    reposts_count: payload.new.reposts_count,
                                    views_count: payload.new.views_count,
                                };
                            }
                            return p;
                        })
                    );
                }
            }).subscribe();
            
        return () => supabase.removeChannel(channel);
    }, [user, fetchPosts]);

    return (
        <main>
            <div className="p-4 border-b border-slate-700/50">
                <h1 className="text-xl font-bold text-white">Página Inicial</h1>
            </div>
            <div className="p-4 border-b border-slate-700/50">
                <CreatePostForm ref={postInputRef} onPostCreated={handlePostCreated} />
            </div>

            <AnimatePresence>
                {newPostsAvailable && (
                    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="p-4">
                        <Button className="w-full" variant="outline" onClick={() => fetchPosts()}>
                            Novas publicações disponíveis. Clique para atualizar!
                        </Button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="space-y-0">
                <AnimatePresence>
                    {posts.map(post => (
                        <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-slate-700/50">
                            <PostCard post={post} onDelete={handleDeletePost} />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default XFeed;