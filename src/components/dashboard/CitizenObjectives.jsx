import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, Target, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';

const missingObjectiveSchemaCodes = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const CitizenObjectives = () => {
  const { toast } = useToast();
  const [objectives, setObjectives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const { data, error } = await supabase.rpc('refresh_my_citizen_objectives');
    if (error) {
      if (missingObjectiveSchemaCodes.has(error.code)) {
        setAvailable(false);
      } else if (!silent) {
        toast({ title: 'Não foi possível atualizar seus objetivos', description: error.message, variant: 'destructive' });
      }
    } else {
      setAvailable(true);
      setObjectives(data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    refresh();
    const handleResume = () => refresh({ silent: true });
    window.addEventListener('govrp:resume', handleResume);
    return () => window.removeEventListener('govrp:resume', handleResume);
  }, [refresh]);

  const completedCount = useMemo(
    () => objectives.filter((objective) => Boolean(objective.completed_at)).length,
    [objectives],
  );

  if (!available) return null;

  return (
    <Card className="glass-effect mb-6 overflow-hidden border-amber-400/20">
      <CardHeader className="gap-4 bg-gradient-to-r from-amber-500/10 to-purple-500/10 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-amber-300" /> Objetivos do cidadão</CardTitle>
          <CardDescription>Metas ligadas às suas ações reais no GOV.RP. Ao concluir, a reputação é reconhecida automaticamente.</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {objectives.length > 0 && <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">{completedCount}/{objectives.length} concluídos</span>}
          <Button variant="ghost" size="icon" onClick={() => refresh()} disabled={loading} aria-label="Atualizar objetivos">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        {loading && !objectives.length ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-amber-300" /> Preparando seus objetivos...</div>
        ) : objectives.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {objectives.map((objective) => {
              const completed = Boolean(objective.completed_at);
              const percentage = Math.min(100, (Number(objective.progress || 0) / Number(objective.target_value || 1)) * 100);
              return (
                <article key={objective.objective_id} className={`rounded-xl border p-4 ${completed ? 'border-emerald-400/20 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`rounded-full p-2 ${completed ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>
                      {completed ? <CheckCircle2 className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{objective.category}</p>
                          <h3 className="font-semibold text-foreground">{objective.title}</h3>
                        </div>
                        <span className="shrink-0 text-xs font-semibold text-amber-200">+{objective.reputation_reward} reputação</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{objective.description}</p>
                      <Progress value={percentage} className="mt-4 h-2" indicatorClassName={completed ? 'bg-emerald-400' : 'bg-amber-400'} />
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{objective.progress}/{objective.target_value}</span>
                        {completed ? (
                          <span className="font-semibold text-emerald-300">Concluído</span>
                        ) : (
                          <Link to={objective.action_path} className="inline-flex items-center font-semibold text-blue-300 hover:text-blue-200">Continuar <ArrowRight className="ml-1 h-3 w-3" /></Link>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">Novos objetivos aparecerão conforme sua jornada evoluir.</p>
        )}
      </CardContent>
    </Card>
  );
};

export default CitizenObjectives;
