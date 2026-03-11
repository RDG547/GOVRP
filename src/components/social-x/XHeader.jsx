import React from 'react';
import { useLocation, useParams, Link, useNavigate } from 'react-router-dom';
import { Home, Bell, Mail, Search, User, ArrowLeft } from 'lucide-react';

const XHeader = () => {
    const location = useLocation();
    const params = useParams();
    const navigate = useNavigate();

    const getHeaderContent = () => {
        const path = location.pathname;
        let showBackButton = false;

        if (path.includes('/services/x/feed')) {
            return { title: 'Feed', icon: <Home />, showBackButton };
        }
        if (path.startsWith('/services/x/notifications')) {
            showBackButton = true;
            return { title: 'Notificações', icon: <Bell />, showBackButton };
        }
        if (path.startsWith('/services/x/messages')) {
            showBackButton = true;
            return { title: 'Mensagens', icon: <Mail />, showBackButton };
        }
        if (path.startsWith('/services/x/search')) {
            showBackButton = true;
            return { title: 'Pesquisar', icon: <Search />, showBackButton };
        }
        if (path.startsWith('/services/x/profile/')) {
            showBackButton = true;
            return { title: params.handle, icon: <User />, showBackButton };
        }
        return { title: 'Feed', icon: <Home />, showBackButton };
    };

    const { title, icon, showBackButton } = getHeaderContent();

    return (
        <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl px-4 py-3 border-b border-border flex items-center gap-4">
            {showBackButton && (
                <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-accent">
                    <ArrowLeft className="w-5 h-5 text-foreground" />
                </button>
            )}
            <div className="flex-shrink-0 text-primary">{icon}</div>
            <h1 className="text-xl font-bold text-foreground truncate">{title}</h1>
        </div>
    );
};

export default XHeader;