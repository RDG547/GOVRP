import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { actor, local, service, request, rpc, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
import { electoralCalendarDates, electoralCalendarPayload } from '../src/lib/electoralCalendar.js';
import { toBrasiliaInput } from '../src/lib/dateTime.js';
import { userErrorMessage } from '../src/lib/userErrors.js';

const origin = 'http://127.0.0.1:3117';
const created = new Set();
const marker = `Calendário ${crypto.randomUUID().slice(0, 8)}`;
let browser, dev, output;
let checks = 0;
const check = (value, message) => { assert(value, message); console.log(`✓ ${message}`); checks++; };
const save = (client, data, id = null) => client.rpc('manage_electoral_calendar', { p_election_id: id, p_data: data });

try {
  const [admin, manager, citizen] = await Promise.all([
    actor('calendar-regression-admin', 'Admin'),
    actor('calendar-regression-manager', 'Presidente do Portal Eleitoral'),
    actor('calendar-regression-citizen'),
  ]);
  const type = await request(service.from('election_types').select('id,name').eq('name', 'Deputado').single());
  const draft = { name: marker, description: 'Verificação do agendamento real.', election_type_id: type.id };
  for (const [index, [key]] of electoralCalendarDates.entries()) {
    draft[key] = toBrasiliaInput(new Date(Date.now() + [24, 25, 25, 26][index] * 3600000));
  }
  const payload = electoralCalendarPayload(draft);
  const anonymous = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
  for (const client of [anonymous, citizen.client]) {
    const result = await save(client, payload);
    check(result.error?.code === '42501', 'Agendamento exige autoridade eleitoral no servidor');
  }

  const events = [];
  await subscribe(citizen.client.channel(`calendar-${crypto.randomUUID()}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'elections',
  }, event => { events.push(event); }));
  for (const person of [admin, manager]) {
    const election = await request(save(person.client, payload));
    created.add(election.id);
    check(election.status === 'Scheduled' && election.candidacy_end_date === election.voting_start_date,
      `${person === admin ? 'Admin' : 'Gestor eleitoral'} agenda etapas consecutivas sem intervalo obrigatório`);
    await waitFor(() => events.some(event => event.new.id === election.id), 'inserção em outra sessão');
    const edited = await request(save(person.client, { ...payload, name: `${marker} editado` }, election.id));
    check(edited.name === `${marker} editado`, 'Calendário futuro pode ser editado pela RPC');
    await waitFor(() => events.some(event => event.eventType === 'UPDATE' && event.new.id === election.id), 'edição em outra sessão');
    const audit = await request(service.from('economic_audit_log').select('id,actor_profile_id').eq('entity_id', election.id).eq('action', 'electoral_calendar_managed'));
    check(audit.length === 2 && audit.every(row => row.actor_profile_id === person.id), 'Criação e edição preservam auditoria');
  }
  check(events.length >= 4, 'Outra sessão recebe criação e edição sem reload');

  const invalid = [
    [{ name: '    ' }, 'Informe um nome de eleição com pelo menos 5 caracteres.'],
    [{ election_type_id: '' }, 'Selecione o tipo de eleição.'],
    [{ election_type_id: 'invalid' }, 'Selecione um tipo de eleição válido.'],
    [{ election_type_id: crypto.randomUUID() }, 'O tipo de eleição selecionado não está mais disponível. Selecione outro tipo.'],
    [{ candidacy_start_date: new Date(Date.now() - 60000).toISOString() }, 'O início das candidaturas deve estar no futuro, no horário de Brasília.'],
    [{ candidacy_end_date: payload.candidacy_start_date }, 'O fim das candidaturas deve ser posterior ao início das candidaturas.'],
    [{ voting_start_date: payload.candidacy_start_date }, 'A votação deve começar no mesmo horário ou depois do fim das candidaturas.'],
    [{ voting_end_date: payload.voting_start_date }, 'O fim da votação deve ser posterior ao início da votação.'],
    [{ voting_end_date: null }, 'Preencha as quatro datas e horários do calendário eleitoral.'],
    [{ voting_end_date: 'infinity' }, 'Preencha as quatro datas e horários do calendário eleitoral.'],
    [{ voting_end_date: '2026-02-30T12:00:00-03:00' }, 'Informe datas e horários válidos para todas as etapas, no horário de Brasília.'],
    [{ status: 'Finished' }, 'Informe apenas os dados do calendário eleitoral.'],
  ];
  for (const [change, message] of invalid) {
    const result = await save(manager.client, { ...payload, ...change });
    assert.equal(result.error?.code, '22023');
    assert.equal(userErrorMessage(result.error), message);
  }
  check(true, 'Doze entradas inválidas são rejeitadas com motivo específico em português');
  const locked = [...created][0];
  await request(service.from('elections').update({ candidacy_start_date: new Date(Date.now() - 60000).toISOString() }).eq('id', locked));
  check((await save(admin.client, payload, locked)).error?.message.includes('eleição iniciada'), 'Eleição iniciada continua protegida contra edição');
  check((await save(admin.client, payload, crypto.randomUUID())).error?.message.includes('não está mais disponível'), 'Eleição removida informa indisponibilidade');

  output = createWriteStream('/tmp/govrp-electoral-calendar-vite.log');
  dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3117', '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      VITE_SUPABASE_ANON_KEY: local.ANON_KEY, VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SECRET_KEY: local.SECRET_KEY || local.SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
      VITE_HCAPTCHA_SITE_KEY: '', VITE_HCAPTCHA_SITEKEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  dev.stdout.pipe(output); dev.stderr.pipe(output);
  await waitFor(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Vite local', 30000);
  browser = await chromium.launch({ headless: true, executablePath: process.env.GOVRP_CHROMIUM_PATH || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  const errors = [];
  async function login(person) {
    await rpc(person.client, 'claim_daily_check_in').catch(() => undefined);
    const notices = await request(service.from('notifications').select('id').eq('user_id', person.id)
      .in('type', ['role_changed', 'election_candidacy_open', 'election_voting_open']));
    for (const notice of notices) await rpc(person.client, 'acknowledge_role_change', { p_notification_id: notice.id });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.getByLabel('E-mail da conta', { exact: true }).fill(person.email);
    await page.getByLabel('Senha', { exact: true }).fill(person.password);
    await page.getByRole('button', { name: 'Somente essenciais', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL(url => !url.pathname.includes('login'), { timeout: 30000 });
    await page.goto(`${origin}/services/elections`);
    try {
      await page.getByRole('tab', { name: 'Gestão eleitoral', exact: true }).click();
    } catch (error) {
      console.error('Página eleitoral:', page.url(), (await page.locator('body').innerText()).slice(-4500));
      await page.screenshot({ path: '/tmp/govrp-electoral-calendar-error.png' });
      throw error;
    }
    await page.getByRole('heading', { name: 'Gestão do Portal Eleitoral', exact: true }).waitFor();
    return page;
  }
  const page = await login(manager);
  const observer = await login(admin);
  const timeOrigin = await observer.evaluate(() => performance.timeOrigin);
  await page.getByRole('button', { name: 'Agendar eleição', exact: true }).click();
  const modal = page.getByRole('dialog');
  const uiName = `${marker} pela interface`;
  await modal.getByLabel('Nome', { exact: true }).fill(uiName);
  for (const [key, label] of electoralCalendarDates) await modal.getByLabel(label, { exact: true }).fill(draft[key]);
  await modal.getByRole('button', { name: 'Salvar calendário', exact: true }).click();
  await modal.getByRole('alert').filter({ hasText: 'Selecione o tipo de eleição.' }).waitFor();
  check(await modal.getByLabel('Nome', { exact: true }).inputValue() === uiName, 'Tipo obrigatório apresenta orientação sem apagar formulário');
  await modal.getByRole('combobox', { name: 'Tipo de eleição', exact: true }).click();
  await page.getByRole('option', { name: type.name, exact: true }).click();
  await modal.getByLabel('Início das candidaturas', { exact: true }).fill(toBrasiliaInput(new Date(Date.now() - 60000)));
  await modal.getByRole('button', { name: 'Salvar calendário', exact: true }).click();
  await modal.getByRole('alert').filter({ hasText: 'O início das candidaturas deve estar no futuro' }).waitFor();
  check(true, 'Erro real do servidor aparece no modal sem mensagem genérica');
  // Background events must not erase the validation message or draft.
  await request(save(admin.client, { ...payload, description: 'Atualização concorrente.' }, [...created][1]));
  await observer.getByRole('heading', { name: marker, exact: true }).waitFor();
  check(await modal.getByRole('alert').isVisible(), 'Realtime preserva erro e contexto do formulário aberto');
  await modal.getByLabel('Início das candidaturas', { exact: true }).fill(draft.candidacy_start_date);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert(await modal.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  }
  await modal.getByRole('button', { name: 'Salvar calendário', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const saved = await request(service.from('elections').select('*').eq('name', uiName).single());
  created.add(saved.id);
  assert.equal(Date.parse(saved.candidacy_start_date), Date.parse(payload.candidacy_start_date));
  assert.equal(saved.candidacy_end_date, saved.voting_start_date);
  await observer.getByRole('heading', { name: uiName, exact: true }).waitFor();
  assert.equal(await observer.evaluate(() => performance.timeOrigin), timeOrigin);
  check(true, 'Agendamento pela interface persiste horário de Brasília e aparece em outra sessão sem reload');
  assert.deepEqual(errors, []);
  console.log(`\n${checks} verificações eleitorais aprovadas (API, permissões, auditoria, Realtime e navegador).`);
} finally {
  await browser?.close();
  dev?.kill('SIGTERM');
  output?.end();
  const rows = await service.from('elections').select('id').like('name', `${marker}%`);
  for (const row of rows.data || []) created.add(row.id);
  for (const id of created) await request(service.from('elections').delete().eq('id', id));
  await cleanup();
}
