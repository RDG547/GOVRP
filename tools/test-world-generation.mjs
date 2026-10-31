import assert from "node:assert/strict";
import {
  createWorldFetch,
  acceptWorldRuntime,
  getWorldRuntime,
} from "../src/lib/worldRuntime.js";
import { withWorldRequest, worldServerFetch } from "../server/world/request.js";
const events = [],
  sent = [];
const storage = () =>
  Object.assign(Object.create(null), {
    "sb-auth-token": "login",
    theme: "dark",
    "govrp_cart:old": "[]",
    "govrp:tutorial:old": "closed",
  });
Object.defineProperty(globalThis, "localStorage", {
  value: storage(),
  configurable: true,
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: storage(),
  configurable: true,
});
for (const s of [localStorage, sessionStorage])
  Object.defineProperty(s, "removeItem", { value: (key) => delete s[key] });
globalThis.dispatchEvent = (event) => events.push(event.type);
let queries = 0;
globalThis.fetch = async (input, options = {}) => {
  if (input.endsWith("/rpc/get_world_runtime")) {
    queries++;
    return Response.json({
      generation_id: "old",
      changed_at: "2026-10-31T00:00:00Z",
      enforce_generation: true,
    });
  }
  sent.push({ input, options });
  return Response.json({ ok: true });
};
const fetch = createWorldFetch("https://qa.invalid/", "public-key");
await Promise.all([
  fetch("https://qa.invalid/rest/v1/posts", { method: "POST" }),
  fetch("https://qa.invalid/rest/v1/accounts"),
]);
assert.equal(queries, 1, "Bootstrap concorrente é compartilhado.");
assert.equal(sent[0].options.headers.get("x-govrp-world-generation"), "old");
const old = fetch("https://qa.invalid/rest/v1/posts", { method: "POST" });
acceptWorldRuntime({
  generation_id: "new",
  changed_at: "2026-10-31T00:01:00Z",
  enforce_generation: true,
});
await old;
assert.equal(
  sent.at(-1).options.headers.get("x-govrp-world-generation"),
  "old",
  "Ação já iniciada conserva a geração antiga para ser recusada pelo banco.",
);
assert.equal(localStorage["sb-auth-token"], "login");
assert.equal(localStorage.theme, "dark");
assert.equal(localStorage["govrp_cart:old"], undefined);
assert.ok(events.includes("govrp:world-reset"));
acceptWorldRuntime({
  generation_id: "late",
  changed_at: "2026-10-31T00:00:01Z",
});
assert.equal(
  getWorldRuntime().generation_id,
  "new",
  "Resposta antiga não substitui geração nova.",
);
const form = new FormData();
form.set("metadata", JSON.stringify({ label: "Imagem pública" }));
form.set("file", new Blob(["fake"]), "fake.bin");
await fetch("https://qa.invalid/storage/v1/object/avatars/fake.bin", {
  method: "POST",
  body: form,
});
assert.deepEqual(JSON.parse(sent.at(-1).options.body.get("metadata")), {
  label: "Imagem pública",
  world_generation: "new",
});
await Promise.all(
  ["request-a", "request-b"].map((generation) =>
    withWorldRequest(
      {
        headers: {
          "x-govrp-world-generation": generation,
          authorization: "Bearer fake",
        },
      },
      () =>
        worldServerFetch("https://qa.invalid/rest/v1/accounts", {
          headers: { apikey: "fake" },
        }),
    ),
  ),
);
assert.deepEqual(
  new Set(
    sent
      .slice(-2)
      .map((r) => r.options.headers.get("x-govrp-world-generation")),
  ),
  new Set(["request-a", "request-b"]),
  "Clientes de servidor concorrentes não misturam gerações.",
);
await withWorldRequest(
  { headers: { "x-govrp-world-generation": "captured" } },
  () =>
    worldServerFetch("https://qa.invalid/storage/v1/object/avatars/fake.bin", {
      method: "POST",
      headers: { apikey: "fake" },
      body: new Uint8Array([1]),
    }),
);
assert.equal(
  JSON.parse(atob(sent.at(-1).options.headers.get("x-metadata")))
    .world_generation,
  "captured",
);
console.log(
  "✓ Geração capturada por ação, bootstrap único, resposta tardia rejeitada, Auth/tema preservados, caches de RP invalidados, uploads marcados e servidor concorrente isolado.",
);
