import React, { lazy, Suspense } from 'react';
import { motion } from 'framer-motion';
import { Gavel, DollarSign, Flag } from 'lucide-react';

const InteractiveGlobe = lazy(() => import('@/components/home/InteractiveGlobe'));

const features = [
  {
    icon: Gavel,
    title: 'Poderes Executivo, Legislativo e Judiciário',
    description: 'Assuma cargos, proponha leis, julgue casos e participe ativamente de todos os níveis de governo.',
    color: 'text-red-400'
  },
  {
    icon: DollarSign,
    title: 'Economia Dinâmica',
    description: 'Crie empresas, invista na bolsa, gerencie seu patrimônio e influencie a economia nacional.',
    color: 'text-green-400'
  },
  {
    icon: Flag,
    title: 'Governo e Gestão de Nações',
    description: 'Assuma o governo de uma nação existente, administre suas instituições, conduza políticas públicas e dispute influência no cenário global.',
    color: 'text-blue-400'
  }
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-foreground mb-6">Explore um Universo de <span className="gradient-text">Possibilidades</span></h2>
            <p className="text-xl text-muted-foreground mb-8">
              No GOV.RP, você não é apenas um jogador, você é um cidadão. Crie leis, funde empresas, participe de eleições e molde o futuro da nação. A plataforma oferece todas as ferramentas para uma imersão política sem precedentes.
            </p>
            <div className="space-y-6">
              {features.map((feature, index) => (
                <div key={index} className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-secondary rounded-full flex items-center justify-center">
                    <feature.icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative aspect-[3/5] min-h-[520px] sm:aspect-square sm:min-h-0"
          >
            <div className="absolute inset-8 bg-gradient-to-br from-cyan-500 to-blue-700 rounded-full blur-3xl opacity-25" />
            <Suspense
              fallback={(
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-3xl border border-blue-400/20 bg-[#020611]">
                  <div className="h-2/3 w-2/3 animate-pulse rounded-full border border-cyan-300/50 bg-[radial-gradient(circle_at_35%_28%,#1d4ed8,#06183d_68%,#01040d)] shadow-[0_0_70px_rgba(56,189,248,0.3)]" />
                </div>
              )}
            >
              <InteractiveGlobe />
            </Suspense>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;
