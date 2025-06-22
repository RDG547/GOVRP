
import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from "@/components/ui/use-toast";
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const Comment = ({ comment, post, currentUser, level = 0, onCommentDeleted }) => {
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
    const { error } = await supabase.rpc('create_comment_reply', {
      p_post_id: post.id,
      p_parent_comment_id: comment.id,
      p_content: replyContent,
    });
    if (error) {
      toast({ title: 'Erro ao responder', variant: 'destructive' });
    } else {
      setReplyContent('');
      setIsReplying(false);
      fetchReplies();
    }
    setIsSubmittingReply(false);
  };

  const handleDelete = async () => {
    await supabase.from('comments').delete().eq('id', comment.id);
    onCommentDeleted();
  };

  return (
    <div className={`ml-${level * 4} mt-3`}>
      <div className="flex items-start space-x-3">
        <img src={comment.author.avatar_url} alt={authorHandle} className="w-8 h-8 rounded-full" />
        <div className="flex-1 bg-slate-800/50 p-2 rounded-lg">
          <div className="flex justify-between items-center">
            <p className="font-bold text-sm text-white">{authorName} <span className="text-xs text-gray-400 font-normal">@{authorHandle}</span></p>
            {currentUser.id === comment.user_id && <Button variant="ghost" size="icon" className="w-6 h-6" onClick={handleDelete}><X className="w-3 h-3"/></Button>}
          </div>
          <p className="text-sm text-gray-200 mt-1">{comment.content}</p>
          <div className="text-xs text-gray-500 mt-2 flex items-center justify-between">
            <span>{formatTime(comment.created_at)}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={() => setIsReplying(prev => !prev)}>Responder</Button>
              {comment.replies_count > 0 && (
                <Button variant="ghost" size="sm" className="h-auto p-1 text-xs" onClick={() => { if(!showReplies) fetchReplies(); setShowReplies(prev => !prev); }}>
                  {showReplies ? 'Ocultar' : `Ver ${comment.replies_count} respostas`}
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
        <div className="mt-2">
          {loadingReplies ? <Loader2 className="animate-spin w-4 h-4 ml-11"/> : replies.map(reply => (
            <Comment key={reply.id} comment={reply} post={post} currentUser={currentUser} level={level + 1} onCommentDeleted={fetchReplies} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Comment;
