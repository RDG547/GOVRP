// These models only configure effects implemented by the authoritative RPCs.
const model = (id, title, kind, action, definition = {}, ruleKey = null, preset = {}) => ({ id, title, kind, action, definition, ruleKey, preset });
export const LEGAL_MEASURE_MODELS = [
  model('sales-create', 'Criar Imposto sobre Vendas', 'tax', 'create', { basis: 'purchase', payer: 'buyer', nature: 'percentage', audience: 'all' }),
  model('sales-change', 'Alterar Imposto sobre Vendas', 'tax', 'change', {}, 'consumption_tax_rate'),
  model('sales-revoke', 'Revogar Imposto sobre Vendas', 'tax', 'revoke', {}, 'consumption_tax_rate'),
  model('corporate-create', 'Criar Imposto sobre Receita Empresarial', 'tax', 'create', { basis: 'purchase', payer: 'seller', nature: 'percentage', audience: 'business' }),
  model('corporate-change', 'Alterar Imposto Empresarial', 'tax', 'change', {}, 'corporate_tax_rate'),
  model('corporate-revoke', 'Revogar Imposto Empresarial', 'tax', 'revoke', {}, 'corporate_tax_rate'),
  model('transfer-create', 'Criar Imposto sobre Transferências', 'tax', 'create', { basis: 'transfer', payer: 'buyer', nature: 'percentage', audience: 'all' }),
  model('transfer-change', 'Alterar ou Revogar Imposto sobre Transferências', 'tax', 'change', {}, 'transaction_tax'),
  model('large-transfer', 'Criar Imposto sobre Grandes Transações', 'tax', 'create', { basis: 'transfer', payer: 'buyer', nature: 'percentage', audience: 'all', min_amount: 10000 }),
  model('exemption', 'Criar Faixa de Isenção Tributária', 'tax', 'change', {}, 'consumption_tax_rate', { exempt_below: 100 }),
  model('fee-create', 'Criar Taxa Administrativa de Licenciamento', 'fee', 'create', { basis: 'license', payer: 'buyer', nature: 'fixed', audience: 'all' }),
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
];
export const LEGAL_REALTIME_TABLES = ['government_rules', 'law_effects', 'legal_authority_rules', 'decrees', 'dou_entries'];
export const LEGAL_KIND_LABELS = { tax: 'Imposto', fee: 'Taxa', penalty: 'Pena e multa', restriction: 'Restrição', benefit: 'Benefício', policy: 'Política pública' };
export const LEGAL_BASIS_LABELS = { purchase: 'Vendas', transfer: 'Transferências', license: 'Licenciamento empresarial', document: 'Emissão de documento' };
export function legalRuleValue(rule) {
  if (!rule) return 'Regra nova';
  if (rule.is_active === false) return 'Revogada';
  if (rule.rule_kind === 'restriction' || rule.kind === 'restriction') return 'Atividade restrita';
  return rule.definition?.nature === 'percentage' ? `${Number(rule.numeric_value * 100).toLocaleString('pt-BR')}%` : Number(rule.numeric_value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}
export function createMeasureDraft(template, rule, key = `norma_${crypto.randomUUID().replaceAll('-', '')}`) {
  const definition = { ...(rule?.definition || template.definition), ...template.preset };
  return {
    kind: template.kind, action: template.action, rule_key: rule?.rule_key || template.ruleKey || key,
    name: rule?.description || template.title, value: rule?.numeric_value ?? (definition.nature === 'percentage' ? 0.1 : 100),
    definition, valid_from: '', valid_until: '',
  };
}
export function measurePayload(draft) {
  const definition = Object.fromEntries(Object.entries(draft.definition).filter(([, value]) => value !== '' && value != null));
  return { ...draft, value: draft.action === 'revoke' ? 0 : Number(draft.value), definition,
    valid_from: draft.valid_from ? new Date(draft.valid_from).toISOString() : null,
    valid_until: draft.valid_until ? new Date(draft.valid_until).toISOString() : null,
  };
}
export function measureSummary(draft, current) {
  const next = draft.action === 'revoke' ? 'Revogada: deixa de ser aplicada a novas operações' : legalRuleValue({ numeric_value: draft.value, definition: draft.definition, rule_kind: draft.kind });
  return `${draft.name}: ${legalRuleValue(current)} → ${next}. ${LEGAL_BASIS_LABELS[draft.definition.basis] || LEGAL_KIND_LABELS[draft.kind]}.`;
}
