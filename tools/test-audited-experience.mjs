import assert from 'node:assert/strict';
import { createSectionLoader } from '../src/lib/sectionLoader.js';
import { fetchBankSections, bankSectionsForEvents, BANK_SECTIONS, CARD_SECTIONS } from '../src/lib/bankData.js';
import { citizenJusticeSectionsForEvents, fetchCitizenSections } from '../src/lib/justice/citizenData.js';
import { userErrorMessage, sanitizeToast, validatePromotion } from '../src/lib/userErrors.js';
import { profileLookup, xProfilePath } from '../src/lib/xProfileRoute.js';

let checks = 0;
const check = (label, run) => { run(); checks++; console.log(`✓ ${label}`); };
check('promoção acima do preço é traduzida inclusive com prefixo do servidor', () => {
  assert.match(userErrorMessage({ message: 'ERROR: INVALID_PROMOTION' }), /menor que o preço normal/);
});
check('diagnósticos de SQL e códigos desconhecidos não chegam ao cidadão', () => {
  for (const message of ['UPDATE requires a WHERE clause', 'duplicate key violates constraint secret_table', 'PGRST202: schema cache', 'UNKNOWN_INTERNAL_FAILURE', 'permission denied for table police_occurrences']) {
    const result = userErrorMessage(message);
    assert.notEqual(result, message);
    assert(!/secret_table|police_occurrences|PGRST202|UNKNOWN/.test(result));
  }
});
check('avisos em português são preservados e alterações de toast também são sanitizadas', () => {
  assert.equal(userErrorMessage('Seu saldo é insuficiente.'), 'Seu saldo é insuficiente.');
  assert.match(sanitizeToast({ description: 'INVALID_PROMOTION', variant: 'destructive' }).description, /promocional/);
  assert.equal(sanitizeToast({ description: 'Documento emitido.', title: 'Sucesso' }).description, 'Documento emitido.');
});
check('formulário recusa promoção inválida antes de fazer upload ou RPC', () => {
  for (const price of [0, -1, NaN, 100, 150]) assert(validatePromotion(100, price));
  assert.equal(validatePromotion(100, 75, '2099-01-01'), null);
  assert.match(validatePromotion(100, 75, '2000-01-01'), /futura/);
});
const identity = { id: 'citizen-id', viewerId: 'viewer', handle: 'antigo', canonicalHandle: 'novo' };
check('perfil aberto permanece ligado ao ID durante a troca do @', () => {
  assert.deepEqual(profileLookup('antigo', identity, 'viewer'), { column: 'id', value: 'citizen-id' });
  assert.deepEqual(profileLookup('novo', identity, 'viewer'), { column: 'id', value: 'citizen-id' });
  assert.equal(xProfilePath('novo'), '/services/x/profile/novo');
});
check('visitar outro perfil ou trocar de sessão não reutiliza a identidade anterior', () => {
  assert.deepEqual(profileLookup('terceiro', identity, 'viewer'), { column: 'x_handle', value: 'terceiro' });
  assert.equal(profileLookup('novo', identity, 'other-viewer').column, 'x_handle');
});
check('notificação sem relação financeira não dispara nenhuma consulta bancária', () => {
  assert.deepEqual(bankSectionsForEvents([{ table: 'notifications', new: { type: 'party_membership_confirmed' } }]), []);
});
check('evento de fatura consulta apenas faturas e não consulta os dados gerais do banco', () => {
  const events = [{ table: 'card_invoices', eventType: 'UPDATE' }];
  assert.deepEqual(bankSectionsForEvents(events), []);
  assert.deepEqual(bankSectionsForEvents(events, CARD_SECTIONS), ['invoices']);
});
check('cartões têm um único consumidor e saldo não invalida investimentos', () => {
  assert(!BANK_SECTIONS.includes('cards'));
  assert.deepEqual(bankSectionsForEvents([{ table: 'accounts' }]), ['account']);
});
check('notificação policial segura invalida somente acompanhamento e indicadores', () => {
  assert.deepEqual(citizenJusticeSectionsForEvents([{ table: 'notifications', new: { type: 'justice_occurrence_status_changed' } }]), ['occurrences', 'policeMetrics']);
  assert.deepEqual(citizenJusticeSectionsForEvents([{ table: 'notifications', new: { type: 'party_membership_confirmed' } }]), []);
});
check('eventos judiciais atualizam apenas seções relacionadas', () => {
  assert.deepEqual(citizenJusticeSectionsForEvents([{ table: 'case_documents' }, { table: 'case_documents' }]), ['caseDocuments']);
  assert.deepEqual(citizenJusticeSectionsForEvents([{ table: 'justice_deadlines' }]), ['deadlines']);
});

const calls = [];
const client = {
  from(table) {
    calls.push(table);
    const query = { then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
    for (const method of ['select', 'eq', 'limit', 'maybeSingle', 'order', 'in']) query[method] = () => query;
    return query;
  },
  rpc(name, args) {
    calls.push({ name, args });
    return Promise.resolve({ data: name === 'get_my_police_occurrences_page' ? { items: [{ id: 'occurrence' }], next_cursor: null, active_count: 101 } : [], error: null });
  },
};
await fetchBankSections(client, 'citizen', bankSectionsForEvents([{ table: 'transactions' }]));
check('uma transação dispara uma RPC, sem as sete consultas complementares', () => {
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'get_user_transactions');
});
calls.length = 0;
const page = await fetchCitizenSections(client, ['occurrences'], { id: 'older', created_at: '2026-09-01T00:00:00Z' });
check('paginar ocorrências faz só uma RPC autorizada com cursor completo', () => {
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_before_id, 'older');
  assert.equal(calls[0].args.p_limit, 20);
  assert.equal(page.values.activeOccurrenceCount, 101);
  assert.deepEqual(page.values.occurrences, [{ id: 'occurrence' }]);
});
calls.length = 0;
await fetchCitizenSections(client, citizenJusticeSectionsForEvents([{ table: 'case_documents' }]));
check('alterar um documento judicial não dispara as outras vinte consultas', () => assert.deepEqual(calls, ['case_documents']));

let resolveFirst;
const firstResponse = new Promise(resolve => { resolveFirst = resolve; });
const loads = [], applied = [];
const loader = createSectionLoader(async sections => { loads.push(sections); if (loads.length === 1) await firstResponse; return sections; }, values => applied.push(values));
const a = loader.refresh(['account']);
const b = loader.refresh(['account', 'transactions']);
await new Promise(resolve => setTimeout(resolve, 0));
const c = loader.refresh(['investments']);
resolveFirst();
await Promise.all([a, b, c]);
check('rajadas são agrupadas e eventos recebidos durante uma consulta não se perdem', () => {
  assert.deepEqual(loads, [['account', 'transactions'], ['investments']]);
  assert.deepEqual(applied, loads);
});
let resolveSlow;
const slowResponse = new Promise(resolve => { resolveSlow = resolve; });
let staleApplied = false;
const disposed = createSectionLoader(() => slowResponse, () => { staleApplied = true; });
const pending = disposed.refresh(['account']);
await new Promise(resolve => setTimeout(resolve, 0));
disposed.dispose(); resolveSlow({ account: 'old-user' }); await pending;
await new Promise(resolve => setTimeout(resolve, 0));
check('consulta de uma sessão encerrada não publica dados na sessão seguinte', () => assert.equal(staleApplied, false));
const partial = await fetchCitizenSections({ ...client, rpc: async () => ({ error: { message: 'Failed to fetch' } }) }, ['occurrences', 'caseDocuments']);
check('falha parcial preserva as demais seções e identifica o que precisa de nova tentativa', () => {
  assert.deepEqual(partial.errors, ['occurrences']);
  assert.deepEqual(partial.values.caseDocuments, []);
  assert(!('occurrences' in partial.values));
});
const rolloutCalls = [];
const rollout = await fetchCitizenSections({ rpc: async name => {
  rolloutCalls.push(name);
  return name === 'get_my_police_occurrences_page'
    ? { error: { code: 'PGRST202' } }
    : { data: [{ id: 'legacy', status: 'Pendente' }], error: null };
} }, ['occurrences']);
check('publicação do frontend preserva a consulta segura enquanto a migração é aplicada', () => {
  assert.deepEqual(rolloutCalls, ['get_my_police_occurrences_page', 'get_my_police_occurrences']);
  assert.equal(rollout.values.occurrences[0].id, 'legacy');
  assert.equal(rollout.values.nextOccurrenceCursor, null);
});
const deniedCalls = [];
await fetchCitizenSections({ rpc: async name => { deniedCalls.push(name); return { error: { code: '42501' } }; } }, ['occurrences']);
check('negação de permissão não tenta caminhos alternativos de acesso', () => assert.deepEqual(deniedCalls, ['get_my_police_occurrences_page']));
console.log(`\n${checks} verificações das correções de auditoria aprovadas.`);
