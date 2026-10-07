import NeedEffects from '@/components/NeedEffects';
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Utensils, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { Button } from '@/components/ui/button';
export default function CitizenConsumables({ onBack }) {
  const { user } = useAuth(); const { act } = useCitizenNeeds();
  const [items, setItems] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const load = useCallback(async () => {
    const { data, error: failure } = await supabase.from('user_inventory').select('id,quantity,metadata,product:products(name,consumable_effects)').eq('user_id', user.id).gt('quantity', 0).order('acquired_at');
    if (failure) setError('Não foi possível consultar seus consumíveis.');
    else { setItems((data || []).map(item => ({ ...item, effects: item.metadata?.consumable_effects || item.product?.consumable_effects || {} })).filter(item => Object.values(item.effects).some(value => Number(value) > 0))); setError(''); }
    setLoading(false);
  }, [user.id]);
  useEffect(() => { void load(); }, [load]);
  useDomainRealtime('citizen-consumables', user.id, [{ table: 'user_inventory', filter: `user_id=eq.${user.id}` }], load);
  const consume = async item => { if (busy) return; setBusy(item.id); try { await act('consume', item.id, crypto.randomUUID()); await load(); } catch (failure) { console.error('Consumo do cidadão', failure); setError('Não foi possível consumir. Confira suas necessidades e a disponibilidade do item.'); } finally { setBusy(''); } };
  return <section aria-label="Meus consumíveis" className="space-y-3"><Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Voltar ao estado do cidadão</Button><h3 className="font-semibold">Meus consumíveis</h3>{loading && <Loader2 className="h-5 w-5 animate-spin" />}{error && <p role="alert" className="text-sm">{error}</p>}{!loading && !items.length && <p className="text-sm text-muted-foreground">Você ainda não possui consumíveis. Adquira alimentos e bebidas no mercado.</p>}{items.map(item => <div key={item.id} className="rounded-xl border p-3 space-y-2"><p className="text-sm font-medium break-words">{item.product?.name || 'Consumível'} · {item.quantity} un.</p><NeedEffects effects={item.effects}/><Button size="sm" disabled={Boolean(busy)} onClick={() => consume(item)}>{busy === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Utensils className="mr-2 h-4 w-4" />}Consumir</Button></div>)}</section>;
}
