import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { processResetWorker } from "../server/admin/reset-worker.js";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY.");
const env = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(env.API_URL, "http://127.0.0.1:54431");
const container = "supabase_db_GOVRP_RESET_QA";
const sql = (q) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: q, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  ).trim();
const a = JSON.parse(readFileSync(`${root}/qa-actors.json`));
const check = async (p) => {
  const r = await p;
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const initial = createClient(env.API_URL, env.ANON_KEY, {
    auth: { persistSession: false },
  }),
  runtime = await check(initial.rpc("get_world_runtime"));
assert.equal(runtime.maintenance, false);
const make = (key) =>
  createClient(env.API_URL, key, {
    global: { headers: { "x-govrp-world-generation": runtime.generation_id } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(env.SERVICE_ROLE_KEY),
  admin = make(env.ANON_KEY);
await check(admin.auth.signInWithPassword(a[0]));
const rpc = (c, n, p = {}) => check(c.rpc(n, p));
sql(
  "CREATE TABLE public.future_reset_module(id uuid PRIMARY KEY DEFAULT gen_random_uuid());",
);
assert.equal((await rpc(admin, "admin_analyze_rp_reset")).blocked, true);
sql("DROP TABLE public.future_reset_module;");
await check(
  service.storage.createBucket("future-unknown-bucket", { public: false }),
);
assert.equal((await rpc(admin, "admin_analyze_rp_reset")).blocked, true);
await check(service.storage.deleteBucket("future-unknown-bucket"));
assert.equal((await rpc(admin, "admin_analyze_rp_reset")).blocked, false);
assert.ok(
  (await service.auth.admin.deleteUser(a[0].id, true)).error,
  "Admin não pode ser removido nem com API de serviço.",
);
console.log(
  "✓ Tabela/bucket desconhecidos bloqueiam reset; Auth de Admin recusa exclusão.",
);
if (Number(sql("SELECT count(*) FROM public.stock_price_history")) < 130000)
  sql(`BEGIN;SET LOCAL session_replication_role=replica;
  INSERT INTO public.donations(donor_id,amount,payment_method,gateway,idempotency_key,status) VALUES('${a[5].id}',10,'pix','abacatepay',gen_random_uuid(),'paid');
  INSERT INTO public.support_tickets(requester_id,requester_name,requester_email,subject) VALUES('${a[5].id}','Pessoa Fictícia','ficticio@example.invalid','Atendimento protegido de QA');
  INSERT INTO public.stock_price_history(investment_id,price,reason) SELECT (SELECT id FROM public.investment_options LIMIT 1),100,'Histórico fictício de carga' FROM generate_series(1,130000);
  INSERT INTO public.posts(user_id,content) SELECT '${a[5].id}','Carga fictícia '||g FROM generate_series(1,50000)g;
  INSERT INTO public.notifications(user_id,content,type) SELECT '${a[5].id}','Aviso fictício de carga','info' FROM generate_series(1,100000);
  INSERT INTO public.police_occurrences(id,type,title,details) VALUES('61000000-0000-0000-0000-000000000001','denuncia','Fato fictício','Ocorrência do universo descartável');
  INSERT INTO public.criminal_investigations(id,occurrence_id,investigation_number,summary,created_by) VALUES('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','QA-APURACAO','Apuração fictícia','${a[0].id}');
  INSERT INTO public.investigation_subjects(investigation_id,profile_id) VALUES('62000000-0000-0000-0000-000000000001','${a[6].id}');
  INSERT INTO public.parliament_members(user_id,house_id,term_start_date,term_end_date) VALUES('${a[2].id}',(SELECT id FROM public.parliament_houses LIMIT 1),'2026-01-01','2027-01-01');
  SET LOCAL session_replication_role=origin;COMMIT;
  SELECT cron.schedule('govrp-qa-world-active','0 0 1 1 *','select 1;');
  SELECT cron.schedule('govrp-qa-world-inactive','0 0 1 1 *','select 1;');
  SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-qa-world-inactive';
  ANALYZE public.stock_price_history;ANALYZE public.posts;ANALYZE public.notifications;`);
// Official definitions must be rebuilt, while offers created by a government
// inside the old universe must disappear too.
sql(`BEGIN;SET LOCAL session_replication_role=replica;
 DELETE FROM public.products WHERE id=md5('govrp:catalog:mansion:DF')::uuid;
 UPDATE public.products SET price=999,stock=0,moderation_status='removed',archived_at=clock_timestamp(),product_type='subscription',subscription_interval='weekly',subscription_price=999 WHERE id='f2100000-0000-4000-8000-000000000002';
 INSERT INTO public.products(id,state_enterprise_id,name,price,stock) SELECT '63000000-0000-0000-0000-000000000001',id,'Oferta criada pelo governo anterior',27,8 FROM public.state_enterprises WHERE service_key='national_market' ON CONFLICT(id) DO NOTHING;
 UPDATE public.penal_code SET legal_history=jsonb_build_array(jsonb_build_object('minimum',minimum_sentence_units,'maximum',maximum_sentence_units,'fine',base_fine,'active',is_active)),maximum_sentence_units=maximum_sentence_units+1 WHERE legal_history='[]';
 SET LOCAL session_replication_role=origin;COMMIT;
 SELECT cron.schedule('govrp-qa-world-active','0 0 1 1 *','select 1;');
 SELECT cron.schedule('govrp-qa-world-inactive','0 0 1 1 *','select 1;');
 SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='govrp-qa-world-active';
 SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-qa-world-inactive';`);
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
const started = Date.now(),
  preview = await rpc(admin, "admin_prepare_rp_reset", {
    p_scope: "full_rp",
    p_country_snapshots: [baseline],
  });
assert.ok(
  Date.now() - started < 8000,
  "Prévia com centenas de milhares de registros respeita 8 segundos.",
);
await rpc(admin, "admin_configure_reset_request", {
  p_request_id: preview.request_id,
  p_mode: "launch",
  p_remove_common_accounts: true,
});
assert.ok(
  (
    await admin.rpc("admin_start_controlled_reset", {
      p_request_id: preview.request_id,
      p_confirmation: "RESETAR GOVRP",
    })
  ).error,
  "Remoção de contas exige frase separada.",
);
await rpc(admin, "admin_start_controlled_reset", {
  p_request_id: preview.request_id,
  p_confirmation: "RESETAR GOVRP",
  p_account_confirmation: "EXCLUIR CONTAS COMUNS",
});
const id = preview.request_id,
  token = sql(
    `SELECT worker_token FROM private.rp_reset_requests WHERE id='${id}'`,
  );
sql(
  "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';",
);
assert.equal(
  sql(
    "SELECT count(*) FROM cron.job WHERE jobname LIKE 'govrp-qa-world-%' AND active",
  ),
  "0",
);
const second = await rpc(admin, "admin_prepare_rp_reset", {
  p_scope: "full_rp",
  p_country_snapshots: [baseline],
});
assert.ok(
  (
    await admin.rpc("admin_start_controlled_reset", {
      p_request_id: second.request_id,
      p_confirmation: "RESETAR GOVRP",
    })
  ).error,
);
const first = await rpc(service, "admin_claim_reset_worker", {
  p_request_id: id,
  p_token: token,
});
assert.equal(
  (
    await rpc(service, "admin_claim_reset_worker", {
      p_request_id: id,
      p_token: token,
    })
  ).busy,
  true,
);
const params = { p_request_id: id, p_token: token, p_lease: first.lease };
await rpc(service, "admin_process_reset_batch", params);
const packet = await rpc(service, "admin_process_reset_batch", params),
  repeat = await rpc(service, "admin_process_reset_batch", params);
assert.equal(
  packet.task.id,
  repeat.task.id,
  "Entrega duplicada reutiliza bloco, sem duplicar backup.",
);
sql(
  `UPDATE private.rp_reset_requests SET lease_until=clock_timestamp()-interval '1 second' WHERE id='${id}';`,
);
const recovered = await rpc(service, "admin_claim_reset_worker", {
  p_request_id: id,
  p_token: token,
});
assert.notEqual(recovered.lease, first.lease);
await rpc(service, "admin_finish_reset_worker", {
  p_request_id: id,
  p_token: token,
  p_lease: recovered.lease,
  p_error: "Falha de conexão simulada em QA",
});
assert.equal(
  (await rpc(admin, "admin_get_controlled_reset", { p_request_id: id })).status,
  "failed",
);
assert.equal((await rpc(admin, "get_world_runtime")).maintenance, true);
await rpc(admin, "admin_resume_controlled_reset", { p_request_id: id });
sql(
  "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';",
);
console.log(
  "✓ Confirmação dupla, reset concorrente recusado, lease expirado recuperado, entrega duplicada e falha de rede com retomada.",
);
let injected = false;
const runStart = Date.now();
for (let i = 0; i < 3000; i++) {
  const current = JSON.parse(
    sql(
      `SELECT json_build_object('phase',phase,'schema',schema_name,'table',table_name) FROM private.rp_reset_steps WHERE request_id='${id}' AND status<>'completed' ORDER BY ordinal LIMIT 1`,
    ),
  );
  if (!injected && current.phase === "clearing") {
    const lock = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const ready = new Promise((resolve, reject) => {
      lock.stdout.on("data", (data) => {
        if (data.toString().includes("LOCK_READY")) resolve();
      });
      lock.on("error", reject);
    });
    lock.stdin.write(
      `BEGIN;LOCK TABLE "${current.schema}"."${current.table}" IN SHARE MODE;\n\\echo LOCK_READY\n`,
    );
    await ready;
    const lease = await rpc(service, "admin_claim_reset_worker", {
      p_request_id: id,
      p_token: token,
    });
    const failure = await rpc(service, "admin_process_reset_batch", {
      p_request_id: id,
      p_token: token,
      p_lease: lease.lease,
    });
    lock.stdin.end("ROLLBACK;\n");
    assert.equal(failure.failed, true);
    assert.equal(
      sql(
        `SELECT last_error->>'sqlstate' FROM private.rp_reset_requests WHERE id='${id}'`,
      ),
      "55P03",
    );
    assert.equal((await rpc(admin, "get_world_runtime")).maintenance, true);
    await rpc(admin, "admin_resume_controlled_reset", { p_request_id: id });
    sql(
      "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';",
    );
    injected = true;
    console.log(
      "✓ Lock real interrompe somente o lote, registra causa e mantém manutenção; retomada aprovada.",
    );
  }
  const result = await processResetWorker({
    client: service,
    requestId: id,
    token,
    budgetMs: current.phase === "backing_up" ? 1000 : 50,
  });
  if (result.failed)
    throw Error(
      sql(
        `SELECT last_error->>'message' FROM private.rp_reset_requests WHERE id='${id}'`,
      ),
    );
  if (i % 15 === 0) console.log(`Lotes de carga: ${i}, ${current.phase}`);
  if (result.validated) break;
  assert.ok(Date.now() - runStart < 20 * 60 * 1000);
}
assert.ok(injected, "Teste precisa alcançar e interromper um lote de limpeza.");
const final = await rpc(admin, "admin_get_controlled_reset", {
  p_request_id: id,
});
assert.equal(final.status, "validated");
assert.equal(final.result.valid, true);
for (const actor of a.slice(0, 5)) {
  const c = make(env.ANON_KEY);
  await check(c.auth.signInWithPassword(actor));
  assert.equal(await rpc(c, "is_admin", { p_user_id: actor.id }), true);
}
for (const actor of a.slice(5)) {
  const c = make(env.ANON_KEY);
  assert.ok(
    (await c.auth.signInWithPassword(actor)).error,
    "Conta comum de lançamento não conserva acesso.",
  );
}
assert.equal(sql("SELECT count(*) FROM public.donations"), "1");
assert.equal(
  sql(
    "SELECT count(*) FROM public.support_tickets WHERE subject='Atendimento protegido de QA'",
  ),
  "1",
);
assert.equal(sql("SELECT count(*) FROM public.stock_price_history"), "0");
assert.equal(sql("SELECT count(*) FROM public.police_occurrences"), "0");
assert.equal(sql("SELECT count(*) FROM public.criminal_investigations"), "0");
assert.equal(sql("SELECT count(*) FROM public.parliament_members"), "0");
assert.equal(
  sql(
    "SELECT count(*) FROM public.products WHERE id='63000000-0000-0000-0000-000000000001'",
  ),
  "0",
);
assert.equal(
  sql(
    "SELECT count(*) FROM public.products WHERE id=md5('govrp:catalog:mansion:DF')::uuid AND stock=5",
  ),
  "1",
);
assert.equal(
  sql(
    "SELECT count(*) FROM public.products WHERE id='f2100000-0000-4000-8000-000000000002' AND price=18 AND stock=1000000 AND product_type='one-time' AND archived_at IS NULL",
  ),
  "1",
);
assert.equal(
  sql("SELECT count(*) FROM public.penal_code WHERE legal_history<>'[]'"),
  "0",
);
console.log(
  "✓ Catálogo oficial recriado, alterações de preço/assinatura revertidas, oferta do governo anterior removida e histórico penal reiniciado.",
);
writeFileSync(
  `${root}/qa-failures-result.json`,
  JSON.stringify({
    requestId: id,
    elapsedMs: Date.now() - runStart,
    validation: final.result,
    records: 280000,
    failureRecovery: true,
    launchAccountsRemoved: 3,
    adminLoginsPreserved: 5,
  }),
  { mode: 0o600 },
);
console.log(
  "✓ Carga de 280 mil registros limpa; cinco logins Admin preservados, três acessos comuns removidos e registros reais de doação/suporte preservados.",
);
