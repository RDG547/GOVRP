import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useQueuedRefresh } from '@/hooks/use-queued-refresh';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/economy/format';

const rpc = async (name, params) => { const { data, error } = await supabase.rpc(name, params); if (error) throw error; return data; };

export default function PopulationCirculationControl() {
  const { user } = useAuth();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [form, setForm] = useState(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!user?.id) return;
    const request = ++sequence.current;
    try { const result = await rpc('get_population_circulation_status'); if (request === sequence.current) { setData(result); setError(''); } }
    catch (failure) { if (request === sequence.current) setError(failure.message); }
  }, [user?.id]);
  const refresh = useQueuedRefresh(load);
  useEffect(() => { setData(null); setForm(null); setError(''); void refresh(); return () => { sequence.current += 1; }; }, [refresh, user?.id]);
  useDomainRealtime('population-circulation', user?.id, ['government_finances'], refresh, Boolean(user?.id));
  const active = data?.plans?.find(plan => plan.active);
  const act = async (action) => { if (busy) return; setBusy(true); setError(''); try { await action(); setForm(null); await refresh(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  return <Card>
    <CardHeader><CardTitle className="text-lg">Programa autorizado de consumo populacional</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p>Uma decisão administrativa pode autorizar pagamentos diários com recursos existentes do Tesouro. O programa tem limite acumulado e prazo em dias reais; cada pagamento gera transferência e despesa pública.</p>
      {active ? <div className="space-y-2 rounded-xl border border-border/60 p-3">
        <p>Limite diário: <strong>{formatCurrency(active.daily_limit)}</strong> · Pago: <strong>{formatCurrency(active.total_paid)}</strong> de {formatCurrency(active.total_limit)}.</p>
        <p>Vigência: {active.starts_on} a {active.ends_on} (datas reais de Brasília).</p>
        <p className="break-words">Decisão: {active.authority_reference}</p>
        <Button variant="outline" disabled={busy} onClick={() => act(() => rpc('stop_population_circulation', { p_plan_id: active.id }))}>Encerrar pagamentos futuros</Button>
      </div> : <p className="text-muted-foreground">Nenhum programa ativo. O sistema não transfere recursos sem autorização.</p>}
      <p>Tesouro disponível: {formatCurrency(data?.treasury)}</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button variant="outline" disabled={busy || !data} onClick={() => setForm({ key: crypto.randomUUID(), daily: '', total: '', end: '', reference: '' })}>Preparar autorização</Button>
      <Dialog open={Boolean(form)} onOpenChange={open => { if (!open && !busy) setForm(null); }}>
        <DialogContent><DialogHeader><DialogTitle>Autorizar orçamento de consumo</DialogTitle><DialogDescription>Esta decisão substitui o programa vigente. Os pagamentos começam no próximo ciclo diário, limitados pelo saldo do Tesouro, teto diário, saldo autorizado e prazo.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="circulation-daily">Teto por dia real (R$)</Label><Input id="circulation-daily" type="number" min="0.01" max="100000" step="0.01" value={form?.daily || ''} onChange={e => setForm({ ...form, daily: e.target.value })} />
            <Label htmlFor="circulation-total">Orçamento total autorizado (R$)</Label><Input id="circulation-total" type="number" min="0.01" max="1000000" step="0.01" value={form?.total || ''} onChange={e => setForm({ ...form, total: e.target.value })} />
            <Label htmlFor="circulation-end">Último dia real (até 90 dias)</Label><Input id="circulation-end" type="date" value={form?.end || ''} onChange={e => setForm({ ...form, end: e.target.value })} />
            <Label htmlFor="circulation-reference">Referência e justificativa da decisão autorizadora</Label><Textarea id="circulation-reference" value={form?.reference || ''} onChange={e => setForm({ ...form, reference: e.target.value })} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setForm(null)}>Cancelar</Button><Button disabled={busy || !form?.end || !Number(form?.daily) || Number(form?.total) < Number(form?.daily) || form?.reference?.trim().length < 20} onClick={() => act(() => rpc('approve_population_circulation', { p_key: form.key, p_daily_limit: Number(form.daily), p_total_limit: Number(form.total), p_ends_on: form.end, p_authority_reference: form.reference }))}>Autorizar orçamento e prazo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  </Card>;
}
