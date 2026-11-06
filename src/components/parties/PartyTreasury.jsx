import EntityCashTransfer from '@/components/EntityCashTransfer';
import EntityFines from '@/components/justice/EntityFines';
import PartyDonationDialog from './PartyDonationDialog';
import PagedResults from '@/components/ui/paged-results';
import {CurrencyInput} from '@/components/ui/currency-input';
import { partyColor } from '@/lib/partyIdentity';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, HeartHandshake, Loader2, ArrowDownLeft, ArrowUpRight, Check, X } from 'lucide-react';
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
  const [failed,setFailed]=useState(false);
  const sequence = useRef(0);
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
  return <Card style={{borderTopColor:partyColor(party.color),borderTopWidth:3}} className="glass-effect min-w-0"><CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5" style={{color:partyColor(party.color)}}/>Caixa partidário</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-2xl font-semibold tabular-nums" aria-label="Saldo do caixa partidário">{balance == null ? 'Consultando saldo…' : formatCurrency(balance)}</p>
    <p className="text-sm text-muted-foreground">Os recursos pertencem ao partido. Doações e transferências têm histórico público. O dono e o presidente podem transferir recursos com justificativa registrada.</p>
    {user && party.status !== 'Encerrado' && <PartyDonationDialog party={party} onDonated={load}/>}
    {user&&([party.owner_id||party.founder_id,party.president_id].includes(user.id)||(user.is_platform_admin&&user.admin_development?.mode==='total'))&&party.status!=='Encerrado'&&<EntityCashTransfer partyId={party.id} onCompleted={load}/>}
    <EntityFines targetType="party" targetId={party.id} onChanged={load}/>
    {failed && <Button variant="outline" onClick={load}>Não foi possível consultar. Tentar novamente</Button>}
    <PagedResults page={page}><ol className="space-y-3" aria-label="Movimentações do caixa partidário">{entries.map(entry => <li key={entry.id} className="flex min-w-0 items-start gap-3 rounded-lg border p-3"><Avatar className="shrink-0"><AvatarImage src={entry.donor_snapshot?.avatar_url}/><AvatarFallback>{entry.donor_snapshot?.full_name?.charAt(0) || '?'}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="break-words font-medium">{entry.donor_snapshot?.full_name || 'Cidadão indisponível'}</p><p className="text-xs text-muted-foreground">{entry.description} · {formatDateTimeBR(entry.created_at)}</p><p className={`mt-1 flex items-center gap-1 ${Number(entry.amount)<0?'text-red-400':'text-emerald-400'}`}>{Number(entry.amount)<0?<ArrowUpRight className="h-4 w-4"/>:<ArrowDownLeft className="h-4 w-4"/>}{formatCurrency(entry.amount)}</p></div></li>)}</ol></PagedResults>
    {!failed && balance != null && !entries.length && <p className="text-sm text-muted-foreground">Nenhuma movimentação nesta página.</p>}
    <div className="flex items-center justify-between gap-2"><Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-xs">Página {page + 1}</span><Button variant="outline" size="sm" disabled={entries.length < 20} onClick={() => setPage(page + 1)}>Próxima</Button></div>

  </CardContent></Card>;
}
