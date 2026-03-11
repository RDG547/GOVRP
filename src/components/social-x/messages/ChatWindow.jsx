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
    const prevMessagesCount = useRef(0); // Para rastrear a contagem de mensagens

    const otherParticipant = conversation.participants.find(p => p.profile.id !== user.id)?.profile;

    const fetchMessages = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('x_messages')
            .select('*, sender:sender_id(id, x_username, x_handle, x_avatar_url)')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: true });
        
        if (error) console.error(error);
        else setMessages(data);
        setLoading(false);
    }, [conversation.id]);

    useEffect(() => {
        fetchMessages();
        prevMessagesCount.current = 0; // Reinicia o contador ao mudar a conversa

        const channel = supabase.channel(`x_dm:${conversation.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'x_messages',
                filter: `conversation_id=eq.${conversation.id}`
            }, async (payload) => {
                if (payload.new.sender_id !== user.id) {
                    const { data: senderProfile } = await supabase.from('profiles').select('id, x_username, x_handle, x_avatar_url').eq('id', payload.new.sender_id).single();
                    setMessages(m => [...m, { ...payload.new, sender: senderProfile }]);
                }
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [conversation.id, fetchMessages, user.id]);

    useEffect(() => {
        // Rola para baixo apenas se o número de mensagens aumentou
        if (messages.length > prevMessagesCount.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        // Atualiza a contagem para a próxima renderização
        prevMessagesCount.current = messages.length;
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (newMessage.trim() === '' || sending) return;

        setSending(true);
        const contentToSend = newMessage;
        setNewMessage('');

        const tempMessage = {
            id: 'temp-' + Date.now(),
            conversation_id: conversation.id,
            sender_id: user.id,
            content: contentToSend,
            created_at: new Date().toISOString(),
            sender: {
                id: user.id,
                x_username: user.x_username,
                x_handle: user.x_handle,
                x_avatar_url: user.x_avatar_url,
            }
        };
        setMessages(m => [...m, tempMessage]);

        const { data, error } = await supabase.rpc('send_x_message', {
            p_recipient_id: otherParticipant.id,
            p_content: contentToSend
        });

        if (error) {
            console.error('Erro ao enviar mensagem:', error);
            setMessages(m => m.filter(msg => msg.id !== tempMessage.id));
            setNewMessage(contentToSend);
        }
        
        setSending(false);
    };

    if (!otherParticipant) {
        return <div className="flex-1 flex items-center justify-center text-muted-foreground">Participante não encontrado.</div>;
    }

    return (
        <div className="flex flex-col h-full flex-1">
            <header className="p-4 border-b border-border flex items-center gap-3">
                <Link to={`/services/x/profile/${otherParticipant.x_handle}`}>
                    <img src={otherParticipant.x_avatar_url} alt={otherParticipant.x_handle} className="w-10 h-10 rounded-full"/>
                </Link>
                <div>
                    <p className="font-bold text-foreground">{otherParticipant.x_username}</p>
                    <p className="text-sm text-muted-foreground">@{otherParticipant.x_handle}</p>
                </div>
            </header>
            
            <main className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {loading ? <div className="flex justify-center"><Loader2 className="animate-spin" /></div> : (
                    messages.map((msg, index) => {
                        const isSender = msg.sender.id === user.id;
                        const showAvatar = index === messages.length - 1 || messages[index + 1].sender.id !== msg.sender.id;
                        return (
                            <div key={msg.id} className={cn("flex items-end gap-2", isSender ? "justify-end" : "justify-start")}>
                                {!isSender && (
                                    <div className="w-8 flex-shrink-0">
                                        {showAvatar && <img src={msg.sender.x_avatar_url} alt={msg.sender.x_handle} className="w-8 h-8 rounded-full" />}
                                    </div>
                                )}
                                <div className={cn("p-3 rounded-2xl max-w-sm md:max-w-md", isSender ? "bg-primary text-primary-foreground rounded-br-none" : "bg-secondary text-secondary-foreground rounded-bl-none")}>
                                    <p className="whitespace-pre-wrap">{msg.content}</p>
                                    <p className="text-xs opacity-70 mt-1 text-right">{format(new Date(msg.created_at), 'p', { locale: ptBR })}</p>
                                </div>
                            </div>
                        )
                    })
                )}
                <div ref={messagesEndRef} />
            </main>

            <footer className="p-4 border-t border-border">
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