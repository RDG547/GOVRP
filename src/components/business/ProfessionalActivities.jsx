import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Briefcase, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { SKILL_NAMES } from '@/lib/companyEconomy';

export default function ProfessionalActivities({ companyId, onCompleted }) {
  const { toast } = useToast();
  const [session, setSession] = useState(null);
  const [answer, setAnswer] = useState([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setSession(null); setAnswer([]); }, [companyId]);
  useEffect(() => {
    if (session?.status !== 'active') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.status]);
  const start = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('start_professional_activity', { p_business_id: companyId });
      if (error) throw error;
      setSession(data);
      setAnswer(data.challenge.mode === 'order' ? data.challenge.options.map(item => item.id) : []);
      setNow(Date.now());
    } catch (error) {
      toast({ title: 'Atividade indisponível', description: error.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('finish_professional_activity', { p_session_id: session.id, p_answer: answer });
      if (error) throw error;
      setSession(data);
      onCompleted?.();
    } catch (error) {
      toast({ title: 'Não foi possível concluir', description: error.message, variant: 'destructive' });
    } finally { setBusy(false); }
  };
  const move = (index, direction) => setAnswer(current => {
    const next = [...current];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    return next;
  });
  const wait = session ? Math.max(0, Math.ceil((new Date(session.started_at).getTime() + 10000 - now) / 1000)) : 0;
  const expired = session && new Date(session.expires_at).getTime() <= now;
  const challenge = session?.challenge;
  const options = challenge?.mode === 'order' ? answer.map(id => challenge.options.find(item => item.id === id)) : challenge?.options;
  return <section className="space-y-4 rounded-2xl border p-4 sm:p-5" aria-label="Atividades profissionais">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Briefcase className="h-5 w-5 text-amber-500"/>Atividade profissional</h2>
    <p className="text-sm text-muted-foreground">A função exercida define a tarefa. São até cinco atividades por dia, com até 20 XP por atividade. Uma boa execução ajuda a produção do próximo dia, até o limite de 20% por empresa. A operação básica continua sem sua participação.</p>
    {(!session || expired || session.status === 'completed') ? <>
      {session?.status === 'completed' && <div role="status" className="space-y-1 rounded-xl bg-secondary p-4"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5"/>Atividade concluída</p><p>Desempenho: {session.score}% · +{session.experience_earned} XP em {SKILL_NAMES[session.skill_area] || session.skill_area}</p><p className="text-sm">{session.experience_earned ? 'Sua contribuição foi registrada para a próxima produção diária.' : 'Revise os critérios da tarefa na próxima tentativa.'}</p></div>}
      {expired && session?.status !== 'completed' && <p role="status">O prazo desta atividade terminou.</p>}
      <Button disabled={busy} onClick={start}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}{session ? 'Iniciar outra atividade' : 'Iniciar atividade'}</Button>
    </> : <div className="space-y-4">
      <div><h3 className="font-semibold">{challenge.title}</h3><p className="text-sm text-muted-foreground">{challenge.description}</p></div>
      <p className="text-xs text-muted-foreground">{challenge.mode === 'order' ? 'Use as setas para organizar as etapas.' : challenge.mode === 'multiple' ? 'Marque todas as opções que atendem ao critério. Você pode deixar todas desmarcadas.' : 'Escolha uma opção.'} · Prazo: {new Date(session.expires_at).toLocaleTimeString('pt-BR')}</p>
      <div className="space-y-2">{options.map((option, index) => challenge.mode === 'order'
        ? <div key={option.id} className="flex items-center gap-2 rounded-xl border p-3"><span className="text-xs text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 text-sm">{option.label}</span><Button variant="outline" size="icon" disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={`Mover ${option.label} para cima`}><ArrowUp className="h-4 w-4"/></Button><Button variant="outline" size="icon" disabled={index === options.length - 1 || busy} onClick={() => move(index, 1)} aria-label={`Mover ${option.label} para baixo`}><ArrowDown className="h-4 w-4"/></Button></div>
        : <label key={option.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 ${answer.includes(option.id) ? 'border-primary bg-primary/10' : ''}`}><input className="h-5 w-5 shrink-0" disabled={busy} type={challenge.mode === 'single' ? 'radio' : 'checkbox'} name={`activity-${session.id}`} checked={answer.includes(option.id)} onChange={() => setAnswer(current => challenge.mode === 'single' ? [option.id] : current.includes(option.id) ? current.filter(id => id !== option.id) : [...current, option.id])}/><span className="min-w-0 text-sm">{option.label}{option.value !== undefined && <strong> · {option.value}</strong>}{option.detail && <span className="mt-1 block text-muted-foreground">{option.detail}</span>}</span></label>)}</div>
      <Button disabled={busy || wait > 0 || (challenge.mode === 'single' && answer.length !== 1)} onClick={finish}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}{wait ? `Revise sua resposta · ${wait}s` : 'Concluir atividade'}</Button>
    </div>}
  </section>;
}
