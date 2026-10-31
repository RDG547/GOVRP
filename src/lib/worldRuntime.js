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
export async function loadWorldRuntime(url, key, force = false) {
  if (runtime && !force) return runtime;
  if (!pending)
    pending = globalThis
      .fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/get_world_runtime`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Não foi possível verificar o estado do universo. Tente novamente.",
          );
        acceptWorldRuntime(await response.json());
        return runtime;
      })
      .finally(() => {
        pending = null;
      });
  return pending;
}
export function createWorldFetch(url, key) {
  url = url.replace(/\/+$/, "");
  return async (input, options = {}) => {
    const path = typeof input === "string" ? input : input.url;
    if (
      (!path.startsWith(`${url}/rest/v1/`) &&
        !path.startsWith(`${url}/storage/v1/object/`)) ||
      path.includes("/rpc/get_world_runtime")
    )
      return globalThis.fetch(input, options);
    const current = await loadWorldRuntime(url, key);
    const headers = new Headers(options.headers || input.headers || {});
    headers.set("x-govrp-world-generation", current.generation_id);
    if (
      path.startsWith(`${url}/storage/v1/object/`) &&
      ["POST", "PUT"].includes((options.method || "GET").toUpperCase())
    )
      return globalThis.fetch(
        input,
        withStorageGeneration(options, headers, current.generation_id),
      );
    return globalThis.fetch(input, { ...options, headers });
  };
}
