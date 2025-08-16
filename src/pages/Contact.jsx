import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Mail, Send, Headphones as Headset, ArrowRight, Users, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Link } from 'react-router-dom';
import { FaDiscord, FaWhatsapp, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { formatPhone } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';

const Contact = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', message: '' });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData(prev => ({
                ...prev,
                name: user.full_name || '',
                email: user.email || '',
                phone: user.phone ? formatPhone(user.phone) : ''
            }));
        }
    }, [user]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'phone') {
            setFormData({ ...formData, [name]: formatPhone(value) });
        } else {
            setFormData({ ...formData, [name]: value });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        
        try {
            const { data, error } = await supabase.functions.invoke('send-contact-email', {
                body: { ...formData, type: 'contact' },
            });

            if (error) throw error;
            
            toast({
                title: "Mensagem enviada!",
                description: "Obrigado pelo seu contato. Responderemos em breve.",
            });
            if (!user) {
                setFormData({ name: '', email: '', phone: '', message: '' });
            }
        } catch (error) {
            toast({
                title: "Erro ao enviar mensagem",
                description: "Houve um problema ao enviar seu contato. Tente novamente mais tarde.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
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
        <title>Contato - GOV.RP</title>
        <meta name="description" content="Entre em contato com a equipe do GOV.RP. Estamos aqui para conversar sobre o projeto, parcerias ou qualquer outra dúvida." />
      </Helmet>

      <div className="min-h-screen py-24">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Mail}
            title="Fale"
            gradientText="Conosco"
            description="Tem alguma dúvida geral sobre o projeto? Use o formulário abaixo ou, para uma resposta mais rápida, junte-se às nossas comunidades."
            iconColor="text-orange-400"
          />

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
            <motion.div 
                initial={{ opacity: 0, x: -20 }} 
                animate={{ opacity: 1, x: 0 }} 
                transition={{ delay: 0.2 }}
                className="lg:col-span-3"
            >
                <h2 className="text-3xl font-bold text-white mb-8">Envie sua Mensagem</h2>
                <div className="glass-effect rounded-2xl p-8 border border-white/10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <Label htmlFor="name" className="text-gray-300 mb-2 block">Seu Nome</Label>
                                <Input id="name" name="name" type="text" required value={formData.name} onChange={handleChange} className="bg-white/5 border-white/10" placeholder="Nome Completo" />
                            </div>
                            <div>
                                <Label htmlFor="email" className="text-gray-300 mb-2 block">Seu Email</Label>
                                <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} className="bg-white/5 border-white/10" placeholder="seu@email.com" />
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="phone" className="text-gray-300 mb-2 block">Telefone (Opcional)</Label>
                            <Input id="phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} className="bg-white/5 border-white/10" placeholder="(00) 00000-0000" />
                        </div>
                        <div>
                           <Label htmlFor="message" className="text-gray-300 mb-2 block">Sua Mensagem</Label>
                           <Textarea id="message" name="message" rows="6" required value={formData.message} onChange={handleChange} className="bg-white/5 border-white/10" placeholder="Escreva sua dúvida ou feedback..."></Textarea>
                        </div>
                        <div className="pt-2">
                            <Button type="submit" disabled={loading || !formData.name || !formData.email || !formData.message} size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                                {loading ? 'Enviando...' : <><Send className="w-5 h-5 mr-2" /> Enviar Mensagem</>}
                            </Button>
                        </div>
                    </form>
                </div>
            </motion.div>
            <motion.div 
                initial={{ opacity: 0, x: 20 }} 
                animate={{ opacity: 1, x: 0 }} 
                transition={{ delay: 0.4 }}
                className="lg:col-span-2"
            >
              <h2 className="text-3xl font-bold text-white mb-8">Nossas Comunidades</h2>
              <div className="space-y-6">
                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Canais Comunitários</h3>
                      <p className="text-gray-300">A forma mais rápida de interagir e tirar dúvidas.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {communityChannels.map(channel => (
                      <a href={channel.link} key={channel.name} target="_blank" rel="noopener noreferrer" 
                         className={`flex items-center justify-center gap-3 p-3 rounded-lg text-white font-semibold transition-all ${channel.color} ${channel.hoverColor}`}>
                        {channel.icon}
                        <span>{channel.name}</span>
                      </a>
                    ))}
                  </div>
                </div>

                <div className="glass-effect rounded-2xl p-6 border border-blue-500/30 bg-blue-500/10">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                        <Headset className="w-6 h-6 text-white"/>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Precisa de Ajuda Técnica?</h3>
                      <p className="text-blue-200/80 mt-1">Para bugs ou problemas com sua conta, acesse nossa Central de Suporte.</p>
                    </div>
                  </div>
                  <Link to="/support" className="mt-4 block">
                    <Button size="sm" variant="outline" className="w-full border-blue-400/50 text-blue-300 hover:bg-blue-400/10 hover:text-blue-200">
                        Ir para Suporte Técnico <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Contact;