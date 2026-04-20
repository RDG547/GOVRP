import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Grid, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/layout/PageHeader';
import { supabase } from '@/lib/supabaseClient';
import {
  fetchServiceAvailabilitySettings,
  SERVICE_MODE_META,
  resolveServiceMode,
  SERVICE_CATEGORIES,
} from '@/lib/serviceCatalog';

const ServiceCard = ({ service, mode }) => {
  const baseModeMeta = SERVICE_MODE_META[mode] || SERVICE_MODE_META.active;
  const modeMeta = {
    ...baseModeMeta,
    badge: mode === 'active' ? null : baseModeMeta.label,
    badgeClassName:
      mode === 'coming_soon'
        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
        : mode === 'maintenance'
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          : '',
    cta:
      mode === 'coming_soon'
        ? 'Ver lançamento'
        : mode === 'maintenance'
          ? 'Ver atualização'
          : 'Acessar Serviço',
  };
  const ModeIcon = modeMeta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full"
    >
      <Link to={service.path} className="block h-full">
        <div className="service-card glass-effect rounded-2xl p-8 h-full flex flex-col justify-between hover:border-primary/50 transition-all duration-300">
          <div>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center">
                <service.icon className={`w-8 h-8 mr-4 ${service.color}`} />
                <h3 className="text-2xl font-bold text-foreground">{service.name}</h3>
              </div>
              {modeMeta.badge ? (
                <Badge className={`${modeMeta.badgeClassName} border whitespace-nowrap`}>
                  <ModeIcon className="mr-1 h-3.5 w-3.5" />
                  {modeMeta.badge}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground">{service.description}</p>
          </div>
          <div className="mt-6 text-primary font-semibold">{modeMeta.cta} &rarr;</div>
        </div>
      </Link>
    </motion.div>
  );
};

const Services = () => {
  const [availabilitySettings, setAvailabilitySettings] = useState({});
  const [loadingAvailability, setLoadingAvailability] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const fetchAvailability = async () => {
      try {
        const settings = await fetchServiceAvailabilitySettings(supabase);
        if (isMounted) {
          setAvailabilitySettings(settings);
        }
      } catch (error) {
        console.error('Error fetching service availability for catalog:', error);
      } finally {
        if (isMounted) {
          setLoadingAvailability(false);
        }
      }
    };

    fetchAvailability();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <>
      <Helmet>
        <title>Serviços - GOV.RP</title>
        <meta
          name="description"
          content="Explore todos os serviços disponíveis na plataforma GOV.RP, desde o banco até o parlamento."
        />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={Grid}
          title="Nossos"
          gradientText="Serviços"
          description="Tudo o que você precisa para construir sua história e interagir com o universo do GOV.RP está aqui. Explore as ferramentas que movem nossa nação digital."
          iconColor="text-primary"
          centered={true}
        />

        {loadingAvailability ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : null}

        <div className="space-y-12">
          {SERVICE_CATEGORIES.map((category) => (
            <section key={category.name}>
              <h2 className="text-3xl font-bold text-foreground mb-6">{category.name}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                {category.services.map((service) => (
                  <ServiceCard
                    key={service.key}
                    service={service}
                    mode={resolveServiceMode(availabilitySettings, service.key)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
};

export default Services;
