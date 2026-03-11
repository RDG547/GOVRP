import React, { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Home, Bell, Mail, Search, User, Feather, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { motion } from 'framer-motion';

const XSidebar = ({ onPostClick }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { toast } = useToast();
    const [unreadCount, setUnreadCount] = useState(0);

    const fetchUnreadCount = useCallback(async () => {
        if (!user) return;
        const { count, error } = await supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('is_read', false)
            .like('type', 'x_%');
        
        if (error) {
            console.error("Error fetching unread count:", error);
        } else {
            setUnreadCount(count || 0);
        }
    }, [user]);

    useEffect(() => {
        fetchUnreadCount();
        
        if (!user) return;
        const channel = supabase
            .channel(`x_notifications_count:${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
                () => {
                    fetchUnreadCount();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, fetchUnreadCount]);

    const handleLogout = async () => {
        await logout();
        toast({ title: 'Você saiu da sua conta.' });
        navigate('/');
    };

    const navItems = [
        { path: '/services/x/feed', icon: Home, label: 'Início' },
        { path: '/services/x/search', icon: Search, label: 'Pesquisar' },
        { path: '/services/x/notifications', icon: Bell, label: 'Notificações', count: unreadCount },
        { path: '/services/x/messages', icon: Mail, label: 'Mensagens' },
        { path: `/services/x/profile/${user?.x_handle}`, icon: User, label: 'Perfil' },
    ];

    return (
        <>
            {/* Desktop Sidebar */}
            <div className="hidden h-full flex-col items-center p-2 md:flex xl:p-4">
                <NavLink to="/services/x/feed" className="rounded-full p-3 transition-colors duration-200 hover:bg-accent">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8 fill-current">
                        <g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g>
                    </svg>
                </NavLink>
                <nav className="mt-4 flex-grow">
                    <ul className="space-y-2">
                        {navItems.map(item => (
                            <li key={item.path}>
                                <NavLink
                                    to={item.path}
                                    end={item.path === '/services/x/feed'}
                                    className={({ isActive }) =>
                                        `flex items-center gap-4 rounded-full p-3 transition-colors duration-200 hover:bg-accent ${
                                            isActive ? 'bg-accent font-bold' : 'text-muted-foreground'
                                        }`
                                    }
                                >
                                    <div className="relative">
                                        <item.icon className="h-7 w-7" />
                                        {item.count > 0 && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                className="absolute -top-1 -right-2 w-5 h-5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center"
                                            >
                                                {item.count}
                                            </motion.div>
                                        )}
                                    </div>
                                    <span className="hidden text-xl xl:inline">{item.label}</span>
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </nav>
                <Button onClick={onPostClick} size="lg" className="mt-4 hidden w-full items-center justify-center gap-2 xl:flex">
                    <Feather className="h-5 w-5" /> Postar
                </Button>
                <Button onClick={onPostClick} size="icon" className="mt-4 flex h-14 w-14 items-center justify-center rounded-full xl:hidden">
                    <Feather className="h-6 w-6" />
                </Button>
                <div className="mt-auto w-full">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="flex w-full items-center gap-3 rounded-full p-3 text-left transition-colors duration-200 hover:bg-accent">
                                <img src={user?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="User avatar" className="h-10 w-10 rounded-full bg-secondary object-cover" />
                                <div className="hidden flex-1 xl:block">
                                    <p className="truncate font-bold">{user?.x_username}</p>
                                    <p className="truncate text-sm text-muted-foreground">@{user?.x_handle}</p>
                                </div>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="mb-2 w-64" side="top">
                            <DropdownMenuLabel>
                                <p className="truncate font-semibold">{user?.x_username}</p>
                                <p className="truncate text-sm text-muted-foreground">@{user?.x_handle}</p>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                                <NavLink to={`/services/x/profile/${user?.x_handle}`} className="cursor-pointer">
                                    <User className="mr-2 h-4 w-4" />Ver Perfil
                                </NavLink>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-400 focus:bg-red-500/10 focus:text-red-400">
                                <LogOut className="mr-2 h-4 w-4" />Sair
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Mobile Bottom Bar */}
            <nav className="flex items-center justify-around h-16 md:hidden">
                {navItems.map(item => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === '/services/x/feed'}
                        className={({ isActive }) =>
                            `relative flex flex-col items-center justify-center rounded-lg p-2 transition-colors duration-200 ${isActive ? 'text-primary' : 'text-muted-foreground'}`
                        }
                    >
                        <item.icon className="h-6 w-6" />
                        {item.count > 0 && (
                            <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute top-1 right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center"
                            >
                                {item.count}
                            </motion.div>
                        )}
                         <span className="sr-only">{item.label}</span>
                    </NavLink>
                ))}
            </nav>
        </>
    );
};

export default XSidebar;