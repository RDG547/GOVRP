import { ASPIRATIONS, ASPIRATION_TONES } from '@/lib/citizenOnboarding';
import { Checkbox } from '@/components/ui/checkbox';
import { tutorialPath, shouldShowTutorial } from '@/lib/tutorial';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Flag, Landmark, LayoutDashboard, Loader2, Newspaper, Scale, Sparkles, Wallet, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';

const paths = {
  politics: 'Comece conhecendo os partidos e acompanhando os debates do Parlamento.',
  entrepreneurship: 'Explore o mercado: você pode vender como pessoa física e depois abrir sua empresa.',
  justice: 'Acompanhe a Justiça e conheça as carreiras que protegem os direitos dos cidadãos.',
  security: 'Conheça o serviço de Segurança e Justiça e as atribuições de cada carreira.',
  communication: 'Leia o jornal, acompanhe os acontecimentos e participe da conversa na Rede X.',
  knowledge: 'Descubra oportunidades de estudo, trabalho e desenvolvimento profissional.',
  civil_life: 'Conheça os serviços com calma. Sua trajetória pode mudar a qualquer momento.',
};
const steps = [
  { icon: Sparkles, title: 'Seu país espera por você', description: 'Seu cidadão já tem identidade, documentos e uma conta. Agora suas escolhas passam a fazer parte da história do GOVRP.', hint: 'Uma república construída pelas ações de seus cidadãos.' },
  { icon: LayoutDashboard, title: 'Seu ponto de partida', description: 'No painel do cidadão você acompanha sua identidade, objetivos e serviços. Volte a ele sempre que precisar se orientar.', hint: 'Abra o menu e escolha Dashboard para voltar ao seu painel.' },
  { icon: Wallet, title: 'Cuide da sua vida financeira', description: 'No Banco Nacional você vê seu saldo, recebe pagamentos e acompanha cada transação. Cartões e empréstimos têm condições próprias.', hint: 'Confira o extrato e os vencimentos antes de assumir compromissos.' },
  { icon: Newspaper, title: 'Acompanhe o que acontece', description: 'O jornal diário reúne as publicações do país. O Diário Oficial registra os atos públicos; a Rede X dá espaço à conversa.', hint: 'Ler o jornal ajuda você a participar dos acontecimentos.' },
  { icon: Flag, title: 'Sua voz na política', description: 'Conheça os partidos, participe das eleições e acompanhe o Parlamento. Você pode apresentar ideias e construir uma carreira pública.', hint: 'Filiação, candidaturas e mandatos seguem as regras de cada instituição.' },
  { icon: Scale, title: 'Seus direitos e deveres', description: 'Registre ocorrências, acompanhe seus protocolos e consulte as decisões que envolvem seu cidadão. Cada autoridade tem sua competência.', hint: 'As atualizações dos seus casos chegam pelas notificações.' },
  { icon: Landmark, title: 'Construa sua própria trajetória', description: 'Trabalhe, compre, venda, empreenda e participe da vida do país. Seu saldo inicial é apenas o primeiro passo.', hint: '' },
];

export default function WelcomeTutorial() {
  const { user, refreshUser, triggerTutorial, setTriggerTutorial } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [finishedFor, setFinishedFor] = useState(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  useEffect(() => { setFinishedFor(null); setOpen(false); setIndex(0); setDontShowAgain(Boolean(user?.tutorial_dont_show_again)); }, [user?.id]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (shouldShowTutorial(user, finishedFor, sessionStorage.getItem(`govrp:tutorial:${user?.id}`))) setOpen(true);
  }, [user?.id, user?.onboarding_completed, user?.tutorial_dont_show_again, finishedFor]);
  useEffect(() => {
    if (triggerTutorial) { setIndex(0); setOpen(true); setTriggerTutorial(false); }
  }, [triggerTutorial, setTriggerTutorial]);
  const finish = async (completed = false) => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_tutorial_progress', { p_completed: completed, p_dont_show_again: dontShowAgain });
      if (error) throw error;
      setFinishedFor(user.id); sessionStorage.setItem(`govrp:tutorial:${user.id}`, 'closed'); setOpen(false);
      await refreshUser({ skipSync: true });
    } catch {
      toast({ title: 'Não foi possível salvar seu progresso', description: 'Tente novamente para concluir o tutorial.', variant: 'destructive' });
    } finally { setSaving(false); }
  };
  const colors = ['text-amber-400 bg-amber-500/10', 'text-blue-400 bg-blue-500/10', 'text-emerald-400 bg-emerald-500/10', 'text-rose-400 bg-rose-500/10', 'text-violet-400 bg-violet-500/10', 'text-purple-400 bg-purple-500/10', 'text-yellow-400 bg-yellow-500/10'];
  const recommended = tutorialPath(user?.initial_aspiration);
  const areaSteps = {
    parties: { title: 'Encontre seu partido', description: 'Conheça as propostas dos partidos, peça filiação e converse com a liderança. Participar da vida interna ajuda você a conquistar uma indicação eleitoral.', icon: Flag, color: 'text-red-400 bg-red-500/10' },
    elections: { title: 'Prepare sua trajetória eleitoral', description: 'Acompanhe as inscrições e as votações. Para concorrer, confira os requisitos e a indicação do seu partido. Mandatos começam com a posse oficial.', icon: Flag, color: 'text-violet-400 bg-violet-500/10' },
    parliament: { title: 'Participe da construção das leis', description: 'Acompanhe projetos, votações e a composição das Casas. Como cidadão, envie sugestões; com mandato, apresente propostas e participe das decisões.', icon: Landmark, color: 'text-indigo-400 bg-indigo-500/10' },
    bank: { ...steps[2], color: colors[2] }, business: { ...steps[6], title: 'Seu primeiro negócio', description: 'Abra o Portal do Empreendedor, confira o custo de licenciamento e escolha um setor. Você pode administrar produtos e acompanhar receitas e despesas.', color: colors[6] },
    market: { ...steps[6], title: 'Compre e venda no mercado', description: 'Compare ofertas no Negócios Livres. Você pode anunciar como pessoa física e vender consumíveis que ajudam a cuidar das necessidades dos cidadãos.', color: colors[6] },
    economy: { ...steps[6], title: 'Entenda a economia do seu país', description: 'Acompanhe preços, atividade econômica e regras legais vigentes. Decisões do Governo e transações dos cidadãos mudam o mundo do RP.', color: colors[6] },
    justice: { ...steps[5], color: user?.initial_aspiration === 'security' ? 'text-cyan-400 bg-cyan-500/10' : colors[5] },
    cases: { ...steps[5], title: 'Acompanhe processos e defesas', description: 'Na visão cidadã da Justiça, consulte seus processos, prazos e intimações. Carreiras jurídicas possuem funções próprias e exigem nomeação autorizada.', color: colors[5] },
    investigations: { ...steps[5], title: 'Da ocorrência à investigação', description: 'Cidadãos registram ocorrências. Policiais fazem a triagem e delegados conduzem investigações e remetem casos ao Ministério Público.', color: 'text-cyan-400 bg-cyan-500/10' },
    careers: { ...steps[1], title: 'Construa sua carreira', description: 'Acompanhe oportunidades e as atribuições dos cargos. Sua aspiração orienta os primeiros passos e não bloqueia nenhuma outra trajetória.', color: colors[1] },
    education: { ...steps[1], title: 'Conhecimento e progressão', description: 'Consulte os serviços de educação disponíveis e acompanhe as oportunidades de desenvolver seu cidadão.', color: colors[1] },
    x: { ...steps[3], title: 'Entre na conversa na Rede X', description: 'Publique, responda comentários e conheça outros cidadãos. Interações válidas melhoram sua socialização; alcance e influência são construídos dentro do RP.', color: 'text-sky-400 bg-sky-500/10' },
    news: { ...steps[3], title: 'Informação e imprensa', description: 'Leia o jornal, acompanhe o Diário Oficial e descubra os acontecimentos nacionais. Comunicação ajuda você a participar da vida pública.', color: colors[3] },
    dashboard: { ...steps[1], color: colors[1] },
  };
  const aspiration = ASPIRATIONS.find(item => item.key === user?.initial_aspiration) || ASPIRATIONS.find(item => item.key === 'civil_life');
  const orientation = { title: `Sua aspiração é ${aspiration.title}`, description: recommended.description, icon: aspiration.icon, color: ASPIRATION_TONES[aspiration.tone].icon, links: recommended.links };
  const orderedSteps = [{ ...steps[0], color: colors[0] }, orientation, ...recommended.links.map(link => ({ ...areaSteps[link.key], to: link.to })), ...steps.slice(1).map((step, i) => ({ ...step, color: colors[i + 1] })).filter(step => !recommended.links.some(link => areaSteps[link.key]?.title === step.title))];
  const current = orderedSteps[Math.min(index, orderedSteps.length - 1)];
  const Icon = current.icon;
  const firstName = user?.full_name?.split(' ')[0] || 'cidadão';
  return <Dialog open={open} onOpenChange={(next) => { if (!next) void finish(); }}>
    <DialogContent className="flex h-[min(620px,calc(100dvh-24px))] max-h-[calc(100dvh-24px)] flex-col gap-3 p-4 sm:max-w-xl sm:p-6" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader className="shrink-0 text-center sm:text-center pr-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">Primeiros passos · {index + 1} de {orderedSteps.length}</p>
        <DialogTitle className="text-lg sm:text-2xl">{index === 0 ? `Bem-vindo ao GOVRP, ${firstName}!` : current.title}</DialogTitle>
        <DialogDescription className="sr-only">Sua jornada começa com suas escolhas.</DialogDescription>
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:h-16 sm:w-16 ${current.color}`}><Icon className="h-7 w-7 sm:h-8 sm:w-8" /></div>
        <p className="text-sm leading-relaxed sm:text-base">{current.description}</p>
        {current.links ? <div className="w-full rounded-xl bg-secondary p-3 text-xs text-muted-foreground sm:text-sm"><p className="mb-2 font-medium">Áreas para conhecer</p><ul className="flex flex-wrap justify-center gap-x-4 gap-y-2">{current.links.map(link => { const AreaIcon = areaSteps[link.key].icon; return <li key={link.key} className="flex items-center gap-2"><AreaIcon className={`h-4 w-4 ${areaSteps[link.key].color.split(' ')[0]}`} />{link.label}</li>; })}</ul></div> : current.hint && <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground sm:text-sm">{current.hint}</p>}
      </div>
      <div className="shrink-0 space-y-3">
        <label className="flex items-center justify-center gap-3 text-sm cursor-pointer"><Checkbox checked={dontShowAgain} onCheckedChange={value => setDontShowAgain(value === true)} />Não mostrar novamente</label>
        <div className="flex gap-1" aria-label={`Etapa ${index + 1} de ${orderedSteps.length}`}>{orderedSteps.map((step, i) => <span key={`${i}-${step.title}`} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-secondary'}`} />)}</div>
        <div className="grid grid-cols-[auto_1fr_1fr] gap-1.5">
          <Button className="px-2" variant="ghost" disabled={saving} onClick={() => finish(false)}>Pular</Button>
          <Button className="px-2" variant="outline" disabled={index === 0 || saving} onClick={() => setIndex(i => i - 1)}><ArrowLeft className="mr-1 h-4 w-4" />Voltar</Button>
          {index < orderedSteps.length - 1 ? <Button className="px-2" onClick={() => setIndex(i => i + 1)}>Próximo<ArrowRight className="ml-1 h-4 w-4" /></Button> : <Button className="px-2" disabled={saving} onClick={() => finish(true)}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}Começar</Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
