import React, { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import {
  fetchAdminEconomy,
  fetchBusinessEconomy,
  fetchCentralBankEconomy,
  fetchCitizenEconomy,
  fetchGovernmentEconomy,
  fetchPublicEconomy,
} from '@/lib/economy/api';
import AdminEconomyPanel from '@/features/economy/pages/AdminEconomyPanel';
import BusinessEconomyPanel from '@/features/economy/pages/BusinessEconomyPanel';
import CentralBankEconomyPanel from '@/features/economy/pages/CentralBankEconomyPanel';
import CitizenEconomyPanel from '@/features/economy/pages/CitizenEconomyPanel';
import GovernmentEconomyPanel from '@/features/economy/pages/GovernmentEconomyPanel';
import PublicEconomyPanel from '@/features/economy/pages/PublicEconomyPanel';
import { PanelError, PanelLoading } from '@/features/economy/components/PanelState';

const views = {
  public: {
    label: 'Economia nacional',
    fetcher: fetchPublicEconomy,
    component: PublicEconomyPanel,
  },
  citizen: {
    label: 'Minha economia',
    fetcher: fetchCitizenEconomy,
    component: CitizenEconomyPanel,
  },
  business: {
    label: 'Economia das empresas',
    fetcher: fetchBusinessEconomy,
    component: BusinessEconomyPanel,
  },
  government: {
    label: 'Economia do Governo',
    fetcher: fetchGovernmentEconomy,
    component: GovernmentEconomyPanel,
  },
  centralBank: {
    label: 'Política monetária',
    fetcher: fetchCentralBankEconomy,
    component: CentralBankEconomyPanel,
  },
  admin: {
    label: 'Motor econômico',
    fetcher: fetchAdminEconomy,
    component: AdminEconomyPanel,
  },
};

const EmbeddedEconomyPanel = ({ view = 'public', showHeader = true }) => {
  const { toast } = useToast();
  const config = views[view] || views.public;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError('');

    try {
      setData(await config.fetcher());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [config]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => load({ quiet: true }), 350);
    };
    let channel = supabase.channel(`embedded-economy-${view}`);

    [
      'economic_state',
      'economic_indicators',
      'economic_sector_snapshots',
      'price_basket_items',
      'economic_bulletins',
      'economic_alerts',
      'economic_policy_decisions',
      'government_finances',
      'investment_options',
      'system_settings',
      'country_rp_states',
      'country_rp_economic_snapshots',
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
  }, [load, view]);

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={() => load()} />;

  const Panel = config.component;

  return (
    <div className="space-y-5">
      {showHeader ? (
        <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
          <div>
            <p className="font-semibold">{config.label}</p>
            <p className="text-sm text-muted-foreground">
              Dados oficiais do motor econômico, atualizados a partir das ações do RP.
            </p>
          </div>
        </div>
      ) : null}


      <Panel
        data={data}
        toast={toast}
        onRefresh={() => load({ quiet: true })}
      />
    </div>
  );
};

export default EmbeddedEconomyPanel;
