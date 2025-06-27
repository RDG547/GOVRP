import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, X, CornerDownRight } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const Comment = ({ comment, post, onCommentAction, level = 0 }) => {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [isReplying, setIsReplying] = useState(false);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState([]);
  const [loadingReplies, setLoadingReplies] = useState(false);

  const formatTime = (date) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const authorName = comment.author.x_username || comment.author.full_name;
  const authorHandle = comment.author.x_handle || comment.author.username;

  const fetchReplies = useCallback(async () => {
    setLoadingReplies(true);
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_user_id_fkey(*), replies_count')
      .eq('parent_comment_id', comment.id)
      .order('created_at', { ascending: true });
    
    if (error) {
      toast({ title: 'Erro ao buscar respostas', variant: 'destructive' });
    } else {
      setReplies(data);
    }
    setLoadingReplies(false);
  }, [comment.id, toast]);

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    setIsSubmittingReply(true);

    const { data: newReply, error } = await supabase.from('comments').insert({
      post_id: post.id,
      user_id: currentUser.id,
      parent_comment_id: comment.id,
      content: replyContent
    }).select('*, author:profiles!comments_user_id_fkey(*), replies_count').single();
    
    if (error) {
      toast({ title: 'Erro ao responder', description: error.message, variant: 'destructive' });
    } else {
      onCommentAction({ type: 'reply_added', parentCommentId: comment.id, newReply });
      setReplies(prev => [...prev, newReply]);
      setReplyContent('');
      setIsReplying(false);
      setShowReplies(true);
    }
    setIsSubmittingReply(false);
  };
  
  const handleChildCommentAction = (action) => {
     if(action.type === 'reply_added') {
        setReplies(currentReplies => 
            currentReplies.map(reply => 
                reply.id === action.parentCommentId 
                    ? { ...reply, replies_count: (reply.replies_count || 0) + 1 }
                    : reply
            )
        );
     } else if (action.type === 'comment_deleted') {
         setReplies(currentReplies => currentReplies.filter(c => c.id !== action.commentId));
         setReplies(currentReplies => 
            currentReplies.map(reply => 
                reply.id === action.parentCommentId 
                    ? { ...reply, replies_count: Math.max(0, (reply.replies_count || 0) - 1) }
                    : reply
            )
        );
     }
  };

  const handleDelete = async () => {
    const { error } = await supabase.from('comments').delete().eq('id', comment.id);
    if(error) {
       toast({ title: 'Erro ao deletar comentário.', variant: 'destructive' });
    } else {
      onCommentAction({ type: 'comment_deleted', commentId: comment.id, parentCommentId: comment.parent_comment_id });
      toast({ title: 'Comentário removido.' });
    }
  };

  const handleToggleReplies = () => {
      const nextState = !showReplies;
      setShowReplies(nextState);
      if (nextState && replies.length === 0) {
          fetchReplies();
      }
  };

  return (
    <div className={`pl-${level > 0 ? 4 : 0} mt-3`}>
      <div className="flex items-start space-x-3">
        <Link to={`/services/x/profile/${authorHandle}`}>
          <img src={comment.author.avatar_url} alt={authorHandle} className="w-8 h-8 rounded-full" />
        </Link>
        <div className="flex-1 bg-slate-800/50 p-3 rounded-lg">
          <div className="flex justify-between items-center">
            <Link to={`/services/x/profile/${authorHandle}`} className="font-bold text-sm text-white hover:underline">{authorName} <span className="text-xs text-gray-400 font-normal">@{authorHandle}</span></Link>
            {currentUser.id === comment.user_id && <Button variant="ghost" size="icon" className="w-6 h-6 text-gray-400 hover:text-red-400" onClick={handleDelete}><X className="w-3 h-3"/></Button>}
          </div>
          <p className="text-sm text-gray-200 mt-1 whitespace-pre-wrap">{comment.content}</p>
          <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
            <span>{formatTime(comment.created_at)}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={() => setIsReplying(prev => !prev)}>Responder</Button>
              {comment.replies_count > 0 && (
                <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={handleToggleReplies}>
                  <CornerDownRight className="w-3 h-3 mr-1" />
                  {showReplies ? 'Ocultar' : `${comment.replies_count} Resposta(s)`}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {isReplying && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="ml-11 mt-2">
            <form onSubmit={handleReplySubmit} className="flex space-x-2">
              <Textarea value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder={`Respondendo a @${authorHandle}`} className="resize-none" rows={1} />
              <Button type="submit" size="icon" disabled={isSubmittingReply}>{isSubmittingReply ? <Loader2 className="animate-spin w-4 h-4"/> : <Send className="w-4 h-4" />}</Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
      {showReplies && (
        <div className="mt-2 pl-4 border-l-2 border-slate-700/50">
          {loadingReplies ? <Loader2 className="animate-spin w-4 h-4 ml-7 mt-2"/> : replies.map(reply => (
            <Comment key={reply.id} comment={reply} post={post} onCommentAction={handleChildCommentAction} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Comment;