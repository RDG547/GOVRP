import {useWorldRuntime} from '@/contexts/WorldRuntimeContext';
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import ComingSoon from '@/pages/ComingSoon';
import MaintenanceMode from '@/pages/MaintenanceMode';
import {
  fetchServiceAvailabilitySettings,
  resolveGlobalServiceMode,
} from '@/lib/serviceCatalog';

const BYPASS_PATH_PREFIXES = ['/admin'];
const BYPASS_PATHS = new Set([
  '/login',
  '/register',
  '/auth/callback',
  '/registro-cidadania',
  '/forgot-password',
  '/update-password',
  '/coming-soon',
  '/maintenance',
]);

const shouldBypassGlobalGate = (pathname = '', isAdmin = false) => {
  if (isAdmin || BYPASS_PATHS.has(pathname)) {
    return true;
  }

  return BYPASS_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
};

const GlobalSiteAvailabilityGate = ({ pathname = '/', isAdmin = false, children }) => {
  const runtime = useWorldRuntime();
  const [loading, setLoading] = useState(true);
  const [siteMode, setSiteMode] = useState('active');

  useEffect(() => {
    if (shouldBypassGlobalGate(pathname, isAdmin)) {
      setLoading(false);
      setSiteMode('active');
      return undefined;
    }

    let isMounted = true;

    const fetchAvailability = async () => {
      try {
        const settings = await fetchServiceAvailabilitySettings(supabase);
        if (isMounted) {
          setSiteMode(resolveGlobalServiceMode(settings));
        }
      } catch (error) {
        console.error('Error fetching global site availability settings:', error);
        if (isMounted) {
          setSiteMode('active');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchAvailability();

    return () => {
      isMounted = false;
    };
  }, [isAdmin, pathname]);

  if (runtime?.maintenance && !isAdmin && !['/login','/auth/callback','/forgot-password','/update-password','/support','/terms','/privacy','/donation'].includes(pathname)) return <MaintenanceMode serviceName="GOV.RP" serviceDescription="O universo está sendo preparado para uma nova geração. Seu acesso será liberado automaticamente após a verificação." />;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (siteMode === 'coming_soon') {
    return (
      <ComingSoon
        serviceName="GOV.RP"
        serviceDescription="A plataforma inteira foi temporariamente colocada em preparo para uma nova fase."
      />
    );
  }

  if (siteMode === 'maintenance') {
    return (
      <MaintenanceMode
        serviceName="GOV.RP"
        serviceDescription="O portal inteiro está temporariamente em manutenção para ajustes técnicos."
      />
    );
  }

  return children;
};

export default GlobalSiteAvailabilityGate;
