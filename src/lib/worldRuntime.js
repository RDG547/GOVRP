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
// The reset engine blocks writes atomically in PostgreSQL only while the
// universe is under maintenance. Day-to-day requests must not depend on an
// extra status RPC, browser generation headers, or special upload metadata.
// Keep the runtime subscription solely for world reset/cache invalidation.
export function createWorldFetch() {
  return (input, options) => globalThis.fetch(input, options);
}
