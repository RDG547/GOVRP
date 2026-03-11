import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Loader2, Calendar, UserPlus, UserCheck, Edit, MessageSquare, Crown, Shield, Scale } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import EditProfileModal from './EditProfileModal';
import FollowListModal from './FollowListModal';
import { useNavigate } from 'react-router-dom';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const roleBadges = {
    'Fundador': { icon: Crown, color: 'text-yellow-400', label: 'Fundador da Plataforma' },
    'Presidente': { icon: Shield, color: 'text-blue-400', label: 'Presidente' },
    'Deputado': { icon: Scale, color: 'text-green-400', label: 'Deputado' },
    'Senador': { icon: Scale, color: 'text-red-400', label: 'Senador' },
};

const UserBadge = ({ title }) => {
    const badge = roleBadges[title];
    if (!badge) return null;
    const Icon = badge.icon;
    const isMobile = window.innerWidth < 768;

    if (isMobile) {
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button className="focus:outline-none no-navigate" onClick={(e) => e.stopPropagation()}>
                        <Icon className={`w-6 h-6 ${badge.color}`} />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto text-sm p-2" onClick={(e) => e.stopPropagation()}>
                    {badge.label}
                </PopoverContent>
            </Popover>
        );
    }

    return (
        <TooltipProvider delayDuration={100}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button className="focus:outline-none no-navigate" onClick={(e) => e.stopPropagation()}>
                        <Icon className={`w-6 h-6 ${badge.color}`} />
                    </button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{badge.label}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

const ProfileHeader = ({ profile, followers, following, isFollowingInitial, onFollowToggle, onProfileUpdate }) => {
    const { user: currentUser } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [isFollowLoading, setIsFollowLoading] = useState(false);
    const [isFollowing, setIsFollowing] = useState(isFollowingInitial);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [followModalState, setFollowModalState] = useState({ isOpen: false, type: 'followers' });
    const [isMessageLoading, setIsMessageLoading] = useState(false);

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
    
    const handleSendMessage = async () => {
        if (!currentUser || !profile) return;
        setIsMessageLoading(true);
        try {
            const { data, error } = await supabase.rpc('send_x_message', {
                p_recipient_id: profile.id,
                p_content: `Olá!`
            });
            
            if (error || !data.success) {
                throw new Error(data?.message || error.message);
            }
            
            navigate(`/services/x/messages/${data.conversation_id}`);

        } catch (error) {
            console.error("Error sending message:", error);
            toast({ title: "Erro ao iniciar conversa", description: error.message, variant: "destructive" });
        } finally {
            setIsMessageLoading(false);
        }
    };

    const openFollowModal = (type) => {
        setFollowModalState({ isOpen: true, type: type });
    };

    const profileName = profile.x_username || profile.full_name;
    const headerImage = profile.x_header_url || 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D';
    const avatarImage = profile.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${profile.username}`;
    
    const displayedTitles = profile.role === 'Admin' ? ['Fundador', ...(profile.titles || [])] : (profile.titles || []);
    const uniqueTitles = [...new Set(displayedTitles)];

    return (
        <>
            <div className="glass-effect rounded-2xl overflow-hidden mb-4">
                <div style={{backgroundImage: `url(${headerImage})`}} className="h-48 bg-cover bg-center" />
                <div className="p-6">
                    <div className="flex items-end -mt-20">
                        <img src={avatarImage} alt="Avatar" className="w-32 h-32 rounded-full object-cover border-4 border-slate-800 bg-slate-800" />
                        <div className="ml-auto flex items-center gap-2">
                            {currentUser && currentUser.id !== profile.id && (
                                <>
                                    <Button onClick={handleSendMessage} disabled={isMessageLoading} variant="outline">
                                        {isMessageLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                                    </Button>
                                    <Button onClick={handleFollowToggle} disabled={isFollowLoading} variant={isFollowing ? 'secondary' : 'default'}>
                                        {isFollowLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : (
                                            isFollowing ? <UserCheck className="w-4 h-4 mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />
                                        )}
                                        {isFollowing ? 'Seguindo' : 'Seguir'}
                                    </Button>
                                </>
                            )}
                            {currentUser && currentUser.id === profile.id && (
                                <Button variant="outline" onClick={() => setIsEditModalOpen(true)}>
                                    <Edit className="w-4 h-4 mr-2"/>
                                    Editar Perfil
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mt-4">
                        <h1 className="text-3xl font-bold text-white">{profileName}</h1>
                        {uniqueTitles?.map(title => <UserBadge key={title} title={title} />)}
                    </div>
                    <p className="text-gray-400">@{profile.x_handle}</p>

                    {profile.x_bio && <p className="mt-4 text-white whitespace-pre-wrap">{profile.x_bio}</p>}

                    <div className="mt-4 text-gray-400 space-y-2">
                        <p className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            <span>Ingressou em {new Date(profile.created_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                        </p>
                        <div className="flex gap-4">
                            <button onClick={() => openFollowModal('following')} className="hover:underline"><span className="font-bold text-white">{following}</span> Seguindo</button>
                            <button onClick={() => openFollowModal('followers')} className="hover:underline"><span className="font-bold text-white">{followers}</span> Seguidores</button>
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
             <FollowListModal 
                isOpen={followModalState.isOpen}
                setIsOpen={(val) => setFollowModalState(prev => ({...prev, isOpen: val}))}
                userId={profile.id}
                type={followModalState.type}
                initialCount={followModalState.type === 'followers' ? followers : following}
            />
        </>
    );
};

export default ProfileHeader;