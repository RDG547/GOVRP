import { withStorageGeneration } from "./worldStorage.js";
// Auth credentials and technical preferences never belong to a world generation.
let runtime = null;
let pending = null;
const listeners = new Set();
export const getWorldRuntime = () => runtime;
export const subscribeWorldRuntime = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function acceptWorldRuntime(value) {
  if (
    !value?.generation_id ||
    (runtime && Date.parse(value.changed_at) < Date.parse(runtime.changed_at))
  )
    return;
  const previous = runtime;
  runtime = value;
  if (
    previous?.generation_id &&
    previous.generation_id !== value.generation_id
  ) {
    for (const storage of [
      globalThis.localStorage,
      globalThis.sessionStorage,
    ]) {
      if (!storage) continue;
      for (const key of Object.keys(storage)) {
        if (
          /^(govrp_cart[:_]|govrp_phone[:_]|govrp_rp[:_]|govrp_tutorial[:_]|govrp_game[:_]|govrp:(tutorial|phone|cart|rp):)/.test(
            key,
          )
        )
          storage.removeItem(key);
      }
    }
    globalThis.dispatchEvent?.(
      new CustomEvent("govrp:world-reset", { detail: value }),
    );
  }
  listeners.forEach((listener) => listener());
}
// Cache the last successful check briefly. A stale generation never bypasses
// PostgreSQL's barrier; it only allows the user action to reach the server
// when a non-authoritative status request fails temporarily.
let checkedAt = 0;

async function requestRuntime(endpoint, options, timeoutMs) {
  // AbortSignal.timeout() is unavailable on older Safari / iOS versions.
  // A conventional AbortController prevents a synchronous TypeError before
  // the network request even begins.
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await globalThis.fetch(endpoint, {
      ...options,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Estado do universo indisponível (HTTP ${response.status}).`);
    const state = await response.json();
    if (!state?.generation_id || typeof state.maintenance !== "boolean") {
      throw new Error("Resposta inválida ao consultar o universo.");
    }
    acceptWorldRuntime(state);
    checkedAt = Date.now();
    return runtime;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function loadWorldRuntime(url, key, force = false) {
  if (runtime && !force) return runtime;
  if (!pending) {
    pending = (async () => {
      try {
        return await requestRuntime(
          `${url.replace(/\/+$/, "")}/rest/v1/rpc/get_world_runtime`,
          {
            method: "POST",
            headers: { apikey: key, "Content-Type": "application/json" },
            body: "{}",
          },
          5500,
        );
      } catch (directError) {
        // Same-origin fallback avoids the additional cross-origin request
        // from old Safari/low-quality mobile networks. This endpoint exposes
        // exactly the same public, read-only runtime information.
        try {
          return await requestRuntime("/api/world-runtime", {
            method: "GET",
            cache: "no-store",
          }, 9500);
        } catch (proxyError) {
          if (runtime && !runtime.maintenance && Date.now() - checkedAt < 60_000) {
            return runtime;
          }
          throw new Error(
            "Não foi possível confirmar o estado do GOVRP. Sua conexão com a plataforma pode estar instável. Tente novamente.",
            { cause: proxyError || directError },
          );
        }
      }
    })().finally(() => { pending = null; });
  }
  return pending;
}
// Reads never mutate the world and do not require a generation check. Avoid
// blocking ordinary screens on an additional Supabase request, particularly
// on high-latency mobile networks. Every mutation still uses the generation
// barrier enforced by Postgres.
const safeReadOnlyRpcs = new Set([
  "get_my_citizen_onboarding",
  "get_my_bank_account",
  // Feed, profile and discovery RPCs only read public Social X content.
  // A slow world-state lookup must not hide posts from regular citizens.
  "get_x_posts",
  "get_user_posts_with_interactions",
  "get_posts_with_interactions",
  "get_public_x_profile",
  "search_x",
  "get_x_trends",
  "get_x_follow_page",
]);

export function createWorldFetch(url, key) {
  url = url.replace(/\/+$/, "");
  return async (input, options = {}) => {
    const path = typeof input === "string" ? input : input.url;
    const method = (options.method || (typeof input === "string" ? "GET" : input.method) || "GET").toUpperCase();
    const isRest = path.startsWith(`${url}/rest/v1/`);
    const isStorage = path.startsWith(`${url}/storage/v1/object/`);
    if ((!isRest && !isStorage) || path.includes("/rpc/get_world_runtime")) {
      return globalThis.fetch(input, options);
    }
    const endpoint = path.split("?")[0].split("/").pop();
    const safeRead = method === "GET" || method === "HEAD" ||
      (isRest && method === "POST" && safeReadOnlyRpcs.has(endpoint));

    // Read-only operations must not wait on the world-state RPC. PostgreSQL
    // policies still govern their access, and triggers enforce all writes.
    if (safeRead) {
      return globalThis.fetch(input, options);
    }

    let current;
    try {
      current = await loadWorldRuntime(url, key);
    } catch (initialError) {
      // Retry ONLY world metadata, NEVER the user mutation. A lost response
      // from a mutation must not be resent because it may already have run.
      await new Promise(resolve => setTimeout(resolve, 350));
      try {
        current = await loadWorldRuntime(url, key, true);
      } catch {
        throw new Error(
          "O GOVRP não conseguiu verificar o estado do servidor. Seus dados não foram enviados; tente salvar novamente.",
          { cause: initialError },
        );
      }
    }
    if (!current?.generation_id || current.maintenance) {
      throw new Error(
        "O GOVRP está temporariamente em manutenção. Seus dados foram mantidos nesta tela.",
      );
    }
    const headers = new Headers(options.headers || input.headers || {});
    headers.set("x-govrp-world-generation", current.generation_id);
    if (isStorage && ["POST", "PUT"].includes(method)) {
      return globalThis.fetch(
        input,
        withStorageGeneration(options, headers, current.generation_id),
      );
    }
    return globalThis.fetch(input, { ...options, headers });
  };
}
