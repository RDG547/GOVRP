import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowLeft, MessageCircle } from 'lucide-react';
import PostCard from '@/components/social-x/PostCard';
import Comment from '@/components/social-x/Comment';
import CreatePostForm from '@/components/social-x/CreatePostForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnimatePresence, motion } from 'framer-motion';

const PostDetails = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const request = useRef(0);
  const removed = useRef(false);
  const [failure, setFailure] = useState(false);
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPostAndComments = useCallback(async () => {
    if (!postId || !user) return;

    const sequence = ++request.current;
    if (removed.current) return;
    // Fetch the main post
    const { data: postData, error: postError } = await supabase
      .rpc('get_x_posts', { p_post_ids: [postId] })
      .eq('id', postId)
      .maybeSingle();

    if (sequence !== request.current || removed.current) return;
    if (postError) {
      console.error('Falha ao consultar publicação', postError);
      setFailure(true); setLoading(false); return;
    }
    setFailure(false);
    if (!postData) {
      removed.current = true; setPost(null); setComments([]); setLoading(false); return;
    }
    setPost(postData);

    // Fetch comments
    const { data: commentsData, error: commentsError } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_user_id_fkey(id,username,full_name,x_username,x_handle,x_avatar_url), replies_count')
      .eq('post_id', postId)
      .is('parent_comment_id', null)
      .order('created_at', { ascending: true });

    if (sequence !== request.current || removed.current) return;
    if (commentsError) {
      toast({ title: "Erro ao carregar comentários", variant: "destructive" });
    } else {
      setComments(commentsData || []);
    }

    setLoading(false);
  }, [postId, user?.id, toast]);

  useEffect(() => {
    removed.current = false;
    setLoading(true);
    void fetchPostAndComments();
    return () => { request.current++; };
  }, [fetchPostAndComments]);
  useDomainRealtime('x-post-details', `${user?.id}:${postId}`, [
    { table: 'posts' },
    { table: 'comments', filter: `post_id=eq.${postId}` },
    { table: 'likes', filter: `post_id=eq.${postId}` },
  ], events => {
    if (events.some(event => event.table === 'posts' && event.eventType === 'DELETE' && event.old?.id === postId)) {
      removed.current = true; request.current++; setPost(null); setComments([]); setLoading(false);
    } else if (!removed.current) void fetchPostAndComments();
  }, Boolean(user?.id));
  usePublicProfileChanges(fetchPostAndComments);

  const handleCommentAction = (action) => {
    if (action.type === 'comment_added') {
      setComments(prev => [...prev.filter(comment => comment.id !== action.newComment.id), action.newComment]);
    } else if (action.type === 'comment_deleted') {
      setComments(prev => prev.filter(c => c.id !== action.commentId));
    } else if (action.type === 'reply_added') {
      setComments(prev => prev.map(c =>
          c.id === action.parentCommentId
            ? { ...c, replies_count: (c.replies_count || 0) + 1 }
            : c
      ));
    }
  };


  const handlePostUpdate = (updatedPostId, updatedData) => {
    if (updatedPostId === post?.id) {
      setPost(prev => ({...prev, ...updatedData}));
    }
  };

  const handlePostDelete = () => {
    removed.current = true; request.current++; setPost(null); setComments([]);
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
  }

  if (!post) {
    return (
        <div className="p-4 text-center">
            <h2 className="text-xl font-bold">{failure ? 'Não foi possível carregar a publicação.' : 'Esta publicação foi removida.'}</h2>
            <Button className="mt-4" onClick={() => navigate('/services/x')}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao Feed</Button>
            {failure && <Button variant="outline" className="m-2" onClick={fetchPostAndComments}>Tentar novamente</Button>}
        </div>
    );
  }

  return (
    <div>
        <Helmet>
            <title>{`${(post.author?.x_username || 'Cidadão')}: "${(post.content || '').substring(0, 50)}..." - GOV.RP X`}</title>
        </Helmet>

        <div className="p-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-md z-10 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft/></Button>
            <h2 className="text-xl font-bold">Post</h2>
        </div>

        <PostCard post={post} onPostUpdate={handlePostUpdate} onPostDelete={handlePostDelete} />

        <div className="p-4 border-b border-border">
          <Card>
             <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><MessageCircle className="w-5 h-5"/> Comentários</CardTitle>
             </CardHeader>
             <CardContent>
                <AnimatePresence>
                  {comments.map(comment => (
                    <motion.div key={comment.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Comment comment={comment} post={post} onCommentAction={handleCommentAction}/>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {comments.length === 0 && (
                    <p className="text-muted-foreground text-center py-4">Nenhum comentário ainda. Seja o primeiro!</p>
                )}
             </CardContent>
          </Card>
        </div>
    </div>
  );
};

export default PostDetails;