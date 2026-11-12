import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useQueuedRefresh } from '@/hooks/use-queued-refresh';
import { economyRealtimeTablesFor } from '@/lib/economy/realtime-tables';
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

  const { user } = useAuth();
  const requestSequence = useRef(0);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const request = ++requestSequence.current;
    if (!quiet) setLoading(true);

    try {
      const result = await config.fetcher();
      // Ignore responses from an old view or an outdated in-flight request.
      if (request !== requestSequence.current) return;
      setData(result);
      setError('');
    } catch (loadError) {
      if (request !== requestSequence.current) return;
      if (!quiet) setError(loadError.message || 'Falha ao consultar economia.');
      else console.warn('economy-live-refresh', loadError?.message);
    } finally {
      if (!quiet && request === requestSequence.current) setLoading(false);
    }
  }, [config.fetcher]);

  // Prevent overlapping requests during bursts of economic events, while
  // guaranteeing a final read if an update arrives during an ongoing fetch.
  const refresh = useQueuedRefresh(load, [{ quiet: true }]);

  useEffect(() => {
    setData(null);
    setError('');
    void refresh({ quiet: false });
    return () => { requestSequence.current += 1; };
  }, [view, refresh]);

  useDomainRealtime(
    'embedded-economy-' + view,
    user?.id || 'public',
    economyRealtimeTablesFor(view, user?.id),
    () => refresh({ quiet: true }),
  );

  if (loading && !data) return <PanelLoading />;
  if (error) return <PanelError message={error} onRetry={() => refresh({ quiet: false })} />;

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
        onRefresh={() => refresh({ quiet: true })}
      />
    </div>
  );
};

export default EmbeddedEconomyPanel;
