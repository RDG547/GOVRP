import { useServiceAvailability } from '@/hooks/use-service-availability';
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import ComingSoon from '@/pages/ComingSoon';
import MaintenanceMode from '@/pages/MaintenanceMode';
import {
  fetchServiceAvailabilitySettings,
  getServiceByKey,
  resolveServiceMode,
} from '@/lib/serviceCatalog';
import { useAuth } from '@/contexts/AuthContext';

const ServiceAvailabilityGate = ({ serviceKey, children }) => {
  const { user } = useAuth();
  const { settings, loading } = useServiceAvailability();
  const [wasAvailable, setWasAvailable] = useState(false);
  const isAdmin = user?.role === 'Admin' || user?.effective_roles?.includes('Admin');
  const serviceMode = isAdmin ? 'active' : resolveServiceMode(settings, serviceKey);
  useEffect(() => { if (!loading && serviceMode === 'active') setWasAvailable(true); }, [loading, serviceMode]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const service = getServiceByKey(serviceKey);

  if (!wasAvailable && serviceMode === 'coming_soon') {
    return (
      <ComingSoon
        serviceName={service?.name || 'Este serviço'}
        serviceDescription={service?.description}
      />
    );
  }

  if (!wasAvailable && serviceMode === 'maintenance') {
    return (
      <MaintenanceMode
        serviceName={service?.name || 'Este serviço'}
        serviceDescription={service?.description}
      />
    );
  }

  return <div className="min-w-0">
    {serviceMode !== 'active' && <div role="status" className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">Este serviço ficou temporariamente indisponível. Seu conteúdo foi preservado; novas ações estarão disponíveis quando o serviço voltar.</div>}
    <fieldset disabled={serviceMode !== 'active'} className="min-w-0">{children}</fieldset>
  </div>;
};

export default ServiceAvailabilityGate;
