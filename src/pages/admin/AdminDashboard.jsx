import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart3, Users, Settings, Newspaper, Vote, ShieldCheck, Crown } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/layout/PageHeader';
import SiteAnalytics from '@/components/admin/SiteAnalytics';
import UserManagement from '@/components/admin/UserManagement';
import SystemSettings from '@/components/admin/SystemSettings';
import ContentModeration from '@/components/admin/ContentModeration';
import ElectionManagement from '@/components/admin/ElectionManagement';
import CandidacyManagement from '@/components/admin/CandidacyManagement';

const tabs = [
    { id: 'analytics', label: 'Análises', icon: BarChart3, component: SiteAnalytics },
    { id: 'users', label: 'Usuários', icon: Users, component: UserManagement },
    { id: 'candidacies', label: 'Candidaturas', icon: ShieldCheck, component: CandidacyManagement },
    { id: 'elections', label: 'Eleições', icon: Vote, component: ElectionManagement },
    { id: 'content', label: 'Conteúdo', icon: Newspaper, component: ContentModeration },
    { id: 'settings', label: 'Sistema', icon: Settings, component: SystemSettings },
];

const AdminDashboard = () => {
    const { tab: activeTabParam } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState(tabs.find(t => t.id === activeTabParam)?.id || 'analytics');
    const [stats, setStats] = useState({});
    const [growthStats, setGrowthStats] = useState({});
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const navRef = useRef(null);

    useEffect(() => {
        const foundTab = tabs.find(t => t.id === activeTabParam);
        if (foundTab) {
            setActiveTab(foundTab.id);
            // Scroll the active tab into view on mobile
            const activeButton = navRef.current?.querySelector(`button[data-tab-id="${foundTab.id}"]`);
            if (activeButton) {
                activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        } else {
            setActiveTab('analytics');
        }
    }, [activeTabParam]);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: statsData, error: statsError } = await supabase.rpc('get_admin_dashboard_stats');
            if (statsError) throw statsError;
            setStats(statsData[0] || {});

            const { data: growthData, error: growthError } = await supabase.rpc('get_dashboard_growth_stats');
            if (growthError) throw growthError;
            setGrowthStats(growthData[0] || {});
        } catch (error) {
            toast({
                title: "Erro ao buscar estatísticas",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    }, [toast]);
    
    useEffect(() => {
        if (activeTab === 'analytics' || activeTab === 'elections') {
            fetchData();
        } else {
            setLoading(false);
        }
    }, [activeTab, fetchData]);
    
    const handleTabChange = (tabId) => {
        navigate(`/admin-dashboard/${tabId}`, { replace: false });
    };

    const ActiveComponent = tabs.find(t => t.id === activeTab)?.component;
    const activeTabInfo = tabs.find(t => t.id === activeTab);

    return (
        <>
            <Helmet>
                <title>Painel de Administração - {activeTabInfo?.label}</title>
                <meta name="description" content="Gerencie todos os aspectos do GOV.RP." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Crown}
                    title="Painel de"
                    gradientText="Administração"
                    description="Controle total sobre a plataforma GOV.RP."
                    iconColor="text-yellow-400"
                    centered={true}
                />

                <div className="mt-8">
                     <nav ref={navRef} className="flex flex-row gap-2 overflow-x-auto custom-scrollbar pb-2 md:pb-0 -mx-4 px-4 md:mx-0 md:px-0 justify-center mb-8">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                data-tab-id={tab.id}
                                onClick={() => handleTabChange(tab.id)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium whitespace-nowrap ${activeTab === tab.id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                    }`}
                            >
                                <tab.icon className="w-5 h-5" />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>

                    <main className="flex-1 min-w-0">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                transition={{ duration: 0.3 }}
                                className="glass-effect p-6 rounded-2xl border"
                            >
                                {ActiveComponent && <ActiveComponent stats={stats} growthStats={growthStats} loading={loading} />}
                            </motion.div>
                        </AnimatePresence>
                    </main>
                </div>
            </div>
        </>
    );
};

export default AdminDashboard;