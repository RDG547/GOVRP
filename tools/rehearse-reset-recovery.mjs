import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Recovery is an operator procedure, never an "undo" RPC. Rehearsals are
// restricted to the separately provisioned disposable Supabase stack.
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
    { input: q, encoding: "utf8", maxBuffer: 200 * 1024 * 1024 },
  ).trim();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const ident = (value) => `"${value.replaceAll('"', '""')}"`;
const requestId = sql(
  "SELECT id FROM private.rp_reset_requests WHERE started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
);
assert.match(requestId, /^[0-9a-f-]{36}$/);
const chunks = JSON.parse(
  sql(
    `SELECT json_agg(to_jsonb(c) ORDER BY schema_name,table_name,chunk_no) FROM private.rp_reset_backup_chunks c WHERE request_id=${quote(requestId)}::uuid`,
  ),
);
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
assert.equal(
  Number(
    sql(
      `SELECT count(*) FROM private.rp_reset_backup_chunks WHERE request_id=${quote(requestId)}::uuid AND encode(extensions.digest(payload::text,'sha256'),'hex')<>digest`,
    ),
  ),
  0,
  "Todos os blocos internos conservam o SHA-256.",
);
for (let offset = 0; offset < chunks.length; offset += 8) {
  await Promise.all(
    chunks.slice(offset, offset + 8).map(async (chunk) => {
      if (!chunk.object_name) return;
      const r = await service.storage
        .from("rp-reset-backups")
        .download(chunk.object_name);
      assert.equal(r.error, null);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await r.data.arrayBuffer()))
          .digest("hex"),
        chunk.digest,
      );
    }),
  );
}
console.log(
  `✓ ${chunks.length} blocos conferidos com SHA-256 antes da recuperação.`,
);
if (!process.argv.includes("--apply")) {
  console.log(
    "Somente verificação. --apply restaura exclusivamente o ambiente GOVRP_RESET_QA.",
  );
  process.exit(0);
}
const tables = [
  ...new Set(
    chunks
      .filter(
        (c) =>
          ["public", "private", "auth"].includes(c.schema_name) &&
          !["platform_admins", "admin_development_modes"].includes(
            c.table_name,
          ),
      )
      .map((c) => `${c.schema_name}.${c.table_name}`),
  ),
];
// Keep real/legal records and technical Auth identities. Replacing the old
// character restores the same UUIDs, so protected records retain their links.
const preserved = new Set([
  "public.donations",
  "public.donation_webhook_events",
  "public.support_tickets",
  "public.support_ticket_messages",
  "public.security_audit_log",
]);
const identities = new Set([
  "auth.users",
  "auth.identities",
  "public.users",
  "private.account_identities",
]);
const assets = JSON.parse(
  sql(
    `SELECT coalesce(json_agg(to_jsonb(a)),'[]') FROM private.rp_reset_assets a WHERE request_id=${quote(requestId)}::uuid AND status IN('archived','deleted')`,
  ),
);
const copies = new Map();
for (const asset of assets) {
  const result = await service.storage
    .from("rp-reset-backups")
    .download(asset.backup_name);
  assert.equal(result.error, null);
  const bytes = Buffer.from(await result.data.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.digest);
  copies.set(asset.id, bytes);
}
const body = ["BEGIN;SET LOCAL session_replication_role=replica;"];
for (const table of tables) {
  if (!preserved.has(table) && !identities.has(table))
    body.push(`DELETE FROM ${table.split(".").map(ident).join(".")};`);
}
const tableColumns = new Map(
  Object.entries(
    JSON.parse(
      sql(
        "SELECT json_object_agg(table_name,columns) FROM (SELECT n.nspname||'.'||c.relname table_name,json_agg(a.attname ORDER BY a.attnum) columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' WHERE n.nspname IN('public','private','auth') AND c.relkind='r' GROUP BY n.nspname,c.relname)x",
      ),
    ),
  ),
);
for (const chunk of chunks) {
  const table = `${chunk.schema_name}.${chunk.table_name}`;
  if (!tables.includes(table) || preserved.has(table) || !chunk.row_count)
    continue;
  const columns = tableColumns.get(table);
  const names = columns.map(ident).join(",");
  const key = table === "private.account_identities" ? "user_id" : "id";
  const conflict = identities.has(table)
    ? ` ON CONFLICT(${ident(key)}) DO UPDATE SET ${columns
        .filter((c) => c !== key)
        .map((c) => `${ident(c)}=excluded.${ident(c)}`)
        .join(",")}`
    : "";
  body.push(
    `INSERT INTO ${table.split(".").map(ident).join(".")}(${names}) OVERRIDING SYSTEM VALUE SELECT ${names} FROM jsonb_populate_recordset(NULL::${table.split(".").map(ident).join(".")},(SELECT payload FROM private.rp_reset_backup_chunks WHERE id=${Number(chunk.id)}))${conflict};`,
  );
}
body.push(
  "UPDATE private.rp_reset_runtime SET maintenance=false,request_id=NULL,enforce_generation=false,changed_at=clock_timestamp();UPDATE private.rp_reset_requests SET status='cancelled' WHERE status NOT IN('completed','expired','cancelled','draft');SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker';SET LOCAL session_replication_role=origin;UPDATE private.rp_reset_runtime SET changed_at=clock_timestamp() WHERE id;COMMIT;",
);
sql(body.join("\n"));
for (const asset of assets) {
  const upload = await service.storage
    .from(asset.bucket_id)
    .upload(asset.object_name, copies.get(asset.id), {
      upsert: true,
      contentType:
        asset.original_metadata?.metadata?.mimetype ||
        "application/octet-stream",
    });
  assert.equal(upload.error, null);
  if (asset.original_metadata?.owner_id)
    sql(
      `UPDATE storage.objects SET owner_id=${quote(asset.original_metadata.owner_id)},owner=${asset.original_metadata.owner ? quote(asset.original_metadata.owner) + "::uuid" : "NULL"} WHERE bucket_id=${quote(asset.bucket_id)} AND name=${quote(asset.object_name)};`,
    );
  const restored = await service.storage
    .from(asset.bucket_id)
    .download(asset.object_name);
  assert.equal(restored.error, null);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await restored.data.arrayBuffer()))
      .digest("hex"),
    asset.digest,
  );
}
const restoredCounts = JSON.parse(
  sql(
    "SELECT json_object_agg(table_name,n) FROM (" +
      tables
        .filter((t) => !preserved.has(t))
        .map(
          (table) =>
            "SELECT " +
            quote(table) +
            " table_name,(SELECT count(*) FROM " +
            table.split(".").map(ident).join(".") +
            ") n",
        )
        .join(" UNION ALL ") +
      ") counts",
  ),
);
for (const [table, count] of Object.entries(restoredCounts))
  assert.equal(
    Number(count),
    chunks
      .filter((c) => `${c.schema_name}.${c.table_name}` === table)
      .reduce((n, c) => n + c.row_count, 0),
    `Contagem restaurada: ${table}`,
  );
assert.equal(
  Number(
    sql(
      `SELECT jsonb_array_length(private.validate_controlled_reset(${quote(requestId)}::uuid)->'orphans')`,
    ),
  ),
  0,
  "Recuperação sem referências órfãs.",
);
console.log(
  `✓ Estado anterior restaurado no stack descartável, incluindo Auth e ${assets.length} arquivo(s); contagens de todas as tabelas conferidas.`,
);
