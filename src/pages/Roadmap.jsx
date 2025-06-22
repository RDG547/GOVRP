import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { CheckCircle, Clock, Zap, Star, Rocket, Target } from 'lucide-react';

const Roadmap = () => {
  const roadmapItems = [
    {
      phase: 'Fase 1',
      title: 'Lançamento Inicial',
      status: 'completed',
      date: 'Q4 2023',
      items: [
        'Sistema de autenticação e cadastro',
        'Banco Nacional com funcionalidades básicas',
        'DIC - Departamento de Identificação Civil',
        'Interface responsiva e moderna',
        'Sistema de navegação integrado'
      ]
    },
    {
      phase: 'Fase 2',
      title: 'Expansão dos Serviços',
      status: 'completed',
      date: 'Q1 2024',
      items: [
        'Negócios Livres - Marketplace completo',
        'X Social - Rede social integrada',
        'Biblioteca Nacional e Acervo Digital',
        'Sistema de notificações em tempo real',
        'Melhorias de performance e segurança'
      ]
    },
    {
      phase: 'Fase 3',
      title: 'Funcionalidades Avançadas',
      status: 'in-progress',
      date: 'Q2 2024',
      items: [
        'Sistema de votação e eleições',
        'Tribunal de Justiça virtual',
        'Ministérios e órgãos governamentais',
        'Sistema de leis e regulamentações',
        'Chat em tempo real entre usuários'
      ]
    },
    {
      phase: 'Fase 4',
      title: 'Integração e Automação',
      status: 'planned',
      date: 'Q3 2024',
      items: [
        'API pública para desenvolvedores',
        'Integração com Discord e WhatsApp',
        'Sistema de IA para moderação',
        'Relatórios e analytics avançados',
        'Sistema de backup automático'
      ]
    },
    {
      phase: 'Fase 5',
      title: 'Expansão Internacional',
      status: 'planned',
      date: 'Q4 2024',
      items: [
        'Suporte multi-idiomas',
        'Servidores internacionais',
        'Parcerias com comunidades globais',
        'Sistema de federações entre países',
        'Eventos e competições internacionais'
      ]
    },
    {
      phase: 'Fase 6',
      title: 'Inovação Contínua',
      status: 'future',
      date: '2025+',
      items: [
        'Realidade virtual e metaverso',
        'Blockchain e NFTs para documentos',
        'IA avançada para simulações',
        'Mobile app nativo',
        'Gamificação e sistema de conquistas'
      ]
    }
  ];

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-6 h-6 text-green-400" />;
      case 'in-progress':
        return <Zap className="w-6 h-6 text-yellow-400" />;
      case 'planned':
        return <Clock className="w-6 h-6 text-blue-400" />;
      case 'future':
        return <Star className="w-6 h-6 text-purple-400" />;
      default:
        return <Target className="w-6 h-6 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'from-green-500 to-emerald-600';
      case 'in-progress':
        return 'from-yellow-500 to-orange-600';
      case 'planned':
        return 'from-blue-500 to-cyan-600';
      case 'future':
        return 'from-purple-500 to-violet-600';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'completed':
        return 'Concluído';
      case 'in-progress':
        return 'Em Andamento';
      case 'planned':
        return 'Planejado';
      case 'future':
        return 'Futuro';
      default:
        return 'Indefinido';
    }
  };

  return (
    <>
      <Helmet>
        <title>Roadmap - GOV.RP</title>
        <meta name="description" content="Acompanhe o roadmap de desenvolvimento do GOV.RP. Veja o que já foi implementado e o que está por vir na nossa plataforma." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              <span className="gradient-text">Roadmap</span> de Desenvolvimento
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Acompanhe nossa jornada de desenvolvimento e veja o que está por vir no GOV.RP. 
              Transparência e evolução constante são nossos compromissos.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="text-3xl font-bold text-green-400 mb-2">2</div>
              <div className="text-gray-300">Fases Concluídas</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
              className="text-center"
            >
              <div className="text-3xl font-bold text-yellow-400 mb-2">1</div>
              <div className="text-gray-300">Em Andamento</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="text-center"
            >
              <div className="text-3xl font-bold text-blue-400 mb-2">3</div>
              <div className="text-gray-300">Planejadas</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center"
            >
              <div className="text-3xl font-bold text-purple-400 mb-2">25+</div>
              <div className="text-gray-300">Funcionalidades</div>
            </motion.div>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative">
            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-600 via-purple-600 to-pink-600" />

            <div className="space-y-12">
              {roadmapItems.map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="relative"
                >
                  <div className={`absolute left-6 w-4 h-4 bg-gradient-to-r ${getStatusColor(item.status)} rounded-full border-4 border-gray-900`} />

                  <div className="ml-20 glass-effect rounded-2xl p-8 hover:bg-white/10 transition-all duration-300">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center space-x-4">
                        <div className={`inline-flex items-center justify-center w-12 h-12 bg-gradient-to-r ${getStatusColor(item.status)} rounded-full`}>
                          {getStatusIcon(item.status)}
                        </div>
                        <div>
                          <h3 className="text-2xl font-bold text-white">{item.title}</h3>
                          <p className="text-blue-400 font-medium">{item.phase}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gradient-to-r ${getStatusColor(item.status)} text-white`}>
                          {getStatusText(item.status)}
                        </div>
                        <p className="text-gray-400 text-sm mt-1">{item.date}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {item.items.map((feature, featureIndex) => (
                        <div key={featureIndex} className="flex items-center space-x-3">
                          <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${getStatusColor(item.status)}`} />
                          <p className="text-gray-300">{feature}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-white mb-6">
              Nossa <span className="gradient-text">Visão</span> para o Futuro
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              className="glass-effect rounded-2xl p-8 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-full mb-6">
                <Rocket className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Inovação Constante</h3>
              <p className="text-gray-300 leading-relaxed">
                Sempre na vanguarda da tecnologia, implementando as mais recentes inovações 
                para proporcionar a melhor experiência de roleplay político.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-effect rounded-2xl p-8 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-600 to-violet-600 rounded-full mb-6">
                <Target className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Expansão Global</h3>
              <p className="text-gray-300 leading-relaxed">
                Levar o GOV.RP para o mundo todo, conectando comunidades de roleplay político 
                de diferentes países e culturas.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="glass-effect rounded-2xl p-8 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-600 to-emerald-600 rounded-full mb-6">
                <Star className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-white mb-4">Comunidade Forte</h3>
              <p className="text-gray-300 leading-relaxed">
                Construir a maior e mais engajada comunidade de roleplay político do mundo, 
                onde todos podem aprender e se divertir.
              </p>
            </motion.div>
          </div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="glass-effect rounded-3xl p-12 text-center"
          >
            <h2 className="text-3xl font-bold text-white mb-6">
              Sua Opinião <span className="gradient-text">Importa</span>
            </h2>
            <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
              O roadmap do GOV.RP é construído com base no feedback da nossa comunidade. 
              Suas sugestões e ideias ajudam a moldar o futuro da plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/contact"
                className="inline-flex items-center px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
              >
                Enviar Sugestão
              </a>
              <a
                href="/services/social-x"
                className="inline-flex items-center px-8 py-4 border border-white/20 text-white font-medium rounded-lg hover:bg-white/10 transition-all duration-300"
              >
                Participar da Discussão
              </a>
            </div>
          </motion.div>
        </section>
      </div>
    </>
  );
};

export default Roadmap;