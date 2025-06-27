import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, UserPlus, UserCheck, Edit } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import EditProfileModal from './EditProfileModal';

const ProfileHeader = ({ profile, followers, following, isFollowingInitial, onFollowToggle, onProfileUpdate }) => {
    const { user: currentUser } = useAuth();
    const { toast } = useToast();
    const [isFollowLoading, setIsFollowLoading] = useState(false);
    const [isFollowing, setIsFollowing] = useState(isFollowingInitial);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const handleFollowToggle = async () => {
        if (!currentUser) {
            toast({ title: "Ação necessária", description: "Você precisa estar logado para seguir alguém." });
            return;
        }

        setIsFollowLoading(true);
        try {
            await supabase.rpc('toggle_follow', { p_following_id: profile.id });
            const newIsFollowing = !isFollowing;
            setIsFollowing(newIsFollowing);
            onFollowToggle(newIsFollowing);

        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível completar a ação.", variant: "destructive" });
        } finally {
            setIsFollowLoading(false);
        }
    };

    const profileName = profile.x_username || profile.full_name;
    const headerImage = profile.x_header_url || 'https://via.placeholder.com/1500x500/1e293b/818cf8.png?text=GOV.RP';
    const avatarImage = profile.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${profile.username}`;

    return (
        <>
            <div className="glass-effect rounded-2xl overflow-hidden mb-4">
                <div style={{backgroundImage: `url(${headerImage})`}} className="h-48 bg-cover bg-center" />
                <div className="p-6">
                    <div className="flex items-end -mt-20">
                        <img src={avatarImage} alt="Avatar" className="w-32 h-32 rounded-full object-cover border-4 border-slate-800 bg-slate-800" />
                        <div className="ml-auto">
                            {currentUser && currentUser.id !== profile.id && (
                                <Button onClick={handleFollowToggle} disabled={isFollowLoading} variant={isFollowing ? 'secondary' : 'default'}>
                                    {isFollowLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : (
                                        isFollowing ? <UserCheck className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />
                                    )}
                                    {isFollowing ? 'Seguindo' : 'Seguir'}
                                </Button>
                            )}
                            {currentUser && currentUser.id === profile.id && (
                                <Button variant="outline" onClick={() => setIsEditModalOpen(true)}>
                                    <Edit className="w-4 h-4 mr-2"/>
                                    Editar Perfil
                                </Button>
                            )}
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold text-white mt-4">{profileName}</h1>
                    <p className="text-gray-400">@{profile.x_handle}</p>

                    {profile.x_bio && <p className="mt-4 text-white whitespace-pre-wrap">{profile.x_bio}</p>}

                    <div className="mt-4 text-gray-400 space-y-2">
                        <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            <span>Ingressou em {new Date(profile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                        </p>
                        <div className="flex gap-4">
                            <Link to="#" className="hover:underline"><span className="font-bold text-white">{following}</span> Seguindo</Link>
                            <Link to="#" className="hover:underline"><span className="font-bold text-white">{followers}</span> Seguidores</Link>
                        </div>
                    </div>
                </div>
            </div>
            {currentUser && currentUser.id === profile.id && (
                <EditProfileModal
                    isOpen={isEditModalOpen}
                    setIsOpen={setIsEditModalOpen}
                    profile={profile}
                    onProfileUpdate={onProfileUpdate}
                />
            )}
        </>
    );
};

export default ProfileHeader;