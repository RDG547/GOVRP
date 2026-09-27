import ParliamentVotingSettings from '@/components/admin/ParliamentVotingSettings';
import ExecutiveTransitionSettings from '@/components/admin/ExecutiveTransitionSettings';
import ParliamentInstitutionalSettings from '@/components/admin/ParliamentInstitutionalSettings';
import OfficialSalarySettings from '@/components/admin/OfficialSalarySettings';
import CitizenNeedsSettings from '@/components/admin/CitizenNeedsSettings';
import EconomicMixControl from '@/features/economy/components/EconomicMixControl';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  Crown,
  Flag,
  Headphones,
  Newspaper,
  Settings,
  ShieldCheck,
  Users,
  Vote,
  Gavel,
  RotateCcw,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/layout/PageHeader';
import SiteAnalytics from '@/components/admin/SiteAnalytics';
import UserManagement from '@/components/admin/UserManagement';
import SystemSettings from '@/components/admin/SystemSettings';
import ContentModeration from '@/components/admin/ContentModeration';
import ElectionManagement from '@/components/admin/ElectionManagement';
import CandidacyManagement from '@/components/admin/CandidacyManagement';
import PartyManagement from '@/components/admin/PartyManagement';
import EconomySystems from '@/components/admin/EconomySystems';
import JusticeSystem from '@/components/admin/JusticeSystem';
import SupportManagement from '@/components/admin/SupportManagement';
import ResetManagement from '@/components/admin/ResetManagement';

const WorldSettings = () => <div className="space-y-6"><EconomicMixControl /><CitizenNeedsSettings /><ParliamentInstitutionalSettings /><ExecutiveTransitionSettings /><ParliamentVotingSettings /></div>;

const tabs = [
  { id: 'users', label: 'Usuários', icon: Users, component: UserManagement },
  { id: 'settings', label: 'Sistema e Serviços', icon: Settings, component: SystemSettings },
  { id: "world", label: "Simulação e Sociedade", icon: Settings, component: WorldSettings },
  { id: 'reset', label: 'Resets', icon: RotateCcw, component: ResetManagement },
  { id: "salaries", label: "Remuneração", icon: Users, component: OfficialSalarySettings },
  { id: 'analytics', label: 'Análises', icon: BarChart3, component: SiteAnalytics },
  { id: 'economy', label: 'Economia', icon: Activity, component: EconomySystems },
  { id: 'justice', label: 'Justiça', icon: Gavel, component: JusticeSystem },
  { id: 'candidacies', label: 'Candidaturas', icon: ShieldCheck, component: CandidacyManagement },
  { id: 'elections', label: 'Eleições', icon: Vote, component: ElectionManagement },
  { id: 'parties', label: 'Partidos', icon: Flag, component: PartyManagement },
  { id: 'content', label: 'Conteúdo', icon: Newspaper, component: ContentModeration },
  { id: 'support', label: 'Suporte', icon: Headphones, component: SupportManagement },
];

const AdminDashboard = () => {
  const { tab: activeTabParam } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(
    tabs.find((tab) => tab.id === activeTabParam)?.id || 'users'
  );
  const [stats, setStats] = useState({});
  const [growthStats, setGrowthStats] = useState({});
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const navRef = useRef(null);

  useEffect(() => {
    const foundTab = tabs.find((tab) => tab.id === activeTabParam);
    if (foundTab) {
      setActiveTab(foundTab.id);
      const activeButton = navRef.current?.querySelector(
        `button[data-tab-id="${foundTab.id}"]`
      );
      activeButton?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    } else {
      setActiveTab('users');
    }
  }, [activeTabParam]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: statsData, error: statsError } = await supabase.rpc(
        'get_admin_dashboard_stats'
      );
      if (statsError) throw statsError;
      setStats(statsData[0] || {});

      const { data: growthData, error: growthError } = await supabase.rpc(
        'get_dashboard_growth_stats'
      );
      if (growthError) throw growthError;
      setGrowthStats(growthData[0] || {});
    } catch (error) {
      toast({
        title: 'Erro ao buscar estatísticas',
        description: error.message,
        variant: 'destructive',
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
    navigate(`/admin-dashboard/${tabId}`);
  };

  const ActiveComponent = tabs.find((tab) => tab.id === activeTab)?.component;
  const activeTabInfo = tabs.find((tab) => tab.id === activeTab);

  return (
    <>
      <Helmet>
        <title>Painel de Administração - {activeTabInfo?.label}</title>
        <meta name="description" content="Gerencie todos os aspectos do GOV.RP." />
      </Helmet>
      <div className="mx-auto max-w-7xl px-2 py-6 sm:px-6 sm:py-12 lg:px-8">
        <PageHeader
          icon={Crown}
          title="Painel de"
          gradientText="Administração"
          description="Controle operacional, econômico e jurídico do GOV.RP."
          iconColor="text-yellow-400"
          centered
        />

        <div className="mt-8">
          <nav
            ref={navRef}
            aria-label="Seções do Painel de Administração"
            className="-mx-2 mb-6 flex flex-nowrap justify-start gap-2 overflow-x-auto scroll-smooth px-2 pb-2 custom-scrollbar sm:-mx-4 sm:mb-8 sm:px-4 md:mx-0 md:px-0"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-tab-id={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium sm:gap-3 sm:px-4 sm:py-3 sm:text-sm ${
                  activeTab === tab.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                >
                <tab.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <main className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="glass-effect rounded-2xl border p-3 sm:p-6"
              >
                {ActiveComponent ? (
                  <ActiveComponent
                    stats={stats}
                    growthStats={growthStats}
                    loading={loading}
                  />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </>
  );
};

export default AdminDashboard;
