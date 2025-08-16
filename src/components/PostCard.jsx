import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Link } from 'react-router-dom';
import { Loader2, Send, MessageCircle, Repeat2, Heart, BarChart2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import Comment from './Comment';
import { useAuth } from '@/contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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


const PostCard = React.memo(({ post, onDelete }) => {
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
  const isQuoteRepost = post.original_post_id && post.quote_content;
  const isSimpleRepost = post.original_post_id && !post.quote_content;
  const repostingUser = isSimpleRepost ? post.author : null;
  const postToShow = post.original_post ? post.original_post : post;
  
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
    await supabase.rpc('toggle_like', { p_post_id: postToShow.id });
  };
  
  const handleRepost = async () => {
    if (isReposted) {
      // Unrepost
      setRepostsCount(prev => prev - 1);
      setIsReposted(false);
      const { error } = await supabase.rpc('delete_repost', { p_original_post_id: postToShow.id });
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
    const { error } = await supabase.rpc('create_repost', { p_post_id: postToShow.id, p_quote_content: quoteContent });
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
    const { data, error } = await supabase.from('comments').select('*, author:profiles!comments_user_id_fkey(*), replies_count').eq('post_id', postToShow.id).is('parent_comment_id', null).order('created_at', { ascending: true });
    if (error) toast({ title: 'Erro ao buscar comentários', variant: 'destructive' });
    else setComments(data);
  }, [postToShow.id, toast]);
  
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
        post_id: postToShow.id,
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
      {isSimpleRepost && (
        <div className="px-4 pt-2 text-sm text-muted-foreground flex items-center gap-2">
            <Repeat2 className="w-4 h-4"/>
            <Link to={`/services/x/profile/${repostingUser.x_handle}`} className="font-bold hover:underline">{repostingUser.x_username}</Link> repostou
        </div>
      )}
      <CardContent className="p-4">
        <div className="flex items-start space-x-4">
          <Link to={`/services/x/profile/${postToShow.author.x_handle}`}><img src={postToShow.author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${postToShow.author.x_handle}`} alt={postToShow.author.x_handle} className="w-12 h-12 rounded-full" /></Link>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <Link to={`/services/x/profile/${postToShow.author.x_handle}`} className="font-bold text-foreground hover:underline">{postToShow.author.x_username}</Link>
                <p className="text-sm text-muted-foreground">@{postToShow.author.x_handle} · <span title={formatTime(postToShow.created_at)}>{formatDistanceToNow(new Date(postToShow.created_at), { locale: ptBR, addSuffix: true })}</span></p>
              </div>
              {currentUser.id === post.user_id && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}><DialogTrigger asChild><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button></DialogTrigger>
                  <DialogContent className="glass-effect text-foreground"><DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription className="text-muted-foreground">Tem certeza que deseja excluir este post? Esta ação não pode ser desfeita.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={handleDelete}>Excluir</Button></DialogFooter></DialogContent>
                </Dialog>
              )}
            </div>
            {isQuoteRepost && <p className="text-foreground mt-2 whitespace-pre-wrap">{post.quote_content}</p>}
            
            {!isSimpleRepost && (
              <p className="text-foreground mt-2 whitespace-pre-wrap">{post.content}</p>
            )}

            {isQuoteRepost && (
                 <div className="mt-2 border border-border rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <img src={postToShow.author.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${postToShow.author.x_handle}`} alt={postToShow.author.x_handle} className="w-6 h-6 rounded-full" />
                        <span className="font-bold text-foreground text-sm">{postToShow.author.x_username}</span>
                        <span className="text-muted-foreground text-sm">@{postToShow.author.x_handle}</span>
                        <span className="text-muted-foreground text-sm">· {formatDistanceToNow(new Date(postToShow.created_at), { locale: ptBR })}</span>
                    </div>
                    <p className="text-foreground text-sm whitespace-pre-wrap">{postToShow.content}</p>
                    {postToShow.image_url && <img  src={postToShow.image_url} alt="Post original" className="mt-2 rounded-lg max-h-60" />}
                </div>
            )}

            {post.image_url && !post.original_post_id && <img src={post.image_url} alt="Post" className="mt-3 rounded-lg border border-border/50 max-h-96 w-auto" />}
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
                <OriginalPostCard post={postToShow} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsRepostDialogOpen(false)}>Cancelar</Button>
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
                <Comment key={comment.id} comment={comment} post={postToShow} onCommentAction={handleCommentAction} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});

export default PostCard;