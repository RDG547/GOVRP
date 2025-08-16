import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import ConversationList from '@/components/social-x/messages/ConversationList';
import ChatWindow from '@/components/social-x/messages/ChatWindow';

const XMessages = () => {
    const { user } = useAuth();
    const { conversationId } = useParams();
    const navigate = useNavigate();
    const [conversations, setConversations] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchConversations = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('x_conversations')
            .select(`
                id,
                updated_at,
                participants:x_conversation_participants (
                    profile:profiles ( id, x_username, x_handle, x_avatar_url )
                )
            `)
            .in('id', (await supabase.from('x_conversation_participants').select('conversation_id').eq('user_id', user.id)).data.map(p => p.conversation_id))
            .order('updated_at', { ascending: false });

        if (error) {
            console.error(error);
        } else {
            setConversations(data);
        }
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchConversations();
        const channel = supabase.channel('x_dms')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'x_messages' }, payload => {
              fetchConversations();
          })
          .subscribe();
        return () => supabase.removeChannel(channel);
    }, [fetchConversations]);
    
    const selectedConversation = conversations.find(c => c.id === conversationId);

    const handleNewMessage = (newConversationId) => {
        fetchConversations().then(() => {
            navigate(`/services/x/messages/${newConversationId}`);
        });
    };

    return (
        <>
            <Helmet><title>Mensagens - X</title></Helmet>
            <div className="flex h-[calc(100vh-10rem)] border border-slate-700/50 rounded-lg overflow-hidden">
                <div className={`w-full md:w-1/3 border-r border-slate-700/50 flex-shrink-0 flex-col ${conversationId ? 'hidden md:flex' : 'flex'}`}>
                    <ConversationList conversations={conversations} loading={loading} />
                </div>
                <div className={`w-full md:w-2/3 flex-shrink-0 ${!conversationId ? 'hidden md:flex' : 'flex'}`}>
                   {conversationId && selectedConversation ? (
                        <ChatWindow
                            key={conversationId}
                            conversation={selectedConversation}
                            onNewMessage={handleNewMessage}
                        />
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400 text-center p-4">
                            <p>Selecione uma conversa para começar a conversar ou inicie uma nova pelo perfil de um usuário.</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default XMessages;