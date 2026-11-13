import React from 'react';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import {
  AlertTriangle,
  Coins,
  Database,
  FileText,
  Gavel,
  Globe,
  Mail,
  Scale,
  Shield,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/layout/PageHeader';

const sections = [
  {
    icon: Globe,
    title: 'Natureza do GOV.RP',
    content: [
      'O GOV.RP é uma plataforma independente de simulação e roleplay político acessível pela web, como PWA e por aplicativos móveis.',
      'A plataforma não é um serviço governamental, não representa a República Federativa do Brasil e não possui vínculo com autoridades, partidos ou instituições reais.',
      'Cargos, leis, eleições, partidos, documentos, empresas, bancos, moedas e indicadores alterados pelos jogadores pertencem ao universo do RP e não produzem efeitos no mundo real.',
      'Dados reais de países são usados apenas como referência inicial e podem ser sobrepostos pela evolução da simulação.',
    ],
  },
  {
    icon: Users,
    title: 'Conta, Elegibilidade e Segurança',
    content: [
      'Você deve fornecer informações corretas, manter seus meios de autenticação protegidos e avisar o suporte ao suspeitar de acesso indevido.',
      'Cada pessoa deve utilizar uma única conta, salvo autorização expressa da administração para testes ou operação da plataforma.',
      'Não é permitido vender, ceder, compartilhar ou utilizar contas para contornar suspensões, votações, limites ou regras do jogo.',
      'O CDA pode suspender ou banir contas por infrações reais às regras da comunidade e impedir novos cadastros por identificadores associados, como e-mail, nome de usuário, nome de cidadão, IPs e instalações de navegador. Cada medida deve ter motivo registrado e pode ser submetida a revisão administrativa.',
      'A verificação de navegador não é um identificador físico infalível. O compartilhamento de IP não prova por si só a identidade de alguém; casos contestados deverão ser analisados individualmente.',
      'A plataforma é destinada a pessoas com 13 anos ou mais. Pessoas menores de idade devem observar a legislação aplicável e contar com a assistência de seu responsável quando necessário.',
    ],
  },
  {
    icon: Coins,
    title: 'Economia, Governo e Mecânicas do RP',
    content: [
      'Saldos, salários, impostos, investimentos, produtos, ações, créditos e demais valores internos são exclusivamente virtuais, sem conversão ou garantia de valor monetário real.',
      'O motor econômico pode recalcular PIB, crescimento, inflação, desemprego, juros, câmbio e outros indicadores conforme a atividade dos jogadores.',
      'Decisões de presidentes, parlamentares, magistrados, ministros, empresários e demais cargos são mecânicas de jogo sujeitas a regras, auditoria, moderação e correção técnica.',
      'Nada na plataforma constitui recomendação financeira, jurídica, eleitoral ou de investimento no mundo real.',
    ],
  },
  {
    icon: Shield,
    title: 'Conduta e Integridade da Comunidade',
    content: [
      'Debate político no contexto do RP é permitido, mas ameaças, assédio, perseguição, discriminação, exploração sexual, incentivo a crimes e divulgação de dados pessoais de terceiros são proibidos.',
      'Também são proibidos spam, manipulação coordenada, compra de votos, automação não autorizada, fraude, exploração consciente de falhas e tentativas de comprometer contas ou infraestrutura.',
      'O uso de nomes, imagens ou narrativas de pessoas reais não pode induzir terceiros a acreditar que existe endosso, representação oficial ou identidade autêntica.',
      'Denúncias devem ser feitas pela Central de Contato e Suporte, com informações suficientes para análise.',
    ],
  },
  {
    icon: FileText,
    title: 'Conteúdo Criado pelos Usuários',
    content: [
      'Você permanece titular do conteúdo original que publicar e declara possuir os direitos necessários para utilizá-lo.',
      'Ao publicar, você concede ao GOV.RP uma licença não exclusiva, gratuita e limitada para armazenar, reproduzir, adaptar tecnicamente, moderar e exibir o conteúdo enquanto isso for necessário à operação da plataforma.',
      'Conteúdo público, como posts, perfis, candidaturas, partidos, leis e atos do RP, pode permanecer visível como registro histórico da simulação, observados pedidos válidos e a legislação aplicável.',
      'Podemos remover, restringir ou preservar conteúdo e registros quando necessário para moderação, segurança, auditoria, cumprimento legal ou proteção da comunidade.',
    ],
  },
  {
    icon: Coins,
    title: 'Apoio Financeiro e Terceiros',
    content: [
      'Contribuições financeiras de apoio ao projeto são processadas por provedores externos, como a Stripe, e não compram votos, cargos, influência política ou moeda do RP.',
      'Preços, recorrência, cancelamento e eventual reembolso são informados no fluxo de pagamento e seguem a legislação aplicável e as regras do processador.',
      'Serviços externos de autenticação, hospedagem, banco de dados, armazenamento, pagamento e fontes públicas possuem termos e políticas próprios.',
    ],
  },
  {
    icon: Database,
    title: 'Dados Reais e Disponibilidade',
    content: [
      'Indicadores econômicos, câmbio, população, território e informações políticas reais são obtidos de fontes externas redundantes e podem conter atraso, revisão, lacunas ou divergências metodológicas.',
      'O GOV.RP pode corrigir dados, reprocessar eventos, restaurar estados e alterar fórmulas para preservar consistência, segurança e equilíbrio da simulação.',
      'A plataforma é fornecida conforme disponibilidade. Atualizações, manutenções, incidentes ou dependências externas podem causar interrupções temporárias.',
    ],
  },
  {
    icon: AlertTriangle,
    title: 'Moderação, Suspensão e Encerramento',
    content: [
      'Medidas de moderação podem incluir aviso, limitação funcional, remoção de conteúdo, reversão de vantagem, suspensão ou encerramento da conta, de forma proporcional à gravidade e recorrência.',
      'Situações urgentes de segurança, fraude ou risco à comunidade podem exigir medida imediata, com revisão posterior quando cabível.',
      'O usuário pode pedir esclarecimento ou revisão pela Central de Contato e Suporte.',
      'A exclusão da conta pode ser solicitada pela página pública de exclusão, sem prejuízo da retenção legal ou de registros necessários à segurança e ao exercício de direitos.',
    ],
  },
  {
    icon: Scale,
    title: 'Responsabilidade e Legislação Aplicável',
    content: [
      'Cada usuário responde por sua conduta, conteúdo e interações. O GOV.RP não endossa automaticamente opiniões ou atos publicados por jogadores.',
      'Nenhuma disposição destes Termos exclui direitos ou responsabilidades que não possam ser afastados pela legislação brasileira.',
      'Estes Termos são regidos pelas leis brasileiras, incluindo o Marco Civil da Internet e a Lei Geral de Proteção de Dados. Eventuais controvérsias serão submetidas ao foro competente definido pela legislação aplicável.',
      'Se uma disposição for inválida, as demais permanecem em vigor na extensão permitida.',
    ],
  },
  {
    icon: Gavel,
    title: 'Alterações destes Termos',
    content: [
      'Podemos atualizar estes Termos para refletir novos recursos, aplicativos, exigências legais ou mudanças operacionais.',
      'Alterações relevantes serão informadas por meio adequado na plataforma. Quando necessário, solicitaremos nova concordância.',
      'A versão e a data de atualização exibidas nesta página identificam o texto vigente.',
    ],
  },
];

const Terms = () => (
  <>
    <Helmet>
      <title>Termos de Uso - GOV.RP</title>
      <meta name="description" content="Termos aplicáveis ao GOV.RP, sua simulação política, economia virtual, comunidade, PWA e aplicativos." />
    </Helmet>

    <div className="min-h-screen py-20">
      <section className="mx-auto mb-20 max-w-4xl px-4 sm:px-6 lg:px-8">
        <PageHeader
          icon={FileText}
          title="Termos de"
          gradientText="Uso"
          description="Regras aplicáveis ao ecossistema GOV.RP na web, no PWA e nos aplicativos móveis."
          iconColor="text-yellow-400"
          centered
        />
        <div className="mt-6 rounded-lg bg-white/5 p-4 text-sm text-gray-400">
          <p><strong>Última atualização:</strong> 14 de agosto de 2026</p>
          <p><strong>Versão:</strong> 2.0 | <strong>Vigência:</strong> a partir da publicação</p>
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
                <div className="mr-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-r from-orange-600 to-red-600">
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

        <div className="glass-effect mt-12 rounded-2xl p-8 text-center">
          <h2 className="mb-3 text-2xl font-bold text-white">Contato e documentos relacionados</h2>
          <p className="mb-6 text-gray-300">Envie dúvidas, recursos ou denúncias para nossa central unificada.</p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Link to="/support" className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 font-medium text-white">
              <Mail className="mr-2 h-5 w-5" /> Contato e Suporte
            </Link>
            <Link to="/privacy" className="inline-flex items-center justify-center rounded-lg border border-white/20 px-6 py-3 font-medium text-white hover:bg-white/10">
              <Shield className="mr-2 h-5 w-5" /> Política de Privacidade
            </Link>
          </div>
        </div>
      </section>
    </div>
  </>
);

export default Terms;
