import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const ConversationList = ({ conversations, loading }) => {
    const { user } = useAuth();
    const { conversationId } = useParams();

    if (loading) {
        return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-blue-400" /></div>;
    }
    
    if (conversations.length === 0) {
        return <div className="flex-1 flex items-center justify-center text-gray-400 text-center p-4">Nenhuma conversa encontrada.</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            <h2 className="p-4 text-xl font-bold border-b border-slate-700/50">Mensagens</h2>
            <ul>
                {conversations.map(convo => {
                    const participant = convo.participants.find(p => p.profile.id !== user.id)?.profile;
                    if (!participant) return null;
                    
                    return (
                        <li key={convo.id}>
                            <Link to={`/services/x/messages/${convo.id}`} className={cn(
                                "flex items-center gap-3 p-4 border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors",
                                convo.id === conversationId ? "bg-slate-700/50" : ""
                            )}>
                                <img src={participant.avatar_url} alt={participant.x_handle} className="w-12 h-12 rounded-full"/>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center">
                                        <p className="font-bold text-white truncate">{participant.x_username}</p>
                                        <p className="text-xs text-gray-400 flex-shrink-0 ml-2">
                                            {formatDistanceToNow(new Date(convo.last_message_at), { locale: ptBR })}
                                        </p>
                                    </div>
                                    <p className="text-sm text-gray-400 truncate">@{participant.x_handle}</p>
                                </div>
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </div>
    );
};

export default ConversationList;