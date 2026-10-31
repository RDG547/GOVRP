import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { processResetWorker } from "../server/admin/reset-worker.js";

// Deliberately isolated from the ordinary development stack and from production.
const root = process.env.RESET_QA_DIRECTORY;
if (!root)
  throw new Error(
    "Informe RESET_QA_DIRECTORY do stack descartável GOVRP_RESET_QA.",
  );
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
    { input: q, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ).trim();
const json = (q) => JSON.parse(sql(q));
const checked = async (p) => {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const client = (key = env.ANON_KEY, headers = {}) =>
  createClient(env.API_URL, key, {
    global: { headers },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = client(env.SERVICE_ROLE_KEY);
let actors = [];
if (existsSync(`${root}/qa-actors.json`))
  actors = JSON.parse(readFileSync(`${root}/qa-actors.json`));
else {
  for (let i = 0; i < 8; i++) {
    const email = `reset-ficticio-${i}-${crypto.randomUUID()}@example.invalid`,
      password = `Govrp!${crypto.randomUUID()}Aa1`;
    const { user } = await checked(
      service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { real_full_name: `Pessoa Fictícia ${i}` },
      }),
    );
    actors.push({ id: user.id, email, password });
  }
  writeFileSync(`${root}/qa-actors.json`, JSON.stringify(actors), {
    mode: 0o600,
  });
}
if (sql("SELECT count(*) FROM private.platform_admins") === "0") {
  sql(`BEGIN;SET LOCAL session_replication_role=replica;
    INSERT INTO private.platform_admins(user_id) SELECT id FROM auth.users WHERE id=ANY(ARRAY[${actors
      .slice(0, 5)
      .map((a) => `'${a.id}'::uuid`)
      .join(",")}]);
    UPDATE public.profiles SET onboarding_completed=true,onboarding_step='completed',full_name='Cidadão Fictício',role='Cidadão',reputation_points=800,political_points=1000;
    ${actors
      .slice(0, 5)
      .map(
        (a, i) =>
          `UPDATE public.profiles SET role='${["Admin", "Presidente", "Deputado", "Juiz", "Vice-Presidente"][i]}' WHERE id='${a.id}';`,
      )
      .join("\n")}
    INSERT INTO public.accounts(user_id,account_number,agency_number,balance) SELECT id,'QA'||row_number() OVER(),'0001',999999 FROM public.profiles;
    INSERT INTO public.posts(user_id,content) SELECT '${actors[5].id}','Publicação fictícia '||g FROM generate_series(1,10000)g;
    INSERT INTO public.notifications(user_id,content,type) SELECT '${actors[5].id}','Histórico descartável','info' FROM generate_series(1,50000);
    INSERT INTO public.transactions(from_account_id,to_account_id,amount,type) SELECT a.id,b.id,10,'transfer' FROM public.accounts a CROSS JOIN public.accounts b CROSS JOIN generate_series(1,150)g WHERE a.user_id='${actors[5].id}' AND b.user_id='${actors[6].id}';
    INSERT INTO public.businesses(id,owner_id,business_type_id,name,region_code) VALUES('50000000-0000-0000-0000-000000000002','${actors[5].id}','padaria','Empresa Fictícia','SP');
    INSERT INTO private.business_daily_effort(business_id,effort_date,boost) VALUES('50000000-0000-0000-0000-000000000002',current_date,.1);
    INSERT INTO public.products(seller_id,business_id,name,price,stock,product_type) VALUES('${actors[5].id}','50000000-0000-0000-0000-000000000002','Produto fictício',10,5,'one-time');
    INSERT INTO public.user_services(id,user_id,service_type,plan_name,price) VALUES('29000000-0000-0000-0000-000000000002','${actors[5].id}','Internet','Fictício',100);
    INSERT INTO private.recurring_billing_cycles(kind,subscription_id,user_id,due_at,amount) VALUES('service','29000000-0000-0000-0000-000000000002','${actors[5].id}',now(),100);
    INSERT INTO public.documents(user_id,type,document_number,full_name,is_valid) VALUES('${actors[5].id}','CPF','12345678901','Cidadão Fictício',true);
    INSERT INTO public.criminal_records(user_id,crime,is_active) VALUES('${actors[5].id}','Crime fictício',true);
    INSERT INTO public.political_parties(id,name,acronym,ideology,founder_id,owner_id,registration_number) VALUES('40000000-0000-0000-0000-000000000002','Partido fictício','PQA','Centro','${actors[5].id}','${actors[5].id}','RP-QA001');
    INSERT INTO public.party_members(party_id,user_id) VALUES('40000000-0000-0000-0000-000000000002','${actors[6].id}');
    INSERT INTO public.security_audit_log(action,target_table,target_id) VALUES('reset_qa_preserve','profiles','ficticio');
    UPDATE private.rp_reset_runtime SET worker_endpoint='http://127.0.0.1:1/disabled-qa';
    SET LOCAL session_replication_role=origin;COMMIT;ANALYZE;`);
}
const admin = client(),
  common = client();
await checked(admin.auth.signInWithPassword(actors[0]));
await checked(common.auth.signInWithPassword(actors[5]));
const rpc = (c, name, args = {}) => checked(c.rpc(name, args));
assert.ok(
  (await common.rpc("admin_analyze_rp_reset")).error,
  "Cidadão não pode analisar/resetar",
);
assert.ok(
  (
    await common.rpc("admin_claim_reset_worker", {
      p_request_id: crypto.randomUUID(),
      p_token: "a".repeat(64),
    })
  ).error,
  "Worker privado não pode ser chamado por cidadão",
);
const t = performance.now(),
  audit = await rpc(admin, "admin_analyze_rp_reset");
assert.equal(audit.blocked, false);
assert.equal(audit.admins.length, 5);
assert.ok(performance.now() - t < 8000);
console.log(
  `✓ Diagnóstico sem enumerar históricos: ${audit.table_count} tabelas; ${(performance.now() - t).toFixed(0)} ms.`,
);
const baseline = {
  country_code: "BR",
  country_name: "Brasil",
  fetched_at: new Date().toISOString(),
  economy: {
    gdp: 2000000000000,
    growth: 2,
    inflation: 4,
    unemployment: 6,
    exchangeUsd: 5,
    exchangeEur: 6,
    gdpCurrency: "USD",
    currency: "BRL",
    referenceSources: ["Referência fictícia de QA"],
    selic: 15,
  },
  demographics: { population: 200000000, area: 8000000 },
  politics: { leader: "Referência de QA" },
  exchange_rates: { USD: 5, EUR: 6, GBP: 7, JPY: 0.04, CNY: 0.7 },
};
let job = await rpc(admin, "admin_get_controlled_reset");
if (
  !job?.started_at ||
  ["cancelled", "completed", "expired"].includes(job.status)
) {
  const preview = await rpc(admin, "admin_prepare_rp_reset", {
    p_scope: "full_rp",
    p_country_snapshots: [baseline],
    p_reason: "Ensaio descartável de reset controlado",
  });
  assert.ok(preview.records_are_estimates);
  const start = await rpc(admin, "admin_start_controlled_reset", {
    p_request_id: preview.request_id,
    p_confirmation: "RESETAR GOVRP",
  });
  assert.equal(start.accepted, true);
  assert.equal(start.success, false);
  job = await rpc(admin, "admin_get_controlled_reset");
}
sql(
  "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';",
);
const requestId = job.id,
  token = sql(
    `SELECT worker_token FROM private.rp_reset_requests WHERE id='${requestId}'`,
  );
assert.equal((await rpc(common, "get_world_runtime")).maintenance, true);
assert.ok(
  (
    await common.from("posts").insert({
      user_id: actors[5].id,
      content: "Não pode entrar no mundo em manutenção",
    })
  ).error,
);
console.log(
  "✓ Manutenção bloqueia escrita direta e início é distinto de conclusão.",
);
if (job.status === "failed")
  throw new Error(
    `Falha QA existente: ${sql(`SELECT last_error->>'message' FROM private.rp_reset_requests WHERE id='${requestId}'`)}`,
  );
const start = Date.now();
for (let i = 0; i < 3000; i++) {
  const result = await processResetWorker({
    client: service,
    requestId,
    token,
    budgetMs: 4500,
  });
  if (result.failed) {
    console.error(
      sql(
        `SELECT last_error-'detail'-'context' FROM private.rp_reset_requests WHERE id='${requestId}'`,
      ),
    );
    throw new Error("Etapa QA falhou.");
  }
  if (i % 5 === 0)
    console.log(
      `Checkpoint ${i}: ${sql(`SELECT current_phase||' / '||(SELECT count(*) FROM private.rp_reset_steps WHERE request_id=r.id AND status='completed') FROM private.rp_reset_requests r WHERE id='${requestId}'`)}`,
    );
  if (result.validated) break;
  assert.ok(
    Date.now() - start < 20 * 60 * 1000,
    "O ensaio excedeu o limite de 20 minutos.",
  );
}
job = await rpc(admin, "admin_get_controlled_reset");
assert.equal(job.status, "validated");
assert.equal(job.result.valid, true);
assert.equal(job.result.preserved_admins, 5);
assert.equal(job.result.orphans.length, 0);
assert.equal(sql("SELECT count(*) FROM public.posts"), "0");
assert.equal(sql("SELECT count(*) FROM public.notifications"), "0");
assert.equal(
  sql(
    "SELECT count(*) FROM public.security_audit_log WHERE action='reset_qa_preserve'",
  ),
  "1",
);
assert.equal(
  sql("SELECT count(*) FROM public.profiles WHERE role='Presidente'"),
  "0",
);
for (const actor of actors.slice(0, 5)) {
  const c = client();
  await checked(c.auth.signInWithPassword(actor));
  assert.equal(await rpc(c, "is_admin", { p_user_id: actor.id }), true);
}
console.log(
  "✓ Cinco Admins conservaram login real e concessões; cargos do RP foram removidos; zero órfãos.",
);
console.log(
  `✓ Reset real descartável chegou à validação em ${((Date.now() - start) / 1000).toFixed(1)} s; reabertura permanece explícita.`,
);
writeFileSync(
  `${root}/qa-reset-result.json`,
  JSON.stringify({
    requestId,
    elapsedMs: Date.now() - start,
    result: job.result,
    steps: job.steps,
  }),
  { mode: 0o600 },
);
