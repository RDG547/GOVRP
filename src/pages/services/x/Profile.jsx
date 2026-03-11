import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';
import ProfileHeader from '@/components/social-x/profile/ProfileHeader';
import ProfilePostList from '@/components/social-x/profile/ProfilePostList';
import ErrorPage from '@/pages/ErrorPage';
import { AnimatePresence, motion } from 'framer-motion';

const XProfile = () => {
    const { handle } = useParams();
    const { user: currentUser } = useAuth();
    const { toast } = useToast();
    
    const [profileData, setProfileData] = useState({
        profile: null,
        posts: [],
        followersCount: 0,
        followingCount: 0,
        isFollowing: false,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchProfileData = useCallback(async () => {
        if (!handle || !currentUser) return;
        setLoading(true);
        setError(null);
        try {
            const { data: profile, error: profileError } = await supabase
                .from('profiles').select('*').eq('x_handle', handle).single();

            if (profileError || !profile) throw new Error("Perfil não encontrado.");
            
            const { count: followers } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('following_id', profile.id);
            const { count: following } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id);

            let isFollowing = false;
            if (currentUser.id !== profile.id) {
                const { count: followCheck } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('follower_id', currentUser.id).eq('following_id', profile.id);
                isFollowing = (followCheck || 0) > 0;
            }

            const { data: userPosts, error: postsError } = await supabase.rpc('get_user_posts_with_interactions', { 
                p_viewer_id: currentUser.id,
                p_target_user_id: profile.id 
            });

            if (postsError) throw postsError;

            setProfileData({ profile, posts: userPosts || [], followersCount: followers || 0, followingCount: following || 0, isFollowing });

        } catch (error) {
            console.error("Error fetching profile:", error);
            setError(error.message);
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [handle, currentUser, toast]);

    useEffect(() => {
        fetchProfileData();
    }, [fetchProfileData]);

    const handleFollowToggle = (isNowFollowing) => {
        setProfileData(prev => ({
            ...prev,
            followersCount: isNowFollowing ? prev.followersCount + 1 : prev.followersCount - 1
        }));
    };

    const handleProfileUpdate = (updatedProfileData) => {
        setProfileData(prev => ({
            ...prev,
            profile: {...prev.profile, ...updatedProfileData}
        }));
    };
    
    const handlePostUpdate = (postId, updatedData) => {
        setProfileData(prev => ({
            ...prev,
            posts: prev.posts.map(p => p.id === postId ? { ...p, ...updatedData } : p)
        }));
    };

    const handlePostDelete = (postId) => {
        setProfileData(prev => ({
            ...prev,
            posts: prev.posts.filter(p => p.id !== postId)
        }));
    };

    if (loading) return <div className="flex justify-center items-center h-screen"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
    if (error || !profileData.profile) return <ErrorPage title="Perfil não encontrado" message={error} />;
    
    const { profile, posts, followersCount, followingCount, isFollowing } = profileData;
    const profileName = profile.x_username || profile.full_name;

    return (
        <>
            <Helmet>
                <title>{profileName} (@{profile.x_handle}) - GOV.RP X</title>
            </Helmet>
             <AnimatePresence>
                <motion.div 
                    key={handle}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-r border-border min-h-screen"
                >
                <div className="p-4 border-b border-border sticky top-0 bg-background/80 backdrop-blur-md z-10">
                    <h2 className="text-xl font-bold">{profileName}</h2>
                    <p className="text-sm text-muted-foreground">{posts.length} posts</p>
                </div>
                <div className="p-4">
                    <ProfileHeader
                        profile={profile}
                        followers={followersCount}
                        following={followingCount}
                        isFollowingInitial={isFollowing}
                        onFollowToggle={handleFollowToggle}
                        onProfileUpdate={handleProfileUpdate}
                    />
                    <ProfilePostList
                        posts={posts}
                        onPostUpdate={handlePostUpdate}
                        onPostDelete={handlePostDelete}
                    />
                </div>
            </motion.div>
            </AnimatePresence>
        </>
    );
};

export default XProfile;