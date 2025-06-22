
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  FileText, 
  Users, 
  CreditCard, 
  MessageSquare, 
  Building, 
  Shield, 
  Settings, 
  HelpCircle,
  BookOpen,
  Zap,
  Globe,
  Lock,
  Smartphone,
  Database,
  Code,
  Lightbulb,
  Target,
  CheckCircle,
  AlertCircle,
  Info
} from 'lucide-react';

const Documentation = () => {
  const sections = [
    {
      id: 'getting-started',
      title: 'Primeiros Passos',
      icon: Zap,
      content: [
        {
          title: 'Criando sua Conta',
          description: 'Aprenda como se registrar na plataforma GOV.RP e configurar seu perfil inicial.',
          steps: [
            'Acesse a página de registro em /register',
            'Preencha todos os campos obrigatórios: nome completo, email, telefone, data de nascimento, RG e CPF',
            'Escolha um nome de usuário único que será seu identificador na plataforma',
            'Confirme seu email através do link enviado para sua caixa de entrada',
            'Faça login e complete seu perfil com informações adicionais se necessário'
          ]
        },
        {
          title: 'Navegação Básica',
          description: 'Entenda como navegar pela interface e acessar os diferentes serviços.',
          steps: [
            'Use o menu superior para acessar as principais seções da plataforma',
            'O dashboard pessoal mostra um resumo de todas suas atividades',
            'Cada serviço possui sua própria área dedicada com funcionalidades específicas',
            'Use o sistema de notificações para acompanhar atualizações importantes',
            'Configure suas preferências através do menu de configurações'
          ]
        }
      ]
    },
    {
      id: 'services',
      title: 'Serviços Disponíveis',
      icon: Globe,
      content: [
        {
          title: 'Banco Nacional',
          description: 'Sistema bancário completo integrado à plataforma.',
          features: [
            'Abertura de conta corrente gratuita com saldo inicial de R$ 1.000',
            'Transferências instantâneas entre usuários da plataforma',
            'Solicitação de cartões de crédito Visa e Mastercard',
            'Sistema de investimentos com diferentes opções de risco',
            'Empréstimos pessoais com análise automática de crédito',
            'Histórico completo de transações e extratos detalhados'
          ],
          usage: [
            'Acesse /services/bank para abrir sua conta',
            'Use CPF ou dados bancários para transferências',
            'Solicite até 2 cartões (um de cada bandeira)',
            'Monitore seus gastos através do painel de controle'
          ]
        },
        {
          title: 'Social X',
          description: 'Rede social para interação entre cidadãos.',
          features: [
            'Criação de perfil personalizado com @handle único',
            'Publicação de posts com texto e imagens',
            'Sistema de curtidas, comentários e retweets',
            'Respostas aninhadas para discussões organizadas',
            'Trending topics baseados em hashtags',
            'Sistema de seguidores e seguindo',
            'Notificações em tempo real para interações'
          ],
          usage: [
            'Crie seu perfil X na primeira visita ao serviço',
            'Escolha um @handle único (mínimo 4 caracteres)',
            'Publique conteúdo relevante e interaja com outros usuários',
            'Use hashtags para participar de tendências'
          ]
        },
        {
          title: 'DIC - Documentos Digitais',
          description: 'Gerenciamento de documentos oficiais digitais.',
          features: [
            'Armazenamento seguro de documentos pessoais',
            'Geração automática de CPF e RG digitais',
            'Solicitação de segundas vias de documentos',
            'Validação digital de autenticidade',
            'Histórico de emissões e renovações',
            'Compartilhamento seguro com terceiros'
          ],
          usage: [
            'Seus documentos são criados automaticamente no registro',
            'Acesse /services/dic para visualizar e gerenciar',
            'Solicite segundas vias quando necessário',
            'Use os documentos digitais como comprovação oficial'
          ]
        },
        {
          title: 'Negócios Livres',
          description: 'Marketplace para comércio entre usuários.',
          features: [
            'Cadastro de produtos e serviços para venda',
            'Sistema de busca e categorização avançado',
            'Avaliações e comentários de compradores',
            'Integração com o sistema bancário para pagamentos',
            'Gestão de estoque e pedidos',
            'Relatórios de vendas e performance'
          ],
          usage: [
            'Cadastre seus produtos com descrições detalhadas',
            'Use imagens de alta qualidade para atrair compradores',
            'Responda rapidamente às dúvidas dos interessados',
            'Mantenha seu estoque sempre atualizado'
          ]
        }
      ]
    },
    {
      id: 'security',
      title: 'Segurança e Privacidade',
      icon: Shield,
      content: [
        {
          title: 'Proteção de Dados',
          description: 'Como protegemos suas informações pessoais e financeiras.',
          measures: [
            'Criptografia end-to-end para todas as comunicações',
            'Armazenamento seguro com backup automático',
            'Autenticação de dois fatores disponível',
            'Monitoramento 24/7 contra atividades suspeitas',
            'Conformidade com LGPD e regulamentações internacionais',
            'Auditoria regular de segurança por terceiros'
          ]
        },
        {
          title: 'Boas Práticas',
          description: 'Recomendações para manter sua conta segura.',
          tips: [
            'Use senhas fortes com pelo menos 8 caracteres',
            'Nunca compartilhe suas credenciais de acesso',
            'Mantenha seu email de recuperação atualizado',
            'Verifique regularmente suas transações bancárias',
            'Reporte imediatamente qualquer atividade suspeita',
            'Faça logout ao usar computadores públicos'
          ]
        }
      ]
    },
    {
      id: 'technical',
      title: 'Informações Técnicas',
      icon: Code,
      content: [
        {
          title: 'Arquitetura da Plataforma',
          description: 'Detalhes técnicos sobre como a plataforma funciona.',
          details: [
            'Frontend desenvolvido em React 18 com Vite',
            'Backend serverless usando Supabase',
            'Banco de dados PostgreSQL com Row Level Security',
            'Autenticação JWT com refresh tokens',
            'Storage de arquivos com CDN global',
            'API REST com rate limiting e cache'
          ]
        },
        {
          title: 'Integrações',
          description: 'Serviços externos integrados à plataforma.',
          integrations: [
            'Supabase para backend e autenticação',
            'Stripe para processamento de pagamentos',
            'Unsplash para imagens de alta qualidade',
            'Dicebear para avatars personalizados',
            'Framer Motion para animações fluidas',
            'TailwindCSS para design responsivo'
          ]
        }
      ]
    },
    {
      id: 'api',
      title: 'API e Desenvolvimento',
      icon: Database,
      content: [
        {
          title: 'Endpoints Principais',
          description: 'Principais endpoints da API para desenvolvedores.',
          endpoints: [
            'GET /api/profiles - Listar perfis de usuários',
            'POST /api/posts - Criar nova publicação',
            'GET /api/transactions - Histórico de transações',
            'POST /api/transfer - Realizar transferência bancária',
            'GET /api/documents - Listar documentos do usuário',
            'POST /api/products - Cadastrar produto no marketplace'
          ]
        },
        {
          title: 'Autenticação',
          description: 'Como autenticar requisições à API.',
          auth: [
            'Todas as requisições requerem token JWT válido',
            'Token deve ser enviado no header Authorization',
            'Formato: "Bearer {seu_token_jwt}"',
            'Tokens expiram em 1 hora e devem ser renovados',
            'Use refresh token para obter novos access tokens',
            'Rate limit de 100 requisições por minuto por usuário'
          ]
        }
      ]
    },
    {
      id: 'troubleshooting',
      title: 'Solução de Problemas',
      icon: HelpCircle,
      content: [
        {
          title: 'Problemas Comuns',
          description: 'Soluções para os problemas mais frequentes.',
          issues: [
            {
              problem: 'Não consigo fazer login',
              solution: 'Verifique se seu email está confirmado. Tente redefinir sua senha se necessário.'
            },
            {
              problem: 'Transferência não foi processada',
              solution: 'Verifique se você tem saldo suficiente e se os dados do destinatário estão corretos.'
            },
            {
              problem: 'Não recebo notificações',
              solution: 'Verifique suas configurações de notificação no menu de configurações.'
            },
            {
              problem: 'Erro ao carregar página',
              solution: 'Limpe o cache do navegador ou tente acessar em modo anônimo.'
            },
            {
              problem: 'Upload de imagem falha',
              solution: 'Verifique se a imagem tem menos de 5MB e está em formato JPG, PNG ou WebP.'
            }
          ]
        },
        {
          title: 'Contato e Suporte',
          description: 'Como obter ajuda quando necessário.',
          support: [
            'Use o formulário de contato em /contact para dúvidas gerais',
            'Reporte bugs através do sistema de feedback integrado',
            'Consulte o FAQ em /faq para respostas rápidas',
            'Entre em contato com suporte técnico para problemas críticos',
            'Participe da comunidade em /community para discussões',
            'Acompanhe atualizações e novidades em /news'
          ]
        }
      ]
    }
  ];

  return (
    <>
      <Helmet>
        <title>Documentação - GOV.RP</title>
        <meta name="description" content="Documentação completa da plataforma GOV.RP com guias, tutoriais e referências técnicas." />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-12">
            <BookOpen className="mx-auto h-16 w-16 text-blue-400 mb-6" />
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
              Documentação <span className="gradient-text">Completa</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              Guia abrangente para usar todos os recursos da plataforma GOV.RP. 
              Desde os primeiros passos até funcionalidades avançadas.
            </p>
          </div>

          <Tabs defaultValue="getting-started" className="w-full">
            <TabsList className="grid w-full grid-cols-2 lg:grid-cols-6 mb-8">
              {sections.map((section) => (
                <TabsTrigger key={section.id} value={section.id} className="flex items-center gap-2">
                  <section.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{section.title}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            {sections.map((section) => (
              <TabsContent key={section.id} value={section.id} className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <section.icon className="h-8 w-8 text-blue-400" />
                  <h2 className="text-3xl font-bold text-white">{section.title}</h2>
                </div>

                <div className="grid gap-6">
                  {section.content.map((item, index) => (
                    <Card key={index} className="border-slate-700/50 bg-black/20">
                      <CardHeader>
                        <CardTitle className="text-white flex items-center gap-2">
                          <Target className="h-5 w-5 text-blue-400" />
                          {item.title}
                        </CardTitle>
                        <p className="text-gray-300">{item.description}</p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {item.steps && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <CheckCircle className="h-4 w-4 text-green-400" />
                              Passo a Passo
                            </h4>
                            <ol className="space-y-2">
                              {item.steps.map((step, stepIndex) => (
                                <li key={stepIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                    {stepIndex + 1}
                                  </span>
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}

                        {item.features && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Lightbulb className="h-4 w-4 text-yellow-400" />
                              Funcionalidades
                            </h4>
                            <ul className="space-y-2">
                              {item.features.map((feature, featureIndex) => (
                                <li key={featureIndex} className="flex items-start gap-3 text-gray-300">
                                  <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                                  <span>{feature}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.usage && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Info className="h-4 w-4 text-blue-400" />
                              Como Usar
                            </h4>
                            <ul className="space-y-2">
                              {item.usage.map((use, useIndex) => (
                                <li key={useIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-blue-400">•</span>
                                  <span>{use}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.measures && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Shield className="h-4 w-4 text-green-400" />
                              Medidas de Segurança
                            </h4>
                            <ul className="space-y-2">
                              {item.measures.map((measure, measureIndex) => (
                                <li key={measureIndex} className="flex items-start gap-3 text-gray-300">
                                  <Lock className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                                  <span>{measure}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.tips && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-yellow-400" />
                              Dicas Importantes
                            </h4>
                            <ul className="space-y-2">
                              {item.tips.map((tip, tipIndex) => (
                                <li key={tipIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-yellow-400">⚠️</span>
                                  <span>{tip}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.details && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Code className="h-4 w-4 text-purple-400" />
                              Detalhes Técnicos
                            </h4>
                            <ul className="space-y-2">
                              {item.details.map((detail, detailIndex) => (
                                <li key={detailIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-purple-400">▶</span>
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.integrations && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Globe className="h-4 w-4 text-blue-400" />
                              Integrações
                            </h4>
                            <ul className="space-y-2">
                              {item.integrations.map((integration, integrationIndex) => (
                                <li key={integrationIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-blue-400">🔗</span>
                                  <span>{integration}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.endpoints && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Database className="h-4 w-4 text-green-400" />
                              Endpoints da API
                            </h4>
                            <div className="space-y-2">
                              {item.endpoints.map((endpoint, endpointIndex) => (
                                <div key={endpointIndex} className="bg-slate-800/50 p-3 rounded-lg">
                                  <code className="text-green-400 text-sm">{endpoint}</code>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {item.auth && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Lock className="h-4 w-4 text-red-400" />
                              Autenticação
                            </h4>
                            <ul className="space-y-2">
                              {item.auth.map((authItem, authIndex) => (
                                <li key={authIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-red-400">🔐</span>
                                  <span>{authItem}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.issues && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <HelpCircle className="h-4 w-4 text-orange-400" />
                              Problemas e Soluções
                            </h4>
                            <div className="space-y-4">
                              {item.issues.map((issue, issueIndex) => (
                                <div key={issueIndex} className="bg-slate-800/50 p-4 rounded-lg">
                                  <h5 className="font-medium text-orange-400 mb-2">❓ {issue.problem}</h5>
                                  <p className="text-gray-300">✅ {issue.solution}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {item.support && (
                          <div>
                            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
                              <Users className="h-4 w-4 text-blue-400" />
                              Canais de Suporte
                            </h4>
                            <ul className="space-y-2">
                              {item.support.map((supportItem, supportIndex) => (
                                <li key={supportIndex} className="flex items-start gap-3 text-gray-300">
                                  <span className="text-blue-400">📞</span>
                                  <span>{supportItem}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <Card className="border-slate-700/50 bg-black/20 mt-12">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-green-400" />
                Atualizações e Melhorias
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-300 mb-4">
                A plataforma GOV.RP está em constante evolução. Acompanhe as novidades:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="font-medium text-white mb-2">📱 Aplicativo Mobile</h4>
                  <p className="text-sm text-gray-400">Em desenvolvimento para iOS e Android</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="font-medium text-white mb-2">🤖 IA Integrada</h4>
                  <p className="text-sm text-gray-400">Assistente virtual para suporte</p>
                </div>
                <div className="bg-slate-800/50 p-4 rounded-lg">
                  <h4 className="font-medium text-white mb-2">🌐 API Pública</h4>
                  <p className="text-sm text-gray-400">Para desenvolvedores terceiros</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
};

export default Documentation;
