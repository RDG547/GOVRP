import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Briefcase, CheckCircle2, Clock, Loader2, Play, ListChecks, Timer } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { userErrorMessage } from '@/lib/userErrors';
import { Button } from '@/components/ui/button';
import { SKILL_NAMES } from '@/lib/companyEconomy';

const durationLabel = seconds => `${Math.floor(seconds / 60)}:${String(Math.ceil(seconds % 60)).padStart(2, '0')}`;
const defaultAnswer = session => session.draft_answer || (session.challenge.mode === 'order' ? session.challenge.options.map(item => item.id) : []);
const modeNames = { timed: 'Execução por tempo', interactive: 'Interativa', hybrid: 'Interativa com execução' };
const modeIcons = { timed: Timer, interactive: ListChecks, hybrid: Clock };

export default function ProfessionalActivities({ companyId, onCompleted }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null), [answer, setAnswer] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [completed, setCompleted] = useState(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0), activeId = useRef(null), pendingSaves = useRef(0), saveQueue = useRef(Promise.resolve()), request = useRef(0), answerRevision = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current, revision = answerRevision.current;
    const result = await supabase.rpc('get_professional_activities', { p_business_id: companyId });
    if (sequence !== request.current) return;
    if (result.error) { console.error('Atividades profissionais', result.error); setError(userErrorMessage(result.error)); return; }
    offset.current = Date.parse(result.data.server_now) - Date.now();
    setNow(Date.now()); setData(result.data); setError('');
    if (result.data.active && ((!pendingSaves.current && revision === answerRevision.current) || activeId.current !== result.data.active.id)) setAnswer(defaultAnswer(result.data.active));
    activeId.current = result.data.active?.id || null;
  }, [companyId]);
  useEffect(() => { setData(null); setCompleted(null); activeId.current = null; void load(); return () => { request.current++; }; }, [load]);
  useDomainRealtime('professional-activities', user?.id, [{ table: 'professional_work_sessions', filter: `user_id=eq.${user?.id}` }, 'business_employees'], load, Boolean(user?.id));
  const session = data?.active;
  useEffect(() => {
    if (!session) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [session?.id]);
  const deadline = session ? Date.parse(session.started_at) + session.duration_seconds * 1000 : 0;
  const remaining = Math.max(0, Math.ceil((deadline - now - offset.current) / 1000));
  const expired = Boolean(session && Date.parse(session.expires_at) <= now + offset.current);
  useEffect(() => { if (expired) void load(); }, [expired, load]);
  const start = async key => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await supabase.rpc('start_professional_activity', { p_business_id: companyId, p_activity_key: key });
      if (result.error) throw result.error;
      setAnswer(defaultAnswer(result.data)); activeId.current = result.data.id; setCompleted(null);
      await load();
    } catch (failure) { setError(userErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  const changeAnswer = next => {
    answerRevision.current++;
    setAnswer(next);
    const id = session.id;
    pendingSaves.current++;
    // Preserve ordering even when options are rearranged quickly or the app closes.
    saveQueue.current = saveQueue.current.then(async () => {
      const { error: failure } = await supabase.rpc('save_professional_activity_draft', { p_session_id: id, p_answer: next });
      if (failure) { console.error('Rascunho da atividade', failure); setError('Não foi possível salvar sua resposta. Confira a conexão antes de sair.'); }
    }).catch(failure => { console.error(failure); setError('Não foi possível salvar sua resposta.'); }).finally(() => { pendingSaves.current--; });
  };
  const move = (index, direction) => {
    const next = [...answer];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    changeAnswer(next);
  };
  const finish = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await saveQueue.current;
      const result = await supabase.rpc('finish_professional_activity', { p_session_id: session.id, p_answer: answer });
      if (result.error) throw result.error;
      setCompleted(result.data); await load(); onCompleted?.();
      toast({ title: 'Atividade concluída', description: `+${result.data.experience_earned} XP em ${SKILL_NAMES[result.data.skill_area] || result.data.skill_area}` });
    } catch (failure) { setError(userErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  const challenge = session?.challenge;
  const options = challenge?.mode === 'order' ? answer.map(id => challenge.options.find(item => item.id === id)).filter(Boolean) : challenge?.options || [];
  const progress = session ? Math.min(100, Math.max(0, 100 * (session.duration_seconds - remaining) / session.duration_seconds)) : 0;
  return <section className="space-y-4 rounded-2xl border p-4 sm:p-5" aria-label="Atividades profissionais">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><Briefcase className="h-5 w-5 text-amber-500"/>Atividades profissionais</h2>
    <p className="text-sm text-muted-foreground">Escolha uma tarefa da sua função. Você pode sair e voltar enquanto ela acontece. São cinco atividades da sua área, com limite diário de cinco execuções. Lotes consomem insumos e energia reais e entregam produtos ao estoque. A venda desses produtos gera a receita empresarial.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}<Button variant="link" onClick={load}>Atualizar</Button></p>}
    {!data ? <p role="status" className="flex gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Consultando atividades…</p> : <>
      <p className="text-sm">{data.role_name} · {data.company_name}</p>
      <p role="status" className="font-semibold">{data.used_today}/{data.daily_limit} atividades hoje{data.used_today >= data.daily_limit ? ' · Limite diário atingido' : ''}</p>
      {completed && <p role="status" className="flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm"><CheckCircle2 className="h-5 w-5 shrink-0"/>Concluída · Desempenho {completed.score}% · +{completed.experience_earned} XP</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.catalog.map(task => {
        const Icon = modeIcons[task.execution_mode];
        const current = session?.business_id === companyId && session?.activity_key === task.activity_key;
        const done = data.recent.some(item => item.activity_key === task.activity_key && item.status === 'completed');
        return <article data-professional-activity={task.activity_key} key={task.activity_key} className="flex min-w-0 flex-col gap-3 rounded-xl border p-3">
          <h3 className="flex gap-2 font-semibold"><Icon className="h-5 w-5 shrink-0 text-amber-400"/>{task.title}</h3>
          <p className="flex-1 text-sm text-muted-foreground">{task.description}</p>
          <p className="text-xs">{modeNames[task.execution_mode]} · {durationLabel(task.duration_seconds)} · até {task.experience} XP</p>
          {task.activity_key==='production'&&<p className="text-xs">Recompensa: produtos da receita no estoque da empresa; consome insumos e energia.</p>}<p className="text-xs font-medium">{current ? remaining ? 'Em andamento' : 'Pronta para concluir' : data.used_today >= data.daily_limit ? 'Limite diário atingido' : done ? 'Concluída · disponível novamente' : 'Disponível'}</p>
          <Button size="sm" disabled={busy || Boolean(session) || data.used_today >= data.daily_limit} onClick={() => start(task.activity_key)}><Play className="mr-2 h-4 w-4"/>Iniciar</Button>
        </article>;
      })}</div>
    </>}
    {session && <div data-professional-session={session.id} className="space-y-4 rounded-xl bg-secondary/40 p-4">
      <div><h3 className="font-semibold">{challenge.title}</h3><p className="text-sm text-muted-foreground">{challenge.description}</p><p className="mt-1 text-xs">{challenge.company_name} · {challenge.role_name}</p></div>
      <div className="flex items-center gap-4" role="timer" aria-label="Tempo restante da atividade">
        <svg viewBox="0 0 48 48" className="h-16 w-16 shrink-0 -rotate-90" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-muted"/><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray="125.66" strokeDashoffset={125.66 * (1 - progress / 100)} className="text-amber-500"/></svg>
        <div><strong className="text-xl">{remaining ? durationLabel(remaining) : 'Pronta para concluir'}</strong><p className="text-xs text-muted-foreground">O tempo continua contando quando você sai desta tela.</p></div>
      </div>
      {challenge.mode !== 'timed' && <><p className="text-xs text-muted-foreground">{challenge.mode === 'order' ? 'Use as setas para organizar as etapas.' : challenge.mode === 'multiple' ? 'Marque todas as opções que atendem ao critério.' : 'Escolha uma opção.'}</p>
        <div className="space-y-2">{options.map((option, index) => challenge.mode === 'order'
          ? <div key={option.id} className="flex items-center gap-2 rounded-xl border p-3"><span className="text-xs">{index + 1}</span><span className="min-w-0 flex-1 text-sm">{option.label}</span><Button variant="outline" size="icon" disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={`Mover ${option.label} para cima`}><ArrowUp className="h-4 w-4"/></Button><Button variant="outline" size="icon" disabled={index === options.length - 1 || busy} onClick={() => move(index, 1)} aria-label={`Mover ${option.label} para baixo`}><ArrowDown className="h-4 w-4"/></Button></div>
          : <label key={option.id} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 ${answer.includes(option.id) ? 'border-primary bg-primary/10' : ''}`}><input className="h-5 w-5 shrink-0" disabled={busy} type={challenge.mode === 'single' ? 'radio' : 'checkbox'} name={`activity-${session.id}`} checked={answer.includes(option.id)} onChange={() => changeAnswer(challenge.mode === 'single' ? [option.id] : answer.includes(option.id) ? answer.filter(id => id !== option.id) : [...answer, option.id])}/><span className="min-w-0 text-sm">{option.label}{option.value !== undefined && <strong> · {option.value}</strong>}{option.detail && <span className="mt-1 block text-muted-foreground">{option.detail}</span>}</span></label>)}</div></>}
      <Button disabled={busy || remaining > 0 || (challenge.mode === 'single' && answer.length !== 1)} onClick={finish}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <CheckCircle2 className="mr-2 h-4 w-4"/>}{remaining ? 'Em andamento' : 'Concluir atividade'}</Button>
    </div>}
  </section>;
}
