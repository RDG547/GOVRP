import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const root = process.env.RESET_QA_DIRECTORY;
assert.ok(root);
const env = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(env.API_URL, "http://127.0.0.1:54431");
const actors = JSON.parse(readFileSync(`${root}/qa-actors.json`));
const sql = (query) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_GOVRP_RESET_QA",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8" },
  ).trim();
assert.equal(sql("SELECT maintenance FROM private.rp_reset_runtime"), "f");
const common = {
  email: `reset-browser-${crypto.randomUUID()}@example.invalid`,
  password: `Govrp!${crypto.randomUUID()}Aa1`,
  email_confirm: true,
};
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const created = await service.auth.admin.createUser(common);
if (created.error) throw created.error;
const browser = await chromium.launch({ headless: true });
const errors = [];
async function pageFor(actor) {
  const client = createClient(env.API_URL, env.ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword(actor);
  if (error) throw error;
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ session }) => {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
      localStorage.setItem("theme", "dark");
    },
    { session: data.session },
  );
  return page;
}
let maintenance = false;
try {
  const admin = await pageFor(actors[0]);
  await admin.goto("http://127.0.0.1:3199/admin-dashboard/reset");
  const panel = admin.getByRole("region", { name: "Reset Geral controlado" });
  await panel.getByText("Concluído e reaberto", { exact: true }).waitFor();
  const cookies = admin.getByRole("button", {
    name: "Somente essenciais",
    exact: true,
  });
  if (await cookies.isVisible()) await cookies.click();
  await panel
    .getByRole("button", { name: "Analisar Reset", exact: true })
    .click();
  await panel
    .getByRole("group", { name: "Deseja fazer backup antes do reset?" })
    .waitFor();
  await panel.getByLabel("Não, executar sem backup", { exact: true }).check();
  await panel
    .getByText(/Os dados removidos não terão cópia de recuperação/)
    .waitFor();
  assert.equal(
    await panel.getByRole("button", { name: /Exportar/ }).count(),
    0,
  );
  assert.equal(
    await admin.getByRole("heading", { name: "Central de Reset" }).count(),
    1,
  );
  assert.equal(
    await admin
      .getByText("Resets de cidadãos — selecionados ou todos", { exact: true })
      .count(),
    1,
  );
  const widths = [320, 360, 375, 390, 412, 430, 768, 1024, 1440];
  for (const width of widths) {
    await admin.setViewportSize({ width, height: 1000 });
    assert.ok(
      await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Sem transbordamento em ${width}px.`,
    );
  }
  await admin.screenshot({
    path: `${root}/reset-options-desktop.png`,
    fullPage: true,
  });
  await admin.setViewportSize({ width: 360, height: 900 });
  await admin.screenshot({
    path: `${root}/reset-options-mobile.png`,
    fullPage: true,
  });
  // A real failed HTTP poll must retain the last state and recover on the next poll.
  await admin.route(
    "**/rest/v1/rpc/admin_get_controlled_reset",
    (route) =>
      route.fulfill({
        status: 503,
        body: JSON.stringify({ message: "Falha de conexão fictícia" }),
        contentType: "application/json",
      }),
    { times: 1 },
  );
  await panel
    .getByRole("button", { name: "Consultar progresso", exact: true })
    .click();
  await panel
    .getByText(/Não foi possível atualizar o progresso agora/)
    .waitFor();
  await panel
    .getByRole("button", { name: "Consultar progresso", exact: true })
    .click();
  await panel
    .getByText(/Não foi possível atualizar o progresso agora/)
    .waitFor({ state: "hidden" });
  await panel.getByText("Concluído e reaberto", { exact: true }).waitFor();
  // Only the disposable stack enters maintenance; no production call is made.
  sql(
    "BEGIN;SELECT set_config('govrp.reset_worker',(SELECT id::text FROM private.rp_reset_requests WHERE status='completed' ORDER BY created_at DESC LIMIT 1),true);UPDATE private.rp_reset_runtime SET maintenance=true,request_id=(SELECT id FROM private.rp_reset_requests WHERE status='completed' ORDER BY created_at DESC LIMIT 1),changed_at=clock_timestamp() WHERE id;COMMIT",
  );
  maintenance = true;
  await admin.goto("http://127.0.0.1:3199/settings");
  await admin
    .getByRole("heading", { name: /Configurações/, exact: false })
    .first()
    .waitFor();
  assert.equal(
    await admin
      .getByText(/O universo está sendo preparado para uma nova geração/)
      .count(),
    0,
    "Admin navega fora do painel durante manutenção.",
  );
  const citizen = await pageFor(common);
  await citizen.goto("http://127.0.0.1:3199/services/bank");
  await citizen
    .getByText(/O universo está sendo preparado para uma nova geração/)
    .waitFor();
  assert.deepEqual(errors, []);
  writeFileSync(
    `${root}/qa-reset-options-interface-result.json`,
    JSON.stringify({
      widths,
      backupChoice: true,
      noExports: true,
      unifiedSection: true,
      failedPollRecovered: true,
      adminSettingsDuringMaintenance: true,
      citizenMaintenance: true,
      errors,
    }),
    { mode: 0o600 },
  );
  console.log(
    "✓ Navegador: backup opcional, seção única, exportação removida, progresso recupera falha HTTP, Admin livre da página de manutenção e cidadão protegido; nove larguras.",
  );
} finally {
  if (maintenance)
    sql(
      "UPDATE private.rp_reset_runtime SET maintenance=false,request_id=NULL,changed_at=clock_timestamp() WHERE id",
    );
  await browser.close();
}
