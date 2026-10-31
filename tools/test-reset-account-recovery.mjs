import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { processResetWorker } from "../server/admin/reset-worker.js";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY.");
const e = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(e.API_URL, "http://127.0.0.1:54431");
const adminActor = JSON.parse(readFileSync(`${root}/qa-actors.json`))[0],
  common = JSON.parse(readFileSync(`${root}/qa-new-actor.json`));
const sql = (q) =>
  execFileSync(
    "docker",
    [
      "exec",
      "supabase_db_GOVRP_RESET_QA",
      "psql",
      "-U",
      "postgres",
      "-At",
      "-c",
      q,
    ],
    { encoding: "utf8" },
  ).trim();
const check = async (p) => {
  const r = await p;
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const make = (key, gen, authorization) =>
  createClient(e.API_URL, key, {
    global: {
      headers: {
        ...(gen ? { "x-govrp-world-generation": gen } : {}),
        ...(authorization ? { Authorization: authorization } : {}),
      },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(e.SERVICE_ROLE_KEY),
  runtime = await check(service.rpc("get_world_runtime"));
const admin = make(e.ANON_KEY, runtime.generation_id);
await check(admin.auth.signInWithPassword(adminActor));
const previous = await check(admin.rpc("admin_get_controlled_reset"));
if (previous.status === "validated")
  await check(
    admin.rpc("admin_reopen_reset_world", { p_request_id: previous.id }),
  );
const user = make(e.ANON_KEY, runtime.generation_id),
  signed = await check(user.auth.signInWithPassword(common)),
  oldToken = signed.session.access_token;
sql(
  "SELECT cron.alter_job(jobid,schedule:='10 seconds',active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
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
const plan = await check(
  admin.rpc("admin_prepare_rp_reset", {
    p_scope: "full_rp",
    p_country_snapshots: [baseline],
  }),
);
await check(
  admin.rpc("admin_configure_reset_request", {
    p_request_id: plan.request_id,
    p_mode: "launch",
    p_remove_common_accounts: true,
  }),
);
await check(
  admin.rpc("admin_start_controlled_reset", {
    p_request_id: plan.request_id,
    p_confirmation: "RESETAR GOVRP",
    p_account_confirmation: "EXCLUIR CONTAS COMUNS",
  }),
);
const id = plan.request_id,
  token = sql(
    `SELECT worker_token FROM private.rp_reset_requests WHERE id='${id}'`,
  );
sql(
  "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
);
const original = service.rpc.bind(service);
let injected = false,
  recovered = false;
service.rpc = (name, args, ...rest) => {
  if (
    name === "admin_ack_reset_task" &&
    args.p_kind === "delete_account" &&
    !injected
  ) {
    injected = true;
    return Promise.reject(
      new Error(
        "QA: resposta perdida depois da exclusão Auth e antes do checkpoint",
      ),
    );
  }
  return original(name, args, ...rest);
};
for (let i = 0; i < 200; i++) {
  try {
    const result = await processResetWorker({
      client: service,
      requestId: id,
      token,
      budgetMs: 4500,
    });
    if (result.failed) throw Error("Etapa SQL falhou.");
    if (result.validated) break;
  } catch (error) {
    if (!injected || recovered) throw error;
    assert.equal(
      sql(
        `SELECT deleted_at IS NOT NULL FROM auth.users WHERE id='${common.id}'`,
      ),
      "t",
    );
    assert.equal(
      sql(
        `SELECT count(*) FROM private.rp_reset_targets WHERE request_id='${id}' AND table_name='deleted_account_ack' AND row_id='${common.id}'`,
      ),
      "0",
    );
    assert.equal(
      (
        await check(
          admin.rpc("admin_get_controlled_reset", { p_request_id: id }),
        )
      ).status,
      "failed",
    );
    await check(
      admin.rpc("admin_resume_controlled_reset", { p_request_id: id }),
    );
    sql(
      "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
    );
    recovered = true;
  }
}
assert.equal(injected, true);
assert.equal(recovered, true);
const final = await check(
  admin.rpc("admin_get_controlled_reset", { p_request_id: id }),
);
assert.equal(final.status, "validated");
assert.equal(final.result.valid, true);
assert.equal(
  sql(
    `SELECT deleted_at IS NOT NULL FROM public.profiles WHERE id='${common.id}'`,
  ),
  "t",
);
assert.equal(
  sql(`SELECT count(*) FROM auth.sessions WHERE user_id='${common.id}'`),
  "0",
);
const current = await check(service.rpc("get_world_runtime")),
  freshAdmin = make(e.ANON_KEY, current.generation_id);
await check(freshAdmin.auth.signInWithPassword(adminActor));
await check(freshAdmin.rpc("admin_reopen_reset_world", { p_request_id: id }));
const stale = make(e.ANON_KEY, current.generation_id, `Bearer ${oldToken}`);
const mutation = await stale
  .from("posts")
  .insert({
    user_id: common.id,
    content: "JWT anterior não pode reabrir o acesso",
  });
assert.ok(mutation.error);
assert.match(mutation.error.message, /não possui mais acesso/);
const file = await stale.storage
  .from("avatars")
  .upload(`${common.id}/revoked-token.png`, new Blob(["ficticio"]), {
    metadata: { world_generation: current.generation_id },
  });
assert.ok(file.error);
writeFileSync(
  `${root}/qa-account-recovery-result.json`,
  JSON.stringify({
    requestId: id,
    authDeletedBeforeAck: true,
    recoveredFromCheckpoint: true,
    sessionsRevoked: true,
    oldJwtGameplayBlocked: true,
    oldJwtStorageBlocked: true,
    validation: final.result,
  }),
  { mode: 0o600 },
);
console.log(
  "✓ Resposta perdida após exclusão Auth: retomada confirma a mesma conta, encerra sessões e perfil; JWT anterior não escreve no RP nem no Storage.",
);
