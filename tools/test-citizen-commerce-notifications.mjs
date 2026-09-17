import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { actor, service, request, rpc, cleanup } from './lib/world-test.mjs';

let checks = 0;
const check = (ok, label) => { assert(ok, label); checks++; console.log(`OK ${label}`); };
const sql = query => execFileSync('docker', ['exec', 'supabase_db_GOVRP', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
const buy = (client, id) => rpc(client, 'buy_product', { p_product_id: id, p_payment_method: 'balance', p_card_id: null, p_idempotency_key: crypto.randomUUID() });
let availability;
try {
  const buyer = await actor('commerce-notices', 'Cidadão', { cpf: String(Date.now()).slice(-11) });
  const seller = await actor('food-seller');
  const vice = await actor('party-vice');
  for (const person of [buyer, seller]) await request(service.from('accounts').insert({ user_id: person.id, account_number: crypto.randomUUID().slice(0,18), agency_number: '0001', balance: 10000 }));
  const args = { p_product_id: null, p_business_id: null, p_name: 'Refeição do cidadão', p_description: 'Refeição produzida por vendedor cidadão.', p_price: 10, p_image_url: null, p_product_type: 'one-time', p_subscription_interval: null, p_category: 'Alimentos', p_stock: 3, p_promotion_price: null, p_promotion_expires_at: null, p_consumable_effects: { hunger: 25 } };
  const product = await rpc(seller.client, 'save_business_product', args);
  const purchase = await buy(buyer.client, product.id);
  const item = await request(buyer.client.from('user_inventory').select('*').eq('metadata->>transaction_id', purchase.transaction_id).single());
  check(item.metadata.consumable_effects.hunger === 25, 'compra de consumível de jogador guarda os efeitos no inventário');
  await rpc(seller.client, 'save_business_product', { ...args, p_product_id: product.id, p_stock: 2, p_consumable_effects: { hunger: 60 } });
  await rpc(buyer.client, 'get_citizen_needs');
  await request(service.from('citizen_needs').update({ hunger: 20 }).eq('user_id', buyer.id));
  const consumed = await rpc(buyer.client, 'citizen_need_action', { p_action: 'consume', p_reference_id: item.id, p_idempotency_key: crypto.randomUUID() });
  check(consumed.hunger === 45, 'alteração do vendedor não recalcula o item já comprado');
  const sellerPurchase = await buy(buyer.client, product.id);
  const giftItem = await request(buyer.client.from('user_inventory').select('*').eq('metadata->>transaction_id', sellerPurchase.transaction_id).single());
  await request(service.from('profiles').update({ cpf: String(Date.now() + 1).slice(-11) }).eq('id', vice.id));
  const recipient = await request(service.from('profiles').select('cpf').eq('id', vice.id).single());
  const gifts = await Promise.all([1,2].map(() => buyer.client.rpc('gift_inventory_item', { p_inventory_id: giftItem.id, p_recipient_cpf: recipient.cpf, p_quantity: 1 })));
  check(gifts.filter(result => !result.error).length === 1, 'duas tentativas de presentear a mesma unidade não duplicam inventário');
  const received = await request(vice.client.from('user_inventory').select('*').eq('product_id', product.id).single());
  check(received.quantity === 1 && received.metadata.consumable_effects.hunger === 60, 'presente mantém quantidade e efeitos registrados');
  check(Boolean((await seller.client.rpc('save_business_product', { ...args, p_consumable_effects: { health: 100 } })).error), 'vendedor não cria efeitos de saúde arbitrários');

  availability = await request(service.from('system_settings').select('*').eq('key', 'service_availability').maybeSingle());
  await request(service.from('system_settings').upsert({ key: 'service_availability', value: { ...availability?.value, '/services/business': { mode: 'maintenance' } } }));
  check(Boolean((await buyer.client.rpc('buy_product', { p_product_id: product.id, p_payment_method: 'balance', p_card_id: null, p_idempotency_key: crypto.randomUUID() })).error), 'serviço comercial desativado bloqueia nova compra no servidor');
  check(Boolean((await seller.client.rpc('save_business_product', args)).error), 'serviço comercial desativado bloqueia cadastro no servidor');
  await request(service.from('system_settings').upsert({ key: 'service_availability', value: { ...availability?.value, '/services/inventory': { mode: 'maintenance' } } }));
  check(Boolean((await vice.client.rpc('citizen_need_action', { p_action: 'consume', p_reference_id: received.id, p_idempotency_key: crypto.randomUUID() })).error), 'inventário indisponível também bloqueia o consumo no servidor');
  await request(service.from('system_settings').upsert(availability || { key: 'service_availability', value: {} }));

  const party = await request(service.from('political_parties').insert({ name: `Partido ${crypto.randomUUID().slice(0,8)}`, acronym: `T${crypto.randomUUID().slice(0,5)}`, founder_id: seller.id, owner_id: seller.id, president_id: buyer.id, vice_president_id: vice.id, registration_number: crypto.randomUUID(), is_active: false }).select('id').single());
  await request(service.from('political_parties').update({ is_active: true }).eq('id', party.id));
  await request(service.from('political_parties').update({ is_active: true }).eq('id', party.id));
  const notices = await request(service.from('notifications').select('*').eq('type', 'party_approved').eq('metadata->>party_id', party.id));
  check(notices.length === 3 && new Set(notices.map(n => n.user_id)).size === 3, 'ativação notifica dono, presidente e vice uma vez');
  const pending = notices.find(n => n.user_id === buyer.id);
  check(!pending.metadata.celebration_seen_at, 'celebração offline permanece pendente');
  check(await rpc(buyer.client, 'acknowledge_party_welcome', { p_notification_id: pending.id }), 'ciência da celebração persiste');
  check(!await rpc(buyer.client, 'acknowledge_party_welcome', { p_notification_id: pending.id }), 'celebração já vista não se repete');
  check(!await rpc(vice.client, 'acknowledge_party_welcome', { p_notification_id: pending.id }), 'cidadão não marca a celebração alheia');
  const card = await request(service.from('cards').insert({ user_id: buyer.id, card_number: crypto.randomUUID().replaceAll('-','').slice(0,16), card_holder_name: 'Teste Notificação', expiry_date: '12/30', cvv: '123', type: 'credit', card_limit: 1000 }).select('id').single());
  const invoice = await request(service.from('card_invoices').insert({ card_id: card.id, user_id: buyer.id, closing_date: '2026-09-09', due_date: '2026-09-19', amount: 125.50, status: 'open' }).select('id').single());
  await request(service.from('card_invoices').update({ status: 'closed' }).eq('id', invoice.id));
  await request(service.from('card_invoices').update({ status: 'overdue' }).eq('id', invoice.id));
  const invoices = await request(buyer.client.from('notifications').select('*').eq('type', 'bank_invoice_closed').eq('metadata->>invoice_id', invoice.id));
  check(invoices.length === 1 && Number(invoices[0].metadata.amount) === 125.50 && invoices[0].content.includes('19/09/2026'), 'fechamento de fatura notifica valor e vencimento sem duplicar no atraso');

  // All exchange mutations stay inside a rolled-back local transaction.
  sql(`begin;
    insert into public.country_rp_states(country_code,country_name) values('ZZ','País isolado de teste') on conflict do nothing;
    insert into public.country_rp_exchange_rates(country_code,currency_code,brl_per_unit,source) values('ZZ','USD',5,'test');
    update public.country_rp_exchange_rates set brl_per_unit=5.5 where country_code='ZZ';
    do $$ begin if not exists(select 1 from public.get_rp_exchange_quotes('ZZ') where change_percent=10 and day_open_rate=5) then raise exception 'Variação diária incorreta'; end if; end $$;
    alter table public.country_rp_exchange_rates disable trigger capture_exchange_day_open;
    update public.country_rp_exchange_rates set rp_day=rp_day-1 where country_code='ZZ';
    alter table public.country_rp_exchange_rates enable trigger capture_exchange_day_open;
    do $$ begin if not exists(select 1 from public.get_rp_exchange_quotes('ZZ') where change_percent=0 and day_open_rate=5.5) then raise exception 'Dia RP novo não reiniciou comparação'; end if; end $$;
    update public.country_rp_exchange_rates set brl_per_unit=6.05 where country_code='ZZ';
    do $$ begin if not exists(select 1 from public.get_rp_exchange_quotes('ZZ') where change_percent=10 and day_open_rate=5.5) then raise exception 'Preço anterior ao dia não foi preservado'; end if; end $$;
    rollback;`);
  check(true, 'câmbio compara o dia RP, reinicia na virada e usa a cotação anterior sem dados externos');
  console.log(`\n${checks} verificações reais de consumo, serviços, notificações e câmbio aprovadas.`);
} finally {
  if (availability) await request(service.from('system_settings').upsert(availability));
  await cleanup();
}
