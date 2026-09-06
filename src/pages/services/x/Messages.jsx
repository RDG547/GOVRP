import React, { useState, useEffect, useCallback } from 'react';
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
                participants:x_conversation_participants (
                    profile:profiles ( id, x_username, x_handle, x_avatar_url )
                )
            `)
            .in('id', conversationIds)
            .order('updated_at', { ascending: false });

        if (error) {
            toast({ title: 'Não foi possível carregar as conversas', description: 'Tente novamente em instantes.', variant: 'destructive' });
        } else {
            setConversations(data);
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
            <div className="flex flex-col h-[calc(100dvh-8rem)] min-h-[420px] lg:flex-row">
                {/* Conversation List */}
                <div className={`
                    w-full lg:w-72 xl:w-80
                    border-r border-border
                    flex-shrink-0 flex flex-col
                    ${conversationId ? 'hidden lg:flex' : 'flex'}
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
                    flex-1 flex flex-col min-w-0
                    ${!conversationId ? 'hidden lg:flex' : 'flex'}
                `}>
                    {conversationId && selectedConversation ? (
                        <>
                            {/* Mobile back button */}
                            <div className="lg:hidden p-2 border-b border-border">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => navigate('/services/x/messages')}
                                    className="gap-2"
                                >
                                    <ArrowLeft className="w-4 h-4" /> Voltar
                                </Button>
                            </div>
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