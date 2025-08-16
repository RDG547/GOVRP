import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BookOpen, Shield, Users, Code, LifeBuoy, Server, Landmark, Briefcase, FileText, MessageSquare, Library, Archive, ArrowRight, GitBranch, HelpCircle, Scale, Gavel, Vote, Eye, ShieldCheck, Headphones, Crown, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { FaDiscord, FaWhatsapp, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';

const sections = [
  { id: 'introducao', title: 'Introdução', icon: BookOpen },
  { id: 'tutorial', title: 'Tutorial Guiado', icon: HelpCircle },
  { id: 'servicos', title: 'Serviços', icon: Server },
  { id: 'admin', title: 'Painel Admin', icon: Crown },
  { id: 'seguranca', title: 'Segurança', icon: Shield },
  { id: 'regras', title: 'Regras', icon: Users },
  { id: 'desenvolvedores', title: 'Desenvolvedores', icon: Code },
  { id: 'suporte', title: 'Suporte', icon: Headphones },
];

const ServiceCard = ({ icon: Icon, title, description, color, children }) => (
  <Dialog>
    <DialogTrigger asChild>
      <motion.div 
        whileHover={{ y: -5, scale: 1.02 }} 
        className="glass-effect p-4 rounded-lg flex items-center gap-4 border border-white/10 cursor-pointer transition-all duration-300 hover:border-blue-400/50 hover:bg-white/5"
      >
        <Icon className={`w-8 h-8 flex-shrink-0 ${color}`} />
        <div>
          <h4 className="font-bold text-white">{title}</h4>
          <p className="text-sm text-gray-400">{description}</p>
        </div>
        <ArrowRight className="w-5 h-5 text-gray-500 ml-auto group-hover:text-blue-400 transition-colors" />
      </motion.div>
    </DialogTrigger>
    <DialogContent className="glass-effect text-white border-white/20">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-2xl">
          <Icon className={`w-8 h-8 flex-shrink-0 ${color}`} />
          {title}
        </DialogTitle>
        <DialogDescription className="text-gray-300 pt-4 prose prose-invert max-w-none">
          {children}
        </DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);

const SectionContent = ({ id }) => {
  const contentMap = {
    introducao: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Bem-vindo ao GOV.RP!</h3>
        <p className="mb-4">GOV.RP é um ecossistema de Roleplay Político onde você pode criar sua própria história, governar, legislar e interagir em uma sociedade virtual complexa. Nossa plataforma foi projetada para oferecer uma experiência imersiva e realista.</p>
        <h4 className="text-xl font-semibold text-white mb-3">Primeiros Passos:</h4>
        <ol className="list-decimal list-inside space-y-3">
          <li><strong>Crie sua Conta:</strong> O primeiro passo é <Link to="/register" className="text-blue-400 hover:underline">se cadastrar</Link> e criar seu cidadão virtual.</li>
          <li><strong>Faça o Tutorial:</strong> Ao entrar pela primeira vez, um tutorial guiado irá apresentar as principais funcionalidades. Recomendamos fortemente que você o siga.</li>
          <li><strong>Explore os Serviços:</strong> Familiarize-se com os <Link to="/services" className="text-blue-400 hover:underline">serviços disponíveis</Link>. Abra sua conta bancária, solicite seus documentos e prepare-se para a vida política.</li>
          <li><strong>Defina seu Caminho:</strong> Você será um político influente, um empresário de sucesso, um jornalista investigativo ou um cidadão comum? As escolhas são suas!</li>
        </ol>
      </div>
    ),
    tutorial: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Tutorial Guiado</h3>
        <p className="mb-4">Para garantir que você comece com o pé direito, desenvolvemos um tutorial interativo que é exibido automaticamente no seu primeiro acesso. Este tour destaca os elementos mais importantes da interface e explica as funcionalidades básicas.</p>
        <h4 className="text-xl font-semibold text-white mb-3">Como funciona?</h4>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li><strong>Aparição Automática:</strong> O tutorial inicia assim que você faz login pela primeira vez.</li>
          <li><strong>"Não mostrar novamente":</strong> Durante o tutorial, você pode marcar uma caixa para que ele não apareça nos próximos logins.</li>
          <li><strong>Reativando o Tutorial:</strong> Mudou de ideia? Você pode reativar o tutorial a qualquer momento. Vá até o seu <Link to="/dashboard" className="text-blue-400 hover:underline">Dashboard</Link>, onde encontrará um interruptor para habilitar ou desabilitar a exibição do tutorial no próximo login.</li>
          <li><strong>Refazendo o Tour:</strong> Se quiser apenas rever o tutorial sem alterar suas configurações, clique no botão "Refazer Tutorial" no seu Dashboard.</li>
        </ul>
        <p>Recomendamos que todos os novos usuários completem o tutorial para uma melhor compreensão da plataforma.</p>
      </div>
    ),
    servicos: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Nossos Serviços Integrados</h3>
        <p className="mb-6">Clique em um serviço para saber mais detalhes.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ServiceCard icon={Landmark} title="Banco Nacional" description="Gerencie suas finanças, realize transferências e invista." color="text-green-400">
            <p>O Banco Nacional é o pilar da economia do GOV.RP. Ao abrir sua conta, você recebe um saldo inicial para começar sua jornada. Use o banco para:</p>
            <ul>
              <li>Guardar seu dinheiro com segurança.</li>
              <li>Realizar transferências para outros cidadãos.</li>
              <li>Solicitar cartões de crédito.</li>
              <li>Investir em fundos de rendimento para fazer seu dinheiro crescer.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Briefcase} title="Negócios Livres" description="Crie e administre sua empresa, e participe da economia." color="text-blue-400">
            <p>O serviço de Negócios Livres é o marketplace do GOV.RP. Aqui, o empreendedorismo ganha vida. Você pode:</p>
            <ul>
              <li>Registrar sua própria empresa.</li>
              <li>Anunciar produtos e serviços para toda a comunidade.</li>
              <li>Comprar itens de outros jogadores.</li>
              <li>Contratar funcionários e gerenciar sua equipe.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={FileText} title="DIC" description="Emita seus documentos oficiais, essenciais para a vida civil." color="text-purple-400">
            <p>O Departamento de Identificação Civil (DIC) é onde você gerencia sua identidade como cidadão. É essencial manter seus documentos em dia para participar plenamente da vida política e econômica.</p>
            <p>Documentos como CPF e RG são gerados no cadastro. Você também pode solicitar:</p>
            <ul>
              <li>Carteira Nacional de Habilitação (CNH) para conduzir veículos.</li>
              <li>Passaporte para viagens internacionais dentro do RP.</li>
              <li>Cadastro Nacional da Pessoa Jurídica (CNPJ) para suas empresas.</li>
              <li>Carteira de Trabalho Digital (CTD) para registros empregatícios.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={MessageSquare} title="Rede Social X" description="Compartilhe suas ideias, noticie eventos e construa sua imagem." color="text-sky-400">
            <p>X é a nossa rede social integrada, o principal canal de comunicação e debate público. Use o X para:</p>
            <ul>
              <li>Publicar suas opiniões e ideias.</li>
              <li>Seguir outros cidadãos e figuras públicas.</li>
              <li>Acompanhar as tendências e os assuntos mais comentados.</li>
              <li>Construir sua imagem pública, seja como político, empresário ou ativista.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Users} title="Partidos Políticos" description="Crie ou filie-se a um partido para participar da vida política." color="text-red-400">
            <p>A política é o coração do GOV.RP. Os partidos são a principal forma de organização política. Através deles, você pode:</p>
            <ul>
              <li>Fundar seu próprio partido com uma ideologia única.</li>
              <li>Filiar-se a um partido existente para apoiar uma causa.</li>
              <li>Lançar sua candidatura a cargos públicos.</li>
              <li>Participar de debates e formar alianças.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Scale} title="Parlamento" description="Proponha, debata e vote em projetos de lei que moldam a nação." color="text-yellow-400">
            <p>O Parlamento é o poder legislativo do nosso roleplay, dividido entre a Câmara dos Deputados e o Senado. Como parlamentar, você pode:</p>
            <ul>
              <li>Propor projetos de lei.</li>
              <li>Debater e votar em propostas de outros membros.</li>
              <li>Fiscalizar as ações do poder executivo.</li>
              <li>Representar os interesses dos seus eleitores.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Gavel} title="Sistema Penal" description="Consulte registros criminais e o status do sistema prisional." color="text-amber-400">
            <p>A justiça e a ordem são mantidas através do Sistema Penal. Este serviço permite:</p>
            <ul>
              <li>Consultar o registro criminal de qualquer cidadão.</li>
              <li>Acompanhar o status de sentenças e penas.</li>
              <li>Juízes e promotores podem gerenciar processos e condenações.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Vote} title="Eleições" description="Exerça seu direito de voto e acompanhe os resultados eleitorais." color="text-teal-400">
            <p>A democracia é exercida através do voto. No portal de Eleições, você pode:</p>
            <ul>
              <li>Verificar as eleições ativas.</li>
              <li>Conhecer os candidatos e suas propostas.</li>
              <li>Votar em seus representantes.</li>
              <li>Acompanhar a apuração dos votos em tempo real.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Shield} title="Polícia" description="Acesse os serviços do departamento de polícia e registre ocorrências." color="text-indigo-400">
            <p>O Departamento de Polícia é responsável pela segurança e ordem. O acesso ao painel é restrito a membros da corporação, que podem:</p>
            <ul>
              <li>Registrar e consultar ocorrências.</li>
              <li>Gerenciar investigações.</li>
              <li>Acessar o banco de dados de cidadãos para fins de segurança.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={Eye} title="AGIES" description="Agência de Inteligência e Espionagem Suprema (acesso restrito)." color="text-pink-400">
            <p>A AGIES atua nos bastidores para garantir a segurança nacional. O acesso é altamente restrito a agentes autorizados, que utilizam o painel para:</p>
            <ul>
              <li>Gerenciar operações de inteligência.</li>
              <li>Monitorar ameaças internas e externas.</li>
              <li>Coletar e analisar informações sigilosas.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={ShieldCheck} title="Forças Armadas" description="Painel de controle e informações das Forças Armadas (acesso restrito)." color="text-lime-400">
            <p>As Forças Armadas são a defesa da nossa nação. O painel é de uso exclusivo de militares e permite:</p>
            <ul>
              <li>Planejar e acompanhar operações militares.</li>
              <li>Gerenciar recursos e pessoal.</li>
              <li>Coordenar a defesa do território nacional.</li>
            </ul>
          </ServiceCard>
          <ServiceCard icon={DollarSign} title="Renda Cidadã" description="Um benefício semanal para todos os cidadãos." color="text-emerald-400">
            <p>A Renda Cidadã é um sistema de distribuição de renda para garantir um nível básico de bem-estar a todos os cidadãos. Funciona da seguinte forma:</p>
            <ul>
              <li>Todo cidadão com conta bancária ativa recebe um valor semanal.</li>
              <li>O pagamento é automático e ocorre em um dia fixo da semana.</li>
              <li>O valor e o dia do pagamento podem ser ajustados pela administração da plataforma para equilibrar a economia.</li>
            </ul>
          </ServiceCard>
        </div>
      </div>
    ),
    admin: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Painel de Administração</h3>
        <p className="mb-4">O Painel de Administração é uma ferramenta poderosa e de acesso restrito, disponível apenas para usuários com o cargo de 'Admin'. Ele permite o gerenciamento completo da plataforma.</p>
        <h4 className="text-xl font-semibold text-white mb-3">Funcionalidades Principais:</h4>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li><strong>Gerenciamento de Usuários:</strong> Admins podem visualizar, editar e gerenciar todos os usuários da plataforma. Isso inclui alterar nomes, cargos e até mesmo remover usuários, se necessário.</li>
          <li><strong>Moderação de Conteúdo:</strong> Ferramentas para moderar posts, comentários e outros conteúdos gerados pelos usuários, garantindo um ambiente seguro e em conformidade com as regras.</li>
          <li><strong>Controle Financeiro:</strong> Admins têm a capacidade de adicionar ou remover fundos das contas bancárias dos usuários, uma ferramenta essencial para corrigir erros, aplicar multas ou distribuir recompensas.</li>
          <li><strong>Configurações do Sistema:</strong> Ajuste de parâmetros globais da plataforma, como o valor e a frequência da Renda Cidadã, taxas de serviços, entre outros.</li>
          <li><strong>Análises e Estatísticas:</strong> Visualização de dados e métricas sobre o uso da plataforma, como número de usuários, transações e atividades gerais.</li>
        </ul>
        <p>O acesso a este painel é um privilégio que vem com grande responsabilidade. Todas as ações são registradas para garantir a transparência e a segurança.</p>
      </div>
    ),
    seguranca: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Sua Segurança é Nossa Prioridade</h3>
        <p className="mb-4">Levamos a segurança dos seus dados a sério. Todas as informações são criptografadas e armazenadas em servidores seguros.</p>
        <p>Nossa <Link to="/privacy" className="text-blue-400 hover:underline">Política de Privacidade</Link> detalha como coletamos e usamos seus dados. Recomendamos fortemente a ativação da <strong>autenticação de dois fatores (2FA)</strong> em sua conta para uma camada extra de proteção.</p>
      </div>
    ),
    regras: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Diretrizes da Comunidade</h3>
        <p className="mb-4">Para garantir um ambiente justo e divertido para todos, temos algumas regras básicas. A violação destas regras pode resultar em advertências ou banimento.</p>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Respeito Mútuo:</strong> Não toleramos assédio, discurso de ódio ou qualquer forma de desrespeito.</li>
          <li><strong>Powergaming/Metagaming:</strong> É proibido usar informações de fora do jogo (OOC) para ganhar vantagens no jogo (IC).</li>
          <li><strong>Bugs e Exploits:</strong> Aproveitar-se de bugs é ilegal. Reporte qualquer bug encontrado à equipe.</li>
        </ul>
        <p className="mt-4">Para a lista completa, consulte nossos <Link to="/terms" className="text-blue-400 hover:underline">Termos de Serviço</Link>.</p>
      </div>
    ),
    desenvolvedores: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Junte-se à Construção do Futuro</h3>
        <p className="mb-4">GOV.RP é um projeto de código aberto e adoraríamos ter sua ajuda! Se você é desenvolvedor, pode contribuir para o nosso ecossistema.</p>
        <p className="mb-4">Nosso código está no GitHub. Sinta-se à vontade para clonar o repositório, verificar os `issues` e submeter `pull requests`.</p>
        <a href="https://github.com/RDG547/GOVRP" target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
            <GitBranch className="w-5 h-5 mr-2" />
            Acessar Repositório no GitHub
          </Button>
        </a>
      </div>
    ),
    suporte: (
      <div>
        <h3 className="text-2xl font-bold text-white mb-4">Precisando de Ajuda?</h3>
        <p className="mb-6">Se você encontrar qualquer problema, tiver dúvidas ou sugestões, nossa equipe está pronta para ajudar. A forma mais rápida de obter ajuda é através da nossa comunidade.</p>
        
        <h4 className="text-xl font-semibold text-white mb-3">Canais de Suporte Comunitário</h4>
        <div className="space-y-3 mb-6">
            <a href="https://discord.gg/NwJuuzKbUU" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 transition-colors">
                <FaDiscord className="w-6 h-6 text-indigo-400" />
                <span>Junte-se ao nosso Discord</span>
            </a>
            <a href="https://chat.whatsapp.com/KKqiDj1HyxM97NK9YAFNnj" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-lg bg-green-500/20 hover:bg-green-500/30 transition-colors">
                <FaWhatsapp className="w-6 h-6 text-green-400" />
                <span>Participe de nossa comunidade no WhatsApp</span>
            </a>
            <a href="https://t.me/geopolitical_simulator5" target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 transition-colors">
                <FaTelegram className="w-6 h-6 text-sky-400" />
                <span>Entre no nosso canal no Telegram</span>
            </a>
        </div>

        <h4 className="text-xl font-semibold text-white mb-3">Outras Opções</h4>
        <ul className="list-disc list-inside space-y-2">
          <li>Para problemas técnicos que exijam investigação, envie um e-mail para <a href="mailto:suporte@govrp.online" className="text-blue-400 hover:underline">suporte@govrp.online</a>.</li>
          <li>Para perguntas rápidas, confira nossa página de <Link to="/faq" className="text-blue-400 hover:underline">FAQ</Link>.</li>
        </ul>
        <Link to="/support" className="mt-6 inline-block">
          <Button className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
            Abrir Ticket de Suporte <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>
    ),
  };
  return contentMap[id] || <div>Conteúdo não encontrado.</div>;
};

const Documentation = () => {
  const [activeTab, setActiveTab] = useState('introducao');

  return (
    <>
      <Helmet>
        <title>Documentação - GOV.RP</title>
        <meta name="description" content="Acesse a documentação completa do GOV.RP. Guias, tutoriais e informações sobre todos os nossos sistemas." />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <PageHeader
            icon={BookOpen}
            title="Central de"
            gradientText="Documentação"
            description="Tudo o que você precisa saber para aproveitar ao máximo sua jornada no GOV.RP."
            iconColor="text-yellow-400"
        />

        <div className="flex flex-col md:flex-row gap-12">
          <aside className="md:w-64 md:sticky md:top-24 md:self-start">
            <div className="md:hidden mb-8">
              <div className="custom-scrollbar -mx-4 px-4 pb-2 overflow-x-auto">
                 <div className="flex space-x-2">
                  {sections.map(section => (
                    <button key={section.id} onClick={() => setActiveTab(section.id)}
                      className={cn(
                        "flex-shrink-0 px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                        activeTab === section.id
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      <section.icon className="w-4 h-4"/>
                      {section.title}
                    </button>
                  ))}
                 </div>
              </div>
            </div>
            <div className="hidden md:block">
              <ul className="space-y-1">
                {sections.map(section => (
                  <li key={section.id}>
                    <button onClick={() => setActiveTab(section.id)} className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg transition-all w-full text-left",
                      activeTab === section.id
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    )}>
                      <section.icon className={cn("w-5 h-5", activeTab === section.id ? "text-blue-400" : "text-gray-500")} />
                      <span>{section.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
          
          <main className="flex-1 glass-effect p-8 rounded-2xl border border-white/10 min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="prose prose-invert max-w-none text-gray-300"
              >
                <SectionContent id={activeTab} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </>
  );
};

export default Documentation;