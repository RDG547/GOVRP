import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import {
  Bot,
  Cookie,
  Database,
  Eye,
  FileText,
  Globe,
  Lock,
  Mail,
  Settings,
  Shield,
  UserCheck,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';

const sections = [
  {
    icon: Database,
    title: 'Dados que Tratamos',
    content: [
      'Cadastro e conta: nome, nome de personagem, nome de usuário, e-mail, telefone, data de nascimento, avatar e identificadores internos.',
      'Documentos virtuais do RP: CPF, RG e outros identificadores gerados ou informados exclusivamente para as mecânicas da plataforma; eles não substituem documentos oficiais.',
      'Conteúdo e comunicações: posts, comentários, mensagens, arquivos, tickets, notícias, leis, decretos, votos e demais interações.',
      'Atividade econômica virtual: saldos, pagamentos, empresas, empregos, produtos, investimentos, tributos e eventos usados pelo motor econômico do RP.',
      'Dados políticos do RP: partido, ideologia declarada, candidaturas, cargos, votos quando públicos e atos institucionais. Essas informações podem revelar opinião ou filiação política e recebem proteção compatível com sua natureza.',
      'Dados técnicos e de segurança: endereço IP, sessão, navegador, dispositivo, sistema operacional, registros de acesso, falhas, auditoria e sinais de abuso.',
    ],
  },
  {
    icon: Eye,
    title: 'Finalidades do Tratamento',
    content: [
      'Criar e autenticar contas, manter sessões, recuperar senhas e proteger o acesso.',
      'Executar a simulação política, social, jurídica e econômica, incluindo cálculos e atualizações em tempo real.',
      'Publicar perfis e atividades que, pela natureza da funcionalidade, integram o espaço público do RP.',
      'Prestar contato e suporte, receber anexos, responder solicitações e investigar incidentes.',
      'Prevenir fraude, contas duplicadas, abuso, acesso indevido, manipulação de votações e violações das regras.',
      'Medir desempenho e uso, quando autorizado, desenvolver recursos e corrigir problemas.',
      'Cumprir obrigações legais, ordens válidas e exercer ou defender direitos.',
    ],
  },
  {
    icon: FileText,
    title: 'Bases Legais',
    content: [
      'Execução dos Termos e de procedimentos solicitados por você, para fornecer a conta e as funcionalidades escolhidas.',
      'Consentimento, quando a legislação exigir ou quando o recurso for opcional, como medição de uso não essencial.',
      'Legítimo interesse, após avaliação de necessidade e impacto, para segurança, prevenção a abusos e melhoria do serviço.',
      'Cumprimento de obrigação legal ou regulatória, exercício regular de direitos e proteção contra fraude.',
      'Dados de natureza política são tratados somente no contexto das funcionalidades escolhidas pelo jogador, da publicidade inerente ao cargo/ato do RP ou de outra hipótese legal aplicável.',
    ],
  },
  {
    icon: Users,
    title: 'Visibilidade e Conteúdo Público',
    content: [
      'Nome de personagem, avatar, nome de usuário, publicações, partidos, candidaturas, cargos e atos públicos do RP podem ser vistos por outros usuários e visitantes conforme a funcionalidade.',
      'Mensagens privadas, credenciais e informações marcadas como restritas não são exibidas publicamente, salvo autorização, necessidade de segurança ou obrigação legal.',
      'Antes de publicar, evite inserir endereços, documentos reais, dados bancários, informações de saúde ou dados pessoais de terceiros.',
      'A exclusão da conta não implica necessariamente apagar atos públicos do RP que precisem permanecer como registro institucional; quando possível, eles serão desassociados ou minimizados.',
    ],
  },
  {
    icon: Globe,
    title: 'Operadores, Compartilhamento e Transferência Internacional',
    content: [
      'Utilizamos prestadores para autenticação, banco de dados, atualização em tempo real, armazenamento e funções de backend, incluindo Supabase.',
      'A aplicação e a medição opcional de uso podem ser processadas pela Vercel. Pagamentos de apoio são processados pela Stripe, que recebe os dados necessários ao pagamento; o GOV.RP não armazena o número completo do cartão.',
      'Provedores de login social recebem e fornecem os dados necessários à autenticação conforme a opção escolhida.',
      'Dados podem ser compartilhados com autoridades ou terceiros quando houver obrigação legal, ordem válida, emergência, investigação de fraude ou necessidade de proteger direitos.',
      'Como alguns prestadores operam fora do Brasil, pode ocorrer transferência internacional com as salvaguardas contratuais, técnicas e legais aplicáveis.',
      'Não vendemos dados pessoais nem os disponibilizamos a anunciantes para criação de perfis comerciais.',
    ],
  },
  {
    icon: Cookie,
    title: 'Cookies, Sessão e Armazenamento Local',
    content: [
      'Recursos essenciais guardam tokens de autenticação, preferências de tema, carrinho virtual, avisos já visualizados e escolhas de privacidade no navegador ou no armazenamento seguro disponibilizado pelo ambiente do app.',
      'A medição de uso da Vercel Analytics somente é carregada quando você escolhe aceitar essa categoria no aviso de privacidade.',
      'Selecionar “Somente essenciais” não impede login, navegação nem uso das principais funcionalidades.',
      'Você pode apagar os dados locais nas configurações do navegador ou do sistema, mas isso pode encerrar a sessão e redefinir preferências.',
    ],
  },
  {
    icon: Bot,
    title: 'Cálculos e Decisões Automatizadas do RP',
    content: [
      'O motor da plataforma combina eventos reais do jogo com componentes simulados para calcular indicadores, elegibilidade, consequências econômicas e estados de serviços.',
      'Esses resultados produzem efeitos apenas dentro do RP e não definem crédito, emprego, benefícios, direitos políticos ou situação jurídica no mundo real.',
      'Você pode solicitar explicação ou revisão de uma decisão automatizada que afete de modo relevante sua participação na plataforma.',
    ],
  },
  {
    icon: Lock,
    title: 'Segurança e Incidentes',
    content: [
      'Adotamos medidas proporcionais ao risco, como conexões protegidas, autenticação, controles de acesso, regras por linha no banco de dados, validação de arquivos, registros de auditoria e separação de privilégios.',
      'Nenhum sistema é totalmente invulnerável. Por isso, medidas e dependências são revistas e incidentes são tratados conforme seu risco e as obrigações aplicáveis.',
      'Não envie senhas, códigos de autenticação ou dados completos de cartão em posts, mensagens ou tickets.',
      'Comunique imediatamente atividades suspeitas pela Central de Contato e Suporte.',
    ],
  },
  {
    icon: Settings,
    title: 'Retenção e Exclusão',
    content: [
      'Dados de conta e do RP são mantidos enquanto a conta estiver ativa e pelo período necessário às finalidades descritas.',
      'Após exclusão, podemos preservar por prazo limitado registros necessários para segurança, prevenção de fraude, cumprimento legal e exercício de direitos.',
      'Backups e caches seguem ciclos próprios de sobrescrita. Dados anonimizados, que não permitam reidentificação razoável, podem ser mantidos para estatística e integridade histórica.',
      'A solicitação de exclusão pode ser feita pela página pública de exclusão de conta ou pela Central de Contato e Suporte.',
    ],
  },
  {
    icon: UserCheck,
    title: 'Direitos do Titular',
    content: [
      'Você pode solicitar confirmação e acesso, correção, informações sobre compartilhamento, portabilidade quando regulamentada, anonimização, bloqueio ou eliminação nos casos aplicáveis.',
      'Também pode revogar consentimento, opor-se a tratamento irregular e pedir revisão ou explicação sobre decisões automatizadas relevantes.',
      'Alguns pedidos exigem validação de identidade. Os direitos não são absolutos e podem existir fundamentos legais para preservar determinados registros.',
      'Se a resposta do GOV.RP não for satisfatória, você pode peticionar perante a Autoridade Nacional de Proteção de Dados e os órgãos competentes.',
    ],
  },
];

const principles = [
  { icon: FileText, title: 'Transparência', description: 'Finalidades, categorias e compartilhamentos descritos de forma compatível com a plataforma.' },
  { icon: Shield, title: 'Necessidade', description: 'Coleta e acesso limitados ao que cada recurso e obrigação exigem.' },
  { icon: UserCheck, title: 'Canal do Titular', description: 'Solicitações de privacidade recebidas pela central unificada e pela exclusão de conta.' },
  { icon: Globe, title: 'Fornecedores Globais', description: 'Uso de operadores internacionais com salvaguardas compatíveis com a LGPD.' },
];

const Privacy = () => (
  <>
    <Helmet>
      <title>Política de Privacidade - GOV.RP</title>
      <meta name="description" content="Como o GOV.RP trata dados na web, PWA, aplicativos, simulação política, economia, comunidade e suporte." />
    </Helmet>

    <div className="min-h-screen py-20">
      <section className="mx-auto mb-20 max-w-4xl px-4 sm:px-6 lg:px-8">
        <PageHeader
          icon={Shield}
          title="Política de"
          gradientText="Privacidade"
          description="Como seus dados são tratados no ecossistema GOV.RP, da web aos aplicativos móveis."
          iconColor="text-red-400"
          centered
        />
        <div className="mt-6 rounded-lg bg-white/5 p-4 text-sm text-gray-400">
          <p><strong>Última atualização:</strong> 14 de agosto de 2026</p>
          <p><strong>Versão:</strong> 2.0 | <strong>Legislação principal:</strong> LGPD e Marco Civil da Internet</p>
          <p><strong>Responsável pelo tratamento:</strong> equipe operadora do projeto GOV.RP | <strong>Canal:</strong> suporte@govrp.online</p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="space-y-12">
          {sections.map((section, index) => (
            <motion.article
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.04 }}
              className="glass-effect rounded-2xl p-8"
            >
              <div className="mb-6 flex items-center">
                <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-green-600 to-blue-600">
                  <section.icon className="h-6 w-6 text-white" />
                </div>
                <h2 className="text-2xl font-bold text-white">{section.title}</h2>
              </div>
              <div className="space-y-4">
                {section.content.map((item) => (
                  <div key={item} className="flex items-start space-x-3">
                    <div className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                    <p className="leading-relaxed text-gray-300">{item}</p>
                  </div>
                ))}
              </div>
            </motion.article>
          ))}
        </div>

        <div className="glass-effect mt-12 rounded-2xl p-8">
          <h2 className="mb-6 text-2xl font-bold text-white">Compromissos de Proteção de Dados</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {principles.map((item) => (
              <div key={item.title} className="rounded-lg bg-white/5 p-4">
                <div className="mb-3 flex items-center">
                  <item.icon className="mr-2 h-5 w-5 text-green-400" />
                  <h3 className="font-semibold text-white">{item.title}</h3>
                </div>
                <p className="text-sm text-gray-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-effect mt-12 rounded-2xl p-8 text-center">
          <h2 className="mb-3 text-2xl font-bold text-white">Exerça seus direitos</h2>
          <p className="mb-6 text-gray-300">
            O canal de privacidade do projeto é <a href="mailto:suporte@govrp.online" className="text-blue-300 hover:underline">suporte@govrp.online</a>. Use o assunto “Privacidade/LGPD”.
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link to="/support" className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 font-medium text-white">
              <Mail className="mr-2 h-5 w-5" /> Contato e Suporte
            </Link>
            <Link to="/account-deletion" className="inline-flex items-center justify-center rounded-lg border border-white/20 px-6 py-3 font-medium text-white hover:bg-white/10">
              <Settings className="mr-2 h-5 w-5" /> Excluir minha conta
            </Link>
          </div>
        </div>
      </section>
    </div>
  </>
);

export default Privacy;
