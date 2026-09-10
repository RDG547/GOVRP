import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, ArrowLeft } from 'lucide-react';
import PostCard from '@/components/social-x/PostCard';
import { Button } from '@/components/ui/button';

const PostDetails = () => {
  const { postId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const request = useRef(0);
  const removed = useRef(false);
  const [failure, setFailure] = useState(false);
  const [post, setPost] = useState(null);
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
      removed.current = true; setPost(null); setLoading(false); return;
    }
    setPost(postData);

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
    { table: 'likes', filter: `post_id=eq.${postId}` },
  ], events => {
    if (events.some(event => event.table === 'posts' && event.eventType === 'DELETE' && event.old?.id === postId)) {
      removed.current = true; request.current++; setPost(null); setLoading(false);
    } else if (!removed.current) void fetchPostAndComments();
  }, Boolean(user?.id));
  usePublicProfileChanges(fetchPostAndComments);

  const handlePostUpdate = (updatedPostId, updatedData) => {
    if (updatedPostId === post?.id) {
      setPost(prev => ({...prev, ...updatedData}));
    }
  };

  const handlePostDelete = () => {
    removed.current = true; request.current++; setPost(null);
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

        <PostCard commentsAlwaysVisible post={post} onPostUpdate={handlePostUpdate} onPostDelete={handlePostDelete} />


    </div>
  );
};

export default PostDetails;