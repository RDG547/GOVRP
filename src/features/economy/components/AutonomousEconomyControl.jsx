import React, { useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/economy/format';

export default function AutonomousEconomyControl({ preview, onChanged }) {
  const [justification, setJustification] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef(null);
  const config = preview?.config;
  if (!config) return null;
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    request.current ||= crypto.randomUUID();
    try {
      const result = await supabase.rpc('configure_autonomous_economy', { p_enabled: !config.enabled, p_justification: justification, p_key: request.current });
      if (result.error) throw result.error;
      request.current = null; setJustification(''); await onChanged?.();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  return <details className="mt-3 space-y-3">
    <summary className="cursor-pointer font-medium">Decisão administrativa sobre o piloto</summary>
    <p className="text-xs text-muted-foreground">O piloto usa poupança existente. Limite de {config.max_entries_per_day} entradas/dia e {config.max_active} NPCs ativas; reserva populacional de {Math.round(config.population_reserve_ratio * 100)}%. A habilitação não faz aporte nem garante vendas.</p>
    <p className="text-xs">Capital máximo disponível neste saldo: {formatCurrency(Math.floor(Number(preview.population_savings || 0) * (1 - config.population_reserve_ratio) * 100) / 100)}.</p>
    <Label htmlFor="autonomous-justification">Justificativa e referência da validação</Label>
    <Textarea id="autonomous-justification" value={justification} disabled={busy} onChange={event => { request.current = null; setJustification(event.target.value); }} />
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button variant="outline" disabled={busy || justification.trim().length < 20} onClick={save}>{busy ? 'Registrando…' : config.enabled ? 'Desativar novas entradas automáticas' : 'Autorizar piloto de empresas NPC'}</Button>
  </details>;
}
