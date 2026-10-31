import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { processResetWorker } from "../server/admin/reset-worker.js";
import { withStorageGeneration } from "../src/lib/worldStorage.js";

const root = process.env.RESET_QA_DIRECTORY;
assert.ok(root, "Informe o ambiente descartável RESET_QA_DIRECTORY.");
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
    { input: query, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  ).trim();
const checked = async (request) => {
  const result = await request;
  if (result.error) throw Error(result.error.message);
  return result.data;
};
let generation;
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  global: {
    fetch: (input, options = {}) => {
      if (
        String(input).includes("/storage/v1/object/") &&
        ["POST", "PUT"].includes(options.method)
      )
        return fetch(
          input,
          withStorageGeneration(
            options,
            new Headers(options.headers),
            generation,
          ),
        );
      return fetch(input, options);
    },
  },
  auth: { persistSession: false },
});
const admin = createClient(env.API_URL, env.ANON_KEY, {
  auth: { persistSession: false },
});
const common = createClient(env.API_URL, env.ANON_KEY, {
  auth: { persistSession: false },
});
await checked(admin.auth.signInWithPassword(actors[0]));
const commonAccount = {
  email: `reset-options-${crypto.randomUUID()}@example.invalid`,
  password: `Govrp!${crypto.randomUUID()}Aa1`,
  email_confirm: true,
};
await checked(service.auth.admin.createUser(commonAccount));
await checked(common.auth.signInWithPassword(commonAccount));
assert.ok(
  (await common.rpc("admin_get_controlled_reset")).error,
  "Cidadão não pode consultar o reset.",
);
const baseline = {
  country_code: "BR",
  country_name: "Brasil",
  fetched_at: new Date().toISOString(),
  economy: {
    gdp: 2e12,
    growth: 2,
    inflation: 4,
    unemployment: 6,
    exchangeUsd: 5,
    exchangeEur: 6,
    gdpCurrency: "USD",
    referenceSources: ["QA fictício"],
    selic: 15,
  },
  demographics: { population: 2e8, area: 8e6 },
  politics: {},
  exchange_rates: { USD: 5, EUR: 6, GBP: 7, JPY: 0.04, CNY: 0.7 },
};
const results = [];
for (const choice of process.argv.includes("--resume-only")
  ? ["dispense_on_resume"]
  : [false, true, "dispense_on_resume"]) {
  let backup = choice !== false;
  const runtime = await checked(service.rpc("get_world_runtime"));
  assert.equal(runtime.maintenance, false);
  generation = runtime.generation_id;
  // Use a real RP file, plus a protected support attachment.
  for (const id of ["post-images", "support-attachments"])
    if (
      !(await checked(service.storage.listBuckets())).some((b) => b.id === id)
    )
      await checked(
        service.storage.createBucket(id, {
          public: id !== "support-attachments",
        }),
      );
  const name = `opcoes-${crypto.randomUUID()}.png`;
  await checked(
    service.storage
      .from("post-images")
      .upload(name, Buffer.from("arquivo RP fictício")),
  );
  await checked(
    service.storage
      .from("support-attachments")
      .upload(name, Buffer.from("atendimento protegido fictício")),
  );
  const preview = await checked(
    admin.rpc("admin_prepare_rp_reset", {
      p_scope: "full_rp",
      p_country_snapshots: [
        { ...baseline, fetched_at: new Date().toISOString() },
      ],
    }),
  );
  await checked(
    admin.rpc("admin_configure_reset_request", {
      p_request_id: preview.request_id,
      p_mode: "universe",
      p_create_backup: backup,
    }),
  );
  await checked(
    admin.rpc("admin_start_controlled_reset", {
      p_request_id: preview.request_id,
      p_confirmation: "RESETAR GOVRP",
    }),
  );
  const id = preview.request_id;
  sql(
    "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
  );
  const token = sql(
    `SELECT worker_token FROM private.rp_reset_requests WHERE id='${id}'`,
  );
  const started = Date.now();
  const lock = spawn(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_GOVRP_RESET_QA",
      "psql",
      "-U",
      "postgres",
      "-At",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const lockClosed = new Promise((resolve, reject) => {
    lock.on("close", resolve);
    lock.on("error", reject);
  });
  lock.stdin.end(
    `BEGIN;SELECT id FROM private.rp_reset_requests WHERE id='${id}' FOR UPDATE;SELECT 'locked';SELECT pg_sleep(2);ROLLBACK;`,
  );
  await new Promise((resolve, reject) => {
    let output = "";
    lock.stdout.on("data", (data) => {
      output += data;
      if (output.includes("locked")) resolve();
    });
    lock.on("error", reject);
  });
  const claimStart = Date.now();
  assert.equal(
    (
      await checked(
        service.rpc("admin_claim_reset_worker", {
          p_request_id: id,
          p_token: token,
        }),
      )
    ).busy,
    true,
  );
  assert.ok(
    Date.now() - claimStart < 1000,
    "Disputa no controle retorna imediatamente, sem esperar timeout.",
  );
  const progress = await checked(admin.rpc("admin_get_controlled_reset"));
  assert.equal(progress.create_backup, backup);
  assert.ok(progress.steps.length <= 40);
  assert.ok(progress.progress.total > progress.steps.length);
  assert.ok(!("preview" in progress) && !("worker_token" in progress));
  assert.ok(
    JSON.stringify(progress).length < 24000,
    "Acompanhamento tem resposta limitada.",
  );
  const premature = await checked(
    admin.rpc("admin_validate_controlled_reset", { p_request_id: id }),
  );
  assert.equal(
    premature.valid,
    false,
    "Validação antecipada não varre todo o mundo antigo.",
  );
  await lockClosed;
  if (choice === "dispense_on_resume") {
    const lease = await checked(
      service.rpc("admin_claim_reset_worker", {
        p_request_id: id,
        p_token: token,
      }),
    );
    const params = { p_request_id: id, p_token: token, p_lease: lease.lease };
    await checked(service.rpc("admin_process_reset_batch", params));
    const packet = await checked(
      service.rpc("admin_process_reset_batch", params),
    );
    assert.equal(packet.task.kind, "backup_chunk");
    await checked(
      service.rpc("admin_finish_reset_worker", {
        ...params,
        p_error:
          "Interrupção fictícia antes da limpeza para testar mudança de opção.",
      }),
    );
    await checked(admin.rpc("admin_skip_reset_backup", { p_request_id: id }));
    await checked(
      admin.rpc("admin_resume_controlled_reset", { p_request_id: id }),
    );
    assert.equal(
      (
        await checked(
          admin.rpc("admin_get_controlled_reset", { p_request_id: id }),
        )
      ).last_error,
      null,
      "Retomada limpa o erro atual e mantém o histórico de eventos.",
    );
    sql(
      "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
    );
    backup = false;
  }
  let status;
  for (let i = 0; i < 600; i++) {
    await processResetWorker({
      client: service,
      requestId: id,
      token,
      budgetMs: 3500,
    });
    status = await checked(
      admin.rpc("admin_get_controlled_reset", { p_request_id: id }),
    );
    if (status.status === "failed")
      throw Error(JSON.stringify(status.last_error));
    if (status.status === "validated") break;
  }
  assert.equal(status.status, "validated");
  assert.equal(status.last_error, null);
  assert.equal(status.progress.completed, status.progress.total);
  assert.equal(status.backup.state, backup ? "verified" : "skipped");
  assert.equal(
    sql(
      `SELECT count(*) FROM storage.objects WHERE bucket_id='post-images' AND name='${name}'`,
    ),
    "0",
  );
  assert.equal(
    sql(
      `SELECT count(*) FROM storage.objects WHERE bucket_id='support-attachments' AND name='${name}'`,
    ),
    "1",
  );
  if (choice === false) {
    assert.equal(
      sql(
        `SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id='${id}' AND object_name IS NOT NULL`,
      ),
      "0",
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM private.rp_reset_backup_chunks c CROSS JOIN LATERAL jsonb_array_elements(c.payload) row_data CROSS JOIN LATERAL jsonb_object_keys(row_data) k(key) WHERE c.request_id='${id}' AND key IN('email','encrypted_password','full_name','document_number','content','amount')`,
      ),
      "0",
      "Sem backup não são copiados conteúdos nem dados pessoais das linhas protegidas.",
    );
  }
  const validation = await checked(
    admin.rpc("admin_validate_controlled_reset", { p_request_id: id }),
  );
  assert.equal(validation.valid, true);
  assert.equal(validation.preserved_admins, 5);
  assert.deepEqual(validation.orphans, []);
  assert.ok(
    (await admin.rpc("admin_skip_reset_backup", { p_request_id: id })).error,
    "A opção de backup não pode mudar após a limpeza.",
  );
  await checked(admin.rpc("admin_reopen_reset_world", { p_request_id: id }));
  for (const actor of actors.slice(0, 5)) {
    const c = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
    });
    await checked(c.auth.signInWithPassword(actor));
  }
  results.push({
    choice,
    backup,
    elapsedMs: Date.now() - started,
    steps: status.progress.total,
    preservedAdmins: validation.preserved_admins,
    orphans: 0,
    protectedFileRetained: true,
    progressResponsiveDuringLock: true,
  });
  console.log(
    `✓ Reset ${backup ? "com" : "sem"} backup: validado, arquivos corretos, cinco logins Admin preservados e progresso limitado.`,
  );
}
writeFileSync(`${root}/qa-reset-options-result.json`, JSON.stringify(results), {
  mode: 0o600,
});
