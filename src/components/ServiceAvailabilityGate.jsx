import { useServiceAvailability } from '@/hooks/use-service-availability';
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import ComingSoon from '@/pages/ComingSoon';
import MaintenanceMode from '@/pages/MaintenanceMode';
import {
  getServiceByKey,
  resolveServiceMode,
} from '@/lib/serviceCatalog';
import { useAuth } from '@/contexts/AuthContext';
import { ServiceSuspensionContext } from '@/contexts/ServiceSuspensionContext';

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

  return <div className="min-w-0">
    {serviceMode === 'coming_soon' && <ComingSoon serviceName={service?.name || 'Este serviço'} serviceDescription={service?.description} />}
    {serviceMode === 'maintenance' && <MaintenanceMode serviceName={service?.name || 'Este serviço'} serviceDescription={service?.description} />}
    {(wasAvailable || serviceMode === 'active') && <ServiceSuspensionContext.Provider value={serviceMode !== 'active'}><div hidden={serviceMode !== 'active'} inert={serviceMode !== 'active' ? '' : undefined}><fieldset disabled={serviceMode !== 'active'} className="min-w-0">{children}</fieldset></div></ServiceSuspensionContext.Provider>}
  </div>;
};
export default ServiceAvailabilityGate;
