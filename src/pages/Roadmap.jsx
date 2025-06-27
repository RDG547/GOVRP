import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { CheckCircle, Clock, Zap, Target, Rocket, Users, Shield, Globe, Code, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FaWhatsapp, FaDiscord, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';

const Roadmap = () => {
  const [isCommunityDialogOpen, setIsCommunityDialogOpen] = useState(false);

  const roadmapItems = [
    {
      phase: 'Fase 1',
      period: 'Q1 2025',
      status: 'completed',
      title: 'Fundação e Conceito',
      description: 'Estabelecimento da base conceitual e arquitetural do GOV.RP.',
      items: [
        'Definição da arquitetura da plataforma',
        'Criação da identidade visual e branding',
        'Planejamento dos sistemas principais',
        'Formação da equipe inicial de desenvolvimento'
      ]
    },
    {
      phase: 'Fase 2',
      period: 'Q2 2025',
      status: 'completed',
      title: 'Desenvolvimento dos Sistemas Core',
      description: 'Implementação dos serviços fundamentais da plataforma.',
      items: [
        'Sistema de autenticação e perfis de usuário',
        'Banco Nacional com sistema de transações',
        'DIC - Departamento de Identificação Civil',
        'Sistema de documentos virtuais (CPF, RG)',
        'Interface administrativa básica'
      ]
    },
    {
      phase: 'Fase 3',
      period: 'Q3 2025',
      status: 'completed',
      title: 'Expansão dos Serviços',
      description: 'Adição de novos serviços e funcionalidades avançadas.',
      items: [
        'Rede Social X integrada',
        'Sistema de Negócios Livres',
        'Biblioteca Nacional',
        'Acervo Digital',
        'Sistema de cartões de crédito',
        'Programa de investimentos'
      ]
    },
    {
      phase: 'Fase 4',
      period: 'Q4 2025',
      status: 'in-progress',
      title: 'Lançamento Público',
      description: 'Abertura oficial da plataforma para toda a comunidade.',
      items: [
        'Testes beta com grupo seleto de usuários',
        'Otimização de performance e segurança',
        'Sistema de notificações em tempo real',
        'Documentação completa para usuários',
        'Lançamento oficial da plataforma'
      ]
    },
    {
      phase: 'Fase 5',
      period: 'Q1 2026',
      status: 'planned',
      title: 'Sistemas Governamentais',
      description: 'Implementação de funcionalidades políticas e administrativas.',
      items: [
        'Sistema de partidos políticos',
        'Eleições e votações digitais',
        'Câmara dos Deputados virtual',
        'Sistema de propostas e leis',
        'Tribunal de Justiça digital'
      ]
    },
    {
      phase: 'Fase 6',
      period: 'Q2 2026',
      status: 'planned',
      title: 'Economia Avançada',
      description: 'Expansão do sistema econômico com novos recursos.',
      items: [
        'Bolsa de valores virtual',
        'Sistema de impostos e tributação',
        'Mercado imobiliário',
        'Seguros e previdência',
        'Criptomoedas do universo RP'
      ]
    },
    {
      phase: 'Fase 7',
      period: 'Q3 2026',
      status: 'planned',
      title: 'Expansão Internacional',
      description: 'Criação de múltiplas nações e diplomacia internacional.',
      items: [
        'Sistema de múltiplas nações',
        'Relações diplomáticas',
        'Comércio internacional',
        'Organizações internacionais',
        'Conflitos e alianças'
      ]
    },
    {
      phase: 'Fase 8',
      period: 'Q4 2026',
      status: 'planned',
      title: 'Inovação e Futuro',
      description: 'Implementação de tecnologias emergentes e recursos avançados.',
      items: [
        'Inteligência artificial para NPCs',
        'Realidade virtual integrada',
        'Blockchain para transparência',
        'API pública para desenvolvedores',
        'Aplicativo mobile nativo'
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
      default:
        return <Target className="w-6 h-6 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'from-green-600 to-emerald-600';
      case 'in-progress':
        return 'from-yellow-600 to-orange-600';
      case 'planned':
        return 'from-blue-600 to-purple-600';
      default:
        return 'from-gray-600 to-slate-600';
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
      default:
        return 'Pendente';
    }
  };

  const communityChannels = [
    { name: 'WhatsApp', link: 'https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj', icon: <FaWhatsapp size={24} />, color: 'bg-green-500', hoverColor: 'hover:bg-green-600' },
    { name: 'Discord', link: 'https://discord.gg/NwJuuzKbUU', icon: <FaDiscord size={24} />, color: 'bg-indigo-500', hoverColor: 'hover:bg-indigo-600' },
    { name: 'Telegram', link: 'https://t.me/geopolitical_simulator5', icon: <FaTelegram size={24} />, color: 'bg-sky-500', hoverColor: 'hover:bg-sky-600' },
  ];

  return (
    <>
      <Helmet>
        <title>Roadmap - GOV.RP</title>
        <meta name="description" content="Acompanhe o desenvolvimento do GOV.RP através do nosso roadmap detalhado. Veja o que já foi implementado e o que está por vir." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Rocket}
            title="Roadmap do"
            gradientText="GOV.RP"
            description="Acompanhe nossa jornada de desenvolvimento e descubra o que está por vir. Transparência total sobre nossos planos e progresso."
            iconColor="text-purple-400"
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-effect rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-600 to-emerald-600 rounded-full mb-4">
                <CheckCircle className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">3 Fases</h3>
              <p className="text-green-400 font-semibold">Concluídas</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass-effect rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-full mb-4">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">1 Fase</h3>
              <p className="text-yellow-400 font-semibold">Em Andamento</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass-effect rounded-2xl p-6 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-4">
                <Rocket className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">4 Fases</h3>
              <p className="text-blue-400 font-semibold">Planejadas</p>
            </motion.div>
          </div>

          <div className="space-y-8">
            {roadmapItems.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: index % 2 === 0 ? -50 : 50 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="glass-effect rounded-2xl p-8 border border-white/10"
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-6">
                  <div className="flex items-center gap-4">
                    <div className={`flex items-center justify-center w-16 h-16 bg-gradient-to-r ${getStatusColor(item.status)} rounded-full`}>
                      {getStatusIcon(item.status)}
                    </div>
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="text-2xl font-bold text-white">{item.phase}</h3>
                        <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                          item.status === 'completed' ? 'bg-green-500/20 text-green-300' :
                          item.status === 'in-progress' ? 'bg-yellow-500/20 text-yellow-300' :
                          'bg-blue-500/20 text-blue-300'
                        }`}>
                          {getStatusText(item.status)}
                        </span>
                      </div>
                      <p className="text-blue-400 font-semibold">{item.period}</p>
                      <h4 className="text-xl font-bold text-white mt-2">{item.title}</h4>
                    </div>
                  </div>
                  
                  <div className="flex-1">
                    <p className="text-gray-300 mb-4 leading-relaxed">{item.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {item.items.map((feature, featureIndex) => (
                        <div key={featureIndex} className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-400 rounded-full flex-shrink-0" />
                          <span className="text-gray-300 text-sm">{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-16"
          >
            <div className="glass-effect rounded-2xl p-8 md:p-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full mb-6">
                <Sparkles className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-3xl font-bold text-white mb-4">O Futuro é Construído Juntos</h3>
              <p className="text-gray-300 mb-6 max-w-2xl mx-auto leading-relaxed">
                Este roadmap é um documento vivo que evolui com base no feedback da nossa comunidade. 
                Suas sugestões e ideias são fundamentais para moldar o futuro do GOV.RP.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Dialog open={isCommunityDialogOpen} onOpenChange={setIsCommunityDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="inline-flex items-center justify-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300">
                      <Users className="w-5 h-5 mr-2" />
                      Participar da Comunidade
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Escolha seu Canal</DialogTitle>
                      <DialogDescription>
                        Junte-se à nossa comunidade para discutir, dar sugestões e ficar por dentro de tudo.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-3 pt-4">
                      {communityChannels.map(channel => (
                        <a href={channel.link} key={channel.name} target="_blank" rel="noopener noreferrer" 
                           className={`flex items-center justify-center gap-3 p-3 rounded-lg text-white font-semibold transition-all ${channel.color} ${channel.hoverColor}`}>
                          {channel.icon}
                          <span>{channel.name}</span>
                        </a>
                      ))}
                    </div>
                  </DialogContent>
                </Dialog>
                <a href="https://github.com/RDG547/GOVRP" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center px-6 py-3 border border-white/20 text-white font-medium rounded-lg hover:bg-white/10 transition-all duration-300">
                  <Code className="w-5 h-5 mr-2" />
                  Contribuir no GitHub
                </a>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </>
  );
};

export default Roadmap;