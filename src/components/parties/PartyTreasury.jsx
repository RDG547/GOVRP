import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, HeartHandshake, Loader2, ArrowDownLeft, Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { formatDateTimeBR } from '@/lib/dateTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function PartyTreasury({ party }) {
  const { user } = useAuth(); const { toast } = useToast();
  const [balance, setBalance] = useState(null), [entries, setEntries] = useState([]), [page, setPage] = useState(0);
  const [open, setOpen] = useState(false), [amount, setAmount] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const sequence = useRef(0), intent = useRef(null);
  const load = useCallback(async () => {
    const version = ++sequence.current;
    const [fund, ledger] = await Promise.all([
      supabase.from('party_treasuries').select('balance').eq('party_id', party.id).maybeSingle(),
      supabase.from('party_treasury_entries').select('*').eq('party_id', party.id).order('created_at', { ascending: false }).order('id').range(page * 20, page * 20 + 19),
    ]);
    if (version !== sequence.current) return;
    setFailed(Boolean(fund.error || ledger.error));
    if (!fund.error) setBalance(Number(fund.data?.balance || 0));
    if (!ledger.error) setEntries(ledger.data || []);
  }, [party.id, page]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useDomainRealtime('party-treasury', party.id, [
    { table: 'party_treasuries', filter: `party_id=eq.${party.id}` },
    { table: 'party_treasury_entries', filter: `party_id=eq.${party.id}` },
  ], load);
  const donate = async () => {
    const value = parseCurrency(amount);
    if (busy || !Number.isFinite(value) || value <= 0) return;
    if (intent.current?.amount !== value || intent.current?.partyId !== party.id) intent.current = { id: crypto.randomUUID(), amount: value, partyId: party.id };
    setBusy(true);
    try {
      const result = await supabase.rpc('donate_to_party', { p_party_id: party.id, p_amount: value, p_idempotency_key: intent.current.id });
      if (result.error) throw result.error;
      intent.current = null; setOpen(false); setAmount(''); void load();
      toast({ title: 'Doação registrada', description: 'O débito está no seu extrato e a entrada está no caixa do partido.' });
    } catch (error) {
      console.error('Falha ao doar para o partido', error);
      const safe = /saldo|valor válido|recebendo doações|conta bancária/.test(error.message || '') ? error.message : 'Não foi possível confirmar. Tente novamente; a mesma doação não será cobrada duas vezes.';
      toast({ title: 'Doação não concluída', description: safe, variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return <Card className="glass-effect min-w-0"><CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-emerald-400"/>Caixa partidário</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-2xl font-semibold tabular-nums" aria-label="Saldo do caixa partidário">{balance == null ? 'Consultando saldo…' : formatCurrency(balance)}</p>
    <p className="text-sm text-muted-foreground">Os recursos pertencem ao partido. Dono, presidente, vice-presidente e membros podem acompanhar o caixa; não há saque para contas pessoais. As doações e o histórico são públicos.</p>
    {user && party.status !== 'Encerrado' && <Button onClick={() => setOpen(true)}><HeartHandshake className="mr-2 h-4 w-4"/>Doar para o partido</Button>}
    {failed && <Button variant="outline" onClick={load}>Não foi possível consultar. Tentar novamente</Button>}
    <ol className="space-y-3" aria-label="Movimentações do caixa partidário">{entries.map(entry => <li key={entry.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3"><Avatar className="shrink-0"><AvatarImage src={entry.donor_snapshot.avatar_url}/><AvatarFallback>{entry.donor_snapshot.full_name?.charAt(0) || '?'}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="break-words font-medium">{entry.donor_snapshot.full_name || 'Cidadão indisponível'}</p><p className="text-xs text-muted-foreground">{entry.description} · {formatDateTimeBR(entry.created_at)}</p><p className="mt-1 flex items-center gap-1 text-emerald-400"><ArrowDownLeft className="h-4 w-4"/>{formatCurrency(entry.amount)}</p></div></li>)}</ol>
    {!failed && balance != null && !entries.length && <p className="text-sm text-muted-foreground">Nenhuma movimentação nesta página.</p>}
    <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-xs">Página {page + 1}</span><Button variant="outline" size="sm" disabled={entries.length < 20} onClick={() => setPage(page + 1)}>Próxima</Button></div>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}><DialogContent className="max-w-md text-center"><DialogHeader className="sm:text-center"><DialogTitle>Doar para {party.name} ({party.acronym})</DialogTitle><DialogDescription>O valor será debitado da sua conta e creditado no caixa de {party.name}. Seu nome, foto, valor e data aparecerão na transparência do partido.</DialogDescription></DialogHeader><Label htmlFor="party-donation-amount">Valor da doação (R$)</Label><Input id="party-donation-amount" inputMode="numeric" placeholder="R$ 0,00" value={amount} disabled={busy} onChange={e => setAmount(formatCurrency(e.target.value, true))}/><DialogFooter className="gap-2 sm:justify-center sm:space-x-0"><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}><X className="mr-2 h-4 w-4"/>Cancelar</Button><Button disabled={busy || !(parseCurrency(amount) > 0)} onClick={donate}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Check className="mr-2 h-4 w-4"/>}Confirmar doação</Button></DialogFooter></DialogContent></Dialog>
  </CardContent></Card>;
}
