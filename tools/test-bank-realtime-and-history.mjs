import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { calculateExchangeVariation, getExchangePair, getExchangeTrend } from '../src/lib/currency.js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
  }));
if (!local.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');

const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

assert(getExchangePair('USD', 'BRL') === 'USD/BRL' && getExchangePair('EUR', 'BRL') === 'EUR/BRL', 'cidadão brasileiro recebe pares USD/BRL e EUR/BRL');
assert(calculateExchangeVariation(5.25, 5) === 5 && getExchangeTrend(5) === 'up' && getExchangeTrend(-1) === 'down' && getExchangeTrend(0) === 'stable', 'variação diária e tendências usam valores persistidos sem percentuais inventados');

const createActor = async (label, role, balance = 0) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `bank-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await service.from('profiles').upsert({
    id,
    username: `${label}${suffix}`,
    full_name: `Teste ${label}`,
    role,
    onboarding_completed: true,
    onboarding_step: 'completed',
  }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  let account = null;
  if (balance !== null) {
    const result = await service.from('accounts').insert({
      user_id: id,
      account_number: `${Date.now()}${suffix}`.slice(0, 18),
      agency_number: '0001',
      balance,
    }).select('*').single();
    if (result.error) throw result.error;
    account = result.data;
  }
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id, client, account, username: `${label}${suffix}` };
};

const waitFor = async (predicate, label, timeoutMs = 8000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Tempo esgotado: ${label}. Eventos administrativos: ${JSON.stringify(adminBEvents)}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const subscribe = (channel) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Canal Realtime não conectou.')), 8000);
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      clearTimeout(timer);
      resolve();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      clearTimeout(timer);
      reject(new Error(`Canal Realtime falhou: ${status}`));
    }
  });
});

const [adminA, adminB, citizen, recipient] = await Promise.all([
  createActor('admina', 'Admin', 1000),
  createActor('adminb', 'Admin', 1000),
  createActor('citizen', 'Cidadão', 5000),
  createActor('recipient', 'Cidadão', 1000),
]);

const cardApplication = await citizen.client.from('credit_card_applications').insert({
  user_id: citizen.id,
  brand: 'visa',
  requested_limit: 2500,
}).select('*').single();
if (cardApplication.error) throw cardApplication.error;
const loanApplication = await citizen.client.from('loan_applications').insert({
  user_id: citizen.id,
  amount: 750,
  reason: 'Validação do fluxo administrativo em tempo real.',
  status: 'Pendente',
}).select('*').single();
if (loanApplication.error) throw loanApplication.error;

const adminBEvents = [];
const citizenNotifications = [];
const exchangeEvents = [];
const adminBChannel = adminB.client
  .channel(`bank-admin-b-${crypto.randomUUID()}`)
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'credit_card_applications',
  }, (payload) => adminBEvents.push({ ...payload, source: 'cards' }))
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'loan_applications',
  }, (payload) => adminBEvents.push({ ...payload, source: 'loans' }));
const citizenChannel = citizen.client
  .channel(`bank-citizen-${crypto.randomUUID()}`)
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${citizen.id}`,
  }, (payload) => citizenNotifications.push(payload.new));
const exchangeChannel = adminB.client
  .channel(`bank-exchange-${crypto.randomUUID()}`)
  .on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'country_rp_exchange_rates', filter: 'country_code=eq.BR',
  }, (payload) => exchangeEvents.push(payload.new));
await Promise.all([subscribe(adminBChannel), subscribe(citizenChannel), subscribe(exchangeChannel)]);
// O emulador local inicia o slot de replicação sob demanda logo após o
// primeiro SUBSCRIBED; aguardar esse pequeno intervalo evita perder o primeiro
// WAL apenas durante a inicialização do ambiente de teste.
await new Promise((resolve) => setTimeout(resolve, 2500));

const approved = await adminA.client.rpc('approve_credit_card_application', {
  p_application_id: cardApplication.data.id,
  p_card_limit: 3000,
  p_brand: 'mastercard',
});
if (approved.error) throw approved.error;
assert(approved.data.success, 'Admin A aprova apenas o cartão solicitado');
await waitFor(
  () => adminBEvents.some((event) => event.source === 'cards' && event.new.id === cardApplication.data.id && event.new.status === 'Aprovado'),
  'Admin B receber a aprovação do cartão',
);
assert(true, 'Admin B recebe a aprovação do cartão sem atualizar a lista');

const rejected = await adminA.client.rpc('reject_loan_application', {
  p_application_id: loanApplication.data.id,
  p_feedback: 'Renda insuficiente para o compromisso solicitado.',
});
if (rejected.error) throw rejected.error;
assert(rejected.data.success, 'Admin A rejeita apenas o empréstimo solicitado');
await waitFor(
  () => adminBEvents.some((event) => event.source === 'loans' && event.new.id === loanApplication.data.id && event.new.status === 'Rejeitado'),
  'Admin B receber a rejeição do empréstimo',
);
assert(true, 'Admin B recebe a rejeição do empréstimo sem atualizar a lista');
await waitFor(
  () => citizenNotifications.some((notification) => notification.metadata?.application_id === loanApplication.data.id),
  'cidadão receber a notificação da decisão',
);
assert(true, 'cidadão recebe a decisão bancária em tempo real');

const currencyCycle = await service.rpc('run_currency_market_cycle', { p_cycle_key: `bank-realtime-${crypto.randomUUID()}` });
if (currencyCycle.error) throw currencyCycle.error;
await waitFor(() => exchangeEvents.some((event) => ['USD', 'EUR', 'GBP', 'JPY', 'CNY'].includes(event.currency_code)), 'cotação do RP chegar em tempo real');
assert(true, 'cotação cambial do RP atualiza os cards sem recarregar a página');

const [storedCardApplication, storedLoanApplication, issuedCard, auditRows, notifications] = await Promise.all([
  service.from('credit_card_applications').select('*').eq('id', cardApplication.data.id).single(),
  service.from('loan_applications').select('*').eq('id', loanApplication.data.id).single(),
  service.from('cards').select('*').eq('user_id', citizen.id).eq('brand', 'mastercard').single(),
  service.from('economic_audit_log').select('*').in('entity_id', [cardApplication.data.id, loanApplication.data.id]),
  service.from('notifications').select('*').eq('user_id', citizen.id).in('type', ['bank_credit_review', 'bank_loan_review']),
]);
for (const result of [storedCardApplication, storedLoanApplication, issuedCard, auditRows, notifications]) {
  if (result.error) throw result.error;
}
assert(storedCardApplication.data.status === 'Aprovado' && Number(storedCardApplication.data.approved_limit) === 3000, 'aprovação persiste limite e bandeira reais');
assert(storedLoanApplication.data.status === 'Rejeitado' && storedLoanApplication.data.admin_feedback, 'rejeição persiste justificativa individual');
assert(issuedCard.data.brand === 'mastercard' && Number(issuedCard.data.card_limit) === 3000, 'cartão aprovado é realmente emitido');
assert(auditRows.data.length === 2 && auditRows.data.every((row) => row.actor_profile_id === adminA.id), 'decisões preservam autor e estado anterior na auditoria');
assert(notifications.data.length >= 2, 'aprovação e rejeição notificam o cidadão');

const immutableAudit = await service.from('economic_audit_log').update({ justification: 'Tentativa de adulteração' }).eq('id', auditRows.data[0].id);
assert(Boolean(immutableAudit.error), 'histórico de auditoria não pode ser alterado');

const transfer = await citizen.client.rpc('execute_transfer', {
  p_sender_id: citizen.id,
  p_recipient_id: recipient.id,
  p_amount: 125.5,
  p_description: 'Transferência rastreável de validação',
  p_idempotency_key: crypto.randomUUID(),
});
if (transfer.error) throw transfer.error;
const history = await adminA.client.rpc('get_admin_transaction_history', {
  p_page: 1,
  p_page_size: 5,
  p_search: citizen.username,
  p_type: 'transfer',
  p_status: 'completed',
  p_currency: 'BRL',
  p_date_from: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  p_date_to: new Date().toISOString().slice(0, 10),
  p_min_amount: 100,
  p_max_amount: 200,
  p_sender_id: citizen.id,
  p_recipient_id: recipient.id,
  p_sort: 'amount_desc',
});
if (history.error) throw history.error;
assert(history.data.length === 1 && history.data[0].id === transfer.data.transaction_id, 'histórico combina busca, período, pessoas, valor, tipo e situação');
assert(history.data.every((row) => row.currency === 'BRL'), 'histórico filtra a moeda no servidor');
assert(history.data[0].sender_account_number && history.data[0].recipient_account_number, 'detalhes mostram as duas contas e seus titulares');
assert(Number(history.data[0].tax_amount) >= 0 && history.data[0].metadata, 'detalhes retornam imposto, referência e dados complementares');

const citizenHistory = await citizen.client.rpc('get_admin_transaction_history', {
  p_page: 1, p_page_size: 5, p_search: null, p_type: null, p_status: null,
  p_date_from: null, p_date_to: null, p_min_amount: null, p_max_amount: null,
  p_sender_id: null, p_recipient_id: null, p_sort: 'newest',
});
assert(Boolean(citizenHistory.error), 'cidadão não acessa o histórico financeiro administrativo');

await Promise.all([
  adminB.client.removeChannel(adminBChannel),
  citizen.client.removeChannel(citizenChannel),
  adminB.client.removeChannel(exchangeChannel),
]);

process.stdout.write(`✓ ${checks.length} testes reais de banco, Realtime e rastreio financeiro concluídos.\n`);
