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
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (user?.onboarding_completed && !finished && user.has_seen_tutorial === false) setOpen(true);
  }, [user?.onboarding_completed, user?.has_seen_tutorial, finished]);
  useEffect(() => {
    if (triggerTutorial) { setIndex(0); setOpen(true); setTriggerTutorial(false); }
  }, [triggerTutorial, setTriggerTutorial]);
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('mark_tutorial_seen', { p_dont_show_again: true });
      if (error) throw error;
      setFinished(true); setOpen(false);
      await refreshUser({ skipSync: true });
    } catch {
      toast({ title: 'Não foi possível salvar seu progresso', description: 'Tente novamente para concluir o tutorial.', variant: 'destructive' });
    } finally { setSaving(false); }
  };
  const current = steps[index];
  const Icon = current.icon;
  const firstName = user?.full_name?.split(' ')[0] || 'cidadão';
  return <Dialog open={open} onOpenChange={(next) => { if (!next) void finish(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto p-5 sm:max-w-2xl sm:p-8" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">Primeiros passos · {index + 1} de {steps.length}</p>
        <DialogTitle className="text-2xl">{index === 0 ? `Bem-vindo ao GOVRP, ${firstName}!` : current.title}</DialogTitle>
        <DialogDescription>Sua jornada começa com suas escolhas.</DialogDescription>
      </DialogHeader>
      <div className="mt-2 grid gap-5 sm:grid-cols-[64px_1fr]">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Icon className="h-8 w-8 text-primary" /></div>
        <div><p className="text-base leading-relaxed">{current.description}</p><p className="mt-4 rounded-xl bg-secondary p-4 text-sm text-muted-foreground">{current.hint || paths[user?.initial_aspiration] || paths.civil_life}</p></div>
      </div>
      <div className="my-3 flex gap-1.5" aria-label={`Etapa ${index + 1} de ${steps.length}`}>{steps.map((step, i) => <span key={step.title} className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-secondary'}`} />)}</div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={saving} onClick={finish}><X className="mr-2 h-4 w-4" />Pular</Button>
        <div className="flex gap-2"><Button variant="outline" disabled={index === 0 || saving} onClick={() => setIndex(i => i - 1)}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
          {index < steps.length - 1 ? <Button onClick={() => setIndex(i => i + 1)}><ArrowRight className="mr-2 h-4 w-4" />Próximo</Button> : <Button disabled={saving} onClick={finish}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Começar minha jornada</Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
