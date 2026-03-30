import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ShieldAlert, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';

const MaintenanceMode = ({
  serviceName = 'Este serviço',
  serviceDescription = 'Esta área está passando por ajustes técnicos temporários.',
}) => {
  const pageTitle = `${serviceName} - Em Manutenção`;

  return (
    <>
      <Helmet>
        <title>{pageTitle} - GOV.RP</title>
        <meta
          name="description"
          content={`${serviceName} está temporariamente em manutenção no GOV.RP.`}
        />
      </Helmet>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={ShieldAlert}
          title={serviceName}
          gradientText="Em Manutenção"
          description={serviceDescription}
          iconColor="text-amber-400"
          centered={true}
        />

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-10 max-w-3xl rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-slate-950/80 to-orange-950/60 p-8 shadow-2xl shadow-amber-500/10"
        >
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-amber-500/15">
              <Wrench className="h-12 w-12 text-amber-300" />
            </div>
            <div className="flex-1 space-y-4">
              <h2 className="text-3xl font-bold text-foreground">
                Estamos fazendo ajustes nesta área
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {serviceName} foi colocado temporariamente em manutenção para receber correções,
                melhorias ou uma nova versão do fluxo atual.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/services">
                  <Button className="w-full sm:w-auto">Voltar aos serviços</Button>
                </Link>
                <Link to="/support">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Falar com o suporte
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default MaintenanceMode;
