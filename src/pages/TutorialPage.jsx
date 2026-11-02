import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { BookOpen, Landmark, FileText, MessageSquare, Scale, Shield, UserPlus, Briefcase, Info, AlertTriangle, User } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const tutorialSections = [
  {
    icon: UserPlus,
    title: '1. Conta, Personagem e Cidadania',
    content: [
      {
        subTitle: 'Conta privada (OOC)',
        description: 'O cadastro cria a conta da pessoa real: nome real, e-mail, telefone, senha e autenticação. Esses dados são privados e nunca se tornam automaticamente o nome público do personagem.',
      },
      {
        subTitle: 'Personagem (IC)',
        description: 'No Registro Nacional de Cidadania você escolhe separadamente nome civil, nascimento, avatar, biografia, origem, residência e aspiração do personagem que irá interpretar.',
      },
      {
        subTitle: 'Cidadão institucional',
        description: 'Depois da identidade do personagem, o GOVRP emite CPF, RG, Título de Eleitor e Carteira de Trabalho, preserva ou abre a conta bancária e concede oficialmente a cidadania.',
      },
      {
        subTitle: 'O Dashboard: Seu Centro de Comando',
        description: 'O Dashboard é sua página inicial personalizada. Nela, você terá uma visão geral de suas finanças, status político, notificações e atalhos para todos os serviços essenciais. Pense nele como seu escritório virtual.',
      },
    ],
  },
  {
    icon: Landmark,
    title: '2. Vida Financeira: O Banco Nacional',
    content: [
      {
        subTitle: 'Abrindo sua Conta',
        description: 'A conta é preservada para cidadãos antigos e aberta de forma idempotente para novos cidadãos durante o registro. Ao concluir a cidadania e abrir a conta bancária, o crédito inicial de R$ 1.000,00 é concedido automaticamente e registrado no extrato.',
      },
      {
        subTitle: 'Transferências e Cartões',
        description: 'Com sua conta, você pode transferir dinheiro para outros cidadãos, pagar por produtos e serviços. Você também pode solicitar cartões de crédito para ter mais poder de compra.',
      },
      {
        subTitle: 'Investimentos',
        description: 'Faça seu dinheiro trabalhar para você! O Banco Nacional oferece opções de investimento para aumentar seu patrimônio ao longo do tempo. Analise as opções e invista com sabedoria.',
      },
    ],
  },
  {
    icon: FileText,
    title: '3. Identidade e Cidadania: O DIC',
    content: [
      {
        subTitle: 'Documentos Essenciais',
        description: 'O Departamento de Identificação Civil (DIC) é a fonte de verdade dos documentos. CPF e RG são emitidos pelo backend durante o Registro Nacional; Título e Carteira de Trabalho completam a cidadania. CNH, Passaporte e outros documentos continuam como progressão posterior.',
      },
    ],
  },
  {
    icon: MessageSquare,
    title: '4. A Vida Social: Rede X',
    content: [
      {
        subTitle: 'Criando seu Perfil Social',
        description: 'O X é a nossa rede social integrada. O primeiro passo é criar seu perfil, escolhendo um nome de usuário e um @handle únicos. É aqui que você construirá sua imagem pública.',
      },
      {
        subTitle: 'Interagindo e Crescendo',
        description: 'Poste suas ideias, compartilhe notícias, siga outros cidadãos e participe de debates. O X é a principal ferramenta para ganhar influência, formar alianças e se manter informado sobre tudo que acontece na nação.',
      },
    ],
  },
  {
    icon: Scale,
    title: '5. O Jogo Político: Governança',
    content: [
      {
        subTitle: 'Partidos Políticos',
        description: 'Para participar ativamente da política, você pode fundar seu próprio partido ou se filiar a um já existente. Partidos são a base para lançar candidaturas e formar blocos de poder.',
      },
      {
        subTitle: 'Eleições e Parlamento',
        description: 'Participe das eleições para eleger Presidente e Vice-Presidente em chapa conjunta, além de deputados e senadores. Se você for eleito para o Parlamento, poderá propor, debater e votar em leis; se chegar ao Executivo, poderá sancionar, vetar, promulgar e editar medidas provisórias dentro dos limites constitucionais.',
      },
    ],
  },
  {
    icon: Briefcase,
    title: '6. Empreendedorismo: Negócios Livres',
    content: [
      {
        subTitle: 'O Marketplace',
        description: 'Se sua vocação é o comércio, o serviço "Negócios Livres" é o seu lugar. Anuncie produtos, ofereça serviços e construa seu império empresarial. A economia é movida por cidadãos como você.',
      },
    ],
  },
  {
    icon: Info,
    title: '7. Regras e Dicas Importantes',
    content: [
      {
        subTitle: 'Roleplay Acima de Tudo',
        description: 'Lembre-se que o GOV.RP é um ambiente de Roleplay. Aja e tome decisões como seu personagem faria. Interpretação é a chave para uma experiência imersiva.',
      },
      {
        subTitle: 'Metagaming e Powergaming',
        description: 'É estritamente proibido usar informações de fora do jogo (OOC - Out of Character) para obter vantagens no jogo (IC - In Character). Da mesma forma, é proibido forçar ações sobre outros jogadores sem dar a eles a chance de reagir. Jogue limpo!',
      },
    ],
  },
];


const TutorialPage = () => {
  return (
    <>
      <Helmet>
        <title>Tutorial - GOV.RP</title>
        <meta name="description" content="Um guia completo para iniciar sua jornada no GOV.RP. Aprenda sobre todos os sistemas e funcionalidades da plataforma." />
      </Helmet>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={BookOpen}
          title="Guia do"
          gradientText="Cidadão"
          description="Este é o manual completo para sua jornada no GOV.RP. Siga os passos e torne-se um mestre de nossos sistemas."
          iconColor="text-blue-400"
          centered={true}
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-8"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [Shield, 'Conta', 'Dados reais e privados · OOC'],
              [User, 'Personagem', 'Identidade interpretada · IC'],
              [FileText, 'Cidadania', 'Documentos e situação institucional'],
            ].map(([Icon, title, description], index) => (
              <div key={title} className="glass-effect rounded-xl border border-white/10 p-5">
                <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-300">{index + 1}</span><Icon className="h-5 w-5 text-emerald-400" /></div>
                <h2 className="mt-4 font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
          <div className="glass-effect p-6 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
              <div className="flex items-center gap-3">
                  <AlertTriangle className="w-8 h-8 text-yellow-400 flex-shrink-0" />
                  <div>
                      <h3 className="font-bold text-yellow-300">Recomendação Importante</h3>
                      <p className="text-sm text-yellow-400/80">Recomendamos que você siga os passos na ordem apresentada para uma melhor compreensão da plataforma, especialmente se for seu primeiro contato com o GOV.RP.</p>
                  </div>
              </div>
          </div>
          
          <Accordion type="single" collapsible className="w-full space-y-4">
            {tutorialSections.map((section) => (
              <AccordionItem key={section.title} value={section.title} className="glass-effect rounded-lg border-border overflow-hidden">
                <AccordionTrigger className="p-4 hover:bg-accent/50 text-lg font-bold">
                  <div className="flex items-center gap-4">
                    <section.icon className="w-6 h-6 text-primary" />
                    <span>{section.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="p-6 pt-2 bg-background/50">
                  <div className="space-y-6">
                    {section.content.map(item => (
                      <div key={item.subTitle} className="pl-6 border-l-2 border-primary/30">
                        <h4 className="font-semibold text-foreground text-md mb-1">{item.subTitle}</h4>
                        <p className="text-muted-foreground text-sm leading-relaxed">{item.description}</p>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

        </motion.div>
      </div>
    </>
  );
};

export default TutorialPage;
