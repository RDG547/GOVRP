import React, { useEffect, useRef, useState } from 'react';
import { AlignLeft, Building2, HeartPulse, Layers, Loader2, Save, TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { userErrorMessage } from '@/lib/userErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { GovSelect } from '@/components/ui/gov-select';
import { ENTERPRISE_SECTORS } from './EnterpriseOperations';

const draftFrom = enterprise => ({ name: enterprise.name, sector: enterprise.sector, description: enterprise.description || '', market_value: enterprise.market_value || 0, health_score: enterprise.health_score ?? 75 });

export default function EnterpriseDetailsForm({ enterprise, onSaved }) {
  const [draft, setDraft] = useState(() => draftFrom(enterprise));
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const { toast } = useToast();
  useEffect(() => { if (!dirty.current) setDraft(draftFrom(enterprise)); }, [enterprise]);
  const change = (key, value) => { dirty.current = true; setDraft(current => ({ ...current, [key]: value })); };
  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('update_enterprise_details', {
        p_enterprise_id: enterprise.id, p_name: draft.name, p_sector: draft.sector,
        p_description: draft.description, p_market_value: Number(draft.market_value), p_health_score: Number(draft.health_score),
      });
      if (error) throw error;
      dirty.current = false;
      onSaved?.();
      toast({ title: 'Dados da empresa atualizados' });
    } catch (error) {
      console.error('Dados da empresa', error);
      toast({ title: 'Não foi possível salvar', description: userErrorMessage(error), variant: 'destructive' });
    } finally { setBusy(false); }
  };
  return <form onSubmit={save} className="space-y-4 rounded-xl border p-4">
    <h3 className="flex items-center gap-2 font-semibold"><Building2 className="h-5 w-5"/>Dados da empresa</h3>
    <label className="block text-sm"><span className="mb-1 flex items-center gap-2"><Building2 className="h-4 w-4"/>Nome</span><Input required minLength={3} maxLength={120} value={draft.name} onChange={event => change('name', event.target.value)}/></label>
    <label className="block text-sm"><span className="mb-1 flex items-center gap-2"><Layers className="h-4 w-4"/>Setor</span><GovSelect disabled={enterprise.is_system} value={draft.sector} onChange={event => change('sector', event.target.value)}>{ENTERPRISE_SECTORS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</GovSelect></label>
    {enterprise.is_system && <p className="text-xs text-muted-foreground">O setor é vinculado ao serviço essencial prestado por esta empresa.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm"><span className="mb-1 flex items-center gap-2"><TrendingUp className="h-4 w-4"/>Valor de mercado (R$)</span><Input required type="number" min={0} max={1000000000000} step="0.01" value={draft.market_value} onChange={event => change('market_value', event.target.value)}/></label>
      <label className="text-sm"><span className="mb-1 flex items-center gap-2"><HeartPulse className="h-4 w-4"/>Saúde operacional (%)</span><Input required type="number" min={0} max={100} value={draft.health_score} onChange={event => change('health_score', event.target.value)}/></label>
    </div>
    <label className="block text-sm"><span className="mb-1 flex items-center gap-2"><AlignLeft className="h-4 w-4"/>Descrição</span><Textarea maxLength={3000} value={draft.description} onChange={event => change('description', event.target.value)}/></label>
    <div className="flex justify-center"><Button disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}Salvar dados da empresa</Button></div>
  </form>;
}
