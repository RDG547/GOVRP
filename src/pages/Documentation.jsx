import ServiceDocumentation from '@/components/ServiceDocumentation';
import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BookOpen, Siren, Shield, Users, Server, Landmark, Store, FileText, MessageSquare, Library, Archive, ArrowRight, HelpCircle, Scale, Gavel, Vote, Eye, ShieldCheck, Headphones, Banknote, Home, Wifi, Zap, Droplet, Smartphone, Wrench, Flame, LineChart, Newspaper, Tally5, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { FaDiscord, FaWhatsapp, FaTelegram } from 'react-icons/fa';
import PageHeader from '@/components/layout/PageHeader';

const sections = [
  { id: 'introducao', title: 'Introdução', icon: BookOpen },
  { id: 'identidade', title: 'Sistema de Identidade', icon: ShieldCheck },
  { id: 'tutorial', title: 'Tutorial Guiado', icon: HelpCircle },
  { id: 'servicos', title: 'Serviços', icon: Server },
  { id: 'seguranca', title: 'Segurança', icon: Shield },
  { id: 'regras', title: 'Regras', icon: Users },
  { id: 'suporte', title: 'Suporte', icon: Headphones },
];

const ServiceCard = ({ icon: Icon, title, description, color, children }) => (
  <Dialog>
    <DialogTrigger asChild>
      <motion.div
        whileHover={{ y: -5, scale: 1.02 }}
        className="glass-effect p-4 rounded-lg flex items-center gap-4 border cursor-pointer transition-all duration-300 hover:border-blue-400/50 hover:bg-accent"
      >
        <Icon className={`w-8 h-8 flex-shrink-0 ${color}`} />
        <div>
          <h4 className="font-bold text-foreground">{title}</h4>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ArrowRight className="w-5 h-5 text-gray-500 ml-auto group-hover:text-blue-400 transition-colors" />
      </motion.div>
    </DialogTrigger>
    <DialogContent className="glass-effect max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-2xl">
          <Icon className={`w-8 h-8 flex-shrink-0 ${color}`} />
          {title}
        </DialogTitle>
        <DialogDescription className="text-muted-foreground pt-4 prose prose-invert max-w-none">
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
        <h3 className="text-2xl font-bold text-foreground mb-4">Bem-vindo ao GOV.RP!</h3>
        <p className="mb-4">GOV.RP é um ecossistema de Roleplay Político onde você pode criar sua própria história, governar, legislar e interagir em uma sociedade virtual complexa. Nossa plataforma foi projetada para oferecer uma experiência imersiva e realista.</p>
        <h4 className="text-xl font-semibold text-foreground mb-3">Primeiros Passos:</h4>
        <ol className="list-decimal list-inside space-y-3">
          <li><strong>Crie sua Conta:</strong> O <Link to="/register" className="text-primary hover:underline">cadastro</Link> registra apenas os dados privados da pessoa real.</li>
          <li><strong>Registre seu Cidadão:</strong> Em seguida, crie separadamente o personagem e conclua o Registro Nacional de Cidadania.</li>
          <li><strong>Faça o Tutorial:</strong> Após a cidadania, um tutorial personalizado pela sua aspiração apresenta os caminhos iniciais.</li>
          <li><strong>Explore os Serviços:</strong> Familiarize-se com os <Link to="/services" className="text-primary hover:underline">serviços disponíveis</Link>.</li>
          <li><strong>Defina seu Caminho:</strong> Você será um político influente, um empresário de sucesso, um jornalista investigativo ou um cidadão comum? As escolhas são suas!</li>
        </ol>
      </div>
    ),
    identidade: (
      <div>
        <h3 className="text-2xl font-bold text-foreground mb-4">Sistema de Identidade</h3>
        <div className="space-y-5">
          <div><h4 className="font-semibold text-blue-300">1. Conta · OOC</h4><p>Nome real, e-mail, telefone, senha e provedores OAuth identificam a pessoa real. Esses dados ficam privados e não aparecem em perfis, documentos, Banco, eleições, partidos, Justiça ou Rede X.</p></div>
          <div><h4 className="font-semibold text-emerald-300">2. Personagem · IC</h4><p>Nome civil, nascimento, avatar, biografia, origem, residência e aspiração pertencem à pessoa fictícia interpretada. O nome real nunca é copiado automaticamente.</p></div>
          <div><h4 className="font-semibold text-amber-300">3. Cidadania institucional</h4><p>CPF, RG, Título de Eleitor, Carteira de Trabalho, conta bancária, patrimônio, cargos e históricos pertencem ao cidadão do RP. A emissão é protegida e seu progresso pode ser retomado quando quiser.</p></div>
          <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm">Contas antigas passam por uma confirmação abreviada. Documentos, saldo, filiação, cargos e histórico existentes são preservados.</p>
        </div>
      </div>
    ),
    tutorial: (
      <div>
        <h3 className="text-2xl font-bold text-foreground mb-4">Tutorial Guiado</h3>
        <p className="mb-4">Para garantir que você comece com o pé direito, desenvolvemos um tutorial interativo personalizado pela aspiração do cidadão, exibido após a conclusão da cidadania. Este tour destaca os elementos mais importantes da interface e explica as funcionalidades básicas.</p>
        <h4 className="text-xl font-semibold text-foreground mb-3">Como funciona?</h4>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li><strong>Aparição Automática:</strong> Sem marcar “Não mostrar novamente”, o tutorial poderá reaparecer na próxima sessão apropriada.</li>
          <li><strong>"Não mostrar novamente":</strong> Durante o tutorial, você pode marcar uma caixa para que ele não apareça nos próximos logins.</li>
          <li><strong>Reativando o Tutorial:</strong> Mudou de ideia? Você pode reativar o tutorial a qualquer momento. Use a opção de tutorial nas <Link to="/settings" className="text-primary hover:underline">Configurações</Link>.</li>
          <li><strong>Refazendo o Tour:</strong> Se quiser apenas rever o tutorial sem alterar suas configurações, clique no botão "Refazer Tutorial" no seu Dashboard.</li>
        </ul>
        <p>Recomendamos que todos os novos usuários completem o tutorial para uma melhor compreensão da plataforma.</p>
      </div>
    ),
    servicos: <ServiceDocumentation />,
    seguranca: (
      <div>
        <h3 className="text-2xl font-bold text-foreground mb-4">Sua Segurança é Nossa Prioridade</h3>
        <p className="mb-4">Levamos a segurança dos seus dados a sério. Dados privados da conta ficam separados da identidade pública do personagem, com acesso controlado no servidor.</p>
        <p>Nossa <Link to="/privacy" className="text-primary hover:underline">Política de Privacidade</Link> detalha como coletamos e usamos seus dados. Mantenha sua senha segura e revise o acesso ao provedor usado no login social.</p>
      </div>
    ),
    regras: (
      <div>
        <h3 className="text-2xl font-bold text-foreground mb-4">Diretrizes da Comunidade</h3>
        <p className="mb-4">Para garantir um ambiente justo e divertido para todos, temos algumas regras básicas. A violação destas regras pode resultar em advertências ou banimento.</p>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>Respeito Mútuo:</strong> Não toleramos assédio, discurso de ódio ou qualquer forma de desrespeito.</li>
          <li><strong>Powergaming/Metagaming:</strong> É proibido usar informações de fora do jogo (OOC) para ganhar vantagens no jogo (IC).</li>
          <li><strong>Bugs e Exploits:</strong> Aproveitar-se de bugs é ilegal. Reporte qualquer bug encontrado à equipe.</li>
        </ul>
        <p className="mt-4">Para a lista completa, consulte nossos <Link to="/terms" className="text-primary hover:underline">Termos de Serviço</Link>.</p>
      </div>
    ),
    suporte: (
      <div>
        <h3 className="text-2xl font-bold text-foreground mb-4">Precisando de Ajuda?</h3>
        <p className="mb-6">Se você encontrar qualquer problema, tiver dúvidas ou sugestões, nossa equipe está pronta para ajudar. A forma mais rápida de obter ajuda é através da nossa comunidade.</p>

        <h4 className="text-xl font-semibold text-foreground mb-3">Canais de Suporte Comunitário</h4>
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

        <h4 className="text-xl font-semibold text-foreground mb-3">Outras Opções</h4>
        <ul className="list-disc list-inside space-y-2">
          <li>Para problemas técnicos que exijam investigação, envie um e-mail para <a href="mailto:suporte@govrp.online" className="text-primary hover:underline">suporte@govrp.online</a>.</li>
          <li>Para perguntas rápidas, confira nossa página de <Link to="/faq" className="text-primary hover:underline">FAQ</Link>.</li>
        </ul>
        <Link to="/support" className="mt-6 inline-block">
          <Button>
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
          iconColor="text-green-400"
          centered={true}
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
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                      )}
                    >
                      <section.icon className="w-4 h-4" />
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
                        ? 'bg-primary/20 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}>
                      <section.icon className={cn("w-5 h-5", activeTab === section.id ? "text-primary" : "text-muted-foreground")} />
                      <span>{section.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <main className="flex-1 glass-effect p-8 rounded-2xl border min-h-[400px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="prose prose-sm md:prose-base prose-headings:font-bold prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground max-w-none"
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
