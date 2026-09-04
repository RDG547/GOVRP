import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
    })
);

const url = env.API_URL;
const anonKey = env.ANON_KEY;
const serviceKey = env.SECRET_KEY || env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Supabase local não está disponível.');

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anonymous = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const userIds = [];
const cleanup = { houses: [], bills: [], cards: [], stories: [], billsOfExchange: [] };
const checks = [];

const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const createUser = async (label, role) => {
  const suffix = `${Date.now()}${crypto.randomUUID().slice(0, 6)}`;
  const email = `hardening-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw error || new Error('Usuário de teste não criado.');
  userIds.push(data.user.id);
  const profile = {
    id: data.user.id,
    full_name: `Teste ${label}`,
    username: `${label}${suffix}`.slice(0, 20),
    role,
    onboarding_completed: true,
    onboarding_step: 'completed',
  };
  const { error: profileError } = await service.from('profiles').upsert(profile, { onConflict: 'id' });
  if (profileError) throw profileError;
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client, profile };
};

try {
  const admin = await createUser('admin', 'Admin');
  const member = await createUser('member', 'Deputado');
  const stranger = await createUser('stranger', 'Cidadão');

  const [publicStats, adminStats, adminUsers, forbiddenUsers] = await Promise.all([
    anonymous.rpc('get_public_dashboard_stats'),
    admin.client.rpc('get_admin_dashboard_stats'),
    admin.client.rpc('admin_get_all_users'),
    stranger.client.rpc('admin_get_all_users'),
  ]);
  for (const result of [publicStats, adminStats, adminUsers]) if (result.error) throw result.error;
  assert(Number(publicStats.data.total_users) === Number(adminStats.data[0].total_users)
    && Number(publicStats.data.total_transactions) === Number(adminStats.data[0].total_transactions),
  'contadores públicos deslogados coincidem com os totais administrativos');
  assert(adminUsers.data.some((profile) => profile.id === member.id), 'Admin busca usuários com o contrato completo da consulta');
  assert(Boolean(forbiddenUsers.error), 'cidadão comum não acessa a busca administrativa de usuários');

  const { data: house, error: houseError } = await service.from('parliament_houses').insert({
    name: `Casa Hardening ${Date.now()}`,
    description: 'Casa criada apenas pelo teste de segurança.',
  }).select('id').single();
  if (houseError) throw houseError;
  cleanup.houses.push(house.id);

  const today = new Date();
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const { error: membershipError } = await service.from('parliament_members').insert({
    user_id: member.id,
    house_id: house.id,
    term_start_date: today.toISOString().slice(0, 10),
    term_end_date: nextMonth.toISOString().slice(0, 10),
  });
  if (membershipError) throw membershipError;

  const { data: bill, error: billError } = await service.from('bills').insert({
    title: 'Projeto de segurança autoritativa',
    summary: 'Comprova que a tramitação não pode ser manipulada no cliente.',
    full_text: 'Texto integral de validação do fluxo parlamentar autoritativo.',
    author_id: member.id,
    house_id: house.id,
    status: 'Em discussão',
    type: 'PL',
  }).select('*').single();
  if (billError) throw billError;
  cleanup.bills.push(bill.id);

  const directBillUpdate = await member.client.from('bills').update({ status: 'Sancionado' }).eq('id', bill.id);
  assert(Boolean(directBillUpdate.error), 'alteração direta de status legislativo é negada');

  const directVoting = await admin.client.from('parliament_votings').insert({
    house_id: house.id,
    title: 'Votação forjada',
    type: 'bill',
    related_id: bill.id,
    status: 'closed',
    end_date: new Date(Date.now() + 86400000).toISOString(),
  });
  assert(Boolean(directVoting.error), 'criação direta de votação parlamentar é negada');

  const anonymousStart = await anonymous.rpc('start_parliament_bill_voting', {
    p_bill_id: bill.id, p_house_id: house.id, p_title: bill.title, p_description: null,
  });
  assert(Boolean(anonymousStart.error), 'anônimo não abre votação parlamentar');

  const citizenStart = await stranger.client.rpc('start_parliament_bill_voting', {
    p_bill_id: bill.id, p_house_id: house.id, p_title: bill.title, p_description: null,
  });
  assert(Boolean(citizenStart.error), 'cidadão sem autoridade não abre votação parlamentar');

  const { data: voting, error: startError } = await admin.client.rpc('start_parliament_bill_voting', {
    p_bill_id: bill.id,
    p_house_id: house.id,
    p_title: bill.title,
    p_description: 'Votação oficial do projeto.',
  });
  if (startError) throw startError;
  assert(voting?.status === 'active', 'autoridade abre votação com prazo e status definidos no banco');

  const prematureStatus = await member.client.rpc('update_bill_status', {
    p_bill_id: bill.id, p_new_status: 'Aguardando sanção presidencial',
  });
  assert(Boolean(prematureStatus.error), 'projeto não avança antes do resultado real');

  const directVote = await member.client.from('parliament_voting_votes').insert({
    voting_id: voting.id, member_id: crypto.randomUUID(), vote: 'Aprovar',
  });
  assert(Boolean(directVote.error), 'voto parlamentar direto é negado');

  const { data: castResult, error: castError } = await member.client.rpc('cast_parliament_vote', {
    p_voting_id: voting.id,
    p_member_id: (await service.from('parliament_members').select('id').eq('user_id', member.id).eq('house_id', house.id).single()).data.id,
    p_vote: 'Aprovar',
  });
  if (castError) throw castError;
  assert(castResult?.success === true, 'voto parlamentar válido é aceito pela função autoritativa');

  const { error: resultError } = await member.client.rpc('update_bill_status', {
    p_bill_id: bill.id, p_new_status: 'Aguardando sanção presidencial',
  });
  if (resultError) throw resultError;
  assert(true, 'resultado aprovado encaminha o projeto para decisão presidencial');

  const citizenSanction = await member.client.rpc('update_bill_status', {
    p_bill_id: bill.id, p_new_status: 'Sancionado',
  });
  assert(Boolean(citizenSanction.error), 'parlamentar não pode sancionar projeto');
  const { error: sanctionError } = await admin.client.rpc('update_bill_status', {
    p_bill_id: bill.id, p_new_status: 'Sancionado',
  });
  if (sanctionError) throw sanctionError;
  assert(true, 'Executivo autorizado sanciona projeto legitimamente aprovado');

  const { data: card, error: cardError } = await service.from('cards').insert({
    user_id: member.id,
    card_number: `411111${String(Date.now()).slice(-10)}`,
    card_holder_name: member.profile.full_name,
    expiry_date: '12/35',
    cvv: '123',
    type: 'credit',
    card_limit: 1000,
    brand: 'visa',
  }).select('*').single();
  if (cardError) throw cardError;
  cleanup.cards.push(card.id);
  const directLimit = await member.client.from('cards').update({ card_limit: 999999 }).eq('id', card.id);
  assert(Boolean(directLimit.error), 'cidadão não altera diretamente o limite do cartão');
  const { data: adjustedCard, error: limitError } = await admin.client.rpc('set_bank_card_limit', {
    p_card_id: card.id, p_new_limit: 2500, p_reason: 'Teste de decisão auditável.',
  });
  if (limitError) throw limitError;
  assert(Number(adjustedCard?.card_limit) === 2500, 'Banco Nacional altera limite por decisão validada');
  const { count: limitAuditCount } = await service.from('economic_audit_log')
    .select('id', { count: 'exact', head: true }).eq('entity_type', 'cards').eq('entity_id', card.id);
  assert(limitAuditCount === 1, 'mudança de limite mantém auditoria');

  const { error: roleUpdateError } = await admin.client.rpc('admin_update_user', {
    p_user_id: stranger.id,
    p_full_name: stranger.profile.full_name,
    p_username: stranger.profile.username,
    p_role: 'Cidadão',
    p_titles: ['Participante do teste'],
  });
  if (roleUpdateError) throw roleUpdateError;
  const { data: privilegeAudit } = await service.from('security_audit_log')
    .select('actor_id, action').eq('target_id', stranger.id).single();
  assert(privilegeAudit?.actor_id === admin.id, 'alteração de privilégio registra o executor');
  const auditMutation = await service.from('security_audit_log').update({ action: 'tampered' }).eq('target_id', stranger.id);
  assert(Boolean(auditMutation.error), 'auditoria de segurança é imutável até para serviço');

  const missingTreasuryReason = await admin.client.rpc('admin_modify_treasury', {
    p_amount: 5, p_action: 'add', p_reason: 'curto',
  });
  assert(Boolean(missingTreasuryReason.error), 'ajuste financeiro administrativo exige justificativa completa');
  const treasuryAdjustment = await admin.client.rpc('admin_modify_treasury', {
    p_amount: 7, p_action: 'add', p_reason: 'Correção funcional auditada do saldo do Tesouro Nacional.',
  });
  if (treasuryAdjustment.error) throw treasuryAdjustment.error;
  const treasuryRestore = await admin.client.rpc('admin_modify_treasury', {
    p_amount: 7, p_action: 'remove', p_reason: 'Reversão funcional auditada do ajuste realizado no teste.',
  });
  if (treasuryRestore.error) throw treasuryRestore.error;
  const investmentAdjustment = await admin.client.rpc('admin_modify_investments', {
    p_user_id: stranger.id,
    p_amount: 10,
    p_action: 'add',
    p_reason: 'Correção funcional auditada do investimento do cidadão de teste.',
  });
  if (investmentAdjustment.error) throw investmentAdjustment.error;
  const { data: administrativeAudits, error: administrativeAuditError } = await service.from('economic_audit_log')
    .select('action,actor_profile_id')
    .eq('actor_profile_id', admin.id)
    .in('action', ['admin_treasury_adjustment', 'admin_investment_adjustment']);
  if (administrativeAuditError) throw administrativeAuditError;
  assert(administrativeAudits.filter((item) => item.action === 'admin_treasury_adjustment').length === 2
    && administrativeAudits.some((item) => item.action === 'admin_investment_adjustment'),
  'ajustes administrativos financeiros preservam trilha completa');
  assert(administrativeAudits.every((item) => item.actor_profile_id === admin.id), 'auditoria financeira identifica o Admin executor');

  const accountSuffix = String(Date.now()).slice(-9);
  const [{ data: payerAccount, error: payerError }, { error: issuerError }] = await Promise.all([
    service.from('accounts').insert({ user_id: member.id, account_number: `91${accountSuffix}`, transfer_key: `P${accountSuffix.slice(-5)}`, balance: 5000 }).select('*').single(),
    service.from('accounts').insert({ user_id: admin.id, account_number: `92${accountSuffix}`, transfer_key: `I${accountSuffix.slice(-5)}`, balance: 1000 }),
  ]);
  if (payerError || issuerError) throw payerError || issuerError;
  const { data: paymentBill, error: paymentBillError } = await service.from('bills_of_exchange').insert({
    issuer_id: admin.id,
    payer_id: member.id,
    bill_code: `SEC-${Date.now()}`,
    amount: 200,
    due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    description: 'Boleto do teste de atomicidade.',
  }).select('*').single();
  if (paymentBillError) throw paymentBillError;
  cleanup.billsOfExchange.push(paymentBill.id);
  const { data: payment, error: paymentError } = await member.client.rpc('pay_boleto', { p_bill_code: paymentBill.bill_code });
  if (paymentError) throw paymentError;
  assert(payment?.success === true, 'boleto do próprio cidadão é pago de forma autoritativa');
  const secondPayment = await member.client.rpc('pay_boleto', { p_bill_code: paymentBill.bill_code });
  assert(secondPayment.data?.success === false, 'boleto pago não pode ser debitado novamente');
  const { data: payerAfter } = await service.from('accounts').select('balance').eq('id', payerAccount.id).single();
  const { count: paymentCount } = await service.from('transactions').select('id', { count: 'exact', head: true }).eq('idempotency_key', paymentBill.id);
  assert(Number(payerAfter.balance) === 4800 && paymentCount === 1, 'pagamento mantém saldo e lançamento únicos');

  const foreignBill = await stranger.client.rpc('validate_and_get_bill', { p_bill_code: paymentBill.bill_code });
  assert(foreignBill.data?.status === 'invalid', 'terceiro não consulta dados do boleto alheio');

  const directHearing = await member.client.from('prison_hearings').insert({
    case_id: 'SECURITY-TEST', user_id: member.id, reason: 'Tentativa direta.',
  });
  assert(Boolean(directHearing.error), 'solicitação judicial direta é negada');
  const { data: hearing, error: hearingError } = await member.client.rpc('schedule_hearing', {
    p_case_id: 'SECURITY-TEST', p_reason: 'Solicitação legítima por função validada.',
  });
  if (hearingError) throw hearingError;
  assert(hearing?.success === true, 'solicitação judicial legítima continua funcional');

  const { data: story, error: storyError } = await member.client.from('stories').insert({
    user_id: member.id, media_url: 'text://security-test', media_type: 'text', content: 'Story seguro.',
  }).select('*').single();
  if (storyError) throw storyError;
  cleanup.stories.push(story.id);
  const directStoryDelete = await member.client.from('stories').delete().eq('id', story.id);
  assert(Boolean(directStoryDelete.error), 'story não é excluído diretamente');
  const { data: storyDelete, error: storyDeleteError } = await member.client.rpc('delete_story', { p_story_id: story.id });
  if (storyDeleteError) throw storyDeleteError;
  assert(storyDelete?.success === true, 'dono exclui story pela função autorizada');
  cleanup.stories = cleanup.stories.filter((id) => id !== story.id);

  console.log(`Hardening de segurança: ${checks.length} verificações reais aprovadas.`);
  checks.forEach((label) => console.log(`✓ ${label}`));
} finally {
  await service.from('stories').delete().in('id', cleanup.stories);
  await service.from('bills_of_exchange').delete().in('id', cleanup.billsOfExchange);
  await service.from('cards').delete().in('id', cleanup.cards);
  await service.from('bills').delete().in('id', cleanup.bills);
  await service.from('parliament_houses').delete().in('id', cleanup.houses);
  for (const userId of userIds.reverse()) await service.auth.admin.deleteUser(userId).catch(() => null);
}
