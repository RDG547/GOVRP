import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, PlusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/utils';

const categoryLabels = {
  economy: 'Economia',
  politics: 'Política',
  society: 'Sociedade',
  infrastructure: 'Infraestrutura',
  security: 'Segurança',
  international: 'Internacional',
};

const severityLabels = {
  information: 'Informativo',
  attention: 'Atenção',
  important: 'Importante',
  critical: 'Crítico',
};

const emptyForm = {
  title: '',
  description: '',
  category: 'society',
  severity: 'attention',
  deadline: '24',
  actionLabel: '',
  actionDescription: '',
  treasuryCost: '0',
  defaultLabel: 'Não agir',
  defaultDescription: 'Encerrar o prazo sem adotar uma medida pública específica.',
};

const buildActionEffects = (category) => {
  const common = { popularity: { player: 1, simulation: 1 } };
  const segments = {
    economy: {
      '*': { purchasingPower: 1 },
      urban_workers: { welfare: 1, purchasingPower: 2 },
      entrepreneurs: { purchasingPower: 2, approval: 1 },
    },
    politics: { '*': { approval: 1, socialTension: -1 } },
    society: { '*': { welfare: 2, socialTension: -2 } },
    infrastructure: {
      '*': { welfare: 1, purchasingPower: 1 },
      rural_workers: { welfare: 2 },
    },
    security: { '*': { socialTension: -2, approval: 1 } },
    international: { '*': { purchasingPower: 1 }, entrepreneurs: { purchasingPower: 2 } },
  };
  return { ...common, segments: segments[category] || segments.society };
};

const NationalEventManagement = () => {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('national_game_events')
      .select('id,title,description,category,severity,status,starts_at,ends_at,resolved_at,decision_options:national_event_decision_options(id,label,treasury_cost,is_default),response:national_event_responses(id,option_id,response_reason,was_automatic,treasury_cost,resolved_at)')
      .eq('country_code', 'BR')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      toast({ title: 'Eventos indisponíveis', description: error.message, variant: 'destructive' });
    } else {
      setEvents(data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
    let refreshTimer;
    const refresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(load, 250);
    };
    let channel = supabase.channel('admin-national-events');
    ['national_game_events', 'national_event_decision_options', 'national_event_responses'].forEach((table) => {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
    });
    channel.subscribe();
    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const activeCount = useMemo(() => events.filter((event) => event.status === 'active').length, [events]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const createEvent = async (submitEvent) => {
    submitEvent.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc('create_national_game_event', {
      p_title: form.title.trim(),
      p_description: form.description.trim(),
      p_category: form.category,
      p_severity: form.severity,
      p_deadline_rp_hours: Number(form.deadline),
      p_country_code: 'BR',
      p_options: [
        {
          label: form.actionLabel.trim(),
          description: form.actionDescription.trim(),
          treasuryCost: Number(form.treasuryCost || 0),
          authorizedRoles: ['Presidente', 'Admin'],
          effects: buildActionEffects(form.category),
        },
        {
          label: form.defaultLabel.trim(),
          description: form.defaultDescription.trim(),
          isDefault: true,
          authorizedRoles: ['Presidente', 'Admin'],
          effects: {
            segments: { '*': { welfare: -1, socialTension: 1 } },
            popularity: { player: -1, simulation: -1 },
          },
        },
      ],
    });
    if (error) {
      toast({ title: 'Evento não criado', description: error.message, variant: 'destructive' });
    } else {
      toast({
        title: 'Acontecimento nacional iniciado',
        description: 'As autoridades responsáveis foram notificadas e o prazo já está correndo.',
      });
      setForm(emptyForm);
      await load();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/70 bg-muted/25 p-4">
        <h2 className="text-xl font-semibold">Acontecimentos e crises nacionais</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Inicie situações com prazo, alternativas e consequências para o Tesouro, a população e a imprensa.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="border-border/70 bg-card/75">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PlusCircle className="h-5 w-5 text-blue-300" /> Novo acontecimento</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={createEvent} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="event-title">Título</Label>
                <Input id="event-title" required minLength={5} value={form.title} onChange={(event) => setField('title', event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-description">Fatos do acontecimento</Label>
                <Textarea id="event-description" required minLength={20} value={form.description} onChange={(event) => setField('description', event.target.value)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Área</Label>
                  <Select value={form.category} onValueChange={(value) => setField('category', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Gravidade</Label>
                  <Select value={form.severity} onValueChange={(value) => setField('severity', value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(severityLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-deadline">Prazo RP (horas)</Label>
                  <Input id="event-deadline" type="number" min="1" max="168" required value={form.deadline} onChange={(event) => setField('deadline', event.target.value)} />
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="mb-3 text-sm font-semibold text-emerald-200">Resposta ativa</p>
                <div className="space-y-3">
                  <Input aria-label="Nome da resposta ativa" required minLength={2} placeholder="Ex.: Liberar auxílio emergencial" value={form.actionLabel} onChange={(event) => setField('actionLabel', event.target.value)} />
                  <Textarea aria-label="Descrição da resposta ativa" required minLength={10} placeholder="Explique o que a autoridade fará" value={form.actionDescription} onChange={(event) => setField('actionDescription', event.target.value)} />
                  <div className="space-y-2">
                    <Label htmlFor="event-cost">Custo ao Tesouro</Label>
                    <Input id="event-cost" type="number" min="0" step="0.01" value={form.treasuryCost} onChange={(event) => setField('treasuryCost', event.target.value)} />
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <p className="mb-3 text-sm font-semibold text-amber-200">Consequência se o prazo vencer</p>
                <div className="space-y-3">
                  <Input aria-label="Nome da resposta padrão" required minLength={2} value={form.defaultLabel} onChange={(event) => setField('defaultLabel', event.target.value)} />
                  <Textarea aria-label="Descrição da resposta padrão" required minLength={10} value={form.defaultDescription} onChange={(event) => setField('defaultDescription', event.target.value)} />
                </div>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                Iniciar acontecimento
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/75">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>Histórico recente</span><Badge variant="outline">{activeCount} em andamento</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : null}
            {!loading && !events.length ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhum acontecimento registrado.</p> : null}
            {events.map((event) => {
              const response = Array.isArray(event.response) ? event.response[0] : event.response;
              const selectedOption = (event.decision_options || []).find((option) => option.id === response?.option_id);
              return (
                <article key={event.id} className="rounded-xl border border-border/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{event.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{categoryLabels[event.category]} · {severityLabels[event.severity]}</p>
                    </div>
                    <Badge variant={event.status === 'resolved' ? 'secondary' : 'outline'}>
                      {event.status === 'resolved' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <Clock3 className="mr-1 h-3 w-3" />}
                      {event.status === 'resolved' ? 'Resolvido' : 'Em andamento'}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{event.description}</p>
                  {event.status === 'active' && event.ends_at ? <p className="mt-3 text-xs text-amber-200">Prazo: {new Date(event.ends_at).toLocaleString('pt-BR')}</p> : null}
                  {response ? (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-xs">
                      <p className="font-medium text-foreground">{selectedOption?.label || (response.was_automatic ? 'Consequência automática' : 'Resposta oficial')}</p>
                      <p className="mt-1 text-muted-foreground">{response.response_reason}</p>
                      {Number(response.treasury_cost) > 0 ? <p className="mt-2 text-amber-200">Custo: {formatCurrency(response.treasury_cost)}</p> : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default NationalEventManagement;
