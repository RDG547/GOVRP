import React from 'react';
import { motion } from 'framer-motion';
import { Gavel, Landmark, Globe } from 'lucide-react';

const features = [
  {
    icon: Gavel,
    title: 'Poderes Executivo, Legislativo e Judiciário',
    description: 'Assuma cargos, proponha leis, julgue casos e participe ativamente de todos os níveis de governo.',
    color: 'text-red-400'
  },
  {
    icon: Landmark,
    title: 'Economia Dinâmica',
    description: 'Crie empresas, invista na bolsa, gerencie seu patrimônio e influencie a economia nacional.',
    color: 'text-green-400'
  },
  {
    icon: Globe,
    title: 'Criação e Gestão de Nações',
    description: 'Funde sua própria nação, defina suas leis, cultura e dispute a hegemonia no cenário global.',
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
            className="relative aspect-square"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full blur-3xl opacity-30"></div>
            <img  class="relative w-full h-full object-cover rounded-2xl" alt="Mapa mundi digital com pontos de luz conectados" src="https://images.unsplash.com/photo-1679830238737-5bc41f101bbb" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default FeaturesSection;