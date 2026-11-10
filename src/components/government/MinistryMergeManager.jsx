import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitMerge, GitPullRequestClosed, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

/**
 * A merger belongs to a specific government, not to the global ministry list.
 * Every absorbed department keeps its history, projects and budget separately.
 */
export default function MinistryMergeManager({
  ministries = [],
  occupiedMinistries = [],
  onUpdate,
  compact = false,
}) {
  const { toast } = useToast();
  const [merges, setMerges] = useState([]);
  const [primaryId, setPrimaryId] = useState('');
  const [mergedId, setMergedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_government_ministry_merges');
    if (error) {
      toast({ title: 'Não foi possível consultar as fusões', description: error.message, variant: 'destructive' });
      return;
    }
    setMerges(Array.isArray(data) ? data : []);
  }, [toast]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.rpc('get_government_ministry_merges').then(({ data, error }) => {
      if (!active) return;
      if (error) toast({ title: 'Erro ao consultar fusões', description: error.message, variant: 'destructive' });
      else setMerges(Array.isArray(data) ? data : []);
      setLoading(false);
    });
    return () => { active = false; };
  }, [toast]);

  const active = useMemo(
    () => ministries.filter(item => item.is_active !== false),
    [ministries]
  );
  const absorbed = useMemo(() => new Set(merges.map(item => item.merged_id)), [merges]);
  const parents = useMemo(() => new Set(merges.map(item => item.primary_id)), [merges]);
  const occupied = useMemo(
    () => new Set(occupiedMinistries),
    [occupiedMinistries]
  );
  const parentOptions = active.filter(item => !absorbed.has(item.id));
  const childOptions = active.filter(item =>
    item.id !== primaryId && !absorbed.has(item.id) &&
    !parents.has(item.id) && !occupied.has(item.name)
  );

  const mutate = async (rpc, params) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(rpc, params);
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message || 'A alteração não foi concluída.');
      await refresh();
      await onUpdate?.();
      setMergedId('');
      toast({
        title: rpc === 'merge_government_ministries' ? 'Ministérios unidos' : 'Fusão desfeita',
        description: rpc === 'merge_government_ministries'
          ? 'Uma única nomeação na pasta principal cobrirá as responsabilidades de ambas.'
          : 'A pasta separada volta a exigir nomeação própria.',
      });
    } catch (error) {
      toast({ title: 'Não foi possível reorganizar os ministérios', description: error.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={compact ? 'border-border/70 bg-card/70' : 'glass-effect'}>
      <CardHeader className={compact ? 'pb-2' : undefined}>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitMerge className="h-4 w-4" /> Mesclar ministérios
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Incorpore uma pasta vaga a outra. Um ministro assume as duas áreas;
          projetos, orçamentos e históricos continuam identificados em suas pastas originais.
          Não altera ministérios de governos futuros.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-xs font-medium">Ministério principal</span>
            <Select value={primaryId || undefined} onValueChange={value => {
              setPrimaryId(value);
              setMergedId('');
            }} disabled={busy || loading}>
              <SelectTrigger aria-label="Ministério principal"><SelectValue placeholder="Manter esta pasta" /></SelectTrigger>
              <SelectContent>
                {parentOptions.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium">Ministério a incorporar</span>
            <Select value={mergedId || undefined} onValueChange={setMergedId} disabled={busy || loading || !primaryId}>
              <SelectTrigger aria-label="Ministério a incorporar"><SelectValue placeholder="Pasta a ser unificada" /></SelectTrigger>
              <SelectContent>
                {childOptions.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button type="button" size="sm" disabled={busy || loading || !primaryId || !mergedId}
          onClick={() => void mutate('merge_government_ministries', {
            p_primary_id: primaryId, p_merged_id: mergedId
          })}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitMerge className="mr-2 h-4 w-4" />}
          Confirmar fusão
        </Button>
        {merges.length > 0 && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-semibold">Pastas unificadas neste Governo</p>
            {merges.map(item => (
              <div key={item.merged_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 p-2">
                <p className="min-w-0 flex-1 text-xs">
                  <strong>{item.primary_name}</strong> + {item.merged_name}
                </p>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => void mutate('unmerge_government_ministry', { p_merged_id: item.merged_id })}>
                  <GitPullRequestClosed className="mr-1 h-3 w-3" /> Desfazer
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
