import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Users, MessageSquare, Mic, Gamepad2, ArrowRight, Rss } from 'lucide-react';
import { FaWhatsapp, FaDiscord, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';

const Community = () => {
  const channels = [
    {
      name: 'WhatsApp',
      description: 'Participe da nossa comunidade para discussões rápidas, anúncios e interação diária com os outros jogadores.',
      link: 'https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj',
      icon: <FaWhatsapp size={32} className="text-white"/>,
      color: 'from-green-500 to-teal-500'
    },
    {
      name: 'Discord',
      description: 'Junte-se ao nosso servidor para canais de voz, discussões aprofundadas, eventos e uma organização mais estruturada.',
      link: 'https://discord.gg/NwJuuzKbUU',
      icon: <FaDiscord size={32} className="text-white"/>,
      color: 'from-indigo-500 to-purple-600'
    },
    {
      name: 'Telegram',
      description: 'Prefere o Telegram? Também temos um grupo ativo por lá para manter todos conectados e informados sobre as novidades.',
      link: 'https://t.me/geopolitical_simulator5',
      icon: <FaTelegram size={32} className="text-white"/>,
      color: 'from-sky-500 to-blue-500'
    }
  ];

  const activities = [
    { icon: Gamepad2, title: 'Sessões de Roleplay', description: 'Participe de sessões de governo, debates parlamentares e eventos diplomáticos.' },
    { icon: Mic, title: 'Eventos Comunitários', description: 'Concursos, jogos e noites de descontração para fortalecer nossos laços.' },
    { icon: MessageSquare, title: 'Debates e Discussões', description: 'Espaços dedicados para debater política, economia e o futuro do GOV.RP.' },
    { icon: Rss, title: 'Feed de Atividades', description: 'Acompanhe em tempo real as últimas ações e decisões tomadas dentro do universo do RP.' }
  ];

  return (
    <>
      <Helmet>
        <title>Comunidade - GOV.RP</title>
        <meta name="description" content="Junte-se à comunidade do GOV.RP! Conecte-se com outros jogadores no WhatsApp, Discord e Telegram, participe de eventos e faça parte da nossa nação." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Users}
            title="Nossa"
            gradientText="Comunidade"
            description="O coração do GOV.RP são nossos cidadãos. Conecte-se, colabore e faça parte de uma comunidade vibrante e apaixonada por roleplay político."
            iconColor="text-pink-400"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 items-stretch">
            {channels.map((channel, index) => (
              <motion.a
                key={index}
                href={channel.link}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + index * 0.1 }}
                className="block glass-effect rounded-2xl p-8 h-full hover:bg-white/10 transition-all duration-300 group hover:-translate-y-2"
              >
                <div className="flex items-center mb-6">
                  <div className={`flex items-center justify-center w-16 h-16 bg-gradient-to-r ${channel.color} rounded-full mr-6`}>
                    {channel.icon}
                  </div>
                  <h2 className="text-3xl font-bold text-white">{channel.name}</h2>
                </div>
                <p className="text-gray-300 mb-6 leading-relaxed flex-grow">{channel.description}</p>
                <div className="flex items-center text-blue-400 group-hover:text-blue-300 transition-colors mt-auto">
                  <span className="font-medium">Juntar-se</span>
                  <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </motion.a>
            ))}
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-4xl font-bold text-white mb-6">O que Acontece na Comunidade?</h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {activities.map((activity, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass-effect rounded-2xl p-8 text-center"
              >
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-6">
                  <activity.icon className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{activity.title}</h3>
                <p className="text-gray-300 text-sm leading-relaxed">{activity.description}</p>
              </motion.div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
};

export default Community;