import React, { useCallback, useEffect, useState } from 'react';
import { Save, Receipt, Coins, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { LEGAL_REALTIME_TABLES, legalRuleValue } from '@/lib/legalMeasures';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

function LevyEditor({ rule, onSaved }) {
  const [nature, setNature] = useState(rule.definition?.nature || 'percentage');
  const percent = nature === 'percentage';
  const factor = percent ? 100 : 1;
  const [value, setValue] = useState(rule.numeric_value * factor);
  const [version, setVersion] = useState(rule.version);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  useEffect(() => { if (!dirty) { setNature(rule.definition?.nature || 'percentage'); setValue(rule.numeric_value * (rule.definition?.nature === 'percentage' ? 100 : 1)); setVersion(rule.version); } }, [rule.numeric_value, rule.version, rule.definition?.nature, dirty]);
  const change = next => { setValue(next); setDirty(true); };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc('adjust_existing_levy', { p_rule_key: rule.rule_key, p_value: Number(value) / factor, p_expected_version: version, p_nature: nature });
      if (error) throw error;
      setDirty(false); await onSaved();
      toast({ title: 'Valor atualizado', description: 'O ato foi publicado e novas operações seguem o valor vigente.' });
    } catch (error) { toast({ title: 'Ajuste não concluído', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
    <div><h3 className="font-semibold break-words">{rule.description}</h3><p className="text-sm text-muted-foreground">Vigente: {legalRuleValue(rule)}</p></div>
    <Tabs value={nature} onValueChange={next => { setNature(next); setValue(0); setDirty(true); }}><TabsList><TabsTrigger value="percentage">Percentual (%)</TabsTrigger><TabsTrigger value="fixed">Valor fixo (R$)</TabsTrigger></TabsList></Tabs>
    <Slider aria-label={`Ajustar ${rule.description}`} value={[Number(value) || 0]} min={0} max={percent ? 100 : 1000000} step={percent ? .01 : 1} onValueChange={values => change(values[0])} />
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm">Novo valor ({percent ? '%' : 'R$'})<Input type={percent ? 'number' : 'text'} inputMode="decimal" min="0" max={percent ? 100 : 1000000} step="0.01" value={percent ? value : Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} onChange={event => change(percent ? event.target.value : Math.min(1000000, Number(event.target.value.replace(/\D/g, '')) / 100))} /></label><Button disabled={!dirty || saving || value === '' || Number(value) < 0 || !Number.isFinite(Number(value)) || Number(value) > (percent ? 100 : 1000000) || version !== rule.version} onClick={save}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Salvar ajuste</Button></div>
    {dirty && <p className="text-sm">Ao salvar: {legalRuleValue(rule)} → {Number(value).toLocaleString('pt-BR')}{percent ? '%' : ' reais'}. As demais condições continuam vigentes.</p>}
    {dirty && version !== rule.version && <div role="status" className="text-sm text-amber-400">Uma nova medida alterou esta regra. <Button size="sm" variant="outline" onClick={() => setDirty(false)}>Usar valor atualizado</Button></div>}
  </section>;
}
export default function ExecutiveLevyManager() {
  const [rules, setRules] = useState([]);
  const [kind, setKind] = useState('tax');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const result = await supabase.from('government_rules').select('*').in('rule_kind', ['tax', 'fee']).eq('is_active', true).order('description');
    if (result.error) setError('Não foi possível consultar os tributos.');
    else { setRules(result.data); setError(''); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useDomainRealtime('legal-rules', 'public', LEGAL_REALTIME_TABLES, load);
  return <div className="min-w-0 space-y-4"><h2 className="text-xl font-semibold">Gestão de Impostos e Tarifas</h2><p className="text-sm text-muted-foreground">Ajuste valores vigentes. Criação e extinção seguem o processo legislativo; o Parlamento pode aprovar novas regras.</p><Tabs value={kind} onValueChange={setKind}><TabsList><TabsTrigger value="tax"><Receipt className="mr-2 h-4 w-4" />Impostos</TabsTrigger><TabsTrigger value="fee"><Coins className="mr-2 h-4 w-4" />Tarifas</TabsTrigger></TabsList></Tabs>{error && <p role="alert">{error}</p>}<div className="grid min-w-0 gap-4 xl:grid-cols-2">{rules.filter(rule => rule.rule_kind === kind).map(rule => <LevyEditor key={rule.rule_key} rule={rule} onSaved={load} />)}</div></div>;
}
