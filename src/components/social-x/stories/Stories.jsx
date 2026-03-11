import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Plus } from 'lucide-react';
import StoryViewer from './StoryViewer';
import UploadStoryModal from './UploadStoryModal';

const Stories = () => {
    const [stories, setStories] = useState([]);
    const [viewingStoryIndex, setViewingStoryIndex] = useState(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const { user } = useAuth();

    const fetchStories = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data: followingIds } = await supabase
            .from('followers')
            .select('following_id')
            .eq('follower_id', user.id);

        const idsToFetch = [user.id, ...(followingIds || []).map(f => f.following_id)];
        
        const { data, error } = await supabase.rpc('get_stories_by_user_ids', { p_user_ids: idsToFetch });

        if (error) {
            console.error('Error fetching stories:', error);
        } else {
            setStories(data || []);
        }
        setLoading(false);
    }, [user]);


    useEffect(() => {
        fetchStories();
    }, [fetchStories]);

    const handleStoryAction = () => {
        fetchStories();
        setViewingStoryIndex(null);
    };

    return (
        <>
            <div className="mb-4">
                <div className="flex items-center gap-3 overflow-x-auto pb-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center w-full h-24">
                            <Loader2 className="animate-spin text-primary" />
                        </div>
                    ) : (
                        <>
                            <button onClick={() => setIsUploadModalOpen(true)} className="flex-shrink-0 flex flex-col items-center justify-center w-20 h-24 text-center space-y-1">
                                <div className="w-16 h-16 rounded-full border-2 border-dashed border-primary flex items-center justify-center bg-secondary/50">
                                    <Plus className="text-primary" />
                                </div>
                                <span className="text-xs font-medium text-foreground">Adicionar</span>
                            </button>
                            {stories.map((story, index) => (
                                <button key={story.user_id} onClick={() => setViewingStoryIndex(index)} className="flex-shrink-0 flex flex-col items-center justify-center w-20 h-24 text-center space-y-1">
                                    <div className="w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500">
                                        <div className="bg-background rounded-full p-0.5">
                                            <img src={story.author_avatar} alt={story.author_username} className="w-full h-full object-cover rounded-full" />
                                        </div>
                                    </div>
                                    <span className="text-xs font-medium text-foreground truncate w-full">{story.author_username}</span>
                                </button>
                            ))}
                        </>
                    )}
                </div>
            </div>

            {viewingStoryIndex !== null && (
                <StoryViewer
                    stories={stories}
                    initialStoryIndex={viewingStoryIndex}
                    onClose={() => setViewingStoryIndex(null)}
                    onAction={handleStoryAction}
                />
            )}

            <UploadStoryModal
                isOpen={isUploadModalOpen}
                onOpenChange={setIsUploadModalOpen}
                onStoryCreated={handleStoryAction}
            />
        </>
    );
};

export default Stories;