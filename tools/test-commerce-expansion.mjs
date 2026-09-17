import assert from 'node:assert/strict';
import { actor, service, request, rpc, cleanup } from './lib/world-test.mjs';
import { formatDateTimeBR, formatDateBR, fromBrasiliaInput, toBrasiliaInput } from '../src/lib/dateTime.js';
let checks = 0;
const check = (condition, title) => { assert(condition, title); checks++; console.log(`OK ${title}`); };
try {
  for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo', 'America/Sao_Paulo']) {
    process.env.TZ = zone;
    check(formatDateTimeBR('2026-09-15T21:30:00Z').includes('18:30:00'), `horário Brasília em navegador ${zone}`);
    check(formatDateBR('2026-09-15') === '15/09/2026', `data civil preservada em ${zone}`);
    check(fromBrasiliaInput('2026-09-15T18:30') === '2026-09-15T21:30:00.000Z', `entrada datetime-local em ${zone}`);
    check(toBrasiliaInput('2026-09-15T21:30:00Z') === '2026-09-15T18:30', `edição do instante em ${zone}`);
  }
  const buyer = await actor('credit-commerce');
  const stranger = await actor('foreign-credit-card');
  const account = await request(service.from('accounts').insert({ user_id: buyer.id, account_number: crypto.randomUUID(), agency_number: '0001', balance: 0 }).select('id,balance').single());
  const card = async (owner, brand, limit) => request(service.from('cards').insert({ user_id: owner, brand, card_number: crypto.randomUUID().replaceAll('-','').slice(0,16), card_holder_name: 'Teste local', expiry_date: '12/35', cvv: '123', type: 'credit', card_type: 'credit', card_limit: limit, used_limit: 0 }).select('id').single());
  const visa = await card(buyer.id, 'visa', 1000), master = await card(buyer.id, 'mastercard', 1000), foreign = await card(stranger.id, 'visa', 1000);
  const offers = await rpc(buyer.client, 'get_state_citizen_offers', { p_housing: false });
  const offer = offers[0]; assert(offer);
  const args = { p_product_id: offer.id, p_payment_method: 'card', p_card_id: visa.id, p_idempotency_key: crypto.randomUUID() };
  const [first, retry] = await Promise.all([rpc(buyer.client, 'buy_product', args), rpc(buyer.client, 'buy_product', args)]);
  check(first.success && retry.transaction_id === first.transaction_id, 'compra estatal concorrente gera uma cobrança idempotente');
  const invoice = await request(buyer.client.from('card_invoices').select('id,amount').eq('card_id', visa.id).single());
  check(Number(invoice.amount) === Number(first.total), 'fatura guarda o total incluindo tributos');
  const items = await request(buyer.client.from('card_invoice_items').select('*').eq('invoice_id', invoice.id));
  check(items.length === 1 && items[0].transaction_id === first.transaction_id, 'um único item de fatura vinculado à transação');
  check(Number((await request(buyer.client.from('accounts').select('balance').eq('id', account.id).single())).balance) === 0, 'compra no cartão não desconta saldo bancário');
  const second = await rpc(buyer.client, 'buy_product', { ...args, p_card_id: master.id, p_idempotency_key: crypto.randomUUID() });
  check(second.success, 'segundo cartão da mesma conta também é aceito');
  check(Boolean((await buyer.client.rpc('buy_product', { ...args, p_card_id: foreign.id, p_idempotency_key: crypto.randomUUID() })).error), 'cartão de terceiro bloqueado no servidor');
  await request(service.from('cards').update({ card_limit: 1 }).eq('id', visa.id));
  check(Boolean((await buyer.client.rpc('buy_product', { ...args, p_idempotency_key: crypto.randomUUID() })).error), 'limite insuficiente bloqueia nova operação');
  await request(service.from('cards').update({ is_active: false }).eq('id', master.id));
  check(Boolean((await buyer.client.rpc('buy_product', { ...args, p_card_id: master.id, p_idempotency_key: crypto.randomUUID() })).error), 'cartão desativado bloqueado no servidor');
  const prefix = `directory${crypto.randomUUID().slice(0,8)}`;
  const legacy = [];
  for (let base = 0; base < 180; base += 12) legacy.push(...await Promise.all(Array.from({length:12}, (_, n) => actor(`${prefix}-${base+n}`, 'Cidadão', { full_name: `${prefix} Cidadão ${String(base+n).padStart(3,'0')}`, onboarding_completed: false, onboarding_mode: 'legacy_migration' }))));
  const visible = [];
  for (let offset = 0; offset < 180; offset += 30) visible.push(...await rpc(buyer.client, 'search_citizens', { p_search: prefix, p_offset: offset, p_limit: 30 }));
  check(visible.length === 180 && new Set(visible.map(row=>row.id)).size === 180, 'diretório pagina todos os 180 cidadãos legados sem duplicar nem truncar');
  check(visible.every(row => !('email' in row) && !('cpf' in row) && !('real_full_name' in row)), 'diretório não expõe identidade privada nem documento');
  const target = await rpc(buyer.client, 'search_citizens', { p_search: prefix+' Cidadão 179' });
  check(target.length === 1 && target[0].id === legacy[179].id, 'busca encontra cidadão além da primeira página');
  await request(service.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', legacy[0].id));
  check((await rpc(buyer.client,'search_citizens',{p_ids:[legacy[0].id]})).length === 0, 'perfil removido deixa de ser elegível');
  console.log(`${checks} verificações reais aprovadas.`);
} finally { await cleanup(); }
