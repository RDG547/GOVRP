
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2 } from 'lucide-react';
import PostCard from '@/components/social-x/PostCard';
import { useAuth } from '@/contexts/AuthContext';

const ContentModeration = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchAllPosts = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_posts_with_interactions', { p_user_id: user.id });
        if (error) {
            toast({ title: "Erro ao buscar posts", description: error.message, variant: "destructive" });
        } else {
            setPosts(data);
        }
        setLoading(false);
    }, [toast, user.id]);

    useEffect(() => {
        fetchAllPosts();
    }, [fetchAllPosts]);

    const handleDeletePost = async (postId) => {
        const { error } = await supabase.rpc('admin_delete_post', { p_post_id: postId });
        if (error) {
            toast({ title: 'Erro ao excluir post', description: error.message, variant: "destructive" });
        } else {
            toast({ title: 'Post excluído com sucesso!' });
            setPosts(prev => prev.filter(p => p.id !== postId));
        }
    };
    
    const filteredPosts = posts.filter(post => 
        post.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.author.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        post.author.x_handle.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Moderação de Conteúdo</h2>
            <Input 
                placeholder="Buscar por conteúdo ou autor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
            />
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : (
                <div className="space-y-4">
                    {filteredPosts.map(post => (
                        <div key={post.id} className="relative group">
                            <PostCard post={post} currentUser={user} onInteraction={() => {}} onDelete={() => {}} viewedPosts={{current: new Set()}} />
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button variant="destructive" size="icon" onClick={() => handleDeletePost(post.id)}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ContentModeration;
