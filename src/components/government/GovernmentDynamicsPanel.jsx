import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Building2, Gauge, Loader2, Megaphone, Newspaper, Plus, ShieldAlert, Star, TrendingUp } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import UserSelectOption from '@/components/UserSelectOption';
import { fetchActiveMinistersWithProfiles } from '@/lib/ministers';

const emptyMinistry = { id: null, name: '', acronym: '', description: '', responsibilities: '', annual_budget: '0', is_active: true };
const emptyOutlet = { id: null, name: '', editor_id: '', editorial_profile: 'neutro', credibility_score: '60', is_active: true };
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0));
const ministerEventTypes = [
  ['policy_success', 'Política bem-sucedida'],
  ['policy_failure', 'Falha de política pública'],
  ['administrative_delivery', 'Entrega administrativa'],
  ['scandal', 'Escândalo comprovado'],
  ['investigation', 'Investigação formal'],
  ['acquitted', 'Absolvição'],
  ['conviction', 'Condenação'],
];

const GovernmentDynamicsPanel = () => {
  const { toast } = useToast();
  const [data, setData] = useState({ popularity: null, events: [], indicators: [], ministries: [], ministers: [], ministerHistory: [], outlets: [], contracts: [], integrityCases: [], profiles: [] });
  const [indicatorCode, setIndicatorCode] = useState('');
  const [ministryForm, setMinistryForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [outletForm, setOutletForm] = useState(null);
  const [contractForm, setContractForm] = useState(null);
  const [coverageForm, setCoverageForm] = useState(null);
  const [integrityForm, setIntegrityForm] = useState(null);
  const [impactForm, setImpactForm] = useState(null);

  const load = useCallback(async () => {
    const [popularity, events, indicators, ministries, ministers, ministerHistory, outlets, contracts, integrityCases, profiles] = await Promise.all([
      supabase.from('government_popularity_state').select('*').eq('country_code', 'BR').single(),
      supabase.from('government_popularity_events').select('*').eq('country_code', 'BR').order('created_at', { ascending: false }).limit(30),
      supabase.from('national_indicator_points').select('*').eq('country_code', 'BR').order('recorded_at', { ascending: true }).limit(500),
      supabase.from('government_ministries').select('*').order('name'),
      fetchActiveMinistersWithProfiles(supabase),
      supabase.from('minister_history').select('*').order('created_at', { ascending: false }).limit(60),
      supabase.from('media_outlets').select('*').order('name'),
      supabase.from('government_media_contracts').select('*, outlet:media_outlets(name)').order('created_at', { ascending: false }).limit(40),
      supabase.from('public_integrity_cases').select('*').order('created_at', { ascending: false }).limit(40),
      supabase.from('profiles').select('id, full_name, username, avatar_url').order('full_name').limit(300),
    ]);
    if (ministers.error || ministers.warning) {
      console.warn('Não foi possível carregar todos os dados ministeriais:', ministers.error || ministers.warning);
    }
    const error = popularity.error || events.error || indicators.error || ministries.error || ministerHistory.error || outlets.error || contracts.error || integrityCases.error || profiles.error;
    if (error) throw error;
    setData({ popularity: popularity.data, events: events.data || [], indicators: indicators.data || [], ministries: ministries.data || [], ministers: ministers.data || [], ministerHistory: ministerHistory.data || [], outlets: outlets.data || [], contracts: contracts.data || [], integrityCases: integrityCases.data || [], profiles: profiles.data || [] });
    setIndicatorCode((current) => current || indicators.data?.at(-1)?.indicator_code || '');
    setLoading(false);
  }, []);

  useEffect(() => { load().catch((error) => { setLoading(false); toast({ title: 'Falha nos indicadores nacionais', description: error.message, variant: 'destructive' }); }); }, [load, toast]);
  useEffect(() => {
    const refresh = () => load().catch(() => {});
    const channel = supabase.channel('government-dynamics-panel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'government_popularity_state' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'government_popularity_events' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'national_indicator_points' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'government_ministries' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ministers' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'minister_history' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'media_outlets' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'government_media_contracts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'public_integrity_cases' }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const indicatorCodes = useMemo(() => [...new Set(data.indicators.map((item) => item.indicator_code))], [data.indicators]);
  const chartData = useMemo(() => data.indicators.filter((item) => item.indicator_code === indicatorCode).map((item) => ({ value: Number(item.value), label: new Date(item.recorded_at).toLocaleDateString('pt-BR'), source: item.source_type })), [data.indicators, indicatorCode]);

  const saveMinistry = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('manage_government_ministry', {
        p_ministry_id: ministryForm.id,
        p_name: ministryForm.name,
        p_acronym: ministryForm.acronym,
        p_description: ministryForm.description,
        p_responsibilities: ministryForm.responsibilities.split('\n').map((item) => item.trim()).filter(Boolean),
        p_annual_budget: Number(ministryForm.annual_budget || 0),
        p_is_active: ministryForm.is_active,
      });
      if (error) throw error;
      setMinistryForm(null);
      toast({ title: 'Estrutura ministerial salva' });
      await load();
    } catch (error) { toast({ title: 'Não foi possível salvar', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const runAction = async (action, successMessage) => {
    setSaving(true);
    try {
      const { error } = await action();
      if (error) throw error;
      setOutletForm(null); setContractForm(null); setCoverageForm(null); setIntegrityForm(null); setImpactForm(null);
      toast({ title: successMessage });
      await load();
    } catch (error) { toast({ title: 'A ação não foi concluída', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };

  const saveOutlet = () => runAction(() => supabase.rpc('manage_media_outlet', {
    p_outlet_id: outletForm.id,
    p_name: outletForm.name,
    p_editor_id: outletForm.editor_id,
    p_profile: outletForm.editorial_profile,
    p_credibility: Number(outletForm.credibility_score),
    p_is_active: outletForm.is_active,
  }), 'Veículo de imprensa salvo');

  const saveContract = () => runAction(() => supabase.rpc('contract_government_media', {
    p_outlet_id: contractForm.outlet_id,
    p_amount: Number(contractForm.amount),
    p_purpose: contractForm.purpose,
    p_duration_days: Number(contractForm.duration_days || 30),
  }), 'Contrato institucional registrado com classificação de risco');

  const publishCoverage = () => runAction(() => supabase.rpc('publish_media_coverage', {
    p_event_type: coverageForm.event_type,
    p_event_id: crypto.randomUUID(),
    p_title: coverageForm.title,
    p_facts: coverageForm.facts,
  }), 'Pauta distribuída com enquadramentos editoriais distintos');

  const createIntegrityCase = () => runAction(() => supabase.rpc('create_public_integrity_case', {
    p_title: integrityForm.title,
    p_summary: integrityForm.summary,
    p_accused_profiles: integrityForm.accused_profile_id ? [integrityForm.accused_profile_id] : [],
    p_evidence: [],
    p_source_type: 'government_review',
    p_source_id: null,
  }), 'Suspeita registrada para apuração');

  const saveMinisterImpact = () => runAction(() => supabase.rpc('record_minister_event', {
    p_minister_id: impactForm.id,
    p_event_type: impactForm.event_type,
    p_summary: impactForm.summary,
    p_metadata: { source: 'presidential_dashboard' },
  }), 'Acontecimento ministerial registrado no histórico');

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-cyan-500/25 bg-cyan-500/5 lg:col-span-1"><CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-cyan-300" />Popularidade nacional</CardTitle><CardDescription>Cálculo auditável: 50% ações dos jogadores e 50% simulação nacional.</CardDescription></CardHeader><CardContent><p className="text-5xl font-black">{Number(data.popularity?.score || 0).toFixed(1)}%</p><Progress value={Number(data.popularity?.score || 0)} className="mt-4 h-3" /><p className={`mt-3 text-sm ${Number(data.popularity?.trend || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>Variação: {Number(data.popularity?.trend || 0) >= 0 ? '+' : ''}{Number(data.popularity?.trend || 0).toFixed(2)} p.p.</p></CardContent></Card>
        <Card className="glass-effect lg:col-span-2"><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-300" />Série histórica nacional</CardTitle><CardDescription>Valores reais de partida seguidos pelos resultados do RP, sem misturar os dois estados.</CardDescription></div><Select value={indicatorCode} onValueChange={setIndicatorCode}><SelectTrigger className="w-full sm:w-64"><SelectValue placeholder="Indicador" /></SelectTrigger><SelectContent>{indicatorCodes.map((code) => <SelectItem key={code} value={code}>{code.replaceAll('_', ' ')}</SelectItem>)}</SelectContent></Select></CardHeader><CardContent>{chartData.length ? <div className="h-60"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.15)" /><XAxis dataKey="label" stroke="#94a3b8" /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(148,163,184,.25)', borderRadius: 8 }} /><Line dataKey="value" type="monotone" stroke="#34d399" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div> : <p className="py-16 text-center text-muted-foreground">A série será formada pelos ciclos da economia.</p>}</CardContent></Card>
      </div>

      <Card className="glass-effect"><CardHeader className="sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-violet-300" />Memória de impactos</CardTitle><CardDescription>Cada variação guarda causa, pesos e pontuação anterior/posterior.</CardDescription></div></CardHeader><CardContent className="space-y-3">{data.events.length ? data.events.map((event) => <div key={event.id} className="grid gap-2 rounded-xl border border-white/10 p-3 sm:grid-cols-[1fr_auto]"><div><p className="font-medium">{event.summary}</p><p className="text-xs text-muted-foreground">{event.domain} · {new Date(event.created_at).toLocaleString('pt-BR')} · jogador {Number(event.player_delta).toFixed(2)} / simulação {Number(event.simulation_delta).toFixed(2)}</p></div><p className={`font-bold ${Number(event.applied_delta) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{Number(event.applied_delta) >= 0 ? '+' : ''}{Number(event.applied_delta).toFixed(2)}</p></div>) : <p className="py-6 text-center text-muted-foreground">Nenhum impacto registrado ainda.</p>}</CardContent></Card>

      <Card className="glass-effect"><CardHeader className="sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-blue-300" />Estrutura de ministérios</CardTitle><CardDescription>Crie, edite, desative e acompanhe orçamento, eficiência e impacto.</CardDescription></div><Button className="mt-3 sm:mt-0" onClick={() => setMinistryForm(emptyMinistry)}><Plus className="mr-2 h-4 w-4" />Novo ministério</Button></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{data.ministries.map((ministry) => <button type="button" key={ministry.id} onClick={() => setMinistryForm({ ...ministry, responsibilities: (ministry.responsibilities || []).join('\n') })} className="rounded-xl border border-white/10 p-4 text-left transition hover:border-primary/40"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{ministry.name}</p><p className="text-xs text-muted-foreground">{ministry.acronym || 'Sem sigla'} · {ministry.is_active ? 'Ativo' : 'Inativo'}</p></div><span className="text-sm font-bold">{Number(ministry.efficiency_score).toFixed(0)}%</span></div><p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{ministry.description}</p><p className="mt-3 text-sm">Orçamento: {money(ministry.annual_budget)}</p></button>)}</CardContent></Card>

      <Card className="glass-effect"><CardHeader><CardTitle className="flex items-center gap-2"><Star className="h-5 w-5 text-amber-300" />Reputação e desempenho dos ministros</CardTitle><CardDescription>Resultados, decisões e escândalos alteram indicadores individuais e repercutem no governo.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{data.ministers.length ? data.ministers.map((minister) => <div key={minister.id} className="rounded-xl border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{minister.profile?.full_name || 'Ministro'}</p><p className="text-xs text-muted-foreground">{minister.ministry}</p></div><Button size="sm" variant="outline" onClick={() => setImpactForm({ id: minister.id, name: minister.profile?.full_name, summary: '', event_type: 'policy_success' })}>Registrar acontecimento</Button></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><p className="text-muted-foreground">Reputação</p><p className="font-bold">{Number(minister.reputation_score ?? 50).toFixed(1)}%</p></div><div><p className="text-muted-foreground">Desempenho</p><p className="font-bold">{Number(minister.performance_score ?? 50).toFixed(1)}%</p></div></div></div>) : <p className="col-span-full py-6 text-center text-muted-foreground">Nenhum ministro em exercício.</p>}</CardContent></Card>

      <Card className="glass-effect"><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Newspaper className="h-5 w-5 text-cyan-300" />Imprensa e publicidade institucional</CardTitle><CardDescription>Veículos têm perfis editoriais próprios; contratos recebem classificação automática de legitimidade e risco.</CardDescription></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setCoverageForm({ event_type: 'government_announcement', title: '', facts: '' })}><Megaphone className="mr-2 h-4 w-4" />Distribuir pauta</Button><Button onClick={() => setOutletForm(emptyOutlet)}><Plus className="mr-2 h-4 w-4" />Novo veículo</Button></div></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{data.outlets.length ? data.outlets.map((outlet) => <div key={outlet.id} className="rounded-xl border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{outlet.name}</p><p className="text-xs capitalize text-muted-foreground">{outlet.editorial_profile} · credibilidade {Number(outlet.credibility_score).toFixed(0)}%</p></div><span className={`rounded-full px-2 py-1 text-xs ${outlet.is_active ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-500/15 text-slate-300'}`}>{outlet.is_active ? 'Ativo' : 'Inativo'}</span></div><div className="mt-4 flex gap-2"><Button size="sm" variant="outline" onClick={() => setOutletForm({ ...outlet, credibility_score: String(outlet.credibility_score) })}>Editar</Button><Button size="sm" onClick={() => setContractForm({ outlet_id: outlet.id, outlet_name: outlet.name, amount: '', purpose: '', duration_days: '30' })}>Contratar campanha</Button></div></div>) : <p className="col-span-full py-6 text-center text-muted-foreground">Cadastre os primeiros veículos e seus editores responsáveis.</p>}</CardContent></Card>

      <Card className="glass-effect"><CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-red-300" />Integridade pública</CardTitle><CardDescription>Suspeita, investigação, processo e sentença são etapas distintas e auditadas.</CardDescription></div><Button variant="outline" onClick={() => setIntegrityForm({ title: '', summary: '', accused_profile_id: '' })}><Plus className="mr-2 h-4 w-4" />Registrar suspeita</Button></CardHeader><CardContent className="space-y-3">{data.integrityCases.length ? data.integrityCases.map((item) => <div key={item.id} className="rounded-xl border border-white/10 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.title}</p><p className="text-sm text-muted-foreground">{item.case_number} · {item.summary}</p></div><span className="rounded-full bg-red-500/10 px-2 py-1 text-xs text-red-200">{item.status}</span></div></div>) : <p className="py-6 text-center text-muted-foreground">Nenhum caso de integridade registrado.</p>}</CardContent></Card>

      <Dialog open={Boolean(ministryForm)} onOpenChange={(open) => { if (!open && !saving) setMinistryForm(null); }}><DialogContent><DialogHeader><DialogTitle>{ministryForm?.id ? 'Editar ministério' : 'Criar ministério'}</DialogTitle></DialogHeader>{ministryForm ? <div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Nome</Label><Input value={ministryForm.name} onChange={(event) => setMinistryForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="space-y-2"><Label>Sigla</Label><Input value={ministryForm.acronym || ''} onChange={(event) => setMinistryForm((current) => ({ ...current, acronym: event.target.value }))} /></div></div><div className="space-y-2"><Label>Descrição</Label><Textarea value={ministryForm.description} onChange={(event) => setMinistryForm((current) => ({ ...current, description: event.target.value }))} /></div><div className="space-y-2"><Label>Responsabilidades (uma por linha)</Label><Textarea value={ministryForm.responsibilities} onChange={(event) => setMinistryForm((current) => ({ ...current, responsibilities: event.target.value }))} /></div><div className="space-y-2"><Label>Orçamento anual</Label><Input type="number" min="0" step="0.01" value={ministryForm.annual_budget} onChange={(event) => setMinistryForm((current) => ({ ...current, annual_budget: event.target.value }))} /></div><label className="flex items-center gap-3"><input type="checkbox" checked={ministryForm.is_active} onChange={(event) => setMinistryForm((current) => ({ ...current, is_active: event.target.checked }))} />Ministério ativo</label></div> : null}<DialogFooter><Button variant="outline" onClick={() => setMinistryForm(null)} disabled={saving}>Cancelar</Button><Button onClick={saveMinistry} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(outletForm)} onOpenChange={(open) => !open && !saving && setOutletForm(null)}><DialogContent><DialogHeader><DialogTitle>{outletForm?.id ? 'Editar veículo' : 'Novo veículo de imprensa'}</DialogTitle></DialogHeader>{outletForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Nome</Label><Input value={outletForm.name} onChange={(event) => setOutletForm((current) => ({ ...current, name: event.target.value }))} /></div><div className="space-y-2"><Label>Editor responsável</Label><Select value={outletForm.editor_id} onValueChange={(value) => setOutletForm((current) => ({ ...current, editor_id: value }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{data.profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}><UserSelectOption user={profile} detail={profile.username ? `@${profile.username}` : ''} /></SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Perfil editorial</Label><Select value={outletForm.editorial_profile} onValueChange={(value) => setOutletForm((current) => ({ ...current, editorial_profile: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['governista', 'oposicao', 'neutro', 'sensacionalista'].map((profile) => <SelectItem key={profile} value={profile} className="capitalize">{profile}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Credibilidade</Label><Input type="number" min="0" max="100" value={outletForm.credibility_score} onChange={(event) => setOutletForm((current) => ({ ...current, credibility_score: event.target.value }))} /></div></div><label className="flex items-center gap-3"><input type="checkbox" checked={outletForm.is_active} onChange={(event) => setOutletForm((current) => ({ ...current, is_active: event.target.checked }))} />Veículo ativo</label></div> : null}<DialogFooter><Button variant="outline" onClick={() => setOutletForm(null)}>Cancelar</Button><Button onClick={saveOutlet} disabled={saving || !outletForm?.name || !outletForm?.editor_id}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(contractForm)} onOpenChange={(open) => !open && !saving && setContractForm(null)}><DialogContent><DialogHeader><DialogTitle>Publicidade em {contractForm?.outlet_name}</DialogTitle></DialogHeader>{contractForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Valor</Label><Input type="number" min="0.01" step="0.01" value={contractForm.amount} onChange={(event) => setContractForm((current) => ({ ...current, amount: event.target.value }))} /></div><div className="space-y-2"><Label>Finalidade institucional detalhada</Label><Textarea rows={5} value={contractForm.purpose} onChange={(event) => setContractForm((current) => ({ ...current, purpose: event.target.value }))} /></div><div className="space-y-2"><Label>Duração em dias</Label><Input type="number" min="1" value={contractForm.duration_days} onChange={(event) => setContractForm((current) => ({ ...current, duration_days: event.target.value }))} /></div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setContractForm(null)}>Cancelar</Button><Button onClick={saveContract} disabled={saving || Number(contractForm?.amount) <= 0 || contractForm?.purpose?.length < 20}>Autorizar com análise de risco</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(coverageForm)} onOpenChange={(open) => !open && !saving && setCoverageForm(null)}><DialogContent><DialogHeader><DialogTitle>Distribuir pauta à imprensa</DialogTitle></DialogHeader>{coverageForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Título do fato</Label><Input value={coverageForm.title} onChange={(event) => setCoverageForm((current) => ({ ...current, title: event.target.value }))} /></div><div className="space-y-2"><Label>Fatos verificáveis</Label><Textarea rows={7} value={coverageForm.facts} onChange={(event) => setCoverageForm((current) => ({ ...current, facts: event.target.value }))} /></div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setCoverageForm(null)}>Cancelar</Button><Button onClick={publishCoverage} disabled={saving || coverageForm?.facts?.length < 20}>Publicar coberturas</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(integrityForm)} onOpenChange={(open) => !open && !saving && setIntegrityForm(null)}><DialogContent><DialogHeader><DialogTitle>Registrar suspeita de integridade</DialogTitle></DialogHeader>{integrityForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Título</Label><Input value={integrityForm.title} onChange={(event) => setIntegrityForm((current) => ({ ...current, title: event.target.value }))} /></div><div className="space-y-2"><Label>Agente relacionado (opcional)</Label><Select value={integrityForm.accused_profile_id || 'none'} onValueChange={(value) => setIntegrityForm((current) => ({ ...current, accused_profile_id: value === 'none' ? '' : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Não identificado</SelectItem>{data.profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}><UserSelectOption user={profile} detail={profile.username ? `@${profile.username}` : ''} /></SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Fatos iniciais</Label><Textarea rows={7} value={integrityForm.summary} onChange={(event) => setIntegrityForm((current) => ({ ...current, summary: event.target.value }))} /></div><p className="text-xs text-muted-foreground">O registro inicia como suspeita. Condenação exige investigação, processo e julgamento.</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setIntegrityForm(null)}>Cancelar</Button><Button onClick={createIntegrityCase} disabled={saving || integrityForm?.summary?.length < 20}>Registrar</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(impactForm)} onOpenChange={(open) => !open && !saving && setImpactForm(null)}><DialogContent><DialogHeader><DialogTitle>Acontecimento de {impactForm?.name || 'ministro'}</DialogTitle></DialogHeader>{impactForm ? <div className="grid gap-4"><div className="space-y-2"><Label>Tipo de acontecimento</Label><Select value={impactForm.event_type} onValueChange={(value) => setImpactForm((current) => ({ ...current, event_type: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ministerEventTypes.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Fato e resultado verificável</Label><Textarea rows={5} value={impactForm.summary} onChange={(event) => setImpactForm((current) => ({ ...current, summary: event.target.value }))} /></div><p className="text-xs text-muted-foreground">A reputação, o desempenho e a repercussão nacional são calculados automaticamente conforme o acontecimento.</p></div> : null}<DialogFooter><Button variant="outline" onClick={() => setImpactForm(null)}>Cancelar</Button><Button onClick={saveMinisterImpact} disabled={saving || impactForm?.summary?.trim().length < 10}>Registrar</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
};

export default GovernmentDynamicsPanel;
