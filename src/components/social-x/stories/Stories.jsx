import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Plus } from 'lucide-react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { invalidateDomain } from '@/lib/realtime';
import StoryViewer from './StoryViewer';
import UploadStoryModal from './UploadStoryModal';

export default function Stories({ profileId = null, allowUpload = true, moderation = false }) {
    const [stories, setStories] = useState([]);
    const [viewingUserId, setViewingUserId] = useState(null);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const request = useRef(0);
    const { user } = useAuth();
    const fetchStories = useCallback(async () => {
        if (!user?.id) return;
        const sequence = ++request.current;
        const { data, error: failure } = await supabase.rpc('get_stories_by_user_ids', { p_user_ids: profileId ? [profileId] : null });
        if (sequence !== request.current) return;
        setError(Boolean(failure));
        if (failure) console.error('Stories: consulta indisponível', failure);
        else setStories(data || []);
        setLoading(false);
    }, [user?.id, profileId]);
    useEffect(() => { void fetchStories(); return () => { request.current++; }; }, [fetchStories]);
    useDomainRealtime('x-stories', user?.id, ['stories'], fetchStories, Boolean(user?.id));
    usePublicProfileChanges(fetchStories, Boolean(user?.id));
    // Expiration is time driven; no database write/reload is needed at 24 hours.
    useEffect(() => {
        const expires = stories.flatMap(group => group.stories).map(item => new Date(item.expires_at || new Date(item.created_at).getTime() + 86400000).getTime());
        if (!expires.length) return undefined;
        const timer = setTimeout(() => {
            setStories(current => current.map(group => ({ ...group, stories: group.stories.filter(item => new Date(item.expires_at || new Date(item.created_at).getTime() + 86400000).getTime() > Date.now()) })).filter(group => group.stories.length));
            void fetchStories();
        }, Math.max(100, Math.min(60000, Math.min(...expires) - Date.now() + 50)));
        return () => clearTimeout(timer);
    }, [stories, fetchStories]);
    const handleStoryAction = () => { void fetchStories(); invalidateDomain('x-stories'); };
    return <>
        <section className="mb-4" aria-label="Stories públicos">
            <div className="flex items-center gap-3 overflow-x-auto pb-2 custom-scrollbar">
                {loading && <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando Stories" />}
                {allowUpload && <button aria-label="Adicionar Story" onClick={() => setIsUploadModalOpen(true)} className="shrink-0 flex flex-col items-center justify-center w-20 h-24 space-y-1 rounded-lg focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="w-16 h-16 rounded-full border-2 border-dashed border-primary flex items-center justify-center bg-secondary/50"><Plus className="text-primary" /></span><span className="text-xs font-medium">Adicionar</span>
                </button>}
                {stories.map(group => <button key={group.user_id} aria-label={`Ver Stories de ${group.author_username}`} onClick={() => setViewingUserId(group.user_id)} className="shrink-0 flex flex-col items-center justify-center w-20 h-24 space-y-1 rounded-lg focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="w-16 h-16 rounded-full p-0.5 bg-gradient-to-tr from-yellow-400 via-red-500 to-purple-500"><span className="flex h-full items-center justify-center bg-background rounded-full p-0.5 overflow-hidden">{group.author_avatar ? <img src={group.author_avatar} alt="" className="w-full h-full object-cover rounded-full" /> : group.author_username?.[0]}</span></span>
                    <span className="text-xs font-medium truncate w-full">{group.author_username}</span>
                </button>)}
                {error && <button className="text-sm text-muted-foreground underline" onClick={fetchStories}>Tentar carregar Stories novamente</button>}
            </div>
        </section>
        {viewingUserId && <StoryViewer moderation={moderation} key={viewingUserId} stories={stories} initialUserId={viewingUserId} onClose={() => setViewingUserId(null)} onAction={handleStoryAction} />}
        <UploadStoryModal isOpen={isUploadModalOpen} onOpenChange={setIsUploadModalOpen} onStoryCreated={handleStoryAction} />
    </>;
}
