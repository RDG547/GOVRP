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

const ServiceAvailabilityGate = ({ serviceKey, children }) => {
  const [loading, setLoading] = useState(true);
  const [serviceMode, setServiceMode] = useState('active');

  useEffect(() => {
    let isMounted = true;

    const fetchAvailability = async () => {
      try {
        const settings = await fetchServiceAvailabilitySettings(supabase);
        if (isMounted) {
          setServiceMode(resolveServiceMode(settings, serviceKey));
        }
      } catch (error) {
        console.error('Error fetching service availability settings:', error);
        if (isMounted) {
          setServiceMode('active');
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
  }, [serviceKey]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const service = getServiceByKey(serviceKey);

  if (serviceMode === 'coming_soon') {
    return (
      <ComingSoon
        serviceName={service?.name || 'Este serviço'}
        serviceDescription={service?.description}
      />
    );
  }

  if (serviceMode === 'maintenance') {
    return (
      <MaintenanceMode
        serviceName={service?.name || 'Este serviço'}
        serviceDescription={service?.description}
      />
    );
  }

  return children;
};

export default ServiceAvailabilityGate;
