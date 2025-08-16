import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { FileText, Shield, Users, AlertTriangle, Scale, Eye, Lock, Gavel, Globe, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';

const Terms = () => {
  const sections = [
    {
      icon: FileText,
      title: 'Aceitação dos Termos',
      content: [
        'Ao acessar e usar o GOV.RP, você concorda automaticamente em cumprir estes Termos de Uso em sua totalidade.',
        'Se você não concordar com qualquer parte destes termos, deve interromper imediatamente o uso de nossos serviços.',
        'Reservamo-nos o direito de modificar estes termos a qualquer momento, com notificação prévia aos usuários.',
        'É sua responsabilidade revisar periodicamente estes termos para estar ciente de quaisquer alterações.',
        'O uso continuado da plataforma após modificações constitui aceitação dos novos termos.',
        'Menores de 13 anos não podem criar contas na plataforma sem supervisão parental adequada.'
      ]
    },
    {
      icon: Users,
      title: 'Uso da Plataforma e Conduta',
      content: [
        'O GOV.RP é uma plataforma de roleplay político destinada a usuários maiores de 13 anos.',
        'Você é integralmente responsável por manter a confidencialidade de sua conta e senha.',
        'É estritamente proibido usar a plataforma para atividades ilegais, prejudiciais ou que violem direitos de terceiros.',
        'Você concorda em não interferir no funcionamento normal da plataforma ou tentar acessar sistemas não autorizados.',
        'O conteúdo que você cria deve respeitar as diretrizes da comunidade e as leis brasileiras aplicáveis.',
        'Comportamentos como assédio, discriminação, spam ou trolling resultarão em suspensão ou banimento.',
        'É proibido compartilhar informações pessoais de outros usuários sem consentimento explícito.',
        'Você deve usar a plataforma de forma respeitosa e construtiva, contribuindo positivamente para a comunidade.'
      ]
    },
    {
      icon: Shield,
      title: 'Direitos e Responsabilidades',
      content: [
        'Você mantém todos os direitos autorais sobre o conteúdo original que cria na plataforma.',
        'Ao publicar conteúdo, você nos concede uma licença não exclusiva para exibi-lo, distribuí-lo e promovê-lo na plataforma.',
        'Não somos responsáveis pelo conteúdo criado pelos usuários, mas nos reservamos o direito de moderação.',
        'Reservamo-nos o direito de remover qualquer conteúdo que viole nossos termos ou diretrizes da comunidade.',
        'Você é integralmente responsável por suas interações com outros usuários e pelas consequências dessas interações.',
        'A plataforma é fornecida "como está" e não garantimos disponibilidade ininterrupta ou livre de erros.',
        'Você concorda em nos isentar de responsabilidade por danos decorrentes do uso da plataforma.',
        'Temos o direito de suspender ou encerrar contas que violem repetidamente nossos termos.'
      ]
    },
    {
      icon: AlertTriangle,
      title: 'Limitações e Proibições Específicas',
      content: [
        'É estritamente proibido criar múltiplas contas para contornar limitações, punições ou obter vantagens indevidas.',
        'Não é permitido vender, transferir ou compartilhar sua conta com terceiros sob nenhuma circunstância.',
        'É proibido usar bots, scripts automatizados ou qualquer software para automatizar ações sem autorização expressa.',
        'Conteúdo ofensivo, discriminatório, pornográfico, violento ou ilegal será removido imediatamente.',
        'Violações graves dos termos podem resultar em banimento permanente sem aviso prévio.',
        'É proibido tentar explorar bugs, vulnerabilidades ou falhas de segurança da plataforma.',
        'Não é permitido fazer engenharia reversa, descompilar ou tentar acessar o código-fonte da plataforma.',
        'Atividades que prejudiquem a experiência de outros usuários ou a estabilidade da plataforma são proibidas.'
      ]
    },
    {
      icon: Scale,
      title: 'Propriedade Intelectual',
      content: [
        'Todos os direitos de propriedade intelectual da plataforma GOV.RP pertencem exclusivamente aos seus criadores.',
        'O nome, logotipo, design e funcionalidades da plataforma são protegidos por direitos autorais e marcas registradas.',
        'Você não pode usar nossos elementos visuais, nome ou marca para fins comerciais sem autorização escrita.',
        'Respeitamos os direitos de propriedade intelectual de terceiros e esperamos que nossos usuários façam o mesmo.',
        'Se você acredita que seu conteúdo foi usado indevidamente, entre em contato conosco imediatamente.',
        'Nos reservamos o direito de remover conteúdo que viole direitos de propriedade intelectual de terceiros.',
        'Usuários que violarem repetidamente direitos autorais terão suas contas permanentemente suspensas.'
      ]
    },
    {
      icon: Lock,
      title: 'Privacidade e Proteção de Dados',
      content: [
        'Coletamos e processamos seus dados pessoais de acordo com nossa Política de Privacidade detalhada.',
        'Implementamos medidas de segurança robustas para proteger suas informações contra acesso não autorizado.',
        'Você tem direito de acessar, corrigir, excluir ou portar seus dados pessoais a qualquer momento.',
        'Não vendemos ou compartilhamos seus dados pessoais com terceiros para fins comerciais.',
        'Podemos compartilhar dados quando exigido por lei ou para proteger nossos direitos legítimos.',
        'Você pode solicitar a exclusão completa de sua conta e dados associados através de nosso suporte.',
        'Mantemos logs de atividade para fins de segurança e melhoria da plataforma por período limitado.'
      ]
    },
    {
      icon: Gavel,
      title: 'Resolução de Disputas e Jurisdição',
      content: [
        'Encorajamos a resolução amigável de disputas através de nosso sistema de suporte ao cliente.',
        'Em caso de disputas legais, tentaremos primeiro resolver através de mediação ou arbitragem.',
        'Estes termos são regidos exclusivamente pelas leis da República Federativa do Brasil.',
        'Qualquer ação legal deve ser iniciada nos tribunais competentes.',
        'Você renuncia ao direito de participar de ações coletivas contra a plataforma.',
        'Limitamos nossa responsabilidade ao valor máximo permitido pela legislação brasileira.',
        'Disputas relacionadas a transações financeiras seguem regulamentações específicas do Banco Central.'
      ]
    },
    {
      icon: Globe,
      title: 'Disposições Gerais',
      content: [
        'Se qualquer disposição destes termos for considerada inválida, as demais disposições permanecerão válidas.',
        'Nosso silêncio ou falha em fazer cumprir qualquer disposição não constitui renúncia de nossos direitos.',
        'Estes termos constituem o acordo completo entre você e o GOV.RP em relação ao uso da plataforma.',
        'Atualizações significativas dos termos serão comunicadas com pelo menos 30 dias de antecedência.',
        'Você pode encerrar sua conta a qualquer momento através das configurações de perfil.',
        'Nos reservamos o direito de encerrar a plataforma ou serviços específicos com aviso prévio adequado.',
        'Disposições que por sua natureza devem sobreviver ao encerramento continuarão válidas após o término.'
      ]
    }
  ];

  return (
    <>
      <Helmet>
        <title>Termos de Uso - GOV.RP</title>
        <meta name="description" content="Leia os termos de uso completos do GOV.RP. Conheça seus direitos, responsabilidades e as regras para uso da plataforma de roleplay político." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
          <PageHeader
            icon={FileText}
            title="Termos de"
            gradientText="Uso"
            description="Leia atentamente nossos termos de uso para entender completamente seus direitos, responsabilidades e as regras que regem o uso da plataforma GOV.RP."
            iconColor="text-yellow-400"
          />
            <div className="mt-6 text-sm text-gray-400 bg-white/5 rounded-lg p-4">
              <p><strong>Última atualização:</strong> {new Date('2025-07-24').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p><strong>Versão:</strong> 1.1 | <strong>Vigência:</strong> Imediata</p>
            </div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-12">
            {sections.map((section, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="glass-effect rounded-2xl p-8"
              >
                <div className="flex items-center mb-6">
                  <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-orange-600 to-red-600 rounded-full mr-4">
                    <section.icon className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">{section.title}</h2>
                </div>
                
                <div className="space-y-4">
                  {section.content.map((item, itemIndex) => (
                    <div key={itemIndex} className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-blue-400 rounded-full mt-2 flex-shrink-0" />
                      <p className="text-gray-300 leading-relaxed">{item}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-effect rounded-2xl p-8 mt-12"
          >
            <h2 className="text-2xl font-bold text-white mb-6">Informações de Contato</h2>
            <div className="space-y-4 text-gray-300">
                <p>Para todas as questões relacionadas a suporte técnico, dúvidas gerais, parcerias, imprensa ou qualquer outro assunto, por favor, utilize nosso canal de e-mail centralizado ou abra um ticket em nossa central de suporte.</p>
                <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg">
                    <Mail className="w-6 h-6 text-blue-400 flex-shrink-0"/>
                    <div>
                        <h3 className="text-white font-semibold">E-mail Oficial de Suporte</h3>
                        <a href="mailto:suporte@govrp.online" className="text-blue-300 hover:underline">suporte@govrp.online</a>
                    </div>
                </div>
            </div>
            <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>Importante:</strong> Para questões urgentes relacionadas a violações de termos ou segurança, 
                entre em contato imediatamente. Respondemos a todas as consultas em até 48 horas úteis.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mt-12"
          >
            <div className="glass-effect rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-4">Dúvidas sobre os Termos?</h3>
              <p className="text-gray-300 mb-6">
                Se você tiver alguma dúvida sobre estes termos de uso ou precisar de esclarecimentos, 
                nossa equipe está disponível para ajudar.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/support" className="inline-flex items-center justify-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300">
                  <Mail className="w-5 h-5 mr-2" />
                  Abrir um Ticket
                </Link>
                <Link to="/privacy" className="inline-flex items-center justify-center px-6 py-3 border border-white/20 text-white font-medium rounded-lg hover:bg-white/10 transition-all duration-300">
                  <Eye className="w-5 h-5 mr-2" />
                  Nossa Política de Privacidade
                </Link>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </>
  );
};

export default Terms;