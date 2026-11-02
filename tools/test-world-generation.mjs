import assert from "node:assert/strict";
import {
  createWorldFetch,
  acceptWorldRuntime,
  getWorldRuntime,
} from "../src/lib/worldRuntime.js";
import { withWorldRequest, worldServerFetch } from "../server/world/request.js";

const events = [], sent = [];
function createStorage() {
  const data = {
    "sb-auth-token": "login",
    theme: "dark",
    "govrp_cart:old": "[]",
    "govrp:tutorial:old": "closed",
  };
  return {
    ...data,
    removeItem: (key) => { delete store[key]; },
  };
}
const local = { "sb-auth-token": "login", theme: "dark", "govrp_cart:old": "[]" };
const session = { "govrp:tutorial:old": "closed" };
Object.defineProperty(local, "removeItem", { value: key => delete local[key], enumerable: false });
Object.defineProperty(session, "removeItem", { value: key => delete session[key], enumerable: false });
Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
globalThis.dispatchEvent = event => events.push(event.type);
let stateQueries = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  if (String(input).endsWith("/rpc/get_world_runtime")) stateQueries++;
  sent.push({input, options});
  return Response.json({ok:true});
};

try {
  const fetch = createWorldFetch("https://qa.invalid/", "public-key");
  await fetch("https://qa.invalid/rest/v1/posts", {method:"POST",body:"{}"});
  await fetch("https://qa.invalid/storage/v1/object/post-images/a.png", {
    method:"POST",body:new Uint8Array([1]),
  });
  await withWorldRequest({headers:{"x-govrp-world-generation":"old"}},
    () => worldServerFetch("https://qa.invalid/rest/v1/accounts",{method:"POST"}));
  assert.equal(stateQueries, 0, "Operações normais não consultam a geração.");
  assert.equal(sent.length, 3);
  assert.ok(sent.every(r => !new Headers(r.options.headers || {}).has("x-govrp-world-generation")));
  acceptWorldRuntime({generation_id:"old",changed_at:"2026-10-31T00:00:00Z"});
  acceptWorldRuntime({generation_id:"new",changed_at:"2026-10-31T00:01:00Z"});
  assert.equal(getWorldRuntime().generation_id,"new");
  assert.equal(local["sb-auth-token"],"login");
  assert.equal(local.theme,"dark");
  assert.equal(local["govrp_cart:old"],undefined);
  assert.equal(session["govrp:tutorial:old"],undefined);
  assert.ok(events.includes("govrp:world-reset"));
  acceptWorldRuntime({generation_id:"late",changed_at:"2026-10-31T00:00:01Z"});
  assert.equal(getWorldRuntime().generation_id,"new");
  console.log("✓ Escritas não dependem de geração; cache do RP é invalidado no reset sem apagar Auth/tema.");
} finally {
  globalThis.fetch = originalFetch;
}
