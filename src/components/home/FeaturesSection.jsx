import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Gavel, LandPlot } from 'lucide-react';

const FeaturesSection = () => {
  return (
    <section className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Explore um Universo de <span className="gradient-text">Possibilidades</span></h2>
            <p className="text-xl text-gray-300 mb-8">No GOV.RP, você não é apenas um jogador, você é um cidadão. Crie leis, funde empresas, participe de eleições e molde o futuro da nação. A plataforma oferece todas as ferramentas para uma imersão política sem precedentes.</p>
            <div className="space-y-4">
                <div className="flex items-center gap-3"><Gavel className="w-6 h-6 text-orange-400" /><p className="text-lg text-gray-200">Poderes Executivo, Legislativo e Judiciário</p></div>
                <div className="flex items-center gap-3"><TrendingUp className="w-6 h-6 text-green-400" /><p className="text-lg text-gray-200">Economia Dinâmica</p></div>
                <div className="flex items-center gap-3"><LandPlot className="w-6 h-6 text-purple-400" /><p className="text-lg text-gray-200">Criação e Gestão de Nações</p></div>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <img  alt="Mapa político estilizado com várias nações e fronteiras" className="rounded-2xl shadow-2xl" src="https://images.unsplash.com/photo-1622985763198-f8aa98d8a3ed" />
          </motion.div>
      </div>
    </section>
  );
};

export default FeaturesSection;