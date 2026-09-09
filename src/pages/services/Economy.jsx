import LiveLegalRules from '@/components/parliament/LiveLegalRules';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useSearchParams } from 'react-router-dom';
import {
  Scale,
  Building2,
  Landmark,
  LineChart,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  fetchAdminEconomy,
  fetchBusinessEconomy,
  fetchCentralBankEconomy,
  fetchCitizenEconomy,
  fetchGovernmentEconomy,
  fetchPublicEconomy,
} from '@/lib/economy/api';
import PublicEconomyPanel from '@/features/economy/pages/PublicEconomyPanel';
import CitizenEconomyPanel from '@/features/economy/pages/CitizenEconomyPanel';
import BusinessEconomyPanel from '@/features/economy/pages/BusinessEconomyPanel';
import GovernmentEconomyPanel from '@/features/economy/pages/GovernmentEconomyPanel';
import CentralBankEconomyPanel from '@/features/economy/pages/CentralBankEconomyPanel';
import AdminEconomyPanel from '@/features/economy/pages/AdminEconomyPanel';
import { PanelError, PanelLoading } from '@/features/economy/components/PanelState';

const roleNames = (user) => new Set([
  user?.role,
  user?.stored_role,
  ...(Array.isArray(user?.titles) ? user.titles : []),
  ...(Array.isArray(user?.effective_roles) ? user.effective_roles : []),
].filter(Boolean));

const panelConfig = {
  legal: { label: 'Regras Legais', icon: Scale },
  public: { label: 'Economia nacional', icon: LineChart, fetcher: fetchPublicEconomy },
  citizen: { label: 'Minha economia', icon: User, fetcher: fetchCitizenEconomy },
  business: { label: 'Minhas empresas', icon: Building2, fetcher: fetchBusinessEconomy },
  government: { label: 'Governo', icon: Landmark, fetcher: fetchGovernmentEconomy },
  centralBank: { label: 'Banco Central', icon: ShieldCheck, fetcher: fetchCentralBankEconomy },
  admin: { label: 'Motor e auditoria', icon: SlidersHorizontal, fetcher: fetchAdminEconomy },
};

const Economy = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [panelData, setPanelData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const roles = useMemo(() => roleNames(user), [user]);

  const availablePanels = useMemo(() => {
    const panels = ['public', 'citizen', 'business', 'legal'];
    if (['Admin', 'Presidente', 'Vice-Presidente', 'Ministro', 'Ministro da Fazenda', 'Ministro da Economia']
      .some((role) => roles.has(role))) panels.push('government');
    if (['Admin', 'Presidente', 'Presidente do Banco Central', 'Presidente do Banco Nacional', 'Banco Central']
      .some((role) => roles.has(role))) panels.push('centralBank');
    if (roles.has('Admin')) panels.push('admin');
    return panels;
  }, [roles]);

  const requestedPanel = searchParams.get('view');
  const activePanel = availablePanels.includes(requestedPanel) ? requestedPanel : 'public';

  const loadPanel = useCallback(async (panel, quiet = false) => {
    const config = panelConfig[panel];
    if (!config?.fetcher) return;
    if (!quiet) setLoading((current) => ({ ...current, [panel]: true }));
    setErrors((current) => ({ ...current, [panel]: null }));
    try {
      const data = await config.fetcher();
      setPanelData((current) => ({ ...current, [panel]: data }));
    } catch (error) {
      setErrors((current) => ({ ...current, [panel]: error.message }));
    } finally {
      setLoading((current) => ({ ...current, [panel]: false }));
    }
  }, []);

  useEffect(() => {
    loadPanel(activePanel);
  }, [activePanel, loadPanel]);

  useEffect(() => {
    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => loadPanel(activePanel, true), 350);
    };
    let channel = supabase.channel('economy-dashboard-live');

    [
      'economic_state',
      'economic_indicators',
      'economic_sector_snapshots',
      'price_basket_items',
      'economic_bulletins',
      'economic_alerts',
      'country_rp_states',
    ].forEach((table) => {
      channel = channel.on('postgres_changes', {
        event: '*', schema: 'public', table,
      }, () => {
        window.clearTimeout(refreshTimer);
        scheduleRefresh();
      });
    });

    channel.subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [activePanel, loadPanel]);

  const changePanel = (panel) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', panel);
    setSearchParams(next, { replace: true });
  };

  const renderPanel = () => {
    if (activePanel === 'legal') return <LiveLegalRules />;
    if (loading[activePanel] && !panelData[activePanel]) return <PanelLoading />;
    if (errors[activePanel]) {
      return <PanelError message={errors[activePanel]} onRetry={() => loadPanel(activePanel)} />;
    }

    const sharedProps = {
      data: panelData[activePanel],
      toast,
      onRefresh: () => loadPanel(activePanel, true),
    };
    if (activePanel === 'public') return <PublicEconomyPanel {...sharedProps} />;
    if (activePanel === 'citizen') return <CitizenEconomyPanel {...sharedProps} />;
    if (activePanel === 'business') return <BusinessEconomyPanel {...sharedProps} />;
    if (activePanel === 'government') return <GovernmentEconomyPanel {...sharedProps} />;
    if (activePanel === 'centralBank') return <CentralBankEconomyPanel {...sharedProps} />;
    return <AdminEconomyPanel {...sharedProps} />;
  };

  return (
    <>
      <Helmet>
        <title>Economia Nacional - GOV.RP</title>
        <meta
          name="description"
          content="PIB, inflação, emprego, política fiscal e monetária derivados das ações do GOVRP."
        />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={LineChart}
          title="Economia"
          gradientText="Nacional"
          description="Cada compra, emprego, empresa e decisão pública deixa uma origem auditável — e os fechamentos transformam essas ações em consequências."
          iconColor="text-cyan-300"
          centered
        />

        <div className="mb-8 flex flex-wrap gap-2 rounded-2xl border border-border/70 bg-muted/25 p-3">
          <div className="flex flex-wrap gap-2">
            {availablePanels.map((panel) => {
              const config = panelConfig[panel];
              const Icon = config.icon;
              return (
                <Button
                  key={panel}
                  variant={activePanel === panel ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => changePanel(panel)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {config.label}
                </Button>
              );
            })}
          </div>
        </div>

        {renderPanel()}
      </div>
    </>
  );
};

export default Economy;
