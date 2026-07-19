import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Rocket, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';

const ComingSoon = ({
  serviceName = 'Este recurso',
  serviceDescription = 'Estamos preparando uma nova experiência para esta área.',
}) => {
  const pageTitle = `${serviceName} - Em Breve`;

  return (
    <>
      <Helmet>
        <title>{pageTitle} - GOV.RP</title>
        <meta
          name="description"
          content={`${serviceName} será liberado em breve no GOV.RP.`}
        />
      </Helmet>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={Rocket}
          title={serviceName}
          gradientText="Em Breve"
          description={serviceDescription}
          iconColor="text-cyan-400"
          centered={true}
        />

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-10 max-w-3xl rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-950/80 to-blue-950/70 p-8 shadow-2xl shadow-cyan-500/10"
        >
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-cyan-500/15">
              <Sparkles className="h-12 w-12 text-cyan-300" />
            </div>
            <div className="flex-1 space-y-4">
              <h2 className="text-3xl font-bold text-foreground">
                Estamos preparando esse espaço
              </h2>
              <p className="text-base leading-relaxed text-muted-foreground">
                {serviceName} está na fila de lançamento e receberá novidades em breve.
                Enquanto isso, você pode continuar explorando os demais serviços já disponíveis.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link to="/services">
                  <Button className="w-full sm:w-auto">Voltar aos serviços</Button>
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default ComingSoon;
