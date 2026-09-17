import { formatLocaleBR } from '@/lib/dateTime';
import { GovSelect } from '@/components/ui/gov-select';
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Loader2, Coins, Shield, Scale, Newspaper, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import LegalEffectsSummary from '@/components/parliament/LegalEffectsSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PROPOSAL_CATEGORIES, proposalCategory, applicableProposal, LEGAL_MEASURE_MODELS, LEGAL_REALTIME_TABLES, LEGAL_KIND_LABELS, LEGAL_BASIS_LABELS, createMeasureDraft, measurePayload, measureSummary } from '@/lib/legalMeasures';

const selectClass = 'flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export default function LegalMeasureStudio({ houseId = null, onCreated, buttonLabel = 'Modelos de Propostas' }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const prefix = useId();
  const [category, setCategory] = useState('economy');
  const categoryIcons = { Coins, Shield, Scale, Newspaper, Landmark };
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState([]);
  const [authority, setAuthority] = useState([]);
  const [sectors, setSectors] = useState([]);
  const [houses, setHouses] = useState([]);
  const [templateId, setTemplateId] = useState(LEGAL_MEASURE_MODELS[0].id);
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [legalText, setLegalText] = useState('');
  const [source, setSource] = useState('bill');
  const [selectedHouse, setSelectedHouse] = useState(houseId || '');
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    const results = await Promise.all([
      supabase.from('government_rules').select('*').order('description'),
      supabase.from('legal_authority_rules').select('*'),
      supabase.from('economic_sectors').select('id,name').order('name'),
      supabase.from('parliament_houses').select('id,name'),
    ]);
    const error = results.find(result => result.error)?.error;
    setLoadError(Boolean(error));
    if (error) { console.error('Modelos de propostas: consulta recusada', error); return; }
    setRules(results[0].data); setReview(false); setAuthority(results[1].data); setSectors(results[2].data); setHouses(results[3].data);
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  useDomainRealtime('legal-rules', 'public', LEGAL_REALTIME_TABLES, load, open);
  const availableModels = LEGAL_MEASURE_MODELS.filter(item => proposalCategory(item) === category && applicableProposal(item, rules));
  const template = LEGAL_MEASURE_MODELS.find(item => item.id === templateId);
  const selectTemplate = (id, currentRules = rules) => {
    const item = LEGAL_MEASURE_MODELS.find(entry => entry.id === id);
    const current = currentRules.find(rule => item.ruleKey ? rule.rule_key === item.ruleKey : item.action !== 'create' && rule.rule_kind === item.kind && rule.is_active);
    const value = createMeasureDraft(item, current);
    setTemplateId(id); setDraft(value); setTitle(item.title);
    setSummary(`${item.title}, com parâmetros e vigência definidos nesta proposta para o GOVRP.`);
    setLegalText(`Art. 1º. ${item.title}, nos termos dos efeitos estruturados anexos a esta norma.\nArt. 2º. Aplicam-se o público, a base de cálculo e os limites expressamente definidos no anexo.\nArt. 3º. Esta norma entra em vigor na data indicada, preservadas as operações e decisões anteriores.`);
    setReview(false);
  };
  useEffect(() => {
    if (open && rules.length && !initialized.current) {
      initialized.current = true;
      if (availableModels.length) selectTemplate(availableModels.find(item => item.id === templateId)?.id || availableModels[0].id, rules);
    }
  }, [open, rules]);
  const update = patch => { setDraft(current => ({ ...current, ...patch })); setReview(false); };
  const definition = patch => { setDraft(current => ({ ...current, definition: { ...current.definition, ...patch } })); setReview(false); };
  const current = rules.find(rule => rule.rule_key === draft?.rule_key);
  const competence = authority.find(rule => rule.capability === draft?.kind);
  const executive = ['Admin', 'Presidente'].includes(user?.role);
  const field = (name, label, input) => <div className="min-w-0 space-y-1"><Label htmlFor={`${prefix}-${name}`}>{label}</Label>{React.cloneElement(input, { id: `${prefix}-${name}` })}</div>;
  const submit = async () => {
    if (saving || !draft) return;
    setSaving(true);
    try {
      const effect = measurePayload(draft);
      const { data, error } = await supabase.rpc('submit_structured_legal_measure', { p_source_kind: source, p_title: title, p_summary: summary, p_full_text: legalText, p_house_id: houseId || selectedHouse || null, p_effects: [effect] });
      if (error) throw error;
      toast({ title: source === 'decree' ? 'Decreto salvo como rascunho' : 'Proposta enviada ao Parlamento', description: source === 'decree' ? 'Publique o ato para iniciar a vigência dos efeitos permitidos.' : 'A regra será aplicada somente após votação e sanção ou promulgação.' });
      setOpen(false); await onCreated?.(data);
    } catch (error) { console.error('Proposta estruturada recusada', error); toast({ title: 'Não foi possível enviar a medida', description: error.message, variant: 'destructive' }); }
    finally { setSaving(false); }
  };
  return <>
    <Button variant="outline" onClick={() => { initialized.current = false; setDraft(null); setOpen(true); }}><BookOpen className="mr-2 h-4 w-4" />{buttonLabel}</Button>
    <Dialog open={open} onOpenChange={value => { if (!saving) setOpen(value); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] overflow-y-auto bg-card">
        <DialogHeader><DialogTitle>Modelos de Propostas</DialogTitle><DialogDescription>30 modelos com consequências na economia, no comércio e na Justiça. O texto jurídico acompanha os parâmetros abaixo.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2" aria-label="Categorias de propostas">{PROPOSAL_CATEGORIES.map(item => { const Icon = categoryIcons[item.icon] || BookOpen; return <Button key={item.id} size="sm" variant={category === item.id ? 'default' : 'outline'} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); const next = LEGAL_MEASURE_MODELS.find(model => proposalCategory(model) === item.id && applicableProposal(model, rules)); if (next) selectTemplate(next.id); else setDraft(null); }}><Icon className="mr-2 h-4 w-4" />{item.label}</Button>; })}</div>
        {!availableModels.length && <p className="rounded-xl border p-4 text-sm text-muted-foreground">Nenhum modelo regulamentado disponível nesta área no momento.</p>}
        {loadError && <Button variant="outline" onClick={load}>Tentar carregar regras novamente</Button>}
        {draft && <div className="space-y-4 min-w-0">
          {field('model', 'Modelo', <GovSelect className={selectClass} value={templateId} onChange={e => selectTemplate(e.target.value)}>{availableModels.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</GovSelect>)}
          <div className="grid gap-3 sm:grid-cols-2">
            {executive && field('source', 'Via institucional', <GovSelect className={selectClass} value={source} onChange={e => { setSource(e.target.value); setReview(false); }}><option value="bill">Projeto para votação no Parlamento</option><option value="decree">Decreto dentro da competência executiva</option></GovSelect>)}
            {source === 'bill' && !houseId && field('house', 'Casa de tramitação', <GovSelect className={selectClass} value={selectedHouse} onChange={e => setSelectedHouse(e.target.value)}><option value="">Selecione a Casa</option>{houses.map(house => <option key={house.id} value={house.id}>{house.name}</option>)}</GovSelect>)}
            {field('action', 'Ação', <GovSelect className={selectClass} value={draft.action} onChange={e => update({ action: e.target.value })}>{!current?.is_active && <option value="create">Criar</option>}<option value="change">Alterar</option><option value="revoke">Revogar</option></GovSelect>)}
            {draft.action !== 'create' && field('rule', 'Regra vigente', <GovSelect className={selectClass} value={draft.rule_key} onChange={e => { const rule = rules.find(r => r.rule_key === e.target.value); update({ ...createMeasureDraft(template, rule), action: draft.action }); }}><option value="">Selecione a regra</option>{rules.filter(rule => rule.rule_kind === draft.kind && rule.is_active).map(rule => <option key={rule.rule_key} value={rule.rule_key}>{rule.description}{rule.is_active ? '' : ' (revogada)'}</option>)}</GovSelect>)}
            {field('name', 'Nome da regra', <Input value={draft.name} onChange={e => update({ name: e.target.value })} />)}
            {draft.action !== 'revoke' && field('value', draft.definition.nature === 'percentage' ? 'Percentual (%)' : draft.kind === 'penalty' ? 'Pena de referência (anos RP)' : 'Valor (R$)', <Input type="number" min="0" step="0.01" value={draft.definition.nature === 'percentage' ? Number((draft.value * 100).toFixed(6)) : draft.value} onChange={e => update({ value: Number(e.target.value) / (draft.definition.nature === 'percentage' ? 100 : 1) })} />)}
          </div>
          {draft.action !== 'revoke' && <div className="grid gap-3 sm:grid-cols-2 rounded-lg border p-3">
            {draft.kind !== 'penalty' && field('audience', 'Público afetado', <GovSelect className={selectClass} value={draft.definition.audience || 'all'} onChange={e => definition({ audience: e.target.value })}><option value="all">Todos</option><option value="citizen">Pessoa física</option><option value="business">Empresas</option></GovSelect>)}
            {['tax', 'fee', 'restriction'].includes(draft.kind) && field('basis', 'Atividade / base de cálculo', <GovSelect className={selectClass} value={draft.definition.basis} onChange={e => definition({ basis: e.target.value, ...(e.target.value !== 'purchase' ? { payer: 'buyer', category: undefined } : {}), ...(['document','license'].includes(e.target.value) ? { nature: 'fixed' } : {}), ...(e.target.value === 'transfer' ? { sector_id: undefined } : {}) })}>{Object.entries(LEGAL_BASIS_LABELS).filter(([key]) => draft.kind !== 'restriction' || key !== 'document').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</GovSelect>)}
            {['tax', 'fee'].includes(draft.kind) && <>
              {field('nature', 'Forma de cobrança', <GovSelect className={selectClass} value={draft.definition.nature} onChange={e => definition({ nature: e.target.value })}>{!['license','document'].includes(draft.definition.basis) && <option value="percentage">Percentual</option>}<option value="fixed">Valor fixo</option></GovSelect>)}
              {field('payer', 'Quem paga', <GovSelect className={selectClass} value={draft.definition.payer} onChange={e => definition({ payer: e.target.value })}><option value="buyer">Comprador / solicitante, acrescido à operação</option>{draft.definition.basis === 'purchase' && <option value="seller">Vendedor, descontado do recebimento</option>}</GovSelect>)}
              {['min_amount', 'max_amount', 'exempt_below'].map((key, index) => <React.Fragment key={key}>{field(key, ['Valor mínimo da operação (R$)', 'Valor máximo da operação (R$)', 'Isentar operações até (R$)'][index], <Input type="number" min="0" step="0.01" value={draft.definition[key] ?? ''} onChange={e => definition({ [key]: e.target.value === '' ? '' : Number(e.target.value) })} />)}</React.Fragment>)}
            </>}
            {draft.kind !== 'penalty' && field('sector', templateId.startsWith('incentive') ? 'Setor beneficiado pelo desconto' : 'Setor (quando aplicável)', <GovSelect className={selectClass} value={draft.definition[templateId.startsWith('incentive') ? 'discount_sector_id' : 'sector_id'] || ''} onChange={e => definition({ [templateId.startsWith('incentive') ? 'discount_sector_id' : 'sector_id']: e.target.value })}><option value="">Todos os setores</option>{sectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</GovSelect>)}
            {draft.definition.basis === 'purchase' && field('category', 'Categoria de produto (opcional)', <Input value={draft.definition.category || ''} placeholder="Nome de uma categoria existente" onChange={e => definition({ category: e.target.value })} />)}
            {draft.definition.basis === 'document' && field('document', 'Documento', <GovSelect className={selectClass} value={draft.definition.document_type || ''} onChange={e => definition({ document_type: e.target.value })}><option value="">Selecione</option>{['CNH', 'Passport', 'RG', 'CPF', 'CTD', 'CNPJ', 'Título de Eleitor', 'Certificado de Reservista', 'Certidão de Casamento', 'Registro Profissional'].map(type => <option key={type} value={type}>{type}</option>)}</GovSelect>)}
            {templateId.startsWith('incentive') && field('discount', 'Redução da cobrança (%)', <Input type="number" min="0" max="100" value={(draft.definition.discount_rate || 0) * 100} onChange={e => definition({ discount_rate: Number(e.target.value) / 100 })} />)}
            {draft.kind === 'penalty' && ['minimum', 'maximum', 'fine'].map((key, index) => <React.Fragment key={key}>{field(key, ['Pena mínima (anos RP)', 'Pena máxima (anos RP)', 'Multa prevista (R$)'][index], <Input type="number" min="0" step="0.01" value={draft.definition[key] ?? ''} onChange={e => definition({ [key]: Number(e.target.value) })} />)}</React.Fragment>)}
            {draft.kind === 'benefit' && <>{field('budget', 'Orçamento máximo total (R$)', <Input type="number" min="1" value={draft.definition.budget || ''} onChange={e => definition({ budget: Number(e.target.value) })} />)}{field('balance', 'Saldo máximo elegível (opcional)', <Input type="number" min="0" value={draft.definition.eligible_balance_max ?? ''} onChange={e => definition({ eligible_balance_max: e.target.value === '' ? '' : Number(e.target.value) })} />)}<p className="text-xs text-muted-foreground sm:col-span-2">Pagamento automático uma vez por cidadão neste programa, conforme elegibilidade, vigência, saldo do Tesouro e orçamento. Alterar a norma não repete pagamentos anteriores.</p></>}
            {draft.kind === 'restriction' && <>
              {field('hour-from', 'Das (horário RP)', <Input type="time" value={draft.definition.hour_from || ''} onChange={e => definition({ hour_from: e.target.value })} />)}
              {field('hour-until', 'Até (horário RP)', <Input type="time" value={draft.definition.hour_until || ''} onChange={e => definition({ hour_until: e.target.value })} />)}
              <fieldset className="sm:col-span-2"><legend className="text-sm mb-2">Dias da semana (nenhum marcado = todos)</legend><div className="flex flex-wrap gap-3">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day, dayIndex) => <label key={day} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={(draft.definition.weekdays || []).includes(dayIndex)} onChange={e => { const days = (draft.definition.weekdays || []).filter(value => value !== dayIndex); if (e.target.checked) days.push(dayIndex); definition({ weekdays: days.length ? days : undefined }); }} />{day}</label>)}</div></fieldset>
            </>}
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">{field('start', 'Início da vigência (vazio = imediato)', <Input type="datetime-local" value={draft.valid_from} onChange={e => update({ valid_from: e.target.value })} />)}{field('until', 'Fim da vigência (obrigatório para benefício)', <Input type="datetime-local" value={draft.valid_until} onChange={e => update({ valid_until: e.target.value })} />)}</div>
          <p className="text-xs text-muted-foreground">Datas, horários e restrições usam o horário de Brasília.</p>
          {source === 'decree' && <p className="rounded-lg border p-3 text-sm" role="status">{competence?.description || 'Consultando competências...'}{!competence?.decree_allowed && ' Esta matéria exige aprovação legislativa.'}</p>}
          {field('title', 'Título', <Input value={title} onChange={e => { setTitle(e.target.value); setReview(false); }} />)}
          {field('summary', 'Ementa e explicação', <Textarea value={summary} onChange={e => { setSummary(e.target.value); setReview(false); }} />)}
          {field('text', 'Texto legal inicial', <Textarea rows={5} value={legalText} onChange={e => { setLegalText(e.target.value); setReview(false); }} />)}
          <section className="rounded-lg bg-secondary p-4 space-y-2" aria-live="polite"><h3 className="font-semibold">O que esta medida fará se entrar em vigor?</h3><p className="text-sm">{measureSummary(draft, current)}</p><LegalEffectsSummary effects={[{effect_data:draft,previous_snapshot:current,valid_from:draft.valid_from,valid_until:draft.valid_until,status:'draft'}]} /><p className="text-sm">Vigência: {draft.valid_from ? formatLocaleBR(new Date(draft.valid_from), 'toLocaleString', 'pt-BR') : 'A partir da publicação válida'}. {draft.valid_until && `Até ${formatLocaleBR(new Date(draft.valid_until), 'toLocaleString', 'pt-BR')}.`}</p><p className="text-xs text-muted-foreground">{LEGAL_KIND_LABELS[draft.kind]} · Operações e sentenças anteriores preservam os valores registrados.</p></section>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} />Revisei o texto, os parâmetros e os efeitos desta medida.</label>
          <Button className="w-full sm:w-auto" disabled={!review || saving || loadError || !authority.length || (source === 'decree' && !competence?.decree_allowed)} onClick={submit}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{source === 'decree' ? 'Salvar decreto para publicação' : 'Enviar proposta para tramitação'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
