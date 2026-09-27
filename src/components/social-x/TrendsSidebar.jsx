import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { GovSelect } from '@/components/ui/gov-select';

export default function TrendsSidebar() {
  const [trends, setTrends] = useState([]);
  const [hours, setHours] = useState(12);
  const [error, setError] = useState('');
  const fetchTrends = useCallback(async () => {
    const result = await supabase.rpc('get_x_trends', { p_window_hours: hours });
    if (result.error) { console.error('Tendências do X:', result.error); setError('Não foi possível carregar as tendências.'); }
    else { setTrends(result.data || []); setError(''); }
  }, [hours]);
  useEffect(() => {
    void fetchTrends();
    const timer = setInterval(() => { void fetchTrends(); }, 60000);
    return () => clearInterval(timer);
  }, [fetchTrends]);
  useDomainRealtime('x-trends', 'public', ['posts'], fetchTrends);
  return <aside className="space-y-6 lg:col-span-1"><div className="lg:sticky lg:top-24"><Card>
    <CardContent className="p-4">
      <h3 className="flex items-center gap-2 text-xl font-bold"><TrendingUp/>Tendências</h3>
      <GovSelect aria-label="Período das tendências" className="mt-3" value={hours} onChange={event=>setHours(Number(event.target.value))}>{[6,12,24].map(value=><option key={value} value={value}>Últimas {value} horas</option>)}</GovSelect>
      <p className="mt-2 text-xs text-muted-foreground">Assuntos recentes, com maior peso para pessoas diferentes.</p>
      {error && <p role="status" className="mt-3 text-sm">{error}</p>}
      {!error && !trends.length && <p className="mt-3 text-sm text-muted-foreground">Ainda não há assuntos em destaque neste período.</p>}
      <ol className="mt-3 space-y-1">{trends.map(trend=><li key={trend.hashtag}><Link className="block rounded-lg p-2 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" to={`/services/x/search?q=${encodeURIComponent(`#${trend.hashtag}`)}`}><p className="break-words font-semibold">#{trend.hashtag}</p><p className="text-xs text-muted-foreground">{trend.post_count} publicações · {trend.unique_authors} pessoas</p></Link></li>)}</ol>
    </CardContent>
  </Card></div></aside>;
}
