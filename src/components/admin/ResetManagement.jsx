import { formatLocaleBR } from '@/lib/dateTime';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, Check, Eye, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { executeAdminReset, fetchResetUsers, prepareAdminReset } from '@/lib/adminReset';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const SCOPE_LABELS = { selected_users: 'Resetar cidadãos selecionados', all_users: 'Resetar todos os cidadãos', full_rp: 'Resetar o RP completo' };
const PAGE_SIZE = 15;
const number = (value) => Number(value || 0).toLocaleString('pt-BR');
const recordGroups = [
  ['Identidade, documentos e progresso', /^(citizen_|document|daily_check|user_achievement|political_point)/],
  ['Contas, cartões e operações financeiras', /^(account|card|credit_card|loan|transaction|trade|investment|user_investment|salary|bills_of_exchange)/],
  ['Empresas, produtos e serviços', /^(business|commerce|product|user_inventory|user_service|user_subscription)/],
  ['Posts, comentários e conversas', /^(post|comment|like|repost|storie|follower|x_|trend|notification)/],
  ['Eleições, partidos e Parlamento', /^(election|candidate|vote|party|political_part|parliament|bill|plebiscit|decree|dou_)/],
  ['Justiça e segurança', /^(case_|criminal|police|prison|judicial|justice|investigation|hearing|sentence|arrest|warrant|appeal|fine_|evidence|agies|armed_forces)/],
];
const groupRecordCounts = (records = {}) => Object.entries(records).reduce((groups, [name, count]) => {
  const label = recordGroups.find(([, pattern]) => pattern.test(name))?.[0] || 'Economia, governo e acontecimentos nacionais';
  groups[label] = (groups[label] || 0) + Number(count);
  return groups;
}, {});

export default function ResetManagement() {
  const { user, refreshUser } = useAuth();
  const { state } = useLocation();
  const { toast } = useToast();
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(() => new Set(state?.resetUserId ? [state.resetUserId] : []));
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [intent, setIntent] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [people, resets] = await Promise.all([fetchResetUsers(), supabase.rpc('admin_get_rp_reset_history')]);
      if (['PGRST202', '42883'].includes(resets.error?.code)) {
        throw new Error('O recurso de reset aguarda a atualização do banco de dados deste ambiente.');
      }
      if (resets.error) throw resets.error;
      setUsers(people);
      setHistory(resets.data || []);
      setSelected((current) => new Set([...current].filter((id) => people.some((person) => person.id === id))));
    } catch (failure) {
      setLoadError(failure.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return users.filter((person) => [person.full_name, person.username, person.email, person.real_full_name].some((value) => value?.toLocaleLowerCase('pt-BR').includes(term)));
  }, [users, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const toggle = (id) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const openReset = (scope) => {
    setIntent({ scope, ids: scope === 'selected_users' ? [...selected] : [] });
    setPreview(null); setReason(''); setConfirmation(''); setError('');
  };
  const prepare = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      setPreview(await prepareAdminReset({ scope: intent.scope, userIds: intent.ids, reason: reason.trim() }));
    } catch (failure) { setError(failure.message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const execute = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const completed = await executeAdminReset(preview.request_id, confirmation);
      setResult(completed); setIntent(null); setSelected(new Set());
      toast({ title: 'Reset concluído', description: `${number(completed.users)} conta(s) prontas para criar um novo cidadão.` });
      await refreshUser({ skipSync: true });
      await load();
    } catch (failure) {
      const connectionFailed = /failed to fetch|network|connection|timeout|timed out|load failed/i.test(failure.message || '');
      setError(connectionFailed
        ? `${failure.message} Consulte o histórico ou tente novamente com esta mesma confirmação.`
        : failure.message);
    } finally { inFlight.current = false; setBusy(false); }
  };

  if ((!user?.is_platform_admin && user?.role !== 'Admin')) return <p>Acesso restrito à administração.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Resets de cidadãos e do RP</h2>
        <p className="mt-2 text-sm text-muted-foreground">O cidadão recomeça pela criação de identidade, documentos e conta bancária. O login, os dados privados da conta e o acesso administrativo são preservados.</p>
      </div>
      {result && <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">Reset concluído para {number(result.users)} conta(s). Registro: {result.request_id}.</p>}
      {loadError ? <div role="alert" className="space-y-2 rounded-lg border border-destructive p-4"><p>{loadError}</p><Button variant="outline" onClick={load}>Tentar carregar novamente</Button></div> : null}
      <section className="space-y-4 rounded-xl border p-4">
        <h3 className="text-lg font-semibold">Escolher cidadãos</h3>
        <div className="relative"><Search aria-hidden="true" className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Buscar cidadãos para reset" className="pl-9" placeholder="Buscar por nome, usuário ou e-mail" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || !!loadError || !filtered.length} onClick={() => setSelected((current) => new Set([...current, ...filtered.map((person) => person.id)]))}>Selecionar resultados ({number(filtered.length)})</Button>
          <Button variant="ghost" size="sm" disabled={!selected.size} onClick={() => setSelected(new Set())}>Limpar seleção</Button>
          <span className="text-sm text-muted-foreground">{number(selected.size)} selecionado(s), incluindo outras páginas e filtros</span>
        </div>
        {loading ? <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Carregando contas…</p> : (
          <div className="divide-y rounded-lg border">
            {visible.map((person) => <label key={person.id} className="flex cursor-pointer items-center gap-3 p-3">
              <Checkbox aria-label={`Selecionar ${person.full_name || person.username}`} checked={selected.has(person.id)} onCheckedChange={() => toggle(person.id)} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{person.full_name || 'Cidadão ainda não criado'}</span><span className="block truncate text-xs text-muted-foreground">@{person.username} · {person.email}</span></span>
              <span className="text-xs text-muted-foreground">{person.role}{person.id === user.id ? ' (você)' : ''}</span>
            </label>)}
            {!visible.length && <p className="p-4 text-sm text-muted-foreground">Nenhuma conta encontrada.</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><span className="text-xs">{currentPage} / {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</Button></div>
          <Button disabled={!selected.size || loading || !!loadError} onClick={() => openReset('selected_users')}><RotateCcw className="mr-2 h-4 w-4" />Resetar selecionados ({number(selected.size)})</Button>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">Todos os cidadãos</h3><p className="text-sm text-muted-foreground">Reinicia todas as contas ativas, incluindo administradores. Remove a vida e os vínculos dos cidadãos; mantém o estado nacional e os indicadores do RP.</p><Button variant="outline" disabled={loading || !!loadError || !users.length} onClick={() => openReset('all_users')}>Revisar reset de todos</Button></section>
        <section className="space-y-3 rounded-xl border border-red-500/40 bg-red-500/5 p-4"><h3 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5 text-red-400" />RP completo</h3><p className="text-sm text-muted-foreground">Reinicia cidadãos, transações, posts, empresas, mandatos, processos, finanças públicas e históricos econômicos. Os países ativos começam novamente com dados reais consultados agora.</p><Button variant="destructive" disabled={loading || !!loadError} onClick={() => openReset('full_rp')}>Revisar reset completo</Button></section>
      </div>
      <section className="space-y-3"><h3 className="font-semibold">Histórico de resets</h3><p className="text-xs text-muted-foreground">Doações reais, atendimentos de suporte, catálogos do sistema e registros de segurança são preservados.</p>{history.length ? history.map((entry) => <div key={entry.id} className="rounded-lg border p-3 text-sm"><p className="font-medium">{SCOPE_LABELS[entry.scope]} · {number(entry.result?.users)} conta(s)</p><p>{entry.reason || 'Sem motivo informado'}</p><p className="mt-1 text-xs text-muted-foreground">{formatLocaleBR(new Date(entry.completed_at), 'toLocaleString', 'pt-BR')} · Administrador: {users.find((person) => person.id === entry.requested_by)?.email || entry.requested_by}</p></div>) : <p className="text-sm text-muted-foreground">Nenhum reset registrado.</p>}</section>
      <Dialog open={!!intent} onOpenChange={(open) => { if (!open && !busy) setIntent(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
          <DialogHeader><DialogTitle>{SCOPE_LABELS[intent?.scope]}</DialogTitle><DialogDescription>Esta operação apaga os dados do jogo de forma permanente. Vínculos compartilhados, como transferências, empresas e conversas dos cidadãos afetados, também serão removidos. Revise o alcance antes de confirmar.</DialogDescription></DialogHeader>
          {!preview ? <div className="space-y-2"><Label htmlFor="reset-reason">Motivo do reset (opcional)</Label><Input id="reset-reason" value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: início de uma nova temporada" /><p className="text-xs text-muted-foreground">{intent?.scope === 'selected_users' ? `${intent.ids.length} conta(s) selecionada(s).` : 'Todas as contas ativas, incluindo a sua.'}</p></div> : <div className="space-y-4">
            <p className="rounded-lg bg-muted p-3 font-medium">{number(preview.users)} conta(s) · {number(preview.total_records)} registro(s) relacionados na prévia</p>
            <p className="text-xs text-muted-foreground">A confirmação vale por 15 minutos. Atividades relacionadas criadas até a execução também serão removidas.</p>
            <details className="text-sm"><summary className="cursor-pointer">Ver dados afetados</summary><div className="mt-2 max-h-40 space-y-1 overflow-auto">{Object.entries(groupRecordCounts(preview.records)).map(([name, count]) => <p key={name}>{name}: {number(count)}</p>)}</div></details>
            {preview.snapshots?.map((snapshot) => <p key={snapshot.country_code} className="text-sm">Referência de {snapshot.country_name}: {snapshot.economy.referenceSources.join(', ')}. Câmbio: {snapshot.economy.exchangeDate}. Indicadores anuais: {Object.values(snapshot.economy.referenceYears).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ')}.</p>)}
            <div className="space-y-2"><Label htmlFor="reset-confirmation">Digite {preview.confirmation} para confirmar</Label><Input id="reset-confirmation" autoComplete="off" value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></div>
          </div>}
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{preview ? 'Executando reset. Aguarde a conclusão…' : 'Preparando a prévia e consultando as referências necessárias…'}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setIntent(null)}><X aria-hidden="true" className="mr-2 h-4 w-4" />Cancelar</Button>
            {preview
              ? <Button variant="destructive" disabled={busy || confirmation !== preview.confirmation} onClick={execute}><Check aria-hidden="true" className="mr-2 h-4 w-4" />Confirmar reset</Button>
              : <Button disabled={busy} onClick={prepare}><Eye aria-hidden="true" className="mr-2 h-4 w-4" />Preparar prévia</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
