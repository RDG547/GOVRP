import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2, Search } from 'lucide-react';
import PostCard from '@/components/social-x/PostCard';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";

const ContentModeration = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const viewedPosts = useRef(new Set());

    const fetchAllPosts = useCallback(async () => {
        setLoading(true);
        if (!user) return;
        const { data, error } = await supabase.rpc('get_posts_with_interactions', { p_user_id: user.id });
        if (error) {
            toast({ title: "Erro ao buscar posts", description: error.message, variant: "destructive" });
        } else {
            setPosts(data);
        }
        setLoading(false);
    }, [toast, user]);

    useEffect(() => {
        fetchAllPosts();
    }, [fetchAllPosts]);

    const handleDeletePost = async (postId, postAuthor) => {
        const { error } = await supabase.rpc('admin_delete_post', { p_post_id: postId });
        if (error) {
            toast({ title: 'Erro ao excluir post', description: error.message, variant: "destructive" });
        } else {
            toast({ title: 'Post excluído com sucesso!', description: `Post de ${postAuthor} foi removido.` });
            setPosts(prev => prev.filter(p => p.id !== postId));
        }
    };
    
    const handleInteraction = (updatedPost) => {
        setPosts(current => current.map(p => p.id === updatedPost.id ? updatedPost : p));
    };

    const filteredPosts = posts.filter(post => 
        post.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (post.author.full_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (post.author.x_handle || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white">Moderação de Conteúdo</h2>
            <div className="relative max-w-sm">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5"/>
                <Input 
                    placeholder="Buscar por conteúdo ou autor..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                />
            </div>
            {loading ? (
                <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
            ) : (
                <div className="space-y-4">
                    {filteredPosts.map(post => (
                        <div key={post.id} className="relative group">
                            <PostCard 
                                post={post} 
                                currentUser={user} 
                                onInteraction={handleInteraction} 
                                onDelete={() => {}} // Admin delete is separate
                                viewedPosts={viewedPosts} 
                            />
                            <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="destructive" size="icon">
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="glass-effect text-white">
                                        <DialogHeader>
                                            <DialogTitle>Confirmar Exclusão</DialogTitle>
                                            <DialogDescription className="text-gray-300">
                                                Tem certeza que deseja excluir o post de {post.author.full_name}? Esta ação é irreversível.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <DialogFooter>
                                            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                                            <Button variant="destructive" onClick={() => handleDeletePost(post.id, post.author.full_name)}>Excluir Post</Button>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ContentModeration;