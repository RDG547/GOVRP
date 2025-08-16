import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const FollowListModal = ({ isOpen, setIsOpen, userId, type, initialCount }) => {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            const fetchList = async () => {
                setLoading(true);
                const rpc = type === 'followers' ? 'get_followers' : 'get_following';
                const { data, error } = await supabase.rpc(rpc, { p_user_id: userId });
                if (error) {
                    console.error(`Error fetching ${type}:`, error);
                } else {
                    setList(data);
                }
                setLoading(false);
            };
            fetchList();
        }
    }, [isOpen, userId, type]);

    const title = type === 'followers' ? 'Seguidores' : 'Seguindo';

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="glass-effect text-white max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{title} ({initialCount})</DialogTitle>
                </DialogHeader>
                <div className="flex-grow overflow-y-auto custom-scrollbar -mr-4 pr-4">
                    {loading ? (
                        <div className="flex justify-center items-center h-40">
                            <Loader2 className="animate-spin w-8 h-8" />
                        </div>
                    ) : list.length > 0 ? (
                        <div className="space-y-4">
                            {list.map(profile => (
                                <div key={profile.id} className="flex items-center gap-4">
                                    <Link to={`/services/x/profile/${profile.x_handle}`} onClick={() => setIsOpen(false)}>
                                        <img src={profile.avatar_url} alt={profile.x_handle} className="w-12 h-12 rounded-full" />
                                    </Link>
                                    <div className="flex-grow">
                                        <Link to={`/services/x/profile/${profile.x_handle}`} onClick={() => setIsOpen(false)}>
                                            <p className="font-bold text-white hover:underline">{profile.x_username}</p>
                                            <p className="text-sm text-gray-400">@{profile.x_handle}</p>
                                        </Link>
                                        <p className="text-sm text-gray-300 mt-1">{profile.x_bio}</p>
                                    </div>
                                    <Link to={`/services/x/profile/${profile.x_handle}`} onClick={() => setIsOpen(false)}>
                                      <Button variant="outline">Ver Perfil</Button>
                                    </Link>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-400 py-10">
                            {type === 'followers' ? 'Ninguém segue este usuário ainda.' : 'Este usuário não segue ninguém ainda.'}
                        </p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default FollowListModal;