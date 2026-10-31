import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY do stack descartável.");
const env = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(env.API_URL, "http://127.0.0.1:54431");
const actors = JSON.parse(readFileSync(`${root}/qa-actors.json`));
const browser = await chromium.launch({ headless: true });
const errors = [];
async function pageFor(actor) {
  const client = createClient(env.API_URL, env.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword(actor);
  if (error) throw Error(error.message);
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
try {
  const admin = await pageFor(actors[0]),
    common = await pageFor(actors[5]);
  await admin.goto("http://127.0.0.1:3199/admin-dashboard/reset");
  const panel = admin.getByRole("region", { name: "Reset Geral controlado" });
  await panel
    .getByText("Verificado — aguardando reabertura", { exact: true })
    .waitFor();
  const cookie = admin.getByRole("button", {
    name: "Somente essenciais",
    exact: true,
  });
  if (await cookie.isVisible()) await cookie.click();
  await common.goto("http://127.0.0.1:3199/services/bank");
  await common
    .getByText(/O universo está sendo preparado para uma nova geração/)
    .waitFor();
  for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440]) {
    await admin.setViewportSize({ width, height: 1000 });
    assert.ok(
      await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `Painel sem transbordamento: ${width}`,
    );
    assert.ok(
      await panel
        .getByRole("button", { name: "Reabrir mundo verificado", exact: true })
        .isEnabled(),
    );
  }
  const boot = await common.evaluate(() => performance.timeOrigin);
  await admin.screenshot({ path: `${root}/reset-mobile.png`, fullPage: true });
  await panel
    .getByRole("button", { name: "Verificar integridade", exact: true })
    .click();
  await panel.getByText(/Verificação aprovada/).waitFor();
  await panel
    .getByRole("button", { name: "Reabrir mundo verificado", exact: true })
    .click();
  await panel.getByText("Concluído e reaberto", { exact: true }).waitFor();
  await common
    .getByText(/O universo está sendo preparado para uma nova geração/)
    .waitFor({ state: "hidden", timeout: 25000 });
  assert.equal(
    await common.evaluate(() => performance.timeOrigin),
    boot,
    "Reabertura não recarrega a página.",
  );
  assert.equal(
    await common.evaluate(() => localStorage.getItem("theme")),
    "dark",
  );
  assert.ok(
    await common.evaluate(() => localStorage.getItem("sb-127-auth-token")),
    "Login preservado.",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${root}/qa-browser-result.json`,
    JSON.stringify({
      widths: [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440],
      errors,
      reopenedWithoutReload: true,
    }),
    { mode: 0o600 },
  );
  console.log(
    "✓ Admin sem personagem acessa acompanhamento, verifica e reabre; cidadão sai da manutenção sem F5, mantendo Auth e tema; dez larguras sem transbordamento.",
  );
} finally {
  await browser.close();
}
