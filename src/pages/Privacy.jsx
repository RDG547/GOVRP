
import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Shield, Eye, Lock, Database, UserCheck, Settings, FileText, Globe, AlertCircle, CheckCircle } from 'lucide-react';

const Privacy = () => {
  const sections = [
    {
      icon: Database,
      title: 'Informações que Coletamos',
      content: [
        'Informações de cadastro fornecidas voluntariamente: nome completo, email, telefone, data de nascimento.',
        'Dados de identificação gerados automaticamente: CPF e RG virtuais únicos para uso na plataforma.',
        'Dados de uso e atividade: como você interage com nossa plataforma, serviços utilizados e preferências.',
        'Informações técnicas: endereço IP, tipo de navegador, sistema operacional, resolução de tela.',
        'Cookies e tecnologias similares para melhorar sua experiência e personalizar conteúdo.',
        'Conteúdo que você cria e compartilha: posts, comentários, mensagens e interações sociais.',
        'Dados financeiros virtuais: transações, saldos e histórico bancário dentro da plataforma.',
        'Logs de segurança e auditoria para proteção contra fraudes e atividades maliciosas.'
      ]
    },
    {
      icon: Eye,
      title: 'Como Usamos suas Informações',
      content: [
        'Fornecer e manter todos os serviços de roleplay político da plataforma GOV.RP.',
        'Personalizar sua experiência com base em suas preferências e histórico de uso.',
        'Comunicar atualizações importantes, novidades, eventos e informações relevantes.',
        'Melhorar continuamente nossos serviços com base no feedback e padrões de uso.',
        'Garantir a segurança da plataforma e prevenir fraudes, abusos ou atividades maliciosas.',
        'Cumprir obrigações legais e regulamentares quando necessário.',
        'Realizar análises estatísticas para entender melhor nossa comunidade.',
        'Desenvolver novos recursos e funcionalidades baseados nas necessidades dos usuários.'
      ]
    },
    {
      icon: UserCheck,
      title: 'Compartilhamento de Dados',
      content: [
        'Jamais vendemos suas informações pessoais para terceiros ou empresas de marketing.',
        'Podemos compartilhar dados com prestadores de serviços confiáveis que nos ajudam a operar a plataforma.',
        'Informações podem ser divulgadas quando exigido por lei, ordem judicial ou autoridades competentes.',
        'Em caso de fusão, aquisição ou venda de ativos, os dados podem ser transferidos com proteções adequadas.',
        'Dados agregados e completamente anonimizados podem ser usados para estatísticas públicas.',
        'Compartilhamos informações com seu consentimento explícito para funcionalidades específicas.',
        'Dados de segurança podem ser compartilhados com autoridades em casos de atividades ilegais.',
        'Informações públicas do seu perfil são visíveis para outros usuários conforme suas configurações.'
      ]
    },
    {
      icon: Lock,
      title: 'Segurança e Proteção dos Dados',
      content: [
        'Implementamos criptografia de ponta (AES-256) para proteger dados sensíveis em trânsito e armazenamento.',
        'Acesso restrito aos dados apenas para funcionários autorizados com necessidade legítima.',
        'Monitoramento contínuo de segurança com sistemas de detecção de intrusão 24/7.',
        'Backups seguros e criptografados com planos de recuperação de desastres testados regularmente.',
        'Autenticação de dois fatores disponível para proteção adicional da sua conta.',
        'Auditorias de segurança regulares realizadas por especialistas independentes.',
        'Políticas rigorosas de segurança para todos os funcionários e prestadores de serviços.',
        'Notificação imediata em caso de qualquer violação de dados que possa afetar você.'
      ]
    },
    {
      icon: Settings,
      title: 'Seus Direitos e Controles',
      content: [
        'Acessar e revisar todas as suas informações pessoais armazenadas a qualquer momento.',
        'Corrigir, atualizar ou completar dados incorretos, desatualizados ou incompletos.',
        'Solicitar a exclusão completa de sua conta e todos os dados pessoais associados.',
        'Portabilidade dos dados em formato estruturado e legível por máquina (JSON/CSV).',
        'Retirar consentimento para processamento de dados não essenciais a qualquer momento.',
        'Configurar preferências de privacidade e controlar a visibilidade do seu perfil.',
        'Apresentar reclamações às autoridades de proteção de dados (ANPD) se necessário.',
        'Receber cópia gratuita de todos os seus dados mediante solicitação formal.'
      ]
    },
    {
      icon: Shield,
      title: 'Retenção e Exclusão de Dados',
      content: [
        'Mantemos seus dados apenas pelo tempo estritamente necessário para os fins declarados.',
        'Dados de conta ativa são mantidos enquanto você utilizar nossos serviços.',
        'Informações podem ser mantidas por períodos legais obrigatórios (até 5 anos para dados financeiros).',
        'Dados de backup são automaticamente excluídos conforme cronograma pré-estabelecido.',
        'Você pode solicitar exclusão antecipada de dados não sujeitos a obrigações legais.',
        'Dados anonimizados podem ser mantidos indefinidamente para fins estatísticos.',
        'Logs de segurança são mantidos por 12 meses para investigação de incidentes.',
        'Exclusão segura e irreversível usando padrões militares de destruição de dados.'
      ]
    }
  ];

  const lgpdCompliance = [
    { icon: CheckCircle, title: 'Base Legal Sólida', description: 'Processamento baseado em consentimento, execução de contrato e legítimo interesse.' },
    { icon: Shield, title: 'Encarregado de Dados', description: 'Profissional dedicado para garantir conformidade e atender suas solicitações.' },
    { icon: FileText, title: 'Relatório de Impacto', description: 'Avaliação completa dos riscos e medidas de proteção implementadas.' },
    { icon: Globe, title: 'Transferência Internacional', description: 'Proteções adequadas para qualquer transferência de dados para outros países.' }
  ];

  const cookieTypes = [
    { name: 'Cookies Essenciais', description: 'Necessários para funcionamento básico da plataforma (login, segurança, navegação).', required: true },
    { name: 'Cookies de Desempenho', description: 'Ajudam a entender como os usuários interagem com a plataforma para melhorias.', required: false },
    { name: 'Cookies Funcionais', description: 'Permitem funcionalidades aprimoradas e personalização da experiência.', required: false },
    { name: 'Cookies de Marketing', description: 'Usados para fornecer conteúdo relevante e personalizado (atualmente desabilitados).', required: false }
  ];

  return (
    <>
      <Helmet>
        <title>Política de Privacidade - GOV.RP</title>
        <meta name="description" content="Conheça nossa política de privacidade completa e como protegemos seus dados pessoais no GOV.RP. Transparência, segurança e conformidade com a LGPD." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mb-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              Política de <span className="gradient-text">Privacidade</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Sua privacidade é fundamental para nós. Esta política explica de forma transparente como coletamos, 
              usamos, protegemos e respeitamos suas informações pessoais no GOV.RP.
            </p>
            <div className="mt-6 text-sm text-gray-400 bg-white/5 rounded-lg p-4">
              <p><strong>Última atualização:</strong> {new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <p><strong>Versão:</strong> 3.0 | <strong>Conformidade:</strong> LGPD (Lei 13.709/2018)</p>
            </div>
          </motion.div>
        </section>

        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-12">
            {sections.map((section, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="glass-effect rounded-2xl p-8"
              >
                <div className="flex items-center mb-6">
                  <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mr-4">
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
            className="glass-effect rounded-2xl p-8 mt-12"
          >
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
              <AlertCircle className="w-6 h-6 mr-3 text-green-400" />
              Conformidade com a LGPD
            </h2>
            <div className="space-y-4 text-gray-300 mb-8">
              <p>
                O GOV.RP está em total conformidade com a Lei Geral de Proteção de Dados (LGPD) - Lei nº 13.709/2018. 
                Processamos seus dados pessoais exclusivamente com base em fundamentos legais válidos e sempre 
                respeitando seus direitos como titular dos dados.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {lgpdCompliance.map((item, index) => (
                <div key={index} className="bg-white/5 rounded-lg p-4">
                  <div className="flex items-center mb-3">
                    <item.icon className="w-5 h-5 text-green-400 mr-2" />
                    <h3 className="text-white font-semibold">{item.title}</h3>
                  </div>
                  <p className="text-sm text-gray-400">{item.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-8 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-blue-300 text-sm">
                <strong>Encarregado de Proteção de Dados:</strong> Temos um encarregado especializado responsável 
                por garantir a conformidade com a LGPD e atender suas solicitações. 
                Contato: <a href="mailto:dpo@gov-rp.com" className="underline hover:text-blue-200">dpo@gov-rp.com</a>
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="glass-effect rounded-2xl p-8 mt-12"
          >
            <h2 className="text-2xl font-bold text-white mb-6">Política Detalhada de Cookies</h2>
            <div className="space-y-4 text-gray-300 mb-6">
              <p>
                Utilizamos cookies e tecnologias similares para melhorar sua experiência, personalizar conteúdo 
                e analisar o uso de nossa plataforma. Você tem controle total sobre os cookies não essenciais.
              </p>
            </div>
            
            <div className="space-y-4">
              {cookieTypes.map((cookie, index) => (
                <div key={index} className="bg-white/5 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-white font-semibold">{cookie.name}</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${cookie.required ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                      {cookie.required ? 'Obrigatório' : 'Opcional'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400">{cookie.description}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-300 text-sm">
                <strong>Gerenciar Cookies:</strong> Você pode gerenciar suas preferências de cookies a qualquer momento 
                através das configurações do seu navegador ou entrando em contato conosco.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            className="text-center mt-12"
          >
            <div className="glass-effect rounded-2xl p-8">
              <h3 className="text-xl font-bold text-white mb-4">Dúvidas sobre Privacidade?</h3>
              <p className="text-gray-300 mb-6">
                Se você tiver alguma dúvida sobre nossa política de privacidade, quiser exercer seus direitos 
                ou relatar alguma preocupação, nossa equipe especializada está pronta para ajudar.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="/contact"
                  className="inline-flex items-center px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-300"
                >
                  <Shield className="w-5 h-5 mr-2" />
                  Entre em Contato
                </a>
                <a
                  href="mailto:dpo@gov-rp.com"
                  className="inline-flex items-center px-6 py-3 border border-white/20 text-white font-medium rounded-lg hover:bg-white/10 transition-all duration-300"
                >
                  <UserCheck className="w-5 h-5 mr-2" />
                  Email do Encarregado
                </a>
              </div>
            </div>
          </motion.div>
        </section>
      </div>
    </>
  );
};

export default Privacy;
