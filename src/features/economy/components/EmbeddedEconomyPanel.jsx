import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    const channel = supabase
      .channel(`embedded-economy-${view}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'economic_state',
      }, () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => load({ quiet: true }), 500);
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'economic_indicators',
      }, () => {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => load({ quiet: true }), 500);
      })
      .subscribe();

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
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">{config.label}</p>
            <p className="text-sm text-muted-foreground">
              Dados oficiais do motor econômico, atualizados a partir das ações do RP.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
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
