import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Mail, LifeBuoy, Send, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Link } from 'react-router-dom';
import { FaDiscord, FaWhatsapp } from 'react-icons/fa';

const Contact = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast({
        title: "Ticket de suporte enviado!",
        description: "Nossa equipe analisará sua solicitação e entrará em contato em breve.",
      });
      setFormData({ name: '', email: '', subject: '', message: '' });
    }, 1500);
  };

  const supportChannels = [
    { icon: Mail, title: 'Email Direto', description: 'Envie um email para suporte@gov.rp', link: 'mailto:suporte@gov.rp' },
    { icon: FaWhatsapp, title: 'Comunidade WhatsApp', description: 'Participe do nosso grupo principal para tirar dúvidas rápidas.', link: 'https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj', external: true },
    { icon: FaDiscord, title: 'Comunidade Discord', description: 'Junte-se ao nosso servidor para obter ajuda de outros jogadores e da equipe.', link: 'https://discord.gg/NwJuuzKbUU', external: true },
    { icon: HelpCircle, title: 'FAQ', description: 'Encontre respostas rápidas em nossa seção de Perguntas Frequentes.', link: '/faq' }
  ];
  
  const SupportChannelLink = ({ channel, ...props }) => {
    const content = (
      <div className="block glass-effect rounded-2xl p-6 hover:bg-white/10 transition-all duration-300">
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
            <channel.icon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{channel.title}</h3>
            <p className="text-gray-300">{channel.description}</p>
          </div>
        </div>
      </div>
    );

    if (channel.external) {
      return <a href={channel.link} target="_blank" rel="noopener noreferrer">{content}</a>;
    }

    return <Link to={channel.link}>{content}</Link>;
  }

  return (
    <>
      <Helmet>
        <title>Contato e Suporte - GOV.RP</title>
        <meta name="description" content="Precisa de ajuda? Entre em contato com nossa equipe de suporte. Estamos aqui para ajudar com qualquer problema ou dúvida." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              Contato & <span className="gradient-text">Suporte</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Encontrou um problema ou tem alguma dúvida? Nossa equipe está pronta para te ajudar a ter a melhor experiência possível no GOV.RP.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <h2 className="text-3xl font-bold text-white mb-8 text-center sm:text-left">Envie sua Mensagem</h2>
              <div className="glass-effect rounded-2xl p-8">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">Seu Nome</label>
                      <input id="name" name="name" type="text" required value={formData.name} onChange={handleChange} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Nome Completo" />
                    </div>
                    <div>
                      <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">Seu Email</label>
                      <input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="seu@email.com" />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="subject" className="block text-sm font-medium text-gray-300 mb-2">Assunto</label>
                    <input id="subject" name="subject" type="text" required value={formData.subject} onChange={handleChange} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ex: Problema com o banco" />
                  </div>
                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-gray-300 mb-2">Descrição</label>
                    <textarea id="message" name="message" rows="5" required value={formData.message} onChange={handleChange} className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 resize-none" placeholder="Descreva seu problema com o máximo de detalhes possível..."></textarea>
                  </div>
                  <Button type="submit" disabled={loading} size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                    {loading ? 'Enviando...' : <><Send className="w-5 h-5 mr-2" /> Enviar Mensagem</>}
                  </Button>
                </form>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
              <h2 className="text-3xl font-bold text-white mb-8 text-center sm:text-left">Canais Alternativos</h2>
              <div className="space-y-6">
                {supportChannels.map((channel, index) => (
                  <SupportChannelLink key={index} channel={channel} />
                ))}
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Contact;