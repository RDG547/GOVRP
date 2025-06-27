import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BookOpen, Shield, Users, Code, LifeBuoy, Server, Landmark, Briefcase, FileText, MessageSquare, Library, Archive, ArrowRight, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { FaDiscord, FaWhatsapp, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';

const sections = [
  { id: 'introducao', title: 'Introdução', icon: BookOpen },
  { id: 'servicos', title: 'Serviços', icon: Server },
  { id: 'seguranca', title: 'Segurança', icon: Shield },
  { id: 'regras', title: 'Regras', icon: Users },
  { id: 'desenvolvedores', title: 'Desenvolvedores', icon: Code },
  { id: 'suporte', title: 'Suporte', icon: LifeBuoy },
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
          <li><strong>Explore os Serviços:</strong> Familiarize-se com os <Link to="/services" className="text-blue-400 hover:underline">serviços disponíveis</Link>. Abra sua conta bancária, solicite seus documentos e prepare-se para a vida política.</li>
          <li><strong>Defina seu Caminho:</strong> Você será um político influente, um empresário de sucesso, um jornalista investigativo ou um cidadão comum? As escolhas são suas!</li>
        </ol>
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
          <ServiceCard icon={Library} title="Biblioteca Nacional" description="Um acervo de conhecimento com leis e documentos históricos." color="text-orange-400">
            <p>A Biblioteca Nacional é um site externo que funciona como um vasto repositório de conhecimento, permitindo o download de livros, artigos e documentos em PDF.</p>
            <p>Pense nela como uma grande biblioteca digital, similar a projetos como Z-Library, onde você pode acessar uma infinidade de materiais para estudo e leitura.</p>
          </ServiceCard>
          <ServiceCard icon={Archive} title="Acervo Digital" description="Links para jogos, softwares, cursos e outros recursos." color="text-rose-400">
            <p>O Acervo Digital é um repositório de links selecionados que te redireciona para um mundo de recursos, incluindo downloads de jogos, softwares, cursos e muito mais.</p>
            <p>É o seu portal de acesso rápido para entretenimento e aprendizado, funcionando como uma ponte para conteúdos externos de qualidade.</p>
          </ServiceCard>
        </div>
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