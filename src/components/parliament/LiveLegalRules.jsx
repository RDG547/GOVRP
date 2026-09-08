import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { LEGAL_REALTIME_TABLES, LEGAL_KIND_LABELS, LEGAL_BASIS_LABELS, legalRuleValue } from '@/lib/legalMeasures';

export default function LiveLegalRules({ basis = null, compact = false }) {
  const [rules, setRules] = useState([]);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const seq = ++request.current;
    const result = await supabase.from('government_rules').select('*').order('description');
    if (seq !== request.current) return;
    setError(Boolean(result.error));
    if (result.error) console.error('Regras vigentes indisponíveis', result.error);
    else setRules(result.data || []);
  }, []);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  useDomainRealtime('legal-rules', 'public', LEGAL_REALTIME_TABLES, load);
  const visible = rules.filter(rule => (rule.is_active || rule.source_id || rule.source_kind === 'system') && rule.rule_kind !== 'penalty' && (!basis || rule.definition?.basis === basis));
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="Regras legais vigentes">
    <h3 className="font-semibold">Regras legais vigentes</h3>
    {error ? <button className="text-sm underline" onClick={load}>Tentar carregar regras novamente</button> : <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      {visible.map(rule => <div key={rule.rule_key} className="rounded-lg bg-secondary/50 p-3 min-w-0"><p className="text-sm font-medium break-words">{rule.description}</p><p className="text-lg font-semibold">{legalRuleValue(rule)}</p><p className="text-xs text-muted-foreground">{LEGAL_KIND_LABELS[rule.rule_kind]} · {LEGAL_BASIS_LABELS[rule.definition?.basis] || 'Programa público'}</p>{rule.definition?.exempt_below != null && <p className="text-xs">Isenção até R$ {rule.definition.exempt_below}</p>}{rule.valid_until && <p className="text-xs">Até {new Date(rule.valid_until).toLocaleString('pt-BR')}</p>}</div>)}
    </div>}
  </section>;
}
