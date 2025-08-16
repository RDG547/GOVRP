import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Landmark, Briefcase, FileText, MessageSquare, Library, Archive, Users, Scale, Gavel, Shield, Vote, Eye, ShieldCheck, Siren } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

const services = [
  { name: 'Banco Nacional', path: '/services/bank', icon: Landmark, color: 'text-green-400', description: 'Gerencie suas finanças, realize transferências e solicite cartões.' },
  { name: 'Negócios Livres', path: '/services/business', icon: Briefcase, color: 'text-blue-400', description: 'Compre e venda produtos e serviços no marketplace da comunidade.' },
  { name: 'DIC', path: '/services/dic', icon: FileText, color: 'text-purple-400', description: 'Emita e gerencie seus documentos de identificação civil.' },
  { name: 'X', path: '/services/x', icon: MessageSquare, color: 'text-sky-400', description: 'Conecte-se, compartilhe ideias e debata na rede social oficial.' },
  { name: 'Biblioteca Nacional', path: '/services/library', icon: Library, color: 'text-orange-400', description: 'Acesse um vasto acervo de livros, artigos e documentos históricos.' },
  { name: 'Acervo Digital', path: '/services/digital-archive', icon: Archive, color: 'text-rose-400', description: 'Explore o arquivo digital de eventos e documentos importantes.' },
  { name: 'Partidos Políticos', path: '/services/political-parties', icon: Users, color: 'text-red-400', description: 'Crie ou filie-se a um partido para participar da vida política.' },
  { name: 'Parlamento', path: '/services/parliament', icon: Scale, color: 'text-yellow-400', description: 'Proponha, debata e vote em projetos de lei que moldam a nação.' },
  { name: 'Sistema Penal', path: '/services/penal-system', icon: Gavel, color: 'text-amber-400', description: 'Consulte registros criminais e o status do sistema prisional.' },
  { name: 'Polícia', path: '/services/police', icon: Siren, color: 'text-blue-500', description: 'Acesse os serviços do departamento de polícia e registre ocorrências.' },
  { name: 'Portal Eleitoral Nacional', path: '/services/elections', icon: Vote, color: 'text-teal-400', description: 'Exerça seu direito de voto e acompanhe os resultados eleitorais.' },
  { name: 'Agência de Inteligência e Espionagem Suprema', path: '/services/agies', icon: Eye, color: 'text-red-500', description: 'A vigilância é a nossa virtude. (Acesso restrito)' },
  { name: 'Forças Armadas', path: '/services/armed-forces', icon: ShieldCheck, color: 'text-emerald-500', description: 'Painel de controle e informações das Forças Armadas.' },
];

const Services = () => {
  return (
    <>
      <Helmet>
        <title>Serviços - GOV.RP</title>
        <meta name="description" content="Explore todos os serviços disponíveis na plataforma GOV.RP, desde o banco até o parlamento." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={Landmark}
          title="Nossos"
          gradientText="Serviços"
          description="Tudo o que você precisa para construir sua história e interagir com o universo do GOV.RP está aqui. Explore as ferramentas que movem nossa nação digital."
          iconColor="text-green-400"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={service.path}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Link to={service.path} className="block h-full">
                <div className="service-card glass-effect rounded-2xl p-8 h-full flex flex-col justify-between hover:border-primary/50 transition-all duration-300">
                  <div>
                    <div className="flex items-center mb-4">
                      <service.icon className={`w-8 h-8 mr-4 ${service.color}`} />
                      <h3 className="text-2xl font-bold text-foreground">{service.name}</h3>
                    </div>
                    <p className="text-muted-foreground">{service.description}</p>
                  </div>
                  <div className="mt-6 text-primary font-semibold">Acessar Serviço &rarr;</div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
};

export default Services;