import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { fetchCitizenSections } from '../src/lib/justice/citizenData.js';
import { profileLookup } from '../src/lib/xProfileRoute.js';
import { fetchBankSections, CARD_SECTIONS } from '../src/lib/bankData.js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.includes('=')).map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"|"$/g, '')];
}));
if (new URL(local.API_URL).hostname !== '127.0.0.1') throw new Error('Somente ambiente local isolado.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, options);
const clients = [], actors = [], occurrenceIds = [];
let checks = 0;
const check = (label, condition) => { assert(condition, label); checks++; console.log(`✓ ${label}`); };
const request = async promise => { const result = await promise; if (result.error) throw result.error; return result.data; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, label) => {
  const started = Date.now();
  while (!predicate()) { if (Date.now() - started > 12000) throw new Error(`Realtime: ${label}`); await pause(75); }
};
async function actor(label, role = 'Cidadão') {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `audit-${suffix}@govrp.local`, password = `Govrp!${crypto.randomUUID()}Aa1`;
  const { user } = await request(service.auth.admin.createUser({ email, password, email_confirm: true }));
  actors.push(user.id);
  const handle = `audit${suffix}`;
  await request(service.from('profiles').upsert({ id: user.id, username: handle, full_name: `Cidadão ${label}`, role, manual_role_override: true, onboarding_completed: true, onboarding_step: 'completed', x_handle: handle, x_username: `${label}${suffix}` }, { onConflict: 'id' }));
  const client = createClient(local.API_URL, local.ANON_KEY, options); clients.push(client);
  await request(client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client, email, password, handle };
}
function subscribe(channel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Canal não conectou.')), 12000);
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timer); reject(new Error(status)); }
    });
  });
}
try {
  const [citizen, officer, stranger] = await Promise.all([actor('autor'), actor('delegado', 'Delegado'), actor('terceiro')]);
  const otherSession = createClient(local.API_URL, local.ANON_KEY, options); clients.push(otherSession);
  await request(otherSession.auth.signInWithPassword({ email: citizen.email, password: citizen.password }));
  const rawCitizen = [], rawStranger = [], rawOfficer = [], notifications = [], serviceEvents = [], publicProfiles = [];
  const channels = [
    citizen.client.channel(`audit-own-${citizen.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'police_occurrences' }, event => rawCitizen.push(event)),
    stranger.client.channel(`audit-other-${stranger.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'police_occurrences' }, event => rawStranger.push(event)),
    officer.client.channel(`audit-authority-${officer.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'police_occurrences' }, event => rawOfficer.push(event)),
    citizen.client.channel(`audit-notices-${citizen.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${citizen.id}` }, event => notifications.push(event.new)),
    otherSession.channel(`audit-internet-${citizen.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'user_services', filter: `user_id=eq.${citizen.id}` }, event => serviceEvents.push(event)),
    otherSession.channel('citizen-public-profile').on('broadcast', { event: 'public-profile-changed' }, event => publicProfiles.push(event.payload)),
  ];
  await Promise.all(channels.map(subscribe));
  await pause(2500);
  const occurrence = await request(citizen.client.rpc('create_police_occurrence', { p_title: 'Ocorrência para teste de sigilo', p_description: 'Descrição completa dos fatos para testar as permissões de acesso.', p_occurrence_type: 'Denúncia', p_location: 'Local isolado', p_occurred_at: new Date().toISOString(), p_anonymous: false, p_priority: 'normal' }));
  occurrenceIds.push(occurrence.id);
  await request(officer.client.rpc('triage_police_occurrence', { p_occurrence_id: occurrence.id, p_action: 'accept', p_notes: 'SIGILO-REALTIME-NAO-PUBLICAR' }));
  await wait(() => rawOfficer.some(event => event.new?.triage_notes === 'SIGILO-REALTIME-NAO-PUBLICAR'), 'triagem chega à autoridade');
  await wait(() => notifications.some(event => event.type === 'justice_occurrence_status_changed' && event.metadata?.occurrence_id === occurrence.id), 'autor recebe andamento seguro');
  await pause(1000);
  check('autor não recebe linha interna da própria ocorrência pelo Realtime', !rawCitizen.some(event => event.new?.id === occurrence.id));
  check('terceiro não recebe ocorrência ou triagem pelo Realtime', !rawStranger.some(event => event.new?.id === occurrence.id));
  check('autoridade autorizada recebe a atualização interna', rawOfficer.some(event => event.new?.triage_notes === 'SIGILO-REALTIME-NAO-PUBLICAR'));
  check('notificação de andamento exclui a nota interna', !JSON.stringify(notifications).includes('SIGILO-REALTIME'));
  check('PostgREST bloqueia leitura direta de triage_notes pelo autor', (await request(citizen.client.from('police_occurrences').select('id,triage_notes').eq('id', occurrence.id))).length === 0);
  const safePage = await fetchCitizenSections(citizen.client, ['occurrences']);
  check('RPC paginada acompanha a situação sem campos internos', safePage.errors.length === 0 && safePage.values.occurrences.some(item => item.id === occurrence.id && item.status === 'Em triagem') && !JSON.stringify(safePage).includes('triage_notes'));

  const card = await request(service.from('cards').insert({ user_id: citizen.id, card_number: `4000${Date.now().toString().slice(-12)}`, card_holder_name: 'Cidadão Teste', expiry_date: '12/30', cvv: '123', type: 'credit', brand: 'visa' }).select('id').single());
  const invoice = await request(service.from('card_invoices').insert({ card_id: card.id, user_id: citizen.id, closing_date: '2026-09-20', due_date: '2026-09-27', amount: 35 }).select('id').single());
  const cards = await fetchBankSections(citizen.client, citizen.id, CARD_SECTIONS);
  check('consulta de cartões e faturas mantém os registros reais do titular', cards.errors.length === 0 && cards.values.cards.some(item => item.id === card.id) && cards.values.invoices.some(item => item.id === invoice.id));
  await request(service.from('card_invoices').update({ amount: 55 }).eq('id', invoice.id));
  const invoices = await fetchBankSections(citizen.client, citizen.id, ['invoices']);
  check('atualização seletiva de fatura retorna seu valor novo sem consultar cartões', invoices.errors.length === 0 && Number(invoices.values.invoices.find(item => item.id === invoice.id)?.amount) === 55 && !('cards' in invoices.values));
  const forbiddenInvoices = await fetchBankSections(stranger.client, citizen.id, ['invoices']);
  check('filtro de faturas continua subordinado à autorização do banco', forbiddenInvoices.errors.length === 0 && forbiddenInvoices.values.invoices.length === 0);

  // The empty local stack needs the economic basket used by the service trigger.
  await request(service.from('price_basket_items').upsert({ code: 'internet', name: 'Internet', category: 'Comunicação', weight: 0.1, base_price: 79.9, current_price: 79.9 }, { onConflict: 'code', ignoreDuplicates: true }));
  await request(service.from('user_services').upsert({ user_id: citizen.id, service_type: 'Internet', plan_name: 'Básico', price: 79.9 }, { onConflict: 'user_id,service_type' }));
  await request(citizen.client.from('user_services').update({ plan_name: 'Ultra', price: 99.9 }).eq('user_id', citizen.id).eq('service_type', 'Internet'));
  await wait(() => serviceEvents.some(event => event.new?.plan_name === 'Ultra'), 'outra sessão recebe plano Ultra');
  const plan = await request(otherSession.from('user_services').select('*').eq('user_id', citizen.id).eq('service_type', 'Internet').single());
  check('mudança do plano chega à segunda sessão e à consulta compartilhada', plan.plan_name === 'Ultra');
  const renamed = await request(citizen.client.rpc('update_x_handle', { p_new_handle: `${citizen.handle}n` }));
  check('validação do @ retorna o novo endereço', renamed.success && renamed.new_handle);
  // update_x_handle validates availability; EditProfileModal persists it with
  // the rest of the profile before updating the route.
  await request(citizen.client.from('profiles').update({ x_handle: renamed.new_handle }).eq('id', citizen.id));
  await wait(() => publicProfiles.some(event => event.id === citizen.id), 'troca do @ publica invalidação segura');
  const lookup = profileLookup(citizen.handle, { handle: citizen.handle, id: citizen.id, viewerId: citizen.id }, citizen.id);
  const renamedProfile = await request(otherSession.from('public_citizen_profiles').select('id,x_handle').eq(lookup.column, lookup.value).single());
  check('perfil já aberto encontra o novo @ por ID após o evento', renamedProfile.x_handle === renamed.new_handle);
  console.log(`\n${checks} verificações reais de API e Realtime aprovadas.`);
} catch (error) {
  console.error('Falha na verificação:', error);
  throw error;
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
  // The immutable audit deliberately prevents deleting an actor. Only the
  // isolated test DB may remove these specific fixture audit rows for teardown.
  if (actors.length) {
    assert(actors.every(id => /^[0-9a-f-]{36}$/.test(id)));
    const ids = actors.map(id => `'${id}'`).join(',');
    execFileSync('docker', ['exec', '-i', 'supabase_db_GOVRP', 'sh', '-c', 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f -'], {
      input: `begin; set local session_replication_role=replica;
        delete from public.justice_audit_log where actor_id in (${ids});
        delete from public.economic_events where actor_profile_id in (${ids});
        delete from public.price_observations where source_table='user_services' and source_id in (select id::text from public.user_services where user_id in (${ids}));
        commit;`, encoding: 'utf8',
    });
  }
  if (occurrenceIds.length) await request(service.from('police_occurrences').delete().in('id', occurrenceIds));
  for (const id of actors) await request(service.auth.admin.deleteUser(id));
}
