import React, { useCallback, useEffect, useState } from 'react';
import { Users, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

export default function EconomicMixControl() {
  const [current, setCurrent] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('economic_state').select('player_share').eq('id', true).single();
    if (!error) setCurrent(Number((data.player_share * 100).toFixed(4)));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useDomainRealtime('economic-mix', 'public', ['economic_state'], load);
  const value = draft ?? current ?? 0;
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('configure_economic_mix', { p_player_share: Number(value) / 100 });
      if (error) throw error;
      await load(); setDraft(null); toast({ title: 'Pesos econômicos atualizados', description: 'A nova distribuição será usada nos próximos cálculos.' });
    } catch (error) { toast({ title: 'Não foi possível salvar', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return <section className="space-y-4 rounded-xl border bg-card p-4"><h2 className="flex items-center gap-2 font-semibold"><Users className="h-5 w-5" />Cidadãos reais × sociedade simulada</h2><p className="text-sm text-muted-foreground">Vigente: {current ?? '…'}% cidadãos reais. A mudança afeta os próximos ciclos, sem recalcular o histórico.</p><Slider aria-label="Peso dos cidadãos reais" min={0} max={100} step={.1} value={[Number(value)]} onValueChange={values => setDraft(values[0])} /><div className="grid gap-4 sm:grid-cols-2"><label>Cidadãos reais (%)<Input type="number" min="0" max="100" step=".1" value={value} onChange={event => setDraft(event.target.value)} /></label><label>Sociedade simulada (%)<Input type="number" min="0" max="100" step=".1" value={Number((100 - Number(value)).toFixed(4))} onChange={event => setDraft(100 - Number(event.target.value))} /></label></div><Button disabled={draft === null || saving || value === '' || Number(value) < 0 || Number(value) > 100} onClick={save}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar pesos</Button></section>;
}
