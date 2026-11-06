import React, { useState } from 'react';
import { Banknote, FilePlus2, Loader2 } from 'lucide-react';
import { useOfficialSalaries, currentSalary } from '@/hooks/use-official-salaries';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';
import { fromBrasiliaInput } from '@/lib/dateTime';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { GovSelect } from '@/components/ui/gov-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export default function OfficialSalaryProposal({ onCreated }) {
  const { roles, error } = useOfficialSalaries(), { toast } = useToast();
  const [role, setRole] = useState(''), [amount, setAmount] = useState(''), [reason, setReason] = useState(''), [startsAt, setStartsAt] = useState('');
  const [preview, setPreview] = useState(null), [busy, setBusy] = useState(false);
  const prepare = async event => {
    event.preventDefault(); setBusy(true);
    const result = await supabase.rpc('preview_official_salary', { p_role: role, p_amount: Number(amount) });
    setBusy(false);
    if (result.error) { toast({ title: 'Não foi possível calcular o impacto', description: 'Confira o cargo e o valor proposto.', variant: 'destructive' }); return; }
    setPreview(result.data);
  };
  const propose = async () => {
    if (busy) return; setBusy(true);
    try {
      const result = await supabase.rpc('propose_official_salary', { p_role: preview.role, p_amount: preview.amount, p_expected_version: preview.version, p_justification: reason, p_valid_from: startsAt ? fromBrasiliaInput(startsAt) : null });
      if (result.error) throw result.error;
      setPreview(null); setReason(''); setAmount(''); onCreated?.();
      toast({ title: 'Projeto salarial apresentado', description: 'A Câmara e o Senado precisam aprovar a proposta antes da sanção e da vigência.' });
    } catch (failure) { console.error('Proposta salarial', failure); toast({ title: 'Projeto não apresentado', description: /catálogo|versão|valor|justificativa|autoridade/i.test(failure.message) ? failure.message : 'Confira a competência presidencial e os dados informados.', variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <section className="space-y-4 rounded-xl border p-4"><h3 className="flex items-center gap-2 text-lg font-semibold"><Banknote className="h-5 w-5 text-emerald-400" />Propor remuneração oficial</h3><p className="text-sm text-muted-foreground">O projeto tramita na Câmara e no Senado. A mudança depende de sanção e vigência; pagamentos anteriores preservam seus valores.</p>{error && <p role="alert">{error}</p>}<form onSubmit={prepare} className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Cargo<GovSelect required value={role} onChange={event => { setRole(event.target.value); setAmount(String(currentSalary(roles.find(item => item.role === event.target.value) || {}))); }}><option value="">Selecione</option>{roles.map(item => <option key={item.role} value={item.role}>{item.title || item.role} · {formatCurrency(currentSalary(item))}/semana</option>)}</GovSelect></label><label className="block text-sm">Nova remuneração semanal<CurrencyInput decimal required value={amount} min="0" max="1000000" onChange={event => setAmount(event.target.value)} /></label><label className="block text-sm sm:col-span-2">Vigência pretendida (Brasília, opcional)<Input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} /><span className="text-xs text-muted-foreground">Sem data: após a sanção. Se a tramitação ultrapassar a data escolhida, valerá após a publicação, sem retroatividade.</span></label><label className="block text-sm sm:col-span-2">Justificativa<Textarea required minLength={40} maxLength={10000} value={reason} onChange={event => setReason(event.target.value)} /></label><Button type="submit" disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700 sm:col-span-2">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}Revisar proposta e impacto</Button></form><Dialog open={Boolean(preview)} onOpenChange={open => { if (!open && !busy) setPreview(null); }}><DialogContent><DialogHeader><DialogTitle>O que esta lei alterará?</DialogTitle><DialogDescription>{preview?.role} · remuneração semanal</DialogDescription></DialogHeader><p className="text-xl font-semibold">{formatCurrency(preview?.current_amount || 0)} → {formatCurrency(preview?.amount || 0)}</p><p className="text-sm">{preview?.holders} ocupante(s) atualmente elegível(is). Variação estimada da folha semanal: <strong>{formatCurrency(preview?.weekly_difference || 0)}</strong>.</p><p className="text-xs text-muted-foreground">A estimativa usa os cargos atuais; a folha efetiva considera os ocupantes e a remuneração vigentes na data do pagamento.</p><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setPreview(null)}>Voltar</Button><Button disabled={busy} onClick={propose}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Enviar à Câmara</Button></DialogFooter></DialogContent></Dialog></section>;
}
