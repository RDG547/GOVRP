import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY.");
assert.equal(
  JSON.parse(readFileSync(`${root}/qa-credentials.json`)).API_URL,
  "http://127.0.0.1:54431",
);
const sql = (q) =>
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
    { input: q, encoding: "utf8" },
  ).trim();
const request = sql(
  "SELECT request_id FROM private.rp_reset_runtime WHERE id AND maintenance",
);
assert.match(
  request,
  /^[0-9a-f-]{36}$/,
  "Use um reset QA validado que ainda aguarda reabertura.",
);
const job = Number(
  sql(
    "SELECT cron.schedule('govrp-qa-drain-probe','1 second','select pg_sleep(8);')",
  ),
);
try {
  for (let i = 0; i < 60; i++) {
    if (
      sql(
        `SELECT count(*) FROM cron.job_run_details WHERE jobid=${job} AND status='running'`,
      ) !== "0"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.notEqual(
    sql(
      `SELECT count(*) FROM cron.job_run_details WHERE jobid=${job} AND status='running'`,
    ),
    "0",
  );
  const setup = `BEGIN;INSERT INTO private.rp_reset_job_schedules SELECT '${request}',jobid,jobname,command,schedule,active FROM cron.job WHERE jobid=${job};`;
  const lines = sql(`${setup}
    UPDATE private.rp_reset_requests SET status='draining',lease_id='97000000-0000-0000-0000-000000000001',lease_until=clock_timestamp()+interval '45 seconds' WHERE id='${request}';
    UPDATE private.rp_reset_steps SET status='pending' WHERE request_id='${request}' AND ordinal=0;
    SELECT public.admin_process_reset_batch('${request}',(SELECT worker_token FROM private.rp_reset_requests WHERE id='${request}'),'97000000-0000-0000-0000-000000000001');ROLLBACK;`).split(
    "\n",
  );
  const result = JSON.parse(lines.find((line) => line.startsWith("{")));
  assert.equal(result.waiting, true);
  assert.equal(result.phase, "draining");
  sql(`SELECT cron.alter_job(${job},active:=false);`);
  for (let i = 0; i < 100; i++) {
    if (
      sql(
        `SELECT count(*) FROM cron.job_run_details WHERE jobid=${job} AND status='running'`,
      ) === "0"
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const probe = sql(
    `${setup}SELECT private.reset_background_jobs_drained('${request}');ROLLBACK;`,
  ).split("\n");
  assert.ok(probe.includes("t"));
  assert.equal(
    sql(
      "SELECT NOT has_function_privilege('authenticated','private.reset_background_jobs_drained(uuid)','EXECUTE')",
    ),
    "t",
  );
  writeFileSync(
    `${root}/qa-background-result.json`,
    JSON.stringify({
      waitingBeforeFirstGameplayWrite: true,
      allowedAfterCronEnded: true,
      simulationRolledBack: true,
    }),
    { mode: 0o600 },
  );
  console.log(
    "✓ Cron real ainda sem escrita de gameplay impede o início da limpeza; o worker só prossegue após seu encerramento.",
  );
} finally {
  sql(`SELECT cron.unschedule(${job});`);
}
