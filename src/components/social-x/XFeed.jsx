import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import CreatePostForm from './CreatePostForm';
import PostCard from './PostCard';
import Stories from './stories/Stories';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { mergePosts, changedPostIds, X_POST_TABLES } from '@/lib/xPosts';
import { useOutletContext } from 'react-router-dom';

const XFeed = () => {
    const outletContext = useOutletContext();
    const postInputRef = outletContext?.postInputRef;
    const { user } = useAuth();
    const { toast } = useToast();
    const [posts, setPosts] = useState([]);
    const postsRef = useRef(posts);
    postsRef.current = posts;
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    const fetchPosts = useCallback(async (ids = null, before = null) => {
        if (!user?.id || !user?.x_handle) return;
        const { data, error } = await supabase.rpc('get_x_posts', { p_post_ids: ids, p_before: before });
        if (error) {
            toast({ title: "Erro ao carregar os posts", description: error.message, variant: "destructive" });
        } else {
            setPosts(current => mergePosts(current, data || []));
            if (!ids) setHasMore((data || []).length === 100);
        }
    }, [toast, user?.id, user?.x_handle]);

    const handlePostCreated = (newPost) => {
        const formattedPost = {
            ...newPost,
            author: { ...user, x_username: user.x_username, x_handle: user.x_handle, x_avatar_url: user.x_avatar_url },
            is_liked_by_user: false,
            is_reposted_by_user: false,
            likes_count: 0,
            reposts_count: 0,
            comments_count: 0,
            views_count: 0
        };
        setPosts(current => mergePosts(current, [formattedPost]));
    };

    const handlePostUpdate = (postId, updatedData) => {
        setPosts(currentPosts => currentPosts.map(p => p.id === postId ? { ...p, ...updatedData } : p));
    };

    const handleDeletePost = (postId) => {
        setPosts(currentPosts => currentPosts.filter(p => p.id !== postId && p.original_post?.id !== postId));
    };

    const handleRepostCreated = () => {
        fetchPosts();
    };

    useEffect(() => { void fetchPosts(); }, [fetchPosts]);
    useDomainRealtime('x-posts', user?.id, X_POST_TABLES, async events => {
        const deleted = events.filter(event => event.table === 'posts' && event.eventType === 'DELETE').map(event => event.old.id);
        if (deleted.length) setPosts(current => current.filter(post => !deleted.includes(post.id) && !deleted.includes(post.original_post?.id)));
        const ids = changedPostIds(events).filter(id => !deleted.includes(id));
        if (events.some(event => event.eventType === 'SYNC')) {
            // Reconcile currently displayed rows after a disconnection, preserving pagination and scroll.
            const known = postsRef.current.map(post => post.id);
            for (let offset = 0; offset < known.length; offset += 80) {
                const batch = known.slice(offset, offset + 80);
                const { data, error } = await supabase.rpc('get_x_posts', { p_post_ids: batch });
                if (!error) setPosts(current => mergePosts(current.filter(post => !batch.includes(post.id) || data.some(row => row.id === post.id)), data));
            }
            await fetchPosts();
        } else if (ids.length) {
            const affected = [...new Set([...ids, ...postsRef.current.filter(post => ids.includes(post.original_post?.id)).map(post => post.id)])];
            for (let offset = 0; offset < affected.length; offset += 80) await fetchPosts(affected.slice(offset, offset + 80));
        }
    }, Boolean(user?.x_handle));
    usePublicProfileChanges(events => {
        const changed = events.map(event => event.new?.id).filter(Boolean);
        const ids = postsRef.current.filter(post => changed.includes(post.author?.id) || changed.includes(post.original_post?.author?.id)).map(post => post.id);
        for (let offset = 0; offset < ids.length; offset += 80) void fetchPosts(ids.slice(offset, offset + 80));
    });
    const loadMore = async () => {
        setLoadingMore(true);
        try { await fetchPosts(null, postsRef.current.at(-1)?.created_at); }
        finally { setLoadingMore(false); }
    };

    return (
        <div>
            <div className="p-4 border-b border-border">
                <Stories />
                <CreatePostForm ref={postInputRef} onPostCreated={handlePostCreated} />
            </div>

            <div className="space-y-0">
                <AnimatePresence>
                    {posts.map(post => (
                        <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-border">
                            <PostCard post={post} onPostUpdate={handlePostUpdate} onPostDelete={handleDeletePost} onRepostCreated={handleRepostCreated} />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
            {hasMore && posts.length >= 100 && <Button variant="outline" className="m-4" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Carregando…' : 'Ver publicações anteriores'}</Button>}
        </div>
    );
};

export default XFeed;