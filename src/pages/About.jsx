import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Users, Zap, Globe, Shield, Puzzle, Code, Target, Milestone, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';

const About = () => {
  const teamMembers = [
    { name: 'Ricardo', role: 'Fundador & Dev Chefe', avatar: 'https://i.imgur.com/kEgzq5b.jpeg' },
    { name: 'Yasmim', role: 'Gerente de Comunidade', avatar: 'https://i.imgur.com/d9w5d1X.jpeg' },
    { name: 'Arthur', role: 'Designer de Sistemas', avatar: 'https://i.imgur.com/Gscx2QZ.jpeg' },
    { name: 'Eduardo', role: 'Moderador Chefe', avatar: 'https://i.imgur.com/tYw2R3e.jpeg' },
  ];

  const values = [
    { icon: Globe, title: 'Liberdade Criativa', description: 'Nós fornecemos a tela; você pinta a obra-prima. Crie narrativas, sistemas políticos e economias sem limites.' },
    { icon: Users, title: 'Comunidade Soberana', description: 'Acreditamos no poder da comunidade. O futuro do GOV.RP é moldado pelas vozes e ações dos nossos cidadãos.' },
    { icon: Zap, title: 'Inovação Constante', description: 'O mundo não para, e nós também não. Estamos sempre desenvolvendo novos sistemas para um universo dinâmico.' },
    { icon: Shield, title: 'Imparcialidade e Justiça', description: 'Nosso compromisso é manter um ambiente equilibrado, onde a estratégia e a interpretação de papéis prevalecem.' },
  ];

  const timelineEvents = [
    { date: 'Q1 2025', title: 'Concepção do Projeto', description: 'A ideia do GOV.RP nasce, com o objetivo de criar a plataforma de RP político mais completa.' },
    { date: 'Q2 2025', title: 'Desenvolvimento Inicial', description: 'Os primeiros sistemas, como o Banco Nacional e o DIC, são desenvolvidos e testados.' },
    { date: 'Q3 2025', title: 'Lançamento Alpha', description: 'A plataforma é aberta para um grupo seleto de testadores para feedback inicial e refinamento.' },
    { date: 'Q4 2025', title: 'Lançamento Público', description: 'GOV.RP é oficialmente lançado para toda a comunidade, marcando o início de uma nova era.' },
    { date: 'Hoje', title: 'Expansão Contínua', description: 'Trabalhando em novos serviços, melhorias de performance e engajamento da comunidade.' },
  ];

  return (
    <>
      <Helmet>
        <title>Sobre Nós - GOV.RP</title>
        <meta name="description" content="Descubra a missão, os valores e a equipe por trás do GOV.RP, a mais imersiva plataforma de simulação e roleplay político." />
      </Helmet>

      <div className="overflow-x-hidden py-20">
        <div className="relative pb-20 hero-pattern">
           <PageHeader
            icon={Users}
            title="A Plataforma Onde a Sua História"
            gradientText="se Torna Legado"
            description="GOV.RP é mais que um jogo. É um universo digital movido pela criatividade, estratégia e colaboração. Fundado por entusiastas de RP, nosso propósito é oferecer uma ferramenta poderosa para a criação de narrativas políticas complexas e imersivas."
            iconColor="text-pink-400"
          />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-24"
          >
            <div>
              <h2 className="text-3xl font-bold text-white mb-6">Nossa <span className="gradient-text">Filosofia</span></h2>
              <p className="text-gray-300 mb-4 leading-relaxed text-lg">
                Nascemos da convicção de que o roleplay é uma forma de arte. Nossa missão é fornecer a infraestrutura tecnológica para que essa arte floresça sem barreiras. Aqui, cada decisão importa, cada aliança tem peso e cada cidadão pode, de fato, mudar o rumo da história.
              </p>
              <p className="text-gray-300 leading-relaxed text-lg">
                Somos uma plataforma independente, livre de afiliações governamentais reais, o que nos permite focar 100% na experiência do jogador. O poder está em suas mãos.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <motion.div whileHover={{ y: -5 }} className="glass-effect p-6 rounded-2xl text-center border-white/10"><Puzzle className="w-10 h-10 mx-auto text-blue-400 mb-3"/><h3 className="text-lg font-bold text-white">Sistemas Modulares</h3><p className="text-sm text-gray-400">Flexibilidade para criar governos, leis e economias únicas.</p></motion.div>
              <motion.div whileHover={{ y: -5 }} className="glass-effect p-6 rounded-2xl text-center border-white/10"><Code className="w-10 h-10 mx-auto text-purple-400 mb-3"/><h3 className="text-lg font-bold text-white">Tecnologia de Ponta</h3><p className="text-sm text-gray-400">Uma plataforma rápida, segura e em constante evolução.</p></motion.div>
            </div>
          </motion.div>

          <div className="my-24">
            <h2 className="text-4xl font-bold text-white text-center mb-12">Nossos <span className="gradient-text">Pilares</span></h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {values.map((value, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="glass-effect p-8 rounded-2xl text-center hover:bg-white/10 transition-colors duration-300 border border-white/10"
                >
                  <div className="inline-block p-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-6">
                    <value.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{value.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
          
          <div className="my-24">
            <h2 className="text-4xl font-bold text-white text-center mb-16">A Jornada do <span className="gradient-text">GOV.RP</span></h2>
            <div className="relative">
              <div className="absolute left-1/2 -translate-x-1/2 w-0.5 h-full bg-white/10" aria-hidden="true"></div>
              {timelineEvents.map((event, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  className="relative flex items-center mb-12"
                >
                  <div className={`w-1/2 ${index % 2 === 0 ? 'pr-8 text-right' : 'pl-8 text-left'}`}>
                    <p className="text-sm text-blue-400 font-semibold">{event.date}</p>
                    <h3 className="text-xl font-bold text-white mt-1">{event.title}</h3>
                    <p className="text-gray-400 mt-2">{event.description}</p>
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 w-8 h-8 bg-slate-800 rounded-full border-4 border-purple-500 flex items-center justify-center">
                    <Milestone className="w-4 h-4 text-purple-400"/>
                  </div>
                  <div className="w-1/2"></div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="my-24">
            <h2 className="text-4xl font-bold text-white text-center mb-12">Os Arquitetos da <span className="gradient-text">Plataforma</span></h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="text-center group"
                >
                   <div className="relative inline-block">
                    <img src={member.avatar} alt={`Avatar de ${member.name}`} className="w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full object-cover mb-4 border-4 border-transparent group-hover:border-purple-500/50 transition-all duration-300" />
                   </div>
                  <h4 className="text-xl font-bold text-white">{member.name}</h4>
                  <p className="text-blue-300">{member.role}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-12"
          >
            <div className="glass-effect rounded-2xl p-8 md:p-12">
              <h3 className="text-3xl font-bold text-white mb-4">Pronto para Deixar sua Marca?</h3>
              <p className="text-gray-300 mb-6 max-w-xl mx-auto">
                A história está sendo escrita agora. Junte-se a nós e comece a construir seu legado no universo do GOV.RP.
              </p>
              <Link to="/register">
                <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                  Criar Minha Conta Agora
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>
          </motion.div>

        </div>
      </div>
    </>
  );
};

export default About;