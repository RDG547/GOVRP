import { fetchPublicProfiles } from '@/lib/publicProfiles';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';
import { useToast } from '@/components/ui/use-toast';
import { Helmet } from 'react-helmet-async';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, ArrowLeft } from 'lucide-react';
import ConversationList from '@/components/social-x/messages/ConversationList';
import ChatWindow from '@/components/social-x/messages/ChatWindow';
import { Button } from '@/components/ui/button';

const XMessages = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { conversationId } = useParams();
    const navigate = useNavigate();
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);
    const chatShell = useRef(null);
    const [viewportHeight, setViewportHeight] = useState(null);
    useEffect(() => {
        const viewport = window.visualViewport;
        const resize = () => {
            const top = chatShell.current?.getBoundingClientRect().top || 0;
            setViewportHeight(Math.max(200, (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0) - top - 12));
        };
        resize();
        viewport?.addEventListener('resize', resize);
        viewport?.addEventListener('scroll', resize);
        window.addEventListener('resize', resize);
        return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('resize', resize); };
    }, []);

    const fetchConversations = useCallback(async () => {
        if (!user) return;

        const { data: userConversations, error: convError } = await supabase
            .from('x_conversation_participants')
            .select('conversation_id')
            .eq('user_id', user.id);

        if (convError) {
            console.error("Error fetching user conversations:", convError);
            setLoading(false);
            return;
        }

        const conversationIds = userConversations.map(p => p.conversation_id);

        if (conversationIds.length === 0) {
            setConversations([]);
            setLoading(false);
            return;
        }

        const { data, error } = await supabase
            .from('x_conversations')
            .select(`
                id,
                updated_at,
                participants:x_conversation_participants ( user_id,
                    profile:profiles ( id, x_username, x_handle, x_avatar_url )
                )
            `)
            .in('id', conversationIds)
            .order('updated_at', { ascending: false });

        if (error) {
            toast({ title: 'Não foi possível carregar as conversas', description: 'Tente novamente em instantes.', variant: 'destructive' });
        } else {
            const profiles = await fetchPublicProfiles((data || []).flatMap(conversation => conversation.participants.map(p => p.user_id)));
            setConversations((data || []).map(conversation => ({ ...conversation, participants: conversation.participants.map(p => ({ ...p, profile: profiles.get(p.user_id) || p.profile })) })));
        }
        setLoading(false);
    }, [user?.id, toast]);

    useEffect(() => { void fetchConversations(); }, [fetchConversations]);
    useDomainRealtime('x-conversations', user?.id, ['x_conversations', { table: 'x_conversation_participants', filter: `user_id=eq.${user?.id}` }, { table: 'notifications', filter: `user_id=eq.${user?.id}` }], fetchConversations, Boolean(user?.id));
    usePublicProfileChanges(fetchConversations);

    const selectedConversation = conversations.find(c => c.id === conversationId);

    const handleConversationDeleted = (deletedConvoId) => {
        setConversations(prev => prev.filter(c => c.id !== deletedConvoId));
    };

    return (
        <>
            <Helmet><title>Mensagens - X</title></Helmet>
            <div ref={chatShell} style={viewportHeight ? { height: viewportHeight } : undefined} className="flex flex-col h-[calc(100dvh-8rem)] min-h-0 overflow-hidden">
                {/* Conversation List */}
                <div className={`
                    w-full
                    border-r border-border
                    flex-1 min-h-0 flex flex-col
                    ${conversationId ? 'hidden' : 'flex'}
                `}>
                    <div className="p-4 border-b border-border">
                        <h2 className="text-xl font-bold text-foreground">Mensagens</h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <ConversationList
                            conversations={conversations}
                            loading={loading}
                            onConversationDeleted={handleConversationDeleted}
                        />
                    </div>
                </div>

                {/* Chat Area */}
                <div className={`
                    flex-1 flex flex-col min-w-0 min-h-0
                    ${!conversationId ? 'hidden' : 'flex'}
                `}>
                    {conversationId && selectedConversation ? (
                        <>
                            <ChatWindow
                                key={conversationId}
                                conversation={selectedConversation}
                            />
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-muted-foreground text-center p-4">
                            <div>
                                <h3 className="text-lg font-semibold mb-2">Selecione uma conversa</h3>
                                <p className="text-sm">Escolha uma conversa da lista ou inicie uma nova pelo perfil de um usuário.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default XMessages;
