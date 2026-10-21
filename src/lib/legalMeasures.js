import { fromBrasiliaInput } from './dateTime.js';
// These models only configure effects implemented by the authoritative RPCs.
const model = (id, title, kind, action, definition = {}, ruleKey = null, preset = {}) => ({ id, title, kind, action, definition, ruleKey, preset });
export const LEGAL_MEASURE_MODELS = [
  model('sales-create', 'Criar Imposto sobre Vendas', 'tax', 'create', { basis: 'purchase', payer: 'buyer', nature: 'percentage', audience: 'all' }, 'consumption_tax_rate'),
  model('sales-change', 'Alterar Imposto sobre Vendas', 'tax', 'change', {}, 'consumption_tax_rate'),
  model('sales-revoke', 'Revogar Imposto sobre Vendas', 'tax', 'revoke', {}, 'consumption_tax_rate'),
  model('corporate-create', 'Criar Imposto sobre Receita Empresarial', 'tax', 'create', { basis: 'purchase', payer: 'seller', nature: 'percentage', audience: 'business' }, 'corporate_tax_rate'),
  model('corporate-change', 'Alterar Imposto Empresarial', 'tax', 'change', {}, 'corporate_tax_rate'),
  model('corporate-revoke', 'Revogar Imposto Empresarial', 'tax', 'revoke', {}, 'corporate_tax_rate'),
  model('transfer-create', 'Criar Imposto sobre Transferências', 'tax', 'create', { basis: 'transfer', payer: 'buyer', nature: 'percentage', audience: 'all' }, 'transaction_tax'),
  model('transfer-change', 'Alterar ou Revogar Imposto sobre Transferências', 'tax', 'change', {}, 'transaction_tax'),
  model('large-transfer', 'Criar Imposto sobre Grandes Transações', 'tax', 'create', { basis: 'transfer', payer: 'buyer', nature: 'percentage', audience: 'all', min_amount: 10000 }),
  model('exemption', 'Criar Faixa de Isenção Tributária', 'tax', 'change', {}, 'consumption_tax_rate', { exempt_below: 100 }),
  model('fee-create', 'Criar Taxa Administrativa de Licenciamento', 'fee', 'create', { basis: 'license', payer: 'buyer', nature: 'fixed', audience: 'all' }, 'business_license_fee'),
  model('fee-change', 'Alterar Taxa Administrativa', 'fee', 'change', {}, 'business_license_fee'),
  model('fee-revoke', 'Revogar Taxa Administrativa', 'fee', 'revoke', {}, 'business_license_fee'),
  model('document-fee', 'Criar Taxa de Emissão de Documento', 'fee', 'create', { basis: 'document', payer: 'buyer', nature: 'fixed', audience: 'all', document_type: 'CNH' }),
  model('sector-fee', 'Criar Taxa Setorial sobre Vendas', 'fee', 'create', { basis: 'purchase', payer: 'seller', nature: 'fixed', audience: 'business' }),
  model('penalty-increase', 'Aumentar Pena de Crime Existente', 'penalty', 'change'),
  model('penalty-decrease', 'Diminuir Pena de Crime Existente', 'penalty', 'change'),
  model('penalty-revoke', 'Revogar Tipo Penal', 'penalty', 'revoke'),
  model('fine-create', 'Criar Multa para Infração Existente', 'penalty', 'change'),
  model('fine-change', 'Alterar Valor de Multa', 'penalty', 'change'),
  model('restriction-create', 'Criar Restrição de Atividade', 'restriction', 'create', { basis: 'purchase', audience: 'all' }),
  model('restriction-revoke', 'Revogar Restrição Existente', 'restriction', 'revoke'),
  model('incentive-create', 'Criar Incentivo Fiscal para Setor', 'tax', 'change', {}, 'corporate_tax_rate', { discount_rate: 0.2 }),
  model('incentive-revoke', 'Revogar Incentivo Fiscal', 'tax', 'change', {}, 'corporate_tax_rate', { discount_rate: 0 }),
  model('subsidy-create', 'Criar Subsídio a Empresas Ativas', 'benefit', 'create', { audience: 'business', budget: 10000 }),
  model('license-change', 'Alterar Taxa de Licenciamento Empresarial', 'fee', 'change', {}, 'business_license_fee'),
  model('benefit-create', 'Criar Benefício Financeiro', 'benefit', 'create', { audience: 'citizen', budget: 10000 }),
  model('benefit-change', 'Alterar Benefício Financeiro', 'benefit', 'change'),
  model('benefit-revoke', 'Suspender ou Revogar Benefício', 'benefit', 'revoke'),
  model('temporary-program', 'Programa Temporário de Apoio a Pequenos Saldos', 'benefit', 'create', { audience: 'citizen', budget: 10000, eligible_balance_max: 500 }),
  ...[
    ['party-foundation', 'Taxa para fundação de partidos', 'party_registration_fee'],
    ['party-foundation-restriction', 'Restrição à fundação de partidos', 'party_registration_restriction'],
    ['party-donation-limit', 'Limite de financiamento partidário', 'party_donation_limit'],
    ['party-donation-period', 'Período de suspensão de doações', 'party_donation_period'],
    ['electoral-age', 'Tempo mínimo de cidadania para candidatura', 'electoral_minimum_age'],
    ['electoral-experience', 'Experiência profissional mínima para candidatura', 'electoral_minimum_experience'],
    ['electoral-membership', 'Filiação para novas candidaturas', 'electoral_party_requirement'],
  ].map(([id, title, operation]) => ({...model(id,title,'regulation','create',{operation}),category:'politics'})),
  ...[
    ['media-disclosure','Transparência da publicidade na Rede X','media_ad_disclosure'],
    ['media-political-ad','Identificação de publicidade política','media_political_ad_party'],
    ['media-ad-restriction','Restrição temporária de publicidade','media_ad_restriction'],
  ].map(([id,title,operation])=>({...model(id,title,'regulation','create',{operation}),category:'media'})),
  {...model('media-registration','Taxa de licenciamento de veículos de comunicação','fee','create'),category:'media'},
  {...model('media-incentive','Incentivo fiscal para comunicação','tax','change',{},'corporate_tax_rate'),category:'media'},
  {...model('media-responsibility','Responsabilidade de veículos de comunicação','sanction','create'),category:'media'},
  {...model('media-subsidy','Programa de apoio à comunicação','benefit','create'),category:'media'},
  ...[
    ['civil-sanction','Sanção aplicável a cidadãos'],['company-sanction','Sanção aplicável a empresas'],['party-sanction','Sanção aplicável a partidos'],
    ['warning','Advertência por infração'],['regularization','Obrigação de regularização'],['business-suspension','Suspensão temporária de atividade empresarial'],
  ].map(([id,title])=>({...model(id,title,'sanction','create'),category:'justice'})),
  {...model('regulation-change','Alterar regulamentação vigente','regulation','change'),category:'politics'},
  {...model('regulation-revoke','Revogar regulamentação vigente','regulation','revoke'),category:'politics'},
  {...model('sanction-change','Alterar sanção prevista em lei','sanction','change'),category:'justice'},
  {...model('sanction-revoke','Revogar sanção prevista em lei','sanction','revoke'),category:'justice'},
  {...model('legacy-sanction','Estruturar sanção de norma anterior','sanction','create'),category:'justice'},
  {...model('health-project','Construção e ampliação da capacidade de saúde','project','create'),category:'health'},
  {...model('regional-project','Autorização de obra de infraestrutura regional','project','create'),category:'infrastructure'},
];
export const LEGAL_REALTIME_TABLES = ['government_rules', 'law_effects', 'legal_authority_rules', 'decrees', 'dou_entries'];
export const LEGAL_KIND_LABELS = { tax: 'Imposto', fee: 'Taxa', penalty: 'Pena e multa', restriction: 'Restrição', benefit: 'Benefício', policy: 'Política pública', sanction: 'Sanção judicial', regulation: 'Regulamentação', project: 'Obra pública' };
export const LEGAL_BASIS_LABELS = { purchase: 'Vendas', transfer: 'Transferências', license: 'Licenciamento empresarial', document: 'Emissão de documento' };
export function legalRuleValue(rule) {
  if (!rule) return 'Regra nova';
  if (rule.is_active === false) return 'Revogada';
  if (rule.rule_kind === 'restriction' || rule.kind === 'restriction') return 'Atividade restrita';
  if ((rule.rule_kind === 'regulation' || rule.kind === 'regulation') && !['party_registration_fee','party_donation_limit','electoral_minimum_age','electoral_minimum_experience'].includes(rule.definition?.operation)) return 'Regulamentação no escopo definido';
  if ((rule.rule_kind === 'sanction' || rule.kind === 'sanction') && !['fine_fixed','fine_percentage'].includes(rule.definition?.sanction_kind)) return 'Aplicação mediante decisão judicial';
  if (rule.numeric_value === '' || rule.numeric_value == null) return 'Valor ainda não definido';
  if (rule.rule_kind === 'project' || rule.kind === 'project') return Number(rule.numeric_value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  return (rule.definition?.nature === 'percentage' || rule.definition?.sanction_kind === 'fine_percentage') ? `${Number(rule.numeric_value * 100).toLocaleString('pt-BR')}%` : Number(rule.numeric_value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
export function createMeasureDraft(template, rule, key = `norma_${crypto.randomUUID().replaceAll('-', '')}`) {
  return {
    kind: template.kind, action: template.action, rule_key: rule?.rule_key || (template.action === 'create' ? template.ruleKey || key : ''),
    name: rule?.description || template.title, value: rule?.numeric_value ?? '',
    definition: rule ? { ...rule.definition } : { ...(template.definition.operation ? { operation: template.definition.operation } : {}) },
    valid_from: '', valid_until: '', validity_mode: '', sector_scope: rule ? rule.definition?.sector_id || 'all' : '', territory_scope: rule ? (rule.definition?.region_codes?.length ? 'states' : 'country') : '', ideology_scope: rule ? (rule.definition?.ideologies?.length ? 'selected' : 'all') : '',
  };
}
export function measurePayload(draft) {
  if (!draft.validity_mode || (draft.validity_mode === 'date' && !draft.valid_from)) throw new Error('Escolha quando a norma deverá entrar em vigor.');
  if (draft.action !== 'revoke' && (draft.value === '' || draft.value == null)) throw new Error('Informe o valor ou confirme expressamente zero para uma medida sem cobrança.');
  if (draft.action !== 'create' && !draft.rule_key) throw new Error('Selecione a regra vigente que será alterada ou revogada.');
  const definition = Object.fromEntries(Object.entries(draft.definition).filter(([, value]) => value !== '' && value != null && (!Array.isArray(value) || value.length>0)));
  if(draft.action !== 'revoke' && ['tax','fee','benefit'].includes(draft.kind) && definition.basis!=='transfer' && !draft.sector_scope) throw new Error('Selecione a abrangência setorial.');
  if(draft.action !== 'revoke' && ['tax','fee','restriction','benefit'].includes(draft.kind) && !draft.territory_scope) throw new Error('Selecione a abrangência territorial.');
  if(draft.territory_scope==='states' && !definition.region_codes?.length) throw new Error('Selecione pelo menos um estado.');
  if(draft.kind==='regulation' && definition.operation?.startsWith('party_') && !draft.ideology_scope) throw new Error('Selecione a abrangência por ideologia.');
  if(draft.ideology_scope==='selected' && !definition.ideologies?.length) throw new Error('Selecione pelo menos uma ideologia ou orientação.');
  const { validity_mode,sector_scope,territory_scope,ideology_scope, ...payload } = draft;
  return { ...payload, value: draft.action === 'revoke' ? 0 : Number(draft.value), definition,
    valid_from: validity_mode === 'date' && draft.valid_from ? fromBrasiliaInput(draft.valid_from) : null,
    valid_until: draft.valid_until ? fromBrasiliaInput(draft.valid_until) : null,
  };
}
export function measureSummary(draft, current) {
  const next = draft.action === 'revoke' ? 'Revogada: deixa de ser aplicada a novas operações' : legalRuleValue({ numeric_value: draft.value, definition: draft.definition, rule_kind: draft.kind });
  return `${draft.name}: ${legalRuleValue(current)} → ${next}. ${LEGAL_BASIS_LABELS[draft.definition.basis] || LEGAL_KIND_LABELS[draft.kind]}.`;
}

export const PROPOSAL_CATEGORIES = [
  { id: 'economy', label: 'Economia', icon: 'Coins' },
  { id: 'security', label: 'Segurança', icon: 'Shield' },
  { id: 'justice', label: 'Justiça', icon: 'Scale' },
  { id: 'media', label: 'Mídia', icon: 'Newspaper' },
  { id: 'politics', label: 'Política', icon: 'Landmark' },
  { id: 'health', label: 'Saúde', icon: 'HeartPulse' },
  { id: 'infrastructure', label: 'Infraestrutura', icon: 'Construction' },
];
export const proposalCategory = template => template.category || (template.kind === 'penalty' ? 'justice' : template.kind === 'restriction' ? 'security' : 'economy');
export function applicableProposal(template, rules) {
  if (template.action !== 'create') return rules.some(rule => rule.is_active && (template.ruleKey ? rule.rule_key === template.ruleKey : rule.rule_kind === template.kind));
  const canonicalKeys = { 'sales-create': 'consumption_tax_rate', 'corporate-create': 'corporate_tax_rate', 'transfer-create': 'transaction_tax', 'fee-create': 'business_license_fee' };
  if (canonicalKeys[template.id]) return !rules.some(rule => rule.rule_key === canonicalKeys[template.id] && rule.is_active);

  return true;
}
