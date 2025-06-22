
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  FileText, 
  Shield, 
  Users, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  Scale,
  Lock,
  Globe,
  Smartphone,
  CreditCard,
  MessageSquare,
  Database,
  Eye,
  UserX,
  Gavel
} from 'lucide-react';

const Terms = () => {
  const sections = [
    {
      id: 'acceptance',
      title: 'Aceitação dos Termos',
      icon: CheckCircle,
      content: [
        'Ao acessar e usar a plataforma GOV.RP, você concorda integralmente com estes Termos de Uso.',
        'Se você não concordar com qualquer parte destes termos, não deve usar nossos serviços.',
        'Estes termos constituem um acordo legal vinculativo entre você e a plataforma GOV.RP.',
        'O uso continuado da plataforma após alterações nos termos constitui aceitação das mudanças.',
        'Você deve ter pelo menos 18 anos ou ter autorização dos pais/responsáveis para usar nossos serviços.'
      ]
    },
    {
      id: 'services',
      title: 'Descrição dos Serviços',
      icon: Globe,
      content: [
        'O GOV.RP é uma plataforma digital que oferece serviços públicos integrados incluindo:',
        '• Banco Nacional: Serviços bancários digitais com conta corrente, transferências e cartões',
        '• Social X: Rede social para interação entre cidadãos',
        '• DIC: Gerenciamento de documentos digitais oficiais',
        '• Negócios Livres: Marketplace para comércio entre usuários',
        'Reservamo-nos o direito de modificar, suspender ou descontinuar qualquer serviço a qualquer momento.',
        'Novos serviços podem ser adicionados periodicamente, sujeitos a estes termos.'
      ]
    },
    {
      id: 'registration',
      title: 'Registro e Conta de Usuário',
      icon: Users,
      content: [
        'Para usar nossos serviços, você deve criar uma conta fornecendo informações precisas e completas.',
        'Você é responsável por manter a confidencialidade de suas credenciais de acesso.',
        'Você deve notificar-nos imediatamente sobre qualquer uso não autorizado de sua conta.',
        'É proibido criar múltiplas contas ou usar informações falsas no registro.',
        'Podemos suspender ou encerrar contas que violem estes termos ou sejam usadas para atividades ilegais.',
        'Você é responsável por todas as atividades que ocorrem em sua conta.'
      ]
    },
    {
      id: 'financial',
      title: 'Serviços Financeiros',
      icon: CreditCard,
      content: [
        'Os serviços bancários são fornecidos através do Banco Nacional integrado à plataforma.',
        'Todas as transações financeiras estão sujeitas às regulamentações bancárias aplicáveis.',
        'Você é responsável por manter saldo suficiente para transações e taxas aplicáveis.',
        'Transferências e pagamentos são processados em tempo real durante o horário de funcionamento.',
        'Disputas financeiras devem ser reportadas dentro de 60 dias da transação.',
        'Reservamo-nos o direito de congelar contas suspeitas de atividade fraudulenta.',
        'Cartões de crédito estão sujeitos a análise de crédito e aprovação.'
      ]
    },
    {
      id: 'content',
      title: 'Conteúdo e Conduta',
      icon: MessageSquare,
      content: [
        'Você é responsável por todo o conteúdo que publica na plataforma.',
        'É proibido publicar conteúdo que seja ilegal, ofensivo, difamatório ou que viole direitos de terceiros.',
        'Não é permitido spam, assédio, discriminação ou incitação à violência.',
        'Conteúdo que viole estes termos pode ser removido sem aviso prévio.',
        'Você concede à plataforma licença para usar, modificar e distribuir seu conteúdo conforme necessário.',
        'Respeitamos direitos autorais e respondemos a notificações DMCA válidas.',
        'Comportamento abusivo pode resultar em suspensão ou banimento da conta.'
      ]
    },
    {
      id: 'privacy',
      title: 'Privacidade e Proteção de Dados',
      icon: Lock,
      content: [
        'Coletamos e processamos dados pessoais conforme nossa Política de Privacidade.',
        'Implementamos medidas de segurança técnicas e organizacionais para proteger seus dados.',
        'Você tem direitos sobre seus dados pessoais conforme a LGPD (Lei Geral de Proteção de Dados).',
        'Não vendemos ou compartilhamos dados pessoais com terceiros para fins comerciais.',
        'Dados financeiros são criptografados e armazenados com segurança máxima.',
        'Você pode solicitar acesso, correção ou exclusão de seus dados pessoais.',
        'Notificaremos sobre violações de dados conforme exigido por lei.'
      ]
    },
    {
      id: 'intellectual',
      title: 'Propriedade Intelectual',
      icon: Shield,
      content: [
        'Todo o conteúdo da plataforma, incluindo design, código e marca, é protegido por direitos autorais.',
        'Você não pode copiar, modificar ou distribuir nosso conteúdo sem autorização expressa.',
        'Marcas registradas e logos são propriedade de seus respectivos donos.',
        'Você mantém os direitos sobre o conteúdo que cria, mas nos concede licença para operação da plataforma.',
        'Violações de propriedade intelectual serão tratadas conforme a legislação aplicável.',
        'Respeitamos os direitos de propriedade intelectual de terceiros.'
      ]
    },
    {
      id: 'liability',
      title: 'Limitação de Responsabilidade',
      icon: Scale,
      content: [
        'A plataforma é fornecida "como está" sem garantias expressas ou implícitas.',
        'Não garantimos disponibilidade ininterrupta ou ausência de erros nos serviços.',
        'Nossa responsabilidade é limitada ao valor pago pelos serviços nos últimos 12 meses.',
        'Não somos responsáveis por danos indiretos, incidentais ou consequenciais.',
        'Você usa a plataforma por sua própria conta e risco.',
        'Não somos responsáveis por ações de terceiros ou conteúdo de usuários.',
        'Limitações podem não se aplicar onde proibidas por lei.'
      ]
    },
    {
      id: 'termination',
      title: 'Encerramento',
      icon: UserX,
      content: [
        'Você pode encerrar sua conta a qualquer momento através das configurações.',
        'Podemos suspender ou encerrar contas que violem estes termos.',
        'Após o encerramento, alguns dados podem ser mantidos conforme exigências legais.',
        'Obrigações financeiras permanecem válidas após o encerramento da conta.',
        'Disposições sobre propriedade intelectual e limitação de responsabilidade sobrevivem ao encerramento.',
        'Dados pessoais serão tratados conforme nossa Política de Privacidade após encerramento.'
      ]
    },
    {
      id: 'changes',
      title: 'Alterações nos Termos',
      icon: Clock,
      content: [
        'Reservamo-nos o direito de modificar estes termos a qualquer momento.',
        'Alterações significativas serão notificadas com pelo menos 30 dias de antecedência.',
        'Continuação do uso após alterações constitui aceitação dos novos termos.',
        'Versões anteriores dos termos ficam disponíveis para consulta.',
        'Alterações entram em vigor na data especificada na notificação.',
        'Você pode encerrar sua conta se não concordar com as alterações.'
      ]
    },
    {
      id: 'legal',
      title: 'Disposições Legais',
      icon: Gavel,
      content: [
        'Estes termos são regidos pelas leis da República Federativa do Brasil.',
        'Disputas serão resolvidas nos tribunais competentes do Brasil.',
        'Se alguma disposição for considerada inválida, as demais permanecem em vigor.',
        'Estes termos constituem o acordo completo entre as partes.',
        'Não renúncia a direitos será considerada válida a menos que por escrito.',
        'Você não pode transferir seus direitos ou obrigações sob estes termos.',
        'Tentaremos resolver disputas através de mediação antes de litígio.'
      ]
    }
  ];

  return (
    <>
      <Helmet>
        <title>Termos de Uso - GOV.RP</title>
        <meta name="description" content="Termos de Uso completos da plataforma GOV.RP. Leia atentamente antes de usar nossos serviços." />
      </Helmet>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-12">
            <FileText className="mx-auto h-16 w-16 text-blue-400 mb-6" />
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Termos de <span className="gradient-text">Uso</span>
            </h1>
            <p className="text-lg text-gray-300 max-w-3xl mx-auto">
              Estes Termos de Uso estabelecem as regras e condições para o uso da plataforma GOV.RP. 
              Por favor, leia atentamente antes de usar nossos serviços.
            </p>
            <div className="mt-6 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <p className="text-yellow-400 text-sm">
                <strong>Última atualização:</strong> 20 de junho de 2025
              </p>
            </div>
          </div>

          <div className="space-y-8">
            {sections.map((section, index) => (
              <motion.div
                key={section.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="border-slate-700/50 bg-black/20">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-3">
                      <section.icon className="h-6 w-6 text-blue-400" />
                      {section.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {section.content.map((item, itemIndex) => (
                        <p key={itemIndex} className="text-gray-300 leading-relaxed">
                          {item}
                        </p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card className="border-slate-700/50 bg-black/20 mt-12">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-yellow-400" />
                Informações Importantes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <h4 className="font-semibold text-blue-400 mb-2">📞 Contato Legal</h4>
                  <p className="text-gray-300 text-sm">
                    Para questões legais ou dúvidas sobre estes termos, entre em contato através do 
                    formulário em /contact ou envie um email para legal@gov.rp
                  </p>
                </div>
                
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <h4 className="font-semibold text-green-400 mb-2">🔒 Segurança</h4>
                  <p className="text-gray-300 text-sm">
                    Reporte vulnerabilidades de segurança para security@gov.rp. 
                    Temos um programa de divulgação responsável para pesquisadores de segurança.
                  </p>
                </div>
                
                <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <h4 className="font-semibold text-purple-400 mb-2">📋 Conformidade</h4>
                  <p className="text-gray-300 text-sm">
                    Estamos em conformidade com LGPD, regulamentações bancárias do Banco Central 
                    e outras leis aplicáveis no Brasil.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="text-center mt-12 p-6 bg-slate-800/50 rounded-lg">
            <p className="text-gray-400 text-sm">
              Ao continuar usando a plataforma GOV.RP, você confirma que leu, entendeu e concorda 
              com estes Termos de Uso em sua totalidade.
            </p>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Terms;
