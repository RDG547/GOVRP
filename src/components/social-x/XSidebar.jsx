import React from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { Home, Search, Bell, Mail, User, Edit, LogOut, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const XSidebar = ({ onPostClick }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    const navItems = [
        { name: 'Início', icon: Home, path: '/services/x/feed' },
        { name: 'Pesquisar', icon: Search, path: '/services/x/search' },
        { name: 'Notificações', icon: Bell, path: '/services/x/notifications' },
        { name: 'Mensagens', icon: Mail, path: '/services/x/messages' },
        { name: 'Perfil', icon: User, path: `/services/x/profile/${user?.x_handle}` },
    ];

    const activeLinkClass = "bg-slate-800 text-white";
    const inactiveLinkClass = "text-gray-300 hover:bg-slate-800/50";

    return (
        <>
            {/* Desktop Sidebar */}
            <div className="sticky top-0 h-screen hidden md:flex flex-col justify-between py-4 px-2">
                <div>
                    <Link to="/services/x" className="mb-6 block">
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-8 h-8 mx-auto text-white fill-current">
                            <g><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></g>
                        </svg>
                    </Link>

                    <nav className="flex flex-col items-center xl:items-start gap-2">
                        {navItems.map(item => (
                            <NavLink key={item.name} to={item.path} end={item.path === '/services/x/feed'}
                                className={({ isActive }) => `${isActive ? activeLinkClass : inactiveLinkClass} flex items-center gap-4 py-3 px-4 rounded-full transition-colors`}>
                                <item.icon className="w-7 h-7" />
                                <span className="hidden xl:inline text-xl font-medium">{item.name}</span>
                            </NavLink>
                        ))}
                    </nav>

                    <Button onClick={onPostClick} size="lg" className="mt-6 w-full xl:w-56 hidden xl:flex">Postar</Button>
                    <Button onClick={onPostClick} size="icon" className="mt-6 xl:hidden w-14 h-14 rounded-full mx-auto flex items-center justify-center">
                        <Edit className="w-7 h-7" />
                    </Button>
                </div>
                
                <div className="mt-auto hidden xl:block">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="w-full justify-start h-auto p-3 rounded-full hover:bg-slate-800/50">
                                <div className="flex items-center gap-3">
                                    <img src={user?.x_avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar" className="w-10 h-10 rounded-full bg-slate-600" />
                                    <div className="hidden xl:flex flex-col items-start">
                                        <span className="font-bold text-white">{user?.x_username}</span>
                                        <span className="text-gray-400 text-sm">@{user?.x_handle}</span>
                                    </div>
                                    <MoreHorizontal className="hidden xl:block ml-auto w-5 h-5 text-gray-400"/>
                                </div>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-64 mb-2 glass-effect border-slate-700" side="top">
                            <DropdownMenuItem onSelect={handleLogout} className="text-red-400 focus:bg-red-500/20 focus:text-red-300">
                                <LogOut className="mr-2 h-4 w-4" />
                                <span>Sair de @{user?.x_handle}</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Mobile Bottom Bar */}
            <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-lg border-t border-border z-40 md:hidden">
                <nav className="flex justify-around items-center h-16">
                    {navItems.map(item => (
                        <NavLink key={item.name} to={item.path} end={item.path === '/services/x/feed'}
                            className={({ isActive }) => `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                            <item.icon className="w-6 h-6" />
                        </NavLink>
                    ))}
                </nav>
            </div>
        </>
    );
};

export default XSidebar;