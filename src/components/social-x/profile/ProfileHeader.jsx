
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, UserPlus, UserCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

const ProfileHeader = ({ profile, followers, following, isFollowingInitial, onFollowToggle }) => {
    const { user: currentUser } = useAuth();
    const { toast } = useToast();
    const [isFollowLoading, setIsFollowLoading] = useState(false);
    const [isFollowing, setIsFollowing] = useState(isFollowingInitial);

    const handleFollowToggle = async () => {
        if (!currentUser) {
            toast({ title: "Ação necessária", description: "Você precisa estar logado para seguir alguém." });
            return;
        }

        setIsFollowLoading(true);
        try {
            if (isFollowing) {
                const { error } = await supabase.from('followers').delete().match({ follower_id: currentUser.id, following_id: profile.id });
                if (error) throw error;
                setIsFollowing(false);
                onFollowToggle(false);
            } else {
                const { error } = await supabase.from('followers').insert({ follower_id: currentUser.id, following_id: profile.id });
                if (error) throw error;
                setIsFollowing(true);
                onFollowToggle(true);
            }
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível completar a ação.", variant: "destructive" });
        } finally {
            setIsFollowLoading(false);
        }
    };

    const profileName = profile.x_username || profile.full_name;

    return (
        <div className="glass-effect rounded-2xl overflow-hidden">
            <div className="h-48 bg-gradient-to-r from-blue-700 to-purple-800" />
            <div className="p-6">
                <div className="flex items-end -mt-20">
                    <img src={profile.avatar_url} alt="Avatar" className="w-32 h-32 rounded-full object-cover border-4 border-slate-800 bg-slate-800" />
                    <div className="ml-auto">
                        {currentUser && currentUser.id !== profile.id && (
                            <Button onClick={handleFollowToggle} disabled={isFollowLoading}>
                                {isFollowLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : (
                                    isFollowing ? <UserCheck className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />
                                )}
                                {isFollowing ? 'Seguindo' : 'Seguir'}
                            </Button>
                        )}
                        {currentUser && currentUser.id === profile.id && (
                            <Link to="/settings">
                                <Button variant="outline">Editar Perfil</Button>
                            </Link>
                        )}
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-white mt-4">{profileName}</h1>
                <p className="text-gray-400">@{profile.x_handle}</p>

                <div className="mt-4 text-gray-400 space-y-2">
                    <p className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        <span>Ingressou em {new Date(profile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                    </p>
                    <div className="flex gap-4">
                        <span><span className="font-bold text-white">{following}</span> Seguindo</span>
                        <span><span className="font-bold text-white">{followers}</span> Seguidores</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProfileHeader;
