import { fetchPublicProfiles } from '@/lib/publicProfiles';
import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, X, CornerDownRight } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Link } from 'react-router-dom';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
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
  const authorName = comment.author?.x_username || comment.author?.full_name;
  const authorHandle = comment.author?.x_handle || comment.author?.username;

  const fetchReplies = useCallback(async () => {
    if (!replies.length) setLoadingReplies(true);
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_user_id_fkey(id,username,full_name,x_username,x_handle,x_avatar_url), replies_count')
      .eq('parent_comment_id', comment.id)
      .order('created_at', { ascending: true });

    if (error) {
      toast({ title: 'Erro ao buscar respostas', variant: 'destructive' });
    } else {
      const profiles = await fetchPublicProfiles((data || []).map(reply => reply.user_id));
      setReplies((data || []).map(reply => ({ ...reply, author: profiles.get(reply.user_id) || reply.author })));
    }
    setLoadingReplies(false);
  }, [comment.id, toast]);

  useDomainRealtime('x-replies', comment.id, [{ table: 'comments', filter: `parent_comment_id=eq.${comment.id}` }], fetchReplies, showReplies);
  usePublicProfileChanges(fetchReplies, showReplies);

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    setIsSubmittingReply(true);

    const { data: newReply, error } = await supabase.from('comments').insert({
      post_id: post.id,
      user_id: currentUser.id,
      parent_comment_id: comment.id,
      content: replyContent
    }).select('*, author:profiles!comments_user_id_fkey(id,username,full_name,x_username,x_handle,x_avatar_url), replies_count').single();

    if (error) {
      toast({ title: 'Erro ao responder', description: error.message, variant: 'destructive' });
    } else {
      onCommentAction({ type: 'reply_added', parentCommentId: comment.id, newReply });
      setReplies(prev => [...prev.filter(reply => reply.id !== newReply.id), newReply]);
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
    <div className={`${level > 0 && level < 3 ? 'pl-2 sm:pl-4' : ''} mt-3 min-w-0`}>
      <div className="flex items-start space-x-3">
        <Link to={`/services/x/profile/${authorHandle}`}>
          <img src={comment.author?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${authorHandle}`} alt={authorHandle} className="w-8 h-8 rounded-full" />
        </Link>
        <div className="min-w-0 flex-1 bg-secondary/50 p-3 rounded-lg">
          <div className="flex justify-between items-center">
            <Link to={`/services/x/profile/${authorHandle}`} className="font-bold text-sm text-foreground hover:underline">{authorName} <span className="text-xs text-muted-foreground font-normal">@{authorHandle}</span></Link>
            {currentUser.id === comment.user_id && <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:text-destructive" onClick={handleDelete}><X className="w-3 h-3"/></Button>}
          </div>
          <p className="text-sm text-foreground mt-1 whitespace-pre-wrap break-words">{comment.content}</p>
          <div className="text-xs text-muted-foreground mt-2 flex items-center justify-between">
            <span>{formatTime(comment.created_at)}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={() => { if (!isReplying && !replyContent) setReplyContent(`@${authorHandle} `); setIsReplying(prev => !prev); }}>Responder</Button>
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
        <div className={`mt-2 ${level < 2 ? 'pl-2 sm:pl-4 border-l-2 border-border/50' : ''}`}>
          {loadingReplies ? <Loader2 className="animate-spin w-4 h-4 ml-7 mt-2"/> : replies.map(reply => (
            <Comment key={reply.id} comment={reply} post={post} onCommentAction={handleChildCommentAction} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Comment;
