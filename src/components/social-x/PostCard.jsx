import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Link } from 'react-router-dom';
import { Loader2, Send, MessageCircle, Repeat2, Heart, BarChart2, Trash2, Crown, Award, Scale } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import Comment from './Comment';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const roleBadges = {
    'Fundador': { icon: Crown, color: 'text-yellow-400', label: 'Fundador' },
    'Presidente': { icon: Award, color: 'text-blue-400', label: 'Presidente' },
    'Senador': { icon: Scale, color: 'text-red-400', label: 'Senador' },
    'Deputado': { icon: Scale, color: 'text-green-400', label: 'Deputado' },
};

const UserBadge = ({ title }) => {
    const badge = roleBadges[title];
    if (!badge) return null;
    const Icon = badge.icon;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger>
                    <Icon className={`w-4 h-4 ${badge.color}`} />
                </TooltipTrigger>
                <TooltipContent>
                    <p>{badge.label}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

const OriginalPostCard = ({ post }) => (
    <Link to={`/services/x/profile/${post.author.x_handle}`} className="block mt-2 border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors">
        <div className="flex items-center gap-2 mb-2">
            <img src={post.author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${post.author.x_handle}`} alt={post.author.x_handle} className="w-6 h-6 rounded-full" />
            <span className="font-bold text-foreground text-sm">{post.author.x_username}</span>
            <span className="text-muted-foreground text-sm">@{post.author.x_handle}</span>
            <span className="text-muted-foreground text-sm">· {formatDistanceToNow(new Date(post.created_at), { locale: ptBR })}</span>
        </div>
        <p className="text-foreground text-sm whitespace-pre-wrap">{post.content}</p>
        {post.image_url && <img  src={post.image_url} alt="Post original" className="mt-2 rounded-lg max-h-60" />}
    </Link>
);


const PostCard = React.memo(({ post, onInteraction, onDelete }) => {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [isLiked, setIsLiked] = useState(post.is_liked_by_user);
  const [isReposted, setIsReposted] = useState(post.is_reposted_by_user);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [viewsCount, setViewsCount] = useState(post.views_count);
  
  const [isCommenting, setIsCommenting] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentContent, setCommentContent] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isRepostDialogOpen, setIsRepostDialogOpen] = useState(false);
  const [quoteContent, setQuoteContent] = useState('');
  const [isSubmittingRepost, setIsSubmittingRepost] = useState(false);

  const postRef = useRef(null);
  const viewedPosts = useRef(new Set());
  
  const authorName = post.author.x_username || post.author.full_name;
  const authorHandle = post.author.x_handle || post.author.username;
  const isRepost = post.original_post_id !== null && post.content === 'repost';
  const postToShow = isRepost ? post.original_post : post;
  
  useEffect(() => {
    setIsLiked(post.is_liked_by_user);
    setIsReposted(post.is_reposted_by_user);
    setLikesCount(post.likes_count);
    setRepostsCount(post.reposts_count);
    setCommentsCount(post.comments_count);
    setViewsCount(post.views_count);
  }, [post]);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewedPosts.current.has(post.id)) {
          viewedPosts.current.add(post.id);
          supabase.rpc('increment_view_count', { p_post_id: post.id }).then(({ error }) => {
            if (!error) setViewsCount(v => (v || 0) + 1);
          });
        }
      }, { threshold: 0.5 }
    );
    const currentRef = postRef.current;
    if (currentRef) observer.observe(currentRef);
    return () => { if (currentRef) observer.unobserve(currentRef) };
  }, [post.id]);

  const handleLike = async () => {
    setIsLiked(prev => !prev);
    setLikesCount(prev => isLiked ? prev - 1 : prev + 1);
    await supabase.rpc('toggle_like', { p_post_id: post.id });
  };
  
  const handleRepost = async () => {
    if (isReposted) {
      // Unrepost
      setRepostsCount(prev => prev - 1);
      setIsReposted(false);
      const { error } = await supabase.rpc('delete_repost', { p_original_post_id: post.id });
      if (error) {
        toast({ title: 'Erro ao remover repost', variant: 'destructive' });
        setRepostsCount(prev => prev + 1); // revert optimistic update
        setIsReposted(true);
      }
    } else {
      // Open quote dialog
      setIsRepostDialogOpen(true);
    }
  };

  const submitRepost = async () => {
    setIsSubmittingRepost(true);
    const { error } = await supabase.rpc('create_repost', { p_post_id: post.id, p_quote_content: quoteContent });
    if (error) {
      toast({ title: 'Erro ao repostar', description: error.message, variant: 'destructive' });
    } else {
      setRepostsCount(prev => prev + 1);
      setIsReposted(true);
      toast({ title: 'Repostado com sucesso!' });
      setIsRepostDialogOpen(false);
      setQuoteContent('');
    }
    setIsSubmittingRepost(false);
  };

  const handleDelete = async () => {
    const { error } = await supabase.from('posts').delete().eq('id', post.id);
    setIsDeleteDialogOpen(false);
    if (error) {
      toast({ title: 'Erro ao excluir o post.', variant: 'destructive' });
    } else {
      toast({ title: 'Post excluído!' });
      onDelete(post.id);
    }
  };
  
  const fetchComments = useCallback(async () => {
    const { data, error } = await supabase.from('comments').select('*, author:profiles!comments_user_id_fkey(*), replies_count').eq('post_id', post.id).is('parent_comment_id', null).order('created_at', { ascending: true });
    if (error) toast({ title: 'Erro ao buscar comentários', variant: 'destructive' });
    else setComments(data);
  }, [post.id, toast]);
  
  const handleCommentToggle = () => {
    const nextState = !isCommenting;
    setIsCommenting(nextState);
    if (nextState && comments.length === 0) fetchComments();
  };
  
  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!commentContent.trim()) return;
    setIsSubmittingComment(true);

    const { data: newComment, error } = await supabase.from('comments').insert({
        post_id: post.id,
        user_id: currentUser.id,
        content: commentContent
    }).select('*, author:profiles!comments_user_id_fkey(*), replies_count').single();
    
    if (error) {
       toast({ title: 'Erro ao comentar', description: 'O post pode ter sido excluído.', variant: 'destructive' });
    } else {
      setCommentContent('');
      setComments(prev => [newComment, ...prev]);
      setCommentsCount(c => c + 1);
    }
    setIsSubmittingComment(false);
  };
  
  const handleCommentAction = (action) => {
      if(action.type === 'comment_deleted') {
          if(action.parentCommentId === null || action.parentCommentId === undefined){
              setComments(current => current.filter(c => c.id !== action.commentId));
              setCommentsCount(c => Math.max(0, c - 1));
          }
      } else if (action.type === 'reply_added') {
          setComments(current => current.map(c => c.id === action.parentCommentId ? { ...c, replies_count: (c.replies_count || 0) + 1} : c));
      }
  };

  const formatTime = (date) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  
  return (
    <Card ref={postRef} className="border-border/50 overflow-hidden bg-card">
      <CardContent className="p-4">
        {post.quote_content && <p className="text-sm text-muted-foreground mb-2">Repostado por <Link to={`/services/x/profile/${authorHandle}`} className="font-bold text-foreground hover:underline">{authorName}</Link></p>}
        <div className="flex items-start space-x-4">
          <Link to={`/services/x/profile/${authorHandle}`}><img src={post.author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${authorHandle}`} alt={authorHandle} className="w-12 h-12 rounded-full" /></Link>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link to={`/services/x/profile/${authorHandle}`} className="font-bold text-foreground hover:underline">{authorName}</Link>
                  {post.author.titles?.map(title => <UserBadge key={title} title={title} />)}
                </div>
                <p className="text-sm text-muted-foreground">@{authorHandle} · <span title={formatTime(post.created_at)}>{formatTime(post.created_at)}</span></p>
              </div>
              {currentUser.id === post.user_id && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}><DialogTrigger asChild><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button></DialogTrigger>
                  <DialogContent className="glass-effect text-foreground"><DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription className="text-muted-foreground">Tem certeza que deseja excluir este post? Esta ação não pode ser desfeita.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={handleDelete}>Excluir</Button></DialogFooter></DialogContent>
                </Dialog>
              )}
            </div>
            {post.quote_content && <p className="text-foreground mt-2 whitespace-pre-wrap">{post.quote_content}</p>}
            <p className="text-foreground mt-2 whitespace-pre-wrap">{post.content}</p>
            {post.image_url && <img  src={post.image_url} alt="Post" className="mt-3 rounded-lg border border-border/50 max-h-96 w-auto" />}
            {post.original_post && <OriginalPostCard post={post.original_post} />}

          </div>
        </div>
      </CardContent>
      <CardFooter className="px-4 py-2 flex justify-between items-center border-t border-border/50">
        <div className="flex items-center space-x-2 md:space-x-4 text-muted-foreground text-sm">
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleCommentToggle} className="flex items-center space-x-1 hover:text-blue-400 transition-colors"><MessageCircle className="w-5 h-5" /><span className="hidden sm:inline">Comentar</span><span>({commentsCount})</span></motion.button>
          
          <Dialog open={isRepostDialogOpen} onOpenChange={setIsRepostDialogOpen}>
            <DialogTrigger asChild>
              <motion.button whileTap={{ scale: 0.9 }} onClick={() => !isReposted && setIsRepostDialogOpen(true)} className={`flex items-center space-x-1 hover:text-green-400 transition-colors ${isReposted ? 'text-green-500' : ''}`}>
                  <Repeat2 className="w-5 h-5" />
                  <span className="hidden sm:inline">Repostar</span>
                  <span>({repostsCount})</span>
              </motion.button>
            </DialogTrigger>
            <DialogContent className="glass-effect text-foreground">
                <DialogHeader>
                    <DialogTitle>Repostar</DialogTitle>
                    <DialogDescription>Adicione um comentário ou apenas reposte.</DialogDescription>
                </DialogHeader>
                <Textarea value={quoteContent} onChange={(e) => setQuoteContent(e.target.value)} placeholder="Adicione um comentário..." className="my-4 bg-secondary border-border" />
                <OriginalPostCard post={post} />
                <DialogFooter>
                    <Button variant="outline" type="button" onClick={() => setIsRepostDialogOpen(false)}>Cancelar</Button>
                    <Button onClick={submitRepost} disabled={isSubmittingRepost}>{isSubmittingRepost && <Loader2 className="animate-spin w-4 h-4 mr-2" />}Repostar</Button>
                </DialogFooter>
            </DialogContent>
          </Dialog>

          <motion.button whileTap={{ scale: 0.9 }} onClick={handleLike} className={`flex items-center space-x-1 hover:text-pink-500 transition-colors ${isLiked ? 'text-pink-500' : ''}`}><Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} /><span className="hidden sm:inline">Curtir</span><span>({likesCount})</span></motion.button>
          <div className="flex items-center space-x-1"><BarChart2 className="w-5 h-5" /><span>{viewsCount || 0}</span></div>
        </div>
      </CardFooter>
      <AnimatePresence>
        {isCommenting && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-4 pb-4 border-t border-border/50">
            <form onSubmit={handleCommentSubmit} className="flex space-x-2 mt-4">
              <Textarea value={commentContent} onChange={(e) => setCommentContent(e.target.value)} placeholder="Poste sua resposta" className="resize-none" rows={1} />
              <Button type="submit" size="icon" disabled={isSubmittingComment}>{isSubmittingComment ? <Loader2 className="animate-spin w-4 h-4"/> : <Send className="w-4 h-4" />}</Button>
            </form>
            <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
              {comments.map(comment => (
                <Comment key={comment.id} comment={comment} post={post} onCommentAction={handleCommentAction} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});

export default PostCard;