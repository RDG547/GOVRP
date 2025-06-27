import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Landmark, Briefcase, FileText, MessageSquare, Library, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';

const services = [
  { name: 'Banco Nacional', description: 'Sistema bancário completo com transferências, empréstimos e investimentos', icon: Landmark, path: '/services/bank', color: 'text-green-400' },
  { name: 'Negócios Livres', description: 'Marketplace completo para compra, venda e negociação entre cidadãos', icon: Briefcase, path: '/services/business', color: 'text-blue-400' },
  { name: 'DIC', description: 'Departamento de Identificação Civil - Todas as documentações oficiais', icon: FileText, path: '/services/dic', color: 'text-purple-400' },
  { name: 'X', description: 'Rede social completa inspirada no X para interação política', icon: MessageSquare, path: '/services/x', color: 'text-sky-400' },
  { name: 'Biblioteca Nacional', description: 'Acesso a uma vasta coleção de livros e recursos educacionais', icon: Library, path: '/services/library', color: 'text-orange-400' },
  { name: 'Acervo Digital', description: 'Repositório digital com links e recursos diversos', icon: Archive, path: '/services/digital-archive', color: 'text-rose-400' }
];

const ServicesSection = () => {
  return (
    <section id="services-section" className="py-24 bg-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Nossos <span className="gradient-text">Serviços</span></h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">Serviços integrados que formam o ecossistema completo para sua experiência de roleplay político</p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              whileHover={{ y: -8, scale: 1.02 }}
              className="service-card"
            >
              <Link to={service.path} className="block h-full">
                <div className="glass-effect rounded-2xl p-8 h-full hover:bg-white/10 transition-all duration-300 group flex flex-col">
                  <div className={`inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-xl mb-6 group-hover:scale-110 transition-transform`}>
                     <service.icon className={`w-8 h-8 ${service.color}`} />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-blue-400 transition-colors">{service.name}</h3>
                  <p className="text-gray-300 mb-6 leading-relaxed flex-grow">{service.description}</p>
                  <div className="flex items-center text-blue-400 group-hover:text-blue-300 transition-colors mt-auto">
                    <span className="font-medium">Acessar Serviço</span>
                    <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
        <div className="text-center mt-16">
          <Link to="/services">
            <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white">
              Ver Todos os Serviços
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;