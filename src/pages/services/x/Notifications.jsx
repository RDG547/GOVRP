import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Heart, Repeat2, MessageCircle, UserPlus, Mail, Bell, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const NotificationIcon = ({ type }) => {
    switch (type) {
        case 'x_like': return <Heart className="w-6 h-6 text-pink-500" />;
        case 'x_repost': return <Repeat2 className="w-6 h-6 text-green-500" />;
        case 'x_comment': return <MessageCircle className="w-6 h-6 text-blue-500" />;
        case 'x_follow': return <UserPlus className="w-6 h-6 text-purple-500" />;
        case 'x_dm': return <Mail className="w-6 h-6 text-sky-500" />;
        default: return <Bell className="w-6 h-6 text-muted-foreground" />;
    }
};

const XNotifications = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchNotifications = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('notifications')
            .select('*, sender:sender_id(id, x_username, x_handle, x_avatar_url)')
            .eq('user_id', user.id)
            .like('type', 'x_%')
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) console.error(error);
        else setNotifications(data);
        
        setLoading(false);
    }, [user]);

    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);
    
    const handleClearAll = async () => {
        if (!user || notifications.length === 0) return;
        const { error } = await supabase.from('notifications').delete().eq('user_id', user.id).like('type', 'x_%');
        if (error) {
            toast({ title: "Erro", description: "Não foi possível limpar as notificações.", variant: "destructive" });
        } else {
            setNotifications([]);
            toast({ title: "Notificações limpas." });
        }
    };

    return (
        <>
            <Helmet><title>Notificações - X</title></Helmet>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost">Opções</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                    <DropdownMenuItem onClick={handleClearAll} disabled={notifications.length === 0}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Limpar Tudo
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {loading ? (
                <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : notifications.length > 0 ? (
                <div className="flow-root">
                    <ul className="-my-4">
                        {notifications.map((notification, index) => (
                            <motion.li
                                key={notification.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.05 }}
                                className={`py-4 border-b border-border ${!notification.is_read ? 'bg-accent/50' : ''}`}
                            >
                                <Link to={notification.link || '#'} className="flex items-center space-x-4 p-2 rounded-lg hover:bg-accent">
                                    <NotificationIcon type={notification.type} />
                                    <div className="flex-1 min-w-0">
                                        {notification.sender?.x_avatar_url && (
                                            <img src={notification.sender.x_avatar_url} alt="sender avatar" className="w-8 h-8 rounded-full mb-2" />
                                        )}
                                        <p className="text-sm text-foreground">
                                            <span className="font-bold">{notification.sender?.x_username || 'Alguém'}</span> {notification.content}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
                                        </p>
                                    </div>
                                    {!notification.is_read && <div className="inline-flex items-center w-3 h-3 rounded-full bg-primary" />}
                                </Link>
                            </motion.li>
                        ))}
                    </ul>
                </div>
            ) : (
                <div className="text-center py-20 text-muted-foreground">
                    <p className="text-lg font-semibold">Tudo tranquilo por aqui.</p>
                    <p>Suas notificações aparecerão aqui.</p>
                </div>
            )}
        </>
    );
};

export default XNotifications;