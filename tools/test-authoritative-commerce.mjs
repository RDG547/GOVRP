import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, '')]; }));
if (!local.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');
const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const checks = [];
const assert = (condition, label) => { if (!condition) throw new Error(`Falha: ${label}`); checks.push(label); };
const toCents = (value) => Math.round(Number(value) * 100);

const createActor = async (label, role, balance) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `commerce-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await service.from('profiles').upsert({ id, username: `${label}${suffix}`, full_name: `Teste ${label}`, role, onboarding_completed: true, onboarding_step: 'completed' }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  const account = await service.from('accounts').insert({ user_id: id, account_number: `${Date.now()}${suffix}`.slice(0, 18), agency_number: '0001', balance }).select('*').single();
  if (account.error) throw account.error;
  const client = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id, client, account: account.data };
};

const [seller, buyer, admin] = await Promise.all([
  createActor('seller', 'Cidadão', 1000), createActor('buyer', 'Cidadão', 2000), createActor('admin', 'Admin', 1000),
]);
const businessTypeId = `test-${crypto.randomUUID().slice(0, 8)}`;
const productName = `Produto funcional ${businessTypeId}`;
const businessType = await service.from('business_types').insert({
  id: businessTypeId, name: 'Comércio funcional', category: 'Teste', description: 'Tipo temporário para validar o ciclo empresarial.',
  registration_fee: 100, min_employees: 2, is_active: true, requires_cnpj: false,
}).select('id').single();
if (businessType.error) throw businessType.error;

const registrationKey = crypto.randomUUID();
const registration = await service.rpc('register_business_authoritative', {
  p_owner_id: seller.id, p_business_type_id: businessTypeId, p_company_name: 'Empresa Funcional Integrada',
  p_description: 'Empresa criada para validar cobrança, conta bancária e receita pública em uma transação.', p_idempotency_key: registrationKey,
});
if (registration.error) throw registration.error;
assert(registration.data?.bank_account_id === seller.account.id, 'empresa nasce vinculada à conta do proprietário');
const repeatedRegistration = await service.rpc('register_business_authoritative', {
  p_owner_id: seller.id, p_business_type_id: businessTypeId, p_company_name: 'Empresa Funcional Integrada',
  p_description: 'Empresa criada para validar cobrança, conta bancária e receita pública em uma transação.', p_idempotency_key: registrationKey,
});
assert(!repeatedRegistration.error && repeatedRegistration.data.id === registration.data.id, 'registro empresarial é idempotente');
await service.from('businesses').update({ status: 'active' }).eq('id', registration.data.id);

const product = await seller.client.rpc('save_business_product', {
  p_product_id: null, p_business_id: registration.data.id, p_name: productName,
  p_description: 'Produto que valida todo o caminho oficial do comércio.', p_price: 100,
  p_image_url: 'https://example.test/product.png', p_product_type: 'one-time', p_subscription_interval: null,
  p_category: 'Outros', p_stock: 3, p_promotion_price: null, p_promotion_expires_at: null,
});
if (product.error) throw product.error;
assert(product.data.business_id === registration.data.id, 'produto pertence a uma empresa canônica');

const [treasuryBefore, sellerBefore, levyQuote] = await Promise.all([
  service.from('government_finances').select('treasury_balance').eq('id', 1).single(),
  service.from('accounts').select('balance').eq('id', seller.account.id).single(),
  service.rpc('quote_legal_levies',{p_basis:'purchase',p_amount:100,p_business:true,p_sector:registration.data.economic_sector_id || null,p_category:'Outros'}),
]);
for (const result of [treasuryBefore, sellerBefore, levyQuote]) if (result.error) throw result.error;
const expectedConsumptionTax = Number(levyQuote.data.buyer_tax);
const expectedCorporateTax = Number(levyQuote.data.seller_tax);
const expectedTotal = 100 + expectedConsumptionTax;
const expectedTaxes = expectedConsumptionTax + expectedCorporateTax;
const purchaseKey = crypto.randomUUID();
const purchase = await buyer.client.rpc('buy_product', {
  p_product_id: product.data.id, p_payment_method: 'balance', p_card_id: null, p_idempotency_key: purchaseKey,
});
if (purchase.error) throw purchase.error;
assert(purchase.data.success && Number(purchase.data.total) === expectedTotal && Number(purchase.data.tax) === expectedTaxes, 'compra calcula consumo e imposto empresarial vigentes');

const [buyerAccount, sellerAccount, treasuryAfter, order, revenues, businessLedger, inventory, events] = await Promise.all([
  service.from('accounts').select('balance').eq('id', buyer.account.id).single(),
  service.from('accounts').select('balance').eq('id', seller.account.id).single(),
  service.from('government_finances').select('treasury_balance').eq('id', 1).single(),
  service.from('commerce_orders').select('*').eq('idempotency_key', purchaseKey).single(),
  service.from('government_revenues').select('revenue_type,amount').eq('source_table', 'commerce_orders').eq('source_id',purchase.data.order_id),
  service.from('business_transactions').select('type,amount').eq('business_id', registration.data.id),
  service.from('user_inventory').select('quantity').eq('user_id', buyer.id).eq('product_id', product.data.id).single(),
  service.from('domain_events').select('event_type').eq('idempotency_key', `commerce-purchase:${purchaseKey}`).single(),
]);
for (const result of [buyerAccount,sellerAccount,treasuryAfter,order,revenues,businessLedger,inventory,events]) if (result.error) throw result.error;
assert(Number(buyerAccount.data.balance) === 2000 - expectedTotal, 'comprador paga o total exato');
assert(Number(sellerAccount.data.balance) === Number(sellerBefore.data.balance) + 100 - expectedCorporateTax, 'empresa recebe a venda líquida dos impostos');
assert(toCents(treasuryAfter.data.treasury_balance) - toCents(treasuryBefore.data.treasury_balance) === toCents(expectedTaxes), 'Tesouro recebe toda a arrecadação da compra');
assert(revenues.data.filter(item=>item.revenue_type==='consumption_tax').reduce((sum,item)=>sum+Number(item.amount),0)===expectedConsumptionTax && revenues.data.filter(item=>item.revenue_type==='corporate_tax').reduce((sum,item)=>sum+Number(item.amount),0)===expectedCorporateTax, 'receitas públicas distinguem os dois impostos');
assert(businessLedger.data.some((item) => item.type === 'revenue' && Number(item.amount) === 100) && businessLedger.data.filter(item=>item.type==='tax').reduce((sum,item)=>sum+Number(item.amount),0)===-expectedCorporateTax, 'livro da empresa registra receita e tributo');
assert(inventory.data.quantity === 1 && events.data.event_type === 'commerce_purchase_completed', 'estoque, inventário e evento são concluídos juntos');

const repeatedPurchase = await buyer.client.rpc('buy_product', { p_product_id: product.data.id, p_payment_method: 'balance', p_card_id: null, p_idempotency_key: purchaseKey });
if (repeatedPurchase.error) throw repeatedPurchase.error;
const afterRetry = await service.from('accounts').select('balance').eq('id', buyer.account.id).single();
assert(Number(afterRetry.data.balance) === 2000 - expectedTotal && repeatedPurchase.data.order_id === order.data.id, 'repetição não cobra nem entrega duas vezes');

const directInsert = await buyer.client.from('transactions').insert({ from_account_id: buyer.account.id, to_account_id: seller.account.id, amount: 999, type: 'transfer' });
assert(Boolean(directInsert.error), 'cliente não cria transação bancária direta');
const spoofTransfer = await buyer.client.rpc('execute_transfer', { p_sender_id: seller.id, p_recipient_id: buyer.id, p_amount: 1, p_description: 'Tentativa', p_idempotency_key: crypto.randomUUID() });
assert(Boolean(spoofTransfer.error), 'transferência não aceita remetente diferente da sessão');

const history = await admin.client.rpc('get_admin_transaction_history', { p_page: 1, p_page_size: 5, p_search: productName, p_type: null });
if (history.error) throw history.error;
assert(history.data.length === 1 && Number(history.data[0].total_count) === 1, 'Admin consulta histórico paginado e pesquisável');

process.stdout.write(`✓ ${checks.length} testes reais do comércio autoritativo concluídos.\n`);
