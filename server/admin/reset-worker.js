import process from "node:process";
import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const backupBucket = "rp-reset-backups";
const checked = async (promise) => {
  const result = await promise;
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

export function collectResetAssetReferences(packet) {
  const retained = new Map(),
    referenced = new Map();
  for (const row of JSON.parse(packet.payload_text)) {
    const protect =
      packet.classification === "C" ||
      packet.classification === "D" ||
      packet.strategy === "keep";
    if ((packet.schema || packet.schema_name) === 'private' && (packet.table || packet.table_name) === 'justice_evidence_uploads' && typeof row.path === 'string' && /^[a-f0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/i.test(row.path)) {
      const value = { bucket: 'justice-evidence', name: row.path };
      (protect ? retained : referenced).set(`${value.bucket}/${value.name}`, value);
    }
    const text = JSON.stringify(row);
    const pattern =
      /https?:\/\/[^\s"\\]+\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^\s"\\?]+)/g;
    for (const match of text.matchAll(pattern)) {
      const path = decodeURIComponent(match[1]),
        split = path.indexOf("/");
      if (split < 1) continue;
      const value = {
        bucket: path.slice(0, split),
        name: path.slice(split + 1),
      };
      if (value.bucket === backupBucket) continue;
      (protect ? retained : referenced).set(path, value);
    }
  }
  return {
    retained: [...retained.values()],
    referenced: [...referenced.values()],
  };
}

export async function processResetWorker({
  client,
  requestId,
  token,
  budgetMs = 4500,
}) {
  const claim = await checked(
    client.rpc("admin_claim_reset_worker", {
      p_request_id: requestId,
      p_token: token,
    }),
  );
  if (claim.busy) return { busy: true };
  const lease = claim.lease,
    params = { p_request_id: requestId, p_token: token, p_lease: lease };
  let processed = 0,
    bucketReady = false;
  const ensureBucket = async () => {
    if (bucketReady) return;
    const buckets = await checked(client.storage.listBuckets());
    if (!buckets.some((bucket) => bucket.id === backupBucket))
      await checked(
        client.storage.createBucket(backupBucket, { public: false }),
      );
    bucketReady = true;
  };
  const until = Date.now() + Math.min(budgetMs, 6500);
  try {
    while (Date.now() < until) {
      const result = await checked(
        client.rpc("admin_process_reset_batch", params),
      );
      if (result.failed || result.validated) return { processed, ...result };
      const task = result.task;
      if (task) {
        let data = {};
        if (task.kind === "backup_chunk") {
          if (sha(task.payload_text) !== task.digest)
            throw new Error(
              "Um bloco de backup chegou com integridade inválida.",
            );
          await ensureBucket();
          await checked(
            client.storage
              .from(backupBucket)
              .upload(task.backup_name, Buffer.from(task.payload_text), {
                upsert: true,
                contentType: "application/json",
              }),
          );
          const copy = await checked(
            client.storage.from(backupBucket).download(task.backup_name),
          );
          if (sha(Buffer.from(await copy.arrayBuffer())) !== task.digest)
            throw new Error(
              "A cópia física do bloco não corresponde ao checksum.",
            );
          data = {
            digest: task.digest,
            backup_name: task.backup_name,
            ...collectResetAssetReferences(task),
          };
        } else if (task.kind === "archive_asset") {
          await ensureBucket();
          const source = await checked(
            client.storage.from(task.bucket).download(task.name),
          );
          const bytes = Buffer.from(await source.arrayBuffer());
          await checked(
            client.storage.from(backupBucket).upload(task.backup_name, bytes, {
              upsert: true,
              contentType: source.type || "application/octet-stream",
            }),
          );
          const copy = await checked(
            client.storage.from(backupBucket).download(task.backup_name),
          );
          if (sha(Buffer.from(await copy.arrayBuffer())) !== sha(bytes))
            throw new Error("A cópia do arquivo não corresponde ao original.");
          data = {
            backup_name: task.backup_name,
            digest: sha(bytes),
            bytes: bytes.length,
          };
        } else if (task.kind === "delete_asset") {
          if (task.backup_required !== false) {
            const archive = await checked(
              client.storage.from(backupBucket).download(task.backup_name),
            );
            if (sha(Buffer.from(await archive.arrayBuffer())) !== task.digest)
              throw new Error(
                "A cópia do arquivo precisa ser recuperada antes da limpeza.",
              );
          }
          await checked(client.storage.from(task.bucket).remove([task.name]));
        } else if (task.kind === "delete_account") {
          // Supabase's supported soft deletion removes access and identities while
          // retaining a technical tombstone for financial/legal foreign keys.
          const existing = await checked(
            client.auth.admin.getUserById(task.id),
          );
          if (!existing.user.deleted_at)
            await checked(client.auth.admin.deleteUser(task.id, true));
        } else throw new Error("Tarefa de manutenção desconhecida.");
        await checked(
          client.rpc("admin_ack_reset_task", {
            ...params,
            p_kind: task.kind,
            p_id: String(task.id),
            p_data: data,
          }),
        );
      }
      processed++;
      if (result.waiting && result.phase === "draining") break;
    }
    return { processed, checkpointed: true };
  } catch (error) {
    await client.rpc("admin_finish_reset_worker", {
      ...params,
      p_error: error.message,
    });
    throw error;
  } finally {
    await client.rpc("admin_finish_reset_worker", { ...params, p_error: null });
  }
}

export async function resetWorkerHandler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.statusCode = 405;
    response.end();
    return;
  }
  const token = request.headers["x-govrp-reset-token"];
  if (typeof token !== "string" || !/^\w{64}$/.test(token)) {
    response.statusCode = 401;
    response.end();
    return;
  }
  try {
    let body = request.body;
    if (!body) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString());
    }
    if (typeof body === "string") body = JSON.parse(body);
    if (!/^[0-9a-f-]{36}$/i.test(body?.request_id || "")) {
      response.statusCode = 400;
      response.end();
      return;
    }
    const client = createClient(
      process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        global: {
          fetch: (input, options = {}) =>
            fetch(input, { ...options, signal: AbortSignal.timeout(20000) }),
        },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const result = await processResetWorker({
      client,
      requestId: body.request_id,
      token,
    });
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    console.error("Worker de reset interrompido:", error.message);
    response.statusCode = /autorizad/i.test(error.message) ? 401 : 503;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        error:
          "O checkpoint foi preservado. Consulte o acompanhamento administrativo.",
      }),
    );
  }
}
