import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchPostAndComments = useCallback(async () => {
    if (!postId || !user) return;
    setLoading(true);

    // Fetch the main post
    const { data: postData, error: postError } = await supabase
      .rpc('get_posts_with_interactions', { p_user_id: user.id })
      .eq('id', postId)
      .single();

    if (postError || !postData) {
      toast({ title: "Erro", description: "Post não encontrado ou erro ao carregar.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setPost(postData);

    // Fetch comments
    const { data: commentsData, error: commentsError } = await supabase
      .from('comments')
      .select('*, author:profiles!comments_user_id_fkey(*), replies_count')
      .eq('post_id', postId)
      .is('parent_comment_id', null)
      .order('created_at', { ascending: true });
    
    if (commentsError) {
      toast({ title: "Erro ao carregar comentários", variant: "destructive" });
    } else {
      setComments(commentsData || []);
    }
    
    setLoading(false);
  }, [postId, user, toast]);

  useEffect(() => {
    fetchPostAndComments();
  }, [fetchPostAndComments]);
  
  const handleCommentAction = (action) => {
    if (action.type === 'comment_added') {
      setComments(prev => [...prev, action.newComment]);
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
    if (updatedPostId === post.id) {
      setPost(prev => ({...prev, ...updatedData}));
    }
  };

  const handlePostDelete = () => {
    navigate('/services/x');
  };

  if (loading) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
  }

  if (!post) {
    return (
        <div className="p-4 text-center">
            <h2 className="text-xl font-bold">Post não encontrado</h2>
            <p>Este post pode ter sido removido.</p>
        </div>
    );
  }
  
  return (
    <div>
        <Helmet>
            <title>{`${post.author.x_username}: "${post.content.substring(0, 50)}..." - GOV.RP X`}</title>
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