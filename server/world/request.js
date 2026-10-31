import { withStorageGeneration } from "../../src/lib/worldStorage.js";
import process from "node:process";
import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage();
const headerValue = (headers, name) =>
  typeof headers?.get === "function" ? headers.get(name) : headers?.[name];
export const withWorldRequest = (request, work) =>
  requests.run(
    {
      generation:
        headerValue(request.headers, "x-govrp-world-generation") || null,
      authorization: headerValue(request.headers, "authorization") || "",
      runtime: null,
    },
    work,
  );

// A cached Supabase client may serve concurrent HTTP requests. Its generation
// must belong to the request, never to mutable global client headers.
export async function worldServerFetch(input, options = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (
    !url.pathname.startsWith("/rest/v1/") &&
    !url.pathname.startsWith("/storage/v1/")
  )
    return globalThis.fetch(input, options);
  if (url.pathname.endsWith("/rpc/get_world_runtime"))
    return globalThis.fetch(input, options);
  const headers = new Headers(options.headers || input.headers || {}),
    context = requests.getStore();
  const load = async () => {
    const response = await globalThis.fetch(
      url.origin + "/rest/v1/rpc/get_world_runtime",
      {
        method: "POST",
        headers: {
          apikey:
            headers.get("apikey") ||
            process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
            process.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok)
      throw new Error(
        "Não foi possível verificar a geração do universo. Tente novamente.",
      );
    return response.json();
  };
  const runtime = await (context ? (context.runtime ||= load()) : load());
  if (
    context &&
    runtime.enforce_generation &&
    !context.generation &&
    /^Bearer eyJ/.test(context.authorization)
  )
    throw Object.assign(
      new Error(
        "A sessão pertence a um universo anterior. Atualize sua sessão antes de continuar.",
      ),
      { statusCode: 409 },
    );
  headers.set(
    "x-govrp-world-generation",
    context?.generation || runtime.generation_id,
  );
  if (
    url.pathname.startsWith("/storage/v1/object/") &&
    ["POST", "PUT"].includes((options.method || "GET").toUpperCase())
  )
    return globalThis.fetch(
      input,
      withStorageGeneration(
        options,
        headers,
        context?.generation || runtime.generation_id,
      ),
    );
  return globalThis.fetch(input, { ...options, headers });
}
