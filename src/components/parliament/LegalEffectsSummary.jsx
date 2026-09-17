import { formatLocaleBR } from '@/lib/dateTime';
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { LEGAL_REALTIME_TABLES, LEGAL_BASIS_LABELS, legalRuleValue } from '@/lib/legalMeasures';

const statusLabel = { active: 'Em vigor', scheduled: 'Vigência futura', revoked: 'Encerrado', draft: 'Proposto' };
const audienceLabel = { all: 'Todos', citizen: 'Pessoas físicas', business: 'Empresas' };
export default function LegalEffectsSummary({ effects = [] }) {
  if (!effects.length) return null;
  return <section className="mt-3 space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3" aria-label="Efeitos da norma">
    <h3 className="text-sm font-semibold">Efeitos da norma</h3>
    {effects.map((effect, index) => {
      const data = effect.effect_data || effect;
      const definition = data.definition || {};
      const previous = effect.previous_snapshot?.numeric_value ?? effect.previous;
      const value = data.value ?? effect.effect_value;
      const restriction = data.kind === 'restriction' || (definition.basis && !definition.nature);
      const nextLabel = restriction ? 'Atividade restrita no escopo definido' : legalRuleValue({ numeric_value: value, definition });
      return <div key={effect.id || index} className="space-y-1 text-sm break-words">
        <p className="font-medium">{data.name || effect.effect_key}: {previous != null && !restriction && `${legalRuleValue({ numeric_value: previous, definition })} → `}{data.action === 'revoke' ? 'Revogada para novas operações' : nextLabel}</p>
        <p>{statusLabel[effect.status] || 'Proposto'} · {LEGAL_BASIS_LABELS[definition.basis] || (data.kind === 'penalty' ? 'Justiça' : 'Política pública')} · {audienceLabel[definition.audience] || 'Público definido na norma'}</p>
        {definition.minimum != null && <p>Pena: {definition.minimum} a {definition.maximum} anos RP. Multa: R$ {Number(definition.fine || 0).toLocaleString('pt-BR')}.</p>}
        {definition.budget != null && <p>Orçamento máximo: R$ {Number(definition.budget).toLocaleString('pt-BR')}. Pagamento único por beneficiário elegível.</p>}
        {definition.discount_rate != null && <p>Redução da cobrança: {Number(definition.discount_rate * 100).toLocaleString('pt-BR')}%{definition.discount_sector_id ? ' no setor selecionado' : ''}.</p>}
        {definition.exempt_below != null && <p>Isenção para operações até R$ {Number(definition.exempt_below).toLocaleString('pt-BR')}.</p>}
        {definition.hour_from && <p>Horário RP: {definition.hour_from} às {definition.hour_until}.</p>}
        {definition.weekdays?.length > 0 && <p>Dias: {definition.weekdays.map(day => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][day]).join(', ')}.</p>}
        <p className="text-xs text-muted-foreground">Vigência: {effect.valid_from ? formatLocaleBR(new Date(effect.valid_from), 'toLocaleString', 'pt-BR') : 'A partir da publicação válida'}{effect.valid_until ? ` até ${formatLocaleBR(new Date(effect.valid_until), 'toLocaleString', 'pt-BR')}` : ''}.</p>
      </div>;
    })}
  </section>;
}

export function LegalEffectsForSource({ sourceKind, sourceId }) {
  const [effects, setEffects] = useState([]);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('law_effects').select('*').eq('source_kind', sourceKind).eq('source_id', sourceId);
    if (error) { console.error('Consulta dos efeitos da norma', error); return; }
    setEffects(data || []);
  }, [sourceKind, sourceId]);
  useEffect(() => { void load(); }, [load]);
  useDomainRealtime('legal-rules', 'public', LEGAL_REALTIME_TABLES, load);
  return <LegalEffectsSummary effects={effects} />;
}
