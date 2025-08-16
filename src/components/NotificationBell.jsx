import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bell, MailCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from './ui/use-toast';

const NotificationBell = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('notifications')
      .select('*, sender:sender_id(id, x_username, x_handle, x_avatar_url)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error fetching notifications:", error);
    } else {
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.is_read).length);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotifications]);

  const handleOpenChange = async (open) => {
    setIsOpen(open);
    if (!open && unreadCount > 0) {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
      if (unreadIds.length > 0) {
        await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
        setNotifications(prev => prev.map(n => unreadIds.includes(n.id) ? { ...n, is_read: true } : n));
        setUnreadCount(0);
      }
    }
  };

  const handleClearAll = async () => {
    if (!user) return;
    const { error } = await supabase.from('notifications').delete().eq('user_id', user.id);
    if (error) {
      toast({ title: "Erro", description: "Não foi possível limpar as notificações.", variant: "destructive" });
    } else {
      setNotifications([]);
      setUnreadCount(0);
      toast({ title: "Notificações limpas." });
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className="relative text-foreground hover:text-primary transition-colors">
          <Bell className="w-6 h-6" />
          {unreadCount > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-2 w-5 h-5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full flex items-center justify-center"
            >
              {unreadCount}
            </motion.div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 md:w-96 bg-popover/80 backdrop-blur-lg border-border shadow-2xl p-0">
        <div className="p-4 flex justify-between items-center border-b border-border">
          <h3 className="font-semibold text-popover-foreground">Notificações</h3>
          {notifications.length > 0 && (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleClearAll}>
              <Trash2 className="w-3 h-3 mr-1" />
              Limpar tudo
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto custom-scrollbar">
          {notifications.length > 0 ? (
            notifications.map(notif => (
              <Link key={notif.id} to={notif.link || '#'} className="block hover:bg-accent transition-colors">
                <div className="p-4 border-b border-border last:border-b-0 flex items-start gap-3">
                  {notif.sender?.x_avatar_url && (
                    <img src={notif.sender.x_avatar_url} alt="sender avatar" className="w-8 h-8 rounded-full" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm text-popover-foreground">{notif.content}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  {!notif.is_read && <div className="w-2 h-2 rounded-full bg-primary mt-1 flex-shrink-0" />}
                </div>
              </Link>
            ))
          ) : (
            <div className="text-center p-8">
              <MailCheck className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-popover-foreground">Tudo em dia!</p>
              <p className="text-sm text-muted-foreground">Você não tem novas notificações.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;