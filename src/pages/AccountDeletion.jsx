import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, LogIn, Mail, Phone, Send, Shield, Trash2, User } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { formatPhone } from '@/lib/utils';

const INITIAL_FORM_DATA = {
  name: '',
  email: '',
  username: '',
  phone: '',
  reason: '',
};

const AccountDeletion = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user && !session?.user?.email) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      name: user?.full_name || prev.name,
      email: session?.user?.email || prev.email,
      username: user?.username || prev.username,
      phone: user?.phone ? formatPhone(user.phone) : prev.phone,
    }));
  }, [session?.user?.email, user]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'phone') {
      setFormData((prev) => ({ ...prev, [name]: formatPhone(value) }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!confirmed) {
      toast({
        title: 'Confirmação necessária',
        description: 'Confirme o pedido de exclusão antes de enviar o formulário.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    const message = [
      'Solicitação de exclusão de conta enviada pelo formulário público.',
      `Nome: ${formData.name}`,
      `E-mail da conta: ${formData.email}`,
      `Nome de usuário: ${formData.username || 'Não informado'}`,
      `Telefone: ${formData.phone || 'Não informado'}`,
      '',
      'Motivo e observações:',
      formData.reason,
      '',
      `Usuário autenticado no envio: ${user ? 'Sim' : 'Não'}`,
      `ID autenticado no envio: ${user?.id || 'Não autenticado'}`,
    ].join('\n');

    try {
      const { error } = await supabase.functions.invoke('send-contact-email', {
        body: {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          subject: 'Solicitação de exclusão de conta',
          message,
          type: 'support',
        },
      });

      if (error) {
        throw error;
      }

      toast({
        title: 'Solicitação enviada',
        description: 'Recebemos seu pedido de exclusão e nossa equipe poderá entrar em contato para validação.',
      });

      setFormData((prev) =>
        user || session?.user?.email
          ? {
              ...prev,
              reason: '',
            }
          : INITIAL_FORM_DATA
      );
      setConfirmed(false);
    } catch (error) {
      toast({
        title: 'Erro ao enviar solicitação',
        description: 'Não foi possível registrar seu pedido agora. Tente novamente em alguns instantes.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    Boolean(formData.name.trim()) &&
    Boolean(formData.email.trim()) &&
    Boolean(formData.reason.trim()) &&
    confirmed &&
    !loading;

  return (
    <>
      <Helmet>
        <title>Exclusão de Conta - GOV.RP</title>
        <meta
          name="description"
          content="Solicite a exclusão da sua conta GOV.RP por meio de um formulário público, com ou sem login."
        />
      </Helmet>

      <div className="min-h-screen py-24">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <PageHeader
            icon={Trash2}
            title="Solicitar"
            gradientText="Exclusão de Conta"
            description="Use este formulário para pedir a exclusão da sua conta. O envio pode ser feito mesmo sem estar logado."
            iconColor="text-red-400"
            centered={true}
          />

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-3"
            >
              <h2 className="text-3xl font-bold text-white mb-8">Formulário de Exclusão</h2>
              <div className="glass-effect rounded-2xl p-8 border border-white/10">
                <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Informe os dados que ajudam a localizar sua conta. Se necessário, nossa equipe poderá pedir confirmação adicional antes de concluir a exclusão.
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="name" className="text-gray-300 mb-2 block">Seu Nome</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          id="name"
                          name="name"
                          type="text"
                          required
                          value={formData.name}
                          onChange={handleChange}
                          className="pl-10 bg-white/5 border-white/10"
                          placeholder="Nome completo"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="email" className="text-gray-300 mb-2 block">E-mail da Conta</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          required
                          value={formData.email}
                          onChange={handleChange}
                          className="pl-10 bg-white/5 border-white/10"
                          placeholder="seu@email.com"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <Label htmlFor="username" className="text-gray-300 mb-2 block">Nome de Usuário</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          id="username"
                          name="username"
                          type="text"
                          value={formData.username}
                          onChange={handleChange}
                          className="pl-10 bg-white/5 border-white/10"
                          placeholder="@usuario"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="phone" className="text-gray-300 mb-2 block">Telefone</Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={handleChange}
                          className="pl-10 bg-white/5 border-white/10"
                          placeholder="(00) 00000-0000"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="reason" className="text-gray-300 mb-2 block">Motivo ou Observações</Label>
                    <Textarea
                      id="reason"
                      name="reason"
                      rows="6"
                      required
                      value={formData.reason}
                      onChange={handleChange}
                      className="bg-white/5 border-white/10"
                      placeholder="Explique qual conta deseja excluir e, se quiser, deixe observações adicionais."
                    />
                  </div>

                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id="confirm-account-deletion"
                        checked={confirmed}
                        onCheckedChange={(value) => setConfirmed(Boolean(value))}
                        className="mt-1 border-red-300 data-[state=checked]:bg-red-500 data-[state=checked]:text-white"
                      />
                      <Label htmlFor="confirm-account-deletion" className="text-sm leading-relaxed text-red-100">
                        Confirmo que desejo solicitar a exclusão da conta informada e autorizo o contato da equipe para validar a titularidade, se necessário.
                      </Label>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    size="lg"
                    disabled={!canSubmit}
                    className="w-full bg-gradient-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600"
                  >
                    {loading ? 'Enviando solicitação...' : <><Send className="w-5 h-5 mr-2" /> Enviar Solicitação</>}
                  </Button>
                </form>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="lg:col-span-2"
            >
              <h2 className="text-3xl font-bold text-white mb-8">Como funciona</h2>

              <div className="space-y-6">
                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-red-600 to-orange-500 flex items-center justify-center">
                      <Shield className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Validação do pedido</h3>
                      <p className="text-gray-300">A equipe pode entrar em contato para confirmar que a solicitação partiu do titular da conta.</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400">
                    Preencha o máximo de informações possível para acelerar a identificação da conta correta.
                  </p>
                </div>

                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center">
                      <Mail className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Sem login obrigatório</h3>
                      <p className="text-gray-300">Você pode acessar esta página mesmo estando deslogado.</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400">
                    Isso ajuda quando você perdeu acesso à conta, mas ainda precisa formalizar o pedido de exclusão.
                  </p>
                </div>

                <div className="glass-effect rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-600 to-slate-500 flex items-center justify-center">
                      <LogIn className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">{user ? 'Voltar para sua conta' : 'Acesso à conta'}</h3>
                      <p className="text-gray-300">
                        {user
                          ? 'Se preferir, você pode retornar para a página de configurações.'
                          : 'Entrar continua opcional, mas pode ajudar você a revisar os dados da conta antes do envio.'}
                      </p>
                    </div>
                  </div>

                  <Button asChild variant="outline" className="w-full border-white/15 bg-white/5 hover:bg-white/10">
                    <Link to={user ? '/settings' : '/login'}>
                      {user ? 'Voltar para Configurações' : 'Entrar na Conta'}
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      </div>
    </>
  );
};

export default AccountDeletion;
