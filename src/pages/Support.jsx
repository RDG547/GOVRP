import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Send, HelpCircle, ArrowRight, Headphones as Headset, Users, Mail, MessageSquare, Paperclip, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Link } from 'react-router-dom';
import { FaDiscord, FaWhatsapp, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { formatPhone } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import {
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MIME_TYPES,
  MAX_SUPPORT_ATTACHMENT_BYTES,
  buildStoragePath,
  validateSelectedFile,
} from '@/lib/security';

const Support = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    requestType: 'support',
    subject: '',
    message: ''
  });
  const [file, setFile] = useState(null);
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

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const validation = validateSelectedFile(selectedFile, {
        allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
        allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS,
        maxBytes: MAX_SUPPORT_ATTACHMENT_BYTES,
        label: 'anexo',
      });

      if (!validation.ok) {
        toast({ title: "Arquivo inválido", description: validation.error, variant: "destructive" });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setFile(selectedFile);
    }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    let attachmentUrl = null;
    if (file && formData.requestType === 'support') {
      const filePath = buildStoragePath({
        prefix: 'support-attachments',
        entityId: user?.id || 'guest',
        fileName: file.name,
      });
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('support-attachments')
        .upload(filePath, file);

      if (uploadError) {
        toast({ title: "Erro no Upload", description: "Não foi possível enviar seu anexo.", variant: "destructive" });
        setLoading(false);
        return;
      }
      attachmentUrl = uploadData.path;
    }

    try {
        const { error } = await supabase.functions.invoke('send-contact-email', {
            body: { ...formData, attachmentUrl, type: formData.requestType },
        });

        if (error) throw error;
        
        toast({
            title: formData.requestType === 'support' ? 'Ticket de suporte enviado!' : 'Mensagem enviada!',
            description: 'Nossa equipe analisará sua solicitação e entrará em contato em breve.',
        });
        setFormData((current) => ({
          name: user ? current.name : '',
          email: user ? current.email : '',
          phone: user ? current.phone : '',
          requestType: 'support',
          subject: '',
          message: '',
        }));
        setFile(null);
        if(fileInputRef.current) fileInputRef.current.value = "";

    } catch (error) {
        toast({
            title: "Erro ao enviar ticket",
            description: "Houve um problema ao enviar seu ticket. Tente novamente mais tarde.",
            variant: "destructive",
        });
    } finally {
        setLoading(false);
    }
  };

  const supportChannels = [
    { name: 'WhatsApp', link: 'https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj', icon: <FaWhatsapp size={24} />, color: 'bg-green-500', hoverColor: 'hover:bg-green-600' },
    { name: 'Discord', link: 'https://discord.gg/NwJuuzKbUU', icon: <FaDiscord size={24} />, color: 'bg-indigo-500', hoverColor: 'hover:bg-indigo-600' },
    { name: 'Telegram', link: 'https://t.me/geopolitical_simulator5', icon: <FaTelegram size={24} />, color: 'bg-sky-500', hoverColor: 'hover:bg-sky-600' },
  ];

  return (
    <>
      <Helmet>
        <title>Contato e Suporte - GOV.RP</title>
        <meta name="description" content="Fale com o GOV.RP, envie dúvidas gerais ou abra uma solicitação de suporte técnico." />
      </Helmet>

      <div className="min-h-screen py-24">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Headset}
            title="Contato e"
            gradientText="Suporte"
            description="Uma única central para dúvidas gerais, privacidade, parcerias, problemas de conta e suporte técnico."
            iconColor="text-blue-400"
            centered={true}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <h2 className="text-3xl font-bold text-white mb-8 text-center">Enviar uma Solicitação</h2>
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
                    <Label htmlFor="requestType" className="text-gray-300 mb-2 block">Tipo de Atendimento</Label>
                    <Select
                        value={formData.requestType}
                        onValueChange={(requestType) => setFormData((current) => ({
                          ...current,
                          requestType,
                        }))}
                      >
                      <SelectTrigger id="requestType" className="bg-white/5">
                        <span className="flex min-w-0 items-center gap-2">
                          {formData.requestType === 'support' ? (
                            <Headset className="h-4 w-4 shrink-0 text-cyan-300" />
                          ) : (
                            <MessageSquare className="h-4 w-4 shrink-0 text-cyan-300" />
                          )}
                          <SelectValue placeholder="Escolha o atendimento" />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="support">Suporte técnico ou conta</SelectItem>
                        <SelectItem value="contact">Contato geral, parceria ou imprensa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="subject" className="text-gray-300 mb-2 block">Assunto</Label>
                    <Input id="subject" name="subject" type="text" required value={formData.subject} onChange={handleChange} className="bg-white/5 border-white/10" placeholder={formData.requestType === 'support' ? 'Ex: Bug no Banco Nacional' : 'Ex: Proposta de parceria'} />
                  </div>
                  <div>
                    <Label htmlFor="message" className="text-gray-300 mb-2 block">{formData.requestType === 'support' ? 'Descrição do Problema' : 'Mensagem'}</Label>
                    <Textarea id="message" name="message" rows="5" required value={formData.message} onChange={handleChange} className="bg-white/5 border-white/10" placeholder={formData.requestType === 'support' ? 'Descreva o problema com o máximo de detalhes possível...' : 'Conte como podemos ajudar...'}></Textarea>
                  </div>
                  {formData.requestType === 'support' && <div>
                    <Label htmlFor="attachment" className="text-gray-300 mb-2 block">Anexo (Opcional)</Label>
                    <div className="relative">
                      <Button type="button" variant="outline" className="w-full justify-start border-white/20 text-white/70" onClick={() => fileInputRef.current?.click()}>
                        <Paperclip className="w-4 h-4 mr-2" />
                        {file ? file.name : "Anexar print ou arquivo (max 5MB)"}
                      </Button>
                      <Input ref={fileInputRef} id="attachment" name="attachment" type="file" onChange={handleFileChange} className="sr-only" accept="image/png, image/jpeg, image/gif" />
                      {file && <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8" onClick={() => { setFile(null); if(fileInputRef.current) fileInputRef.current.value = ""; }}><XIcon className="w-4 h-4" /></Button>}
                    </div>
                  </div>}
                  <Button type="submit" disabled={loading} size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                    {loading ? 'Enviando...' : <><Send className="w-5 h-5 mr-2" /> {formData.requestType === 'support' ? 'Enviar Ticket' : 'Enviar Mensagem'}</>}
                  </Button>
                </form>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }}>
              <h2 className="text-3xl font-bold text-white mb-8 text-center">Canais de Contato</h2>
              <div className="space-y-6">
                <Link to="/faq" className="block glass-effect rounded-2xl p-6 hover:bg-white/10 transition-all duration-300 border border-white/10">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <HelpCircle className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Base de Conhecimento (FAQ)</h3>
                      <p className="text-gray-300">Encontre respostas rápidas para as dúvidas mais comuns.</p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-gray-400 ml-auto"/>
                  </div>
                </Link>

                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <Users className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Ajuda Comunitária</h3>
                      <p className="text-gray-300">Converse com a equipe e outros jogadores em tempo real.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {supportChannels.map(channel => (
                      <a href={channel.link} key={channel.name} target="_blank" rel="noopener noreferrer" 
                         className={`flex items-center justify-center gap-3 p-3 rounded-lg text-white font-semibold transition-all ${channel.color} ${channel.hoverColor}`}>
                        {channel.icon}
                        <span>{channel.name}</span>
                      </a>
                    ))}
                  </div>
                </div>

                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center">
                      <Mail className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">E-mail Direto</h3>
                      <p className="text-gray-300">Se preferir, envie sua questão diretamente para nosso e-mail de suporte.</p>
                       <a href="mailto:suporte@govrp.online" className="font-semibold text-blue-300 hover:underline">
                          suporte@govrp.online
                      </a>
                    </div>
                  </div>
                </div>

              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  );
};

export default Support;
