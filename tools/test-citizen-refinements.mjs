import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chromium } from 'playwright';
import { actor, local, service, request, rpc, waitFor, cleanup } from './lib/world-test.mjs';

const marker = `Refinamento ${crypto.randomUUID().slice(0, 8)}`;
const origin = 'http://127.0.0.1:3140';
const created = [];
const errors = [];
let browser, dev, log, page;
try {
  const admin = await actor('refinement-pagination', 'Admin');
  const type = await request(service.from('election_types').select('id').eq('name', 'Deputado').single());
  const dates = Object.fromEntries(['candidacy_start_date', 'candidacy_end_date', 'voting_start_date', 'voting_end_date'].map((key, i) => [key, new Date(Date.now() + [8, 9, 9, 10][i] * 86400000).toISOString()]));
  const elections = await request(service.from('elections').insert(Array.from({ length: 50 }, (_, i) => ({ name: `${marker} ${String(i).padStart(2, '0')}`, election_type_id: type.id, ...dates }))).select('id'));
  created.push(...elections.map(item => item.id));
  await rpc(admin.client, 'claim_daily_check_in');
  for (let i = 0; i < 100; i++) {
    const notification = await rpc(admin.client, 'get_pending_office_notification');
    if (!notification?.id) break;
    await rpc(admin.client, 'acknowledge_role_change', { p_notification_id: notification.id });
  }
  log = createWriteStream('/tmp/govrp-citizen-refinements-vite.log');
  dev = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3140', '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY,
      VITE_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SECRET_KEY: local.SECRET_KEY || local.SERVICE_ROLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, VITE_HCAPTCHA_SITE_KEY: '', VITE_HCAPTCHA_SITEKEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  dev.stdout.pipe(log); dev.stderr.pipe(log);
  await waitFor(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Vite local', 30000);
  browser = await chromium.launch({ headless: true, executablePath: process.env.GOVRP_CHROMIUM_PATH || '/opt/google/chrome/chrome', args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Tokyo' });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/login`);
  await page.getByLabel('E-mail da conta', { exact: true }).fill(admin.email);
  await page.getByLabel('Senha', { exact: true }).fill(admin.password);
  await page.getByRole('button', { name: 'Somente essenciais', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('login'));
  await page.goto(`${origin}/admin-dashboard/elections`);
  const search = page.getByRole('textbox', { name: 'Buscar eleição', exact: true });
  await search.fill(marker);
  await page.getByRole('status').filter({ hasText: 'Página 1 de 5 · 50 eleições' }).waitFor();
  const boot = await page.evaluate(() => performance.timeOrigin);
  const names = new Set();
  for (let current = 1; current <= 5; current++) {
    await page.getByRole('status').filter({ hasText: `Página ${current} de 5 · 50 eleições` }).waitFor();
    assert.equal(await page.locator('[data-election-card]').count(), 10);
    for (const name of await page.locator('[data-election-card] h3').allTextContents()) names.add(name);
    if (current < 5) await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  }
  assert.equal(names.size, 50);
  assert(await page.getByRole('button', { name: 'Próxima', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Página 4 de 5 · 50 eleições' }).waitFor();
  await page.locator('[data-election-card]').first().getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar Eleição', exact: true });
  const nameInput = dialog.getByLabel('Nome da Eleição', { exact: true });
  const editedName = `${await nameInput.inputValue()} revisada`;
  await nameInput.fill(editedName);
  await request(service.from('elections').update({ description: 'Atualização em outra sessão' }).eq('id', created[0]));
  await page.waitForTimeout(800);
  assert.equal(await nameInput.inputValue(), editedName);
  for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Modal eleitoral: ${width}px`);
  }
  await dialog.getByRole('button', { name: 'Salvar Eleição', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('status').filter({ hasText: 'Página 4 de 5 · 50 eleições' }).waitFor();
  await page.getByText(editedName, { exact: true }).waitFor();
  assert.equal(await search.inputValue(), marker);
  assert.equal(await page.evaluate(() => performance.timeOrigin), boot);
  console.log('✓ 50 eleições paginadas sem duplicação; edição, filtros e rascunho preservados após Realtime.');
  await page.goto(`${origin}/services/national-market`);
  await page.getByRole('heading', { name: 'Mercado Nacional', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Gerenciar', exact: true }).count(), 0);
  console.log('✓ Serviço estatal público não expõe gestão institucional.');
  assert.deepEqual(errors, []);
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(-3000));
    await page.screenshot({ path: '/tmp/govrp-citizen-refinements-error.png' });
  }
  throw error;
} finally {
  await browser?.close(); dev?.kill('SIGTERM'); log?.end();
  if (created.length) await request(service.from('elections').delete().in('id', created));
  await cleanup();
}
