import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Unlock, Loader2, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { formatDateTimeBR, fromBrasiliaInput } from '@/lib/dateTime';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function CitizenCustodyControl({ citizen }) {
  const { user } = useAuth(), { toast } = useToast();
  const [open, setOpen] = useState(false), [term, setTerm] = useState(null), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const [reason, setReason] = useState(''), [deadline, setDeadline] = useState(''), [timed, setTimed] = useState(false), [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('prison_terms').select('id,custody_origin,administrative_reason,sentence_id,arrest_id,admitted_at,expected_release_at').eq('inmate_id', citizen.id).in('custody_status', ['awaiting_intake','provisional','serving']).order('admitted_at', { ascending: false }).limit(1).maybeSingle();
    setError(error ? 'Não foi possível consultar a custódia atual.' : ''); setTerm(data || null); setLoading(false); setConfirmed(false);
  }, [citizen.id]);
  useEffect(() => { if (open) { setLoading(true); setReason(''); setDeadline(''); setTimed(false); setConfirmed(false); load(); } }, [open, load]);
  useDomainRealtime('admin-custody', open ? user?.id : null, [{ table: 'prison_terms', filter: `inmate_id=eq.${citizen.id}` }], load);
  const judicial = term && term.custody_origin !== 'administrative';
  const releaseAt = timed && deadline ? fromBrasiliaInput(deadline) : null;
  const save = async () => {
    if (!confirmed || saving || judicial || loading || error) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_set_citizen_custody', { p_user_id: citizen.id, p_action: term ? 'release' : 'admit', p_reason: reason, p_release_at: term ? null : releaseAt, p_expected_term_id: term?.id || null });
      if (error) throw error;
      toast({ title: term ? 'Libertação registrada' : 'Custódia administrativa registrada', description: 'O cidadão foi notificado e a alteração ficou no histórico.' }); setOpen(false);
    } catch (error) {
      console.error('admin-custody', error);
      toast({ title: 'Situação não alterada', description: /^(Apenas|Descreva|Selecione|Cidadão|Existe|Este|Defina|Nenhuma|A situação)/.test(error.message) ? error.message : 'Não foi possível concluir a ação. Consulte a situação atual e tente novamente.', variant: 'destructive' }); await load();
    } finally { setSaving(false); }
  };
  return <><Button variant="ghost" size="icon" title="Situação prisional" aria-label={`Situação prisional de ${citizen.full_name}`} onClick={() => setOpen(true)}><Lock className="h-4 w-4 text-amber-400"/></Button><Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Situação prisional</DialogTitle><DialogDescription>{citizen.full_name} · responsável: {user.full_name || user.username}</DialogDescription></DialogHeader>{loading ? <Loader2 className="h-6 w-6 animate-spin"/> : error ? <p role="alert">{error}</p> : <div className="space-y-4"><div className="rounded-lg border p-3 text-sm"><p className="font-semibold">{term ? judicial ? 'Custódia judicial ativa' : 'Custódia administrativa ativa' : 'Cidadão em liberdade'}</p>{term && <><p>Entrada: {formatDateTimeBR(term.admitted_at)}</p><p>Libertação prevista: {term.expected_release_at ? formatDateTimeBR(term.expected_release_at) : 'Indeterminada / manual'}</p>{term.administrative_reason && <p>Motivo: {term.administrative_reason}</p>}</>}</div>{judicial ? <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"><p className="flex gap-2 text-sm"><ShieldAlert className="h-5 w-5 shrink-0"/>Esta prisão está vinculada à Justiça. Consulte o processo e utilize a ação judicial de libertação para registrar seus efeitos corretamente.</p><Button asChild variant="outline"><Link to="/services/justice?view=authority">Consultar Justiça</Link></Button></div> : <><div className="space-y-2"><Label htmlFor={`custody-reason-${citizen.id}`}>Motivo da {term ? 'libertação' : 'prisão'} administrativa</Label><Textarea id={`custody-reason-${citizen.id}`} minLength={20} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></div>{!term && <div className="space-y-3"><label className="flex items-center gap-2"><input type="checkbox" checked={timed} onChange={event => { setTimed(event.target.checked); setConfirmed(false); }}/>Definir prazo de libertação</label>{timed ? <div><Label htmlFor={`custody-date-${citizen.id}`}>Data e hora de Brasília</Label><Input id={`custody-date-${citizen.id}`} type="datetime-local" value={deadline} onChange={event => { setDeadline(event.target.value); setConfirmed(false); }}/></div> : <p className="text-sm text-muted-foreground">Prazo indeterminado, com libertação manual pela administração.</p>}</div>}<label className="flex items-start gap-3 rounded-lg border border-amber-500/30 p-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/>Confirmo {term ? 'libertar' : 'colocar em custódia'} {citizen.full_name}, pelo motivo informado{!term ? releaseAt ? ` até ${formatDateTimeBR(releaseAt)}` : ' por prazo indeterminado' : ''}. Esta ação ficará na auditoria.</label></>}</div>}<DialogFooter className="gap-2"><Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Fechar</Button>{!judicial && <Button onClick={save} disabled={loading || Boolean(error) || saving || !confirmed || reason.trim().length < 20 || (!term && timed && !releaseAt)} variant={term ? 'default' : 'destructive'}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : term ? <Unlock className="mr-2 h-4 w-4"/> : <Lock className="mr-2 h-4 w-4"/>}{term ? 'Libertar cidadão' : 'Confirmar prisão'}</Button>}</DialogFooter></DialogContent></Dialog></>;
}
