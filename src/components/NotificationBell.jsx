import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, MailCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link } from 'react-router-dom';
import { Button } from './ui/button';

const NotificationBell = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchNotifications = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error("Error fetching notifications:", error);
      } else {
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
    };

    fetchNotifications();

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          setNotifications(prev => [payload.new, ...prev].slice(0, 10));
          setUnreadCount(prev => prev + 1);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleOpenChange = async (open) => {
    setIsOpen(open);
    if (!open && unreadCount > 0) {
      setUnreadCount(0);
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
      if (unreadIds.length > 0) {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('id', unreadIds);
      }
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button className="relative text-white hover:text-blue-300 transition-colors">
          <Bell className="w-6 h-6" />
          {unreadCount > 0 && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-2 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
            >
              {unreadCount}
            </motion.div>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-slate-800/90 backdrop-blur-lg border-white/10 text-white p-0">
        <div className="p-4 border-b border-white/10">
          <h3 className="font-semibold">Notificações</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length > 0 ? (
            notifications.map(notif => (
              <div key={notif.id} className={`p-4 border-b border-white/10 ${!notif.is_read ? 'bg-blue-500/10' : ''}`}>
                <Link to={notif.link || '#'} className="block hover:bg-white/5 -m-4 p-4">
                  <p className="text-sm">{notif.content}</p>
                  <p className="text-xs text-gray-400 mt-1">{new Date(notif.created_at).toLocaleString('pt-BR')}</p>
                </Link>
              </div>
            ))
          ) : (
            <div className="text-center p-8">
              <MailCheck className="w-12 h-12 mx-auto text-gray-500 mb-4" />
              <p className="text-gray-400">Tudo em dia!</p>
              <p className="text-sm text-gray-500">Você não tem novas notificações.</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;