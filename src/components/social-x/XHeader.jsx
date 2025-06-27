import React from 'react';
import { useLocation, useParams, Link } from 'react-router-dom';
import { Home, Bell, Mail, Search, User, ArrowLeft } from 'lucide-react';

const XHeader = () => {
    const location = useLocation();
    const params = useParams();

    const getHeaderContent = () => {
        const path = location.pathname;

        if (path === '/services/x' || path === '/services/x/') {
            return { title: 'Página Inicial', icon: <Home /> };
        }
        if (path.startsWith('/services/x/notifications')) {
            return { title: 'Notificações', icon: <Bell /> };
        }
        if (path.startsWith('/services/x/messages')) {
            return { title: 'Mensagens', icon: <Mail /> };
        }
        if (path.startsWith('/services/x/search')) {
            return { title: 'Pesquisar', icon: <Search /> };
        }
        if (path.startsWith('/services/x/profile/')) {
            return { title: params.handle, icon: <User />, isProfile: true };
        }
        return { title: 'X', icon: <Home /> };
    };

    const { title, icon, isProfile } = getHeaderContent();

    return (
        <div className="sticky top-20 z-30 bg-slate-900/80 backdrop-blur-xl px-4 py-3 border-b border-slate-700/50 flex items-center gap-4">
            {isProfile && (
                <Link to="/services/x" className="p-2 rounded-full hover:bg-white/10 lg:hidden">
                    <ArrowLeft className="w-5 h-5 text-white" />
                </Link>
            )}
            <div className="flex-shrink-0 text-sky-400">{icon}</div>
            <h1 className="text-xl font-bold text-white truncate">{title}</h1>
        </div>
    );
};

export default XHeader;