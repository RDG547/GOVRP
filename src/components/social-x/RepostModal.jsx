import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const RepostModal = ({ post, open, onOpenChange, onReposted }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [quoteContent, setQuoteContent] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!post) return null;

    const handleRepost = async () => {
        setIsSubmitting(true);
        const { error } = await supabase.rpc('create_repost', { 
            p_post_id: post.id,
            p_quote_content: quoteContent || null
        });

        if (error) {
            toast({ title: 'Erro ao repostar', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Repostado com sucesso.' });
            onOpenChange(false);
            if(onReposted) onReposted();
        }
        setIsSubmitting(false);
    };

    const OriginalPostPreview = ({ post }) => {
        const author = post.author;
        if (!author) return null;
        
        return (
            <div className="border border-border rounded-lg p-3 mt-4 flex gap-3">
                <img src={author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${author.x_handle}`} alt={author.x_username} className="w-10 h-10 rounded-full"/>
                <div className="w-full">
                    <div className="flex items-center gap-1 text-sm">
                        <span className="font-bold text-foreground truncate">{author.x_username}</span>
                        <span className="text-muted-foreground truncate">@{author.x_handle}</span>
                        <span className="text-muted-foreground">· {formatDistanceToNowStrict(new Date(post.created_at), { locale: ptBR })}</span>
                    </div>
                    <p className="text-foreground text-sm whitespace-pre-wrap">{post.content}</p>
                    {post.image_url && <img src={post.image_url} alt="Post media" className="mt-2 rounded-lg max-h-40 w-full object-cover" />}
                </div>
            </div>
        );
    };


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Repostar</DialogTitle>
                    <DialogDescription>Adicione um comentário ou apenas reposte.</DialogDescription>
                </DialogHeader>
                <div className="py-4">
                    <Textarea 
                        value={quoteContent}
                        onChange={(e) => setQuoteContent(e.target.value)}
                        placeholder="Adicione um comentário..."
                        className="bg-transparent border-border"
                    />
                    <OriginalPostPreview post={post} />
                </div>
                <DialogFooter>
                    <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button onClick={handleRepost} disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="animate-spin mr-2"/> : null}
                        Repostar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default RepostModal;