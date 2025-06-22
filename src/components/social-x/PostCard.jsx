
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

const PostCard = React.memo(({ post, currentUser, onInteraction, viewedPosts, onDelete }) => {
  const { toast } = useToast();
  const [isLiked, setIsLiked] = useState(post.is_liked_by_user);
  const [isReposted, setIsReposted] = useState(post.is_reposted_by_user);
  const [likesCount, setLikesCount] = useState(post.likes_count);
  const [repostsCount, setRepostsCount] = useState(post.reposts_count);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [isCommenting, setIsCommenting] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentContent, setCommentContent] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const postRef = useRef(null);
  
  const authorName = post.author.x_username || post.author.full_name;
  const authorHandle = post.author.x_handle || post.author.username;
  
  useEffect(() => {
    setIsLiked(post.is_liked_by_user);
    setIsReposted(post.is_reposted_by_user);
    setLikesCount(post.likes_count);
    setRepostsCount(post.reposts_count);
    setCommentsCount(post.comments_count);
  }, [post]);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !viewedPosts.current.has(post.id)) {
          viewedPosts.current.add(post.id);
          supabase.rpc('increment_view_count', { p_post_id: post.id }).then(({ error }) => {
            if (error) console.error('Error incrementing view count:', error);
            else onInteraction({ ...post, views_count: post.views_count + 1 });
          });
        }
      }, { threshold: 0.5 }
    );
    if (postRef.current) observer.observe(postRef.current);
    return () => { if (postRef.current) observer.unobserve(postRef.current) };
  }, [post.id, viewedPosts, onInteraction]);

  const handleLike = async () => {
    setIsLiked(prev => !prev);
    setLikesCount(prev => isLiked ? prev - 1 : prev + 1);
    await supabase.rpc('toggle_like', { p_post_id: post.id });
  };
  
  const handleRepost = async () => {
    setIsReposted(prev => !prev);
    setRepostsCount(prev => isReposted ? prev - 1 : prev + 1);
    await supabase.rpc('toggle_repost', { p_post_id: post.id });
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
    const { error } = await supabase.from('comments').insert({ post_id: post.id, user_id: currentUser.id, content: commentContent });
    if (error) {
       toast({ title: 'Erro ao comentar', description: 'O post pode ter sido excluído.', variant: 'destructive' });
    } else {
      setCommentContent('');
      fetchComments();
      setCommentsCount(c => c + 1);
    }
    setIsSubmittingComment(false);
  };

  const formatTime = (date) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  
  return (
    <Card ref={postRef} className="border-slate-700/50 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start space-x-4">
          <Link to={`/services/x/profile/${authorHandle}`}><img src={post.author.avatar_url} alt={authorHandle} className="w-12 h-12 rounded-full" /></Link>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <div>
                <Link to={`/services/x/profile/${authorHandle}`} className="font-bold text-white hover:underline">{authorName}</Link>
                <p className="text-sm text-gray-400">@{authorHandle} · <span title={formatTime(post.created_at)}>{formatTime(post.created_at)}</span></p>
              </div>
              {currentUser.id === post.user_id && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}><DialogTrigger asChild><Button variant="ghost" size="icon" className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></Button></DialogTrigger>
                  <DialogContent><DialogHeader><DialogTitle>Confirmar Exclusão</DialogTitle><DialogDescription>Tem certeza que deseja excluir este post? Esta ação não pode ser desfeita.</DialogDescription></DialogHeader><DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={handleDelete}>Excluir</Button></DialogFooter></DialogContent>
                </Dialog>
              )}
            </div>
            <p className="text-white mt-2 whitespace-pre-wrap">{post.content}</p>
            {post.image_url && <img src={post.image_url} alt="Post" className="mt-3 rounded-lg border border-slate-700/50 max-h-96 w-auto" />}
          </div>
        </div>
      </CardContent>
      <CardFooter className="px-4 py-2 flex justify-between items-center border-t border-slate-700/50">
        <div className="flex items-center space-x-4 text-gray-400">
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleCommentToggle} className="flex items-center space-x-1 hover:text-blue-400 transition-colors"><MessageCircle className="w-5 h-5" /><span>{commentsCount}</span></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleRepost} className={`flex items-center space-x-1 hover:text-green-400 transition-colors ${isReposted ? 'text-green-500' : ''}`}><Repeat2 className="w-5 h-5" /><span>{repostsCount}</span></motion.button>
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleLike} className={`flex items-center space-x-1 hover:text-pink-500 transition-colors ${isLiked ? 'text-pink-500' : ''}`}><Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} /><span>{likesCount}</span></motion.button>
          <div className="flex items-center space-x-1"><BarChart2 className="w-5 h-5" /><span>{post.views_count || 0}</span></div>
        </div>
      </CardFooter>
      <AnimatePresence>
        {isCommenting && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="px-4 pb-4 border-t border-slate-700/50">
            <form onSubmit={handleCommentSubmit} className="flex space-x-2 mt-4">
              <Textarea value={commentContent} onChange={(e) => setCommentContent(e.target.value)} placeholder="Poste sua resposta" className="resize-none" rows={1} />
              <Button type="submit" size="icon" disabled={isSubmittingComment}>{isSubmittingComment ? <Loader2 className="animate-spin w-4 h-4"/> : <Send className="w-4 h-4" />}</Button>
            </form>
            <div className="mt-4 space-y-3 max-h-96 overflow-y-auto">
              {comments.map(comment => (
                <Comment key={comment.id} comment={comment} post={post} currentUser={currentUser} onCommentDeleted={fetchComments} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});

export default PostCard;
