import { formatLocaleBR } from '@/lib/dateTime';
import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Send, HelpCircle, ArrowRight, Headphones as Headset, Users, Mail, MessageSquare, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
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
import SupportConversation, { SUPPORT_STATUS } from '@/components/support/SupportConversation';

const TICKETS_PER_PAGE = 5;

const Support = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    requestType: 'support',
    subject: '',
    message: ''
  });
  const [loading, setLoading] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replySaving, setReplySaving] = useState(false);

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

  const loadTickets = useCallback(async ({ quiet = false, selectTicketId = null } = {}) => {
    if (!user?.id) {
      setTickets([]);
      setTicketCount(0);
      setSelectedTicket(null);
      return;
    }
    if (!quiet) setTicketsLoading(true);
    const from = (ticketPage - 1) * TICKETS_PER_PAGE;
    const { data, count, error } = await supabase
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .eq('requester_id', user.id)
      .is('deleted_at', null)
      .order('last_message_at', { ascending: false })
      .range(from, from + TICKETS_PER_PAGE - 1);
    if (error) {
      toast({ title: 'Erro ao carregar seus tickets', description: error.message, variant: 'destructive' });
    } else {
      setTickets(data || []);
      setTicketCount(count || 0);
      setSelectedTicket((current) => {
        const requested = (data || []).find((ticket) => ticket.id === selectTicketId);
        if (requested) return requested;
        if (current) return (data || []).find((ticket) => ticket.id === current.id) || current;
        return data?.[0] || null;
      });
    }
    if (!quiet) setTicketsLoading(false);
  }, [ticketPage, toast, user?.id]);

  const loadMessages = useCallback(async (ticketId, { quiet = false } = {}) => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    if (!quiet) setThreadLoading(true);
    const { data, error } = await supabase
      .from('support_ticket_messages')
      .select('*, sender:profiles!support_ticket_messages_sender_id_fkey(full_name, avatar_url, role)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (error) toast({ title: 'Erro ao abrir a conversa', description: error.message, variant: 'destructive' });
    else setMessages(data || []);
    if (!quiet) setThreadLoading(false);
  }, [toast]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);
  useEffect(() => { void loadMessages(selectedTicket?.id); }, [loadMessages, selectedTicket?.id]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase.channel(`my-support:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets', filter: `requester_id=eq.${user.id}` }, () => void loadTickets({ quiet: true }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_ticket_messages' }, (payload) => {
        if (payload.new?.ticket_id === selectedTicket?.id || payload.old?.ticket_id === selectedTicket?.id) {
          void loadMessages(selectedTicket.id, { quiet: true });
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadMessages, loadTickets, selectedTicket?.id, user?.id]);

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

    if (formData.requestType === 'support' && !user) {
      toast({ title: 'Entre para abrir um ticket', description: 'O acesso à conta permite acompanhar as respostas da equipe com segurança.', variant: 'destructive' });
      setLoading(false);
      return;
    }

    try {
        let createdTicket = null;
        if (formData.requestType === 'support') {
          const { data, error } = await supabase.rpc('create_support_ticket', {
            p_requester_name: formData.name,
            p_requester_email: formData.email,
            p_requester_phone: formData.phone || null,
            p_request_type: formData.requestType,
            p_subject: formData.subject,
            p_message: formData.message,
            p_attachment_path: null,
          });
          if (error || data?.success === false) throw error || new Error(data?.message || 'Não foi possível abrir o ticket.');
          createdTicket = data;
        } else {
          const { error } = await supabase.functions.invoke('send-contact-email', {
              body: { ...formData, type: formData.requestType },
          });
          if (error) throw error;
        }
        
        toast({
            title: formData.requestType === 'support' ? 'Ticket de suporte enviado!' : 'Mensagem enviada!',
            description: createdTicket?.public_id
              ? `Protocolo ${createdTicket.public_id}. Acompanhe as respostas logo abaixo.`
              : 'Nossa equipe analisará sua solicitação e entrará em contato em breve.',
        });
        setFormData((current) => ({
          name: user ? current.name : '',
          email: user ? current.email : '',
          phone: user ? current.phone : '',
          requestType: 'support',
          subject: '',
          message: '',
        }));
        if (createdTicket?.ticket_id) {
          setTicketPage(1);
          const { data: newTicket } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('id', createdTicket.ticket_id)
            .is('deleted_at', null)
            .maybeSingle();
          if (newTicket) setSelectedTicket(newTicket);
        }

    } catch (error) {
        toast({
            title: "Erro ao enviar ticket",
            description: error?.message || "Houve um problema ao enviar seu ticket. Tente novamente mais tarde.",
            variant: "destructive",
        });
    } finally {
        setLoading(false);
    }
  };

  const replyToTicket = async (message) => {
    setReplySaving(true);
    const { error } = await supabase.rpc('reply_to_support_ticket', {
      p_ticket_id: selectedTicket.id,
      p_message: message,
      p_attachment_path: null,
    });
    setReplySaving(false);
    if (error) {
      toast({ title: 'Resposta não enviada', description: error.message, variant: 'destructive' });
      return false;
    }
    await Promise.all([loadMessages(selectedTicket.id, { quiet: true }), loadTickets({ quiet: true })]);
    return true;
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
                  {formData.requestType === 'support' && !user ? (
                    <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                      Para abrir e acompanhar um ticket, <Link to="/login" className="font-semibold underline">entre na sua conta</Link>.
                    </p>
                  ) : null}
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

          {user ? (
            <section className="mt-20">
              <div className="mb-8 text-center">
                <h2 className="text-3xl font-bold text-white">Meus Tickets</h2>
                <p className="mt-2 text-gray-300">Acompanhe o atendimento e converse com a equipe em tempo real.</p>
              </div>
              <div className="grid min-w-0 gap-5 xl:grid-cols-[21rem_minmax(0,1fr)]">
                <aside className="space-y-3">
                  {ticketsLoading ? (
                    <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cyan-300" /></div>
                  ) : tickets.length ? tickets.map((ticket) => {
                    const status = SUPPORT_STATUS[ticket.status] || SUPPORT_STATUS.open;
                    return (
                      <button key={ticket.id} type="button" onClick={() => setSelectedTicket(ticket)} className={`w-full rounded-xl border p-4 text-left ${selectedTicket?.id === ticket.id ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-white/10 bg-white/[0.025] hover:bg-white/5'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-cyan-300">{ticket.public_id}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[0.68rem] ${status.className}`}>{status.label}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 font-medium text-white">{ticket.subject}</p>
                        <p className="mt-2 text-xs text-gray-400">Atualizado em {formatLocaleBR(new Date(ticket.last_message_at), 'toLocaleDateString', 'pt-BR')}</p>
                      </button>
                    );
                  }) : (
                    <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-gray-400">Você ainda não abriu tickets.</p>
                  )}
                  {ticketCount > TICKETS_PER_PAGE ? (
                    <div className="flex items-center justify-center gap-3">
                      <Button type="button" variant="outline" size="icon" disabled={ticketPage === 1} onClick={() => setTicketPage((page) => Math.max(1, page - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                      <span className="text-xs text-gray-400">Página {ticketPage} de {Math.ceil(ticketCount / TICKETS_PER_PAGE)}</span>
                      <Button type="button" variant="outline" size="icon" disabled={ticketPage >= Math.ceil(ticketCount / TICKETS_PER_PAGE)} onClick={() => setTicketPage((page) => page + 1)}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                  ) : null}
                </aside>
                <SupportConversation ticket={selectedTicket} messages={messages} loading={threadLoading} saving={replySaving} onReply={replyToTicket} />
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </>
  );
};

export default Support;
