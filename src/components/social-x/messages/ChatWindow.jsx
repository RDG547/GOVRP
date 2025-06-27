import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ChatWindow = ({ conversation }) => {
    const { user } = useAuth();
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef(null);

    const otherParticipant = conversation.participants.find(p => p.profile.id !== user.id)?.profile;

    const fetchMessages = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('direct_messages')
            .select('*, sender:sender_id(*)')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: true });
        
        if (error) console.error(error);
        else setMessages(data);
        setLoading(false);
    }, [conversation.id]);

    useEffect(() => {
        fetchMessages();

        const channel = supabase.channel(`dm:${conversation.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'direct_messages',
                filter: `conversation_id=eq.${conversation.id}`
            }, async (payload) => {
                const { data: senderProfile } = await supabase.from('profiles').select('*').eq('id', payload.new.sender_id).single();
                setMessages(m => [...m, { ...payload.new, sender: senderProfile }]);
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [conversation.id, fetchMessages]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (newMessage.trim() === '' || sending) return;

        setSending(true);
        await supabase.rpc('send_direct_message', {
            p_recipient_id: otherParticipant.id,
            p_content: newMessage
        });
        setNewMessage('');
        setSending(false);
    };

    if (!otherParticipant) {
        return <div className="flex-1 flex items-center justify-center text-gray-400">Participante não encontrado.</div>;
    }

    return (
        <div className="flex flex-col h-full flex-1">
            <header className="p-4 border-b border-slate-700/50 flex items-center gap-3">
                <Link to={`/services/x/profile/${otherParticipant.x_handle}`}>
                    <img src={otherParticipant.avatar_url} alt={otherParticipant.x_handle} className="w-10 h-10 rounded-full"/>
                </Link>
                <div>
                    <p className="font-bold text-white">{otherParticipant.x_username}</p>
                    <p className="text-sm text-gray-400">@{otherParticipant.x_handle}</p>
                </div>
            </header>
            
            <main className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {loading ? <div className="flex justify-center"><Loader2 className="animate-spin" /></div> : (
                    messages.map((msg, index) => {
                        const isSender = msg.sender_id === user.id;
                        const showAvatar = index === messages.length - 1 || messages[index + 1].sender_id !== msg.sender_id;
                        return (
                            <div key={msg.id} className={cn("flex items-end gap-2", isSender ? "justify-end" : "justify-start")}>
                                {!isSender && (
                                    <div className="w-8 flex-shrink-0">
                                        {showAvatar && <img src={msg.sender.avatar_url} alt={msg.sender.x_handle} className="w-8 h-8 rounded-full" />}
                                    </div>
                                )}
                                <div className={cn("p-3 rounded-2xl max-w-sm md:max-w-md", isSender ? "bg-blue-600 text-white rounded-br-none" : "bg-slate-700 text-white rounded-bl-none")}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                    <p className="text-xs opacity-70 mt-1 text-right">{format(new Date(msg.created_at), 'p', { locale: ptBR })}</p>
                                </div>
                            </div>
                        )
                    })
                )}
                <div ref={messagesEndRef} />
            </main>

            <footer className="p-4 border-t border-slate-700/50">
                <form onSubmit={handleSendMessage} className="flex gap-2">
                    <Textarea 
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        placeholder={`Mensagem para @${otherParticipant.x_handle}`}
                        className="resize-none"
                        rows={1}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendMessage(e);
                            }
                        }}
                    />
                    <Button type="submit" size="icon" disabled={sending}>
                        {sending ? <Loader2 className="animate-spin" /> : <Send />}
                    </Button>
                </form>
            </footer>
        </div>
    );
};

export default ChatWindow;