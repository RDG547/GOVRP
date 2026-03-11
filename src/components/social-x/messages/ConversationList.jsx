import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { motion, useDragControls } from 'framer-motion';

const ConversationListItem = ({ convo, isSelected, onConversationDeleted }) => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [deletingId, setDeletingId] = useState(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const controls = useDragControls();
    const itemRef = useRef(null);
    const dragOccurred = useRef(false);

    const participant = convo.participants.find(p => p.profile.id !== user.id)?.profile;

    const handleDeleteConversation = async () => {
        setDeletingId(convo.id);
        try {
            // First delete participants, then the conversation
            await supabase.from('x_conversation_participants').delete().eq('conversation_id', convo.id);
            const { error } = await supabase.from('x_conversations').delete().eq('id', convo.id);
            if (error) throw error;
            
            toast({ title: "Sucesso", description: "Conversa excluída." });
            onConversationDeleted(convo.id);
            if (isSelected) {
                navigate('/services/x/messages');
            }
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível excluir a conversa.", variant: "destructive" });
        } finally {
            setDeletingId(null);
            setShowDeleteConfirm(false);
        }
    };

    if (!participant) return null;

    return (
        <li className="relative bg-background overflow-hidden">
            <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir Conversa?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Esta ação não pode ser desfeita. Isso excluirá permanentemente a conversa para todos os participantes.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteConversation} className="bg-destructive hover:bg-destructive/90">Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <div
                className="absolute inset-y-0 right-0 flex items-center justify-center bg-destructive w-20 z-0"
            >
                <Button variant="ghost" size="icon" className="text-destructive-foreground hover:bg-destructive/80" onClick={() => setShowDeleteConfirm(true)}>
                    {deletingId === convo.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                </Button>
            </div>

            <motion.div
                ref={itemRef}
                drag="x"
                dragControls={controls}
                dragConstraints={{ left: -80, right: 0 }}
                dragElastic={0.2}
                onDragStart={() => { dragOccurred.current = false; }}
                onDrag={(event, info) => { if (Math.abs(info.offset.x) > 5) dragOccurred.current = true; }}
                onTap={() => { if (!dragOccurred.current) navigate(`/services/x/messages/${convo.id}`); }}
                className={cn(
                    "relative flex items-center gap-3 p-4 border-b border-border bg-background cursor-pointer z-10",
                    isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                )}
            >
                <img src={participant.x_avatar_url} alt={participant.x_handle} className="w-12 h-12 rounded-full"/>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                        <p className="font-bold text-foreground truncate">{participant.x_username}</p>
                        <p className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                            {formatDistanceToNow(new Date(convo.updated_at), { locale: ptBR, addSuffix: true })}
                        </p>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">@{participant.x_handle}</p>
                </div>
            </motion.div>
        </li>
    );
};


const ConversationList = ({ conversations, loading, onConversationDeleted }) => {
    const { conversationId } = useParams();

    if (loading) {
        return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
    }
    
    if (conversations.length === 0) {
        return <div className="flex-1 flex items-center justify-center text-muted-foreground text-center p-4">Nenhuma conversa encontrada.</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            <h2 className="p-4 text-xl font-bold border-b border-border">Mensagens</h2>
            <ul>
                {conversations.map(convo => (
                    <ConversationListItem 
                        key={convo.id}
                        convo={convo}
                        isSelected={convo.id === conversationId}
                        onConversationDeleted={onConversationDeleted}
                    />
                ))}
            </ul>
        </div>
    );
};

export default ConversationList;