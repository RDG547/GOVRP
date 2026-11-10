import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gavel, Loader2, MessageSquare, Vote, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateTimeBR } from '@/lib/dateTime';

const stageLabel = { hearing: 'Sabatina', voting: 'Em votação', appointed: 'Empossado', rejected: 'Rejeitado', declined: 'Recusado' };
export default function JudicialGovernance() {
  const { user } = useAuth(), { toast } = useToast();
  const [data, setData] = useState(null), [failed, setFailed] = useState(false), [busy, setBusy] = useState('');
  const [texts, setTexts] = useState({}), [action, setAction] = useState(null), [reason, setReason] = useState('');
  const sequence = useRef(0);
  const admin = user?.is_platform_admin && user.admin_development?.mode === 'total';
  const load = useCallback(async () => {
    const current = ++sequence.current;
    const result = await supabase.rpc('get_judicial_governance');
    if (current !== sequence.current) return;
    setFailed(Boolean(result.error)); if (!result.error) setData(result.data);
  }, []);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useDomainRealtime('judicial-governance', user?.id, ['institutional_terms', 'minister_invitations', 'parliament_votings', 'parliament_voting_votes', 'judicial_electoral_assignments', 'public_integrity_cases', 'public_integrity_case_events', 'public_profile_directory_data'], load, Boolean(user?.id));
  const run = async (id, name, args) => {
    if (busy) return;
    setBusy(id);
    try {
      const result = await supabase.rpc(name, args); if (result.error) throw result.error;
      setAction(null); setReason(''); await load(); toast({ title: 'Ação institucional registrada', description: result.data?.message });
    } catch (failure) { console.error('Governança judicial', failure); toast({ title: 'A ação não foi concluída', description: /[a-zà-ú] /i.test(failure.message || '') ? failure.message : 'Confira os requisitos e sua competência para esta etapa.', variant: 'destructive' }); }
    finally { setBusy(''); }
  };
  const hearing = (item, kind) => run(item.id, 'manage_judicial_hearing', { p_invitation_id: item.id, p_action: kind, p_text: texts[item.id] || '' });
  const confirmAction = () => {
    if (action.kind === 'resign') return run(action.id, 'resign_judicial_term', { p_term_id: action.id, p_reason: reason });
    return run(action.id, 'manage_judicial_impeachment', { p_action: action.kind, p_term_id: action.kind === 'open' ? action.id : null, p_case_id: action.kind === 'open' ? null : action.id, p_text: reason, p_evidence: action.kind === 'open' ? [{ reference: texts[`evidence:${action.id}`] }] : [] });
  };
  if (!data) return <section className="rounded-xl border p-4"><h3 className="font-semibold">STF e nomeações institucionais</h3>{failed ? <Button variant="outline" onClick={load}>Tentar consultar novamente</Button> : <p role="status" className="text-sm text-muted-foreground">Consultando mandatos e indicações…</p>}</section>;
  return <section className="min-w-0 space-y-4 rounded-xl border p-3 sm:p-5">
    <div><h3 className="flex items-center gap-2 text-xl font-semibold"><Gavel className="h-5 w-5 text-violet-400" />STF e nomeações institucionais</h3><p className="text-sm text-muted-foreground">Instância judicial única · cinco vagas · mandatos individuais de oito anos RP / dois meses reais.</p></div>
    {failed && <p role="alert" className="text-sm text-destructive">Não foi possível atualizar os dados. <Button variant="link" onClick={load}>Tentar novamente</Button></p>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{data.seats.map(seat => <article key={seat.office_key} className="min-w-0 space-y-3 rounded-lg bg-secondary/40 p-4"><p className="font-semibold">{seat.office_key === 'public_prosecutor' ? 'Ministério Público' : `STF · vaga ${seat.office_key.split('_').at(-1)}`}</p><div className="flex items-center gap-2"><Avatar><AvatarImage src={seat.holder?.avatar_url} /><AvatarFallback>{seat.holder?.full_name?.charAt(0) || '—'}</AvatarFallback></Avatar><p className="min-w-0 break-words">{seat.holder?.full_name || 'Vaga disponível'}</p></div>{seat.term && <><p className="text-xs text-muted-foreground">Posse: {formatDateTimeBR(seat.term.starts_at)}{seat.term.ends_at && <><br />Término: {formatDateTimeBR(seat.term.ends_at)}</>}</p><div className="flex flex-wrap gap-2">{seat.term.profile_id === user.id && <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'resign', id: seat.term.id })}><LogOut className="mr-2 h-4 w-4" />Renunciar</Button>}{seat.office_key.startsWith('supreme_court_') && (data.senate_member_id || admin) && <Button size="sm" variant="destructive" onClick={() => setAction({ kind: 'open', id: seat.term.id })}>Processo de responsabilidade</Button>}</div></>}</article>)}</div>
    <div className="space-y-3"><h4 className="font-semibold">Indicações e sabatinas</h4>{!data.nominations.length && <p className="text-sm text-muted-foreground">Nenhuma indicação registrada.</p>}{data.nominations.map(item => {
      const voting = data.votes.find(v => v.id === item.voting_id);
      const ownVote = voting?.votes?.some(v => v.user_id === user.id);
      const candidate = item.candidate_id === user.id;
      return <article key={item.id} className="min-w-0 space-y-3 rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{item.candidate_name} · {item.office_key === 'public_prosecutor' ? 'Procurador-Geral da República' : 'STF'}</p><span className="text-sm text-violet-400">{stageLabel[item.stage] || ({ pending: 'Aguardando aceite', declined: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado' })[item.status] || item.status}</span></div>
        <ol className="max-h-72 space-y-2 overflow-y-auto">{item.hearing_notes.map(note => <li key={note.id} className="rounded bg-secondary/50 p-3 text-sm"><p className="font-medium">{note.kind === 'answer' ? 'Manifestação do indicado' : 'Pergunta na sabatina'} · {formatDateTimeBR(note.at)}</p><p className="whitespace-pre-wrap break-words">{note.text}</p></li>)}</ol>
        {item.stage === 'hearing' && (candidate || data.senate_member_id || admin) && <div className="space-y-2"><label className="block text-sm">{candidate ? 'Sua manifestação' : 'Pergunta ao indicado'}<Textarea value={texts[item.id] || ''} onChange={event => setTexts(current => ({ ...current, [item.id]: event.target.value }))} maxLength={10000} /></label><div className="flex flex-wrap gap-2"><Button size="sm" disabled={Boolean(busy) || (texts[item.id] || '').trim().length < 10} onClick={() => hearing(item, candidate ? 'answer' : 'question')}><MessageSquare className="mr-2 h-4 w-4" />Registrar</Button>{(data.senate_president || admin) && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => hearing(item, 'open_vote')}><Vote className="mr-2 h-4 w-4" />Encerrar sabatina e abrir votação</Button>}</div></div>}
        {voting && <div className="space-y-2 text-sm"><p>{voting.status === 'active' ? `Votação até ${formatDateTimeBR(voting.end_date)}` : `Resultado: ${voting.result?.approved ? 'aprovado' : 'rejeitado'}`} · Maioria absoluta</p><p>{voting.votes.length} votos registrados</p>{voting.status === 'active' && data.senate_member_id && !ownVote && <div className="flex flex-wrap gap-2">{['Aprovar', 'Rejeitar', 'Abster'].map(vote => <Button key={vote} size="sm" variant={vote === 'Rejeitar' ? 'destructive' : 'outline'} disabled={Boolean(busy)} onClick={() => run(voting.id, 'cast_parliament_vote', { p_voting_id: voting.id, p_member_id: data.senate_member_id, p_vote: vote })}>{vote}</Button>)}</div>}</div>}
      </article>;
    })}</div>
    {!!data.impeachments.length && <div className="space-y-3"><h4 className="font-semibold">Responsabilidade judicial</h4>{data.impeachments.map(item => {
      const voting = data.votes.find(v => v.id === item.senate_voting_id);
      return <article key={item.id} className="space-y-3 rounded-lg border p-4"><p className="font-semibold">{item.case_number}</p><p className="whitespace-pre-wrap break-words text-sm">{item.summary}</p><p className="text-sm">Prazo de defesa: {formatDateTimeBR(item.defense_deadline_at)}</p><ol className="max-h-56 space-y-2 overflow-y-auto">{item.events.map(event => <li key={event.id} className="break-words rounded bg-secondary p-2 text-sm">{formatDateTimeBR(event.created_at)} · {event.summary}</li>)}</ol>{item.status === 'judicial_process' && <div className="flex flex-wrap gap-2">{item.accused_profiles.includes(user.id) && !voting && <Button size="sm" onClick={() => setAction({ kind: 'defense', id: item.id })}>Apresentar defesa</Button>}{(data.senate_president || admin) && !voting && <Button size="sm" disabled={Boolean(busy)} onClick={() => setAction({ kind: 'open_vote', id: item.id })}>Abrir votação após a defesa</Button>}{voting?.status === 'active' && data.senate_member_id && !voting.votes.some(v => v.user_id === user.id) && ['Aprovar', 'Rejeitar', 'Abster'].map(vote => <Button key={vote} size="sm" disabled={Boolean(busy)} onClick={() => run(voting.id, 'cast_parliament_vote', { p_voting_id: voting.id, p_member_id: data.senate_member_id, p_vote: vote })}>{vote} perda do mandato</Button>)}</div>}{voting?.status === 'closed' && <p>{voting.result.approved ? 'Perda do mandato aprovada' : 'Pedido rejeitado'} · {voting.result.yes}/{voting.result.required} votos exigidos</p>}</article>;
    })}</div>}
    <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Designações para o Portal Eleitoral</summary><p className="my-2 text-sm text-muted-foreground">Dois juízes por período eleitoral, de sete dias antes da votação até um dia após o encerramento. A ordem considera quem serviu há mais tempo. Vagas não preenchidas dependem de magistrados em exercício.</p>{data.electoral_assignments.map(item => <p key={item.id} className="text-sm">{item.name} · {formatDateTimeBR(item.starts_at)} até {formatDateTimeBR(item.ends_at)}{item.ended_at ? ' · Encerrada' : ''}</p>)}</details>
    <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !busy) setAction(null); }}><DialogContent><DialogHeader><DialogTitle>{({ resign: 'Renunciar ao mandato', open: 'Instaurar processo de responsabilidade', defense: 'Apresentar defesa', open_vote: 'Abrir votação de responsabilidade' })[action?.kind]}</DialogTitle><DialogDescription>A fundamentação será registrada no histórico institucional. A perda do mandato exige prazo de defesa e dois terços do Senado.</DialogDescription></DialogHeader><label className="block text-sm">Fundamentação<Textarea minLength={20} maxLength={20000} value={reason} onChange={event => setReason(event.target.value)} /></label>{action?.kind === 'open' && <label className="block text-sm">Provas e referências verificáveis<Textarea required value={texts[`evidence:${action.id}`] || ''} onChange={event => setTexts(current => ({ ...current, [`evidence:${action.id}`]: event.target.value }))} /></label>}<DialogFooter><Button variant="outline" disabled={Boolean(busy)} onClick={() => setAction(null)}>Cancelar</Button><Button disabled={Boolean(busy) || reason.trim().length < 20 || (action?.kind === 'open' && !(texts[`evidence:${action.id}`] || '').trim())} onClick={confirmAction}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
