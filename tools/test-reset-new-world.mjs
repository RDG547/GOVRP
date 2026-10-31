import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY.");
const e = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(e.API_URL, "http://127.0.0.1:54431");
let actor = JSON.parse(readFileSync(`${root}/qa-actors.json`))[5];
if (existsSync(`${root}/qa-new-actor.json`))
  actor = JSON.parse(readFileSync(`${root}/qa-new-actor.json`));
const service = createClient(e.API_URL, e.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const probe = await service.auth.admin.getUserById(actor.id);
if (probe.data?.user?.deleted_at) {
  const email = `novo-mundo-${crypto.randomUUID()}@example.invalid`,
    password = `Govrp!${crypto.randomUUID()}Aa1`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { real_full_name: "Pessoa Fictícia Nova" },
  });
  if (created.error) throw Error(created.error.message);
  actor = { id: created.data.user.id, email, password };
  writeFileSync(`${root}/qa-new-actor.json`, JSON.stringify(actor), {
    mode: 0o600,
  });
}
const runtime = await service.rpc("get_world_runtime");
assert.equal(runtime.data.maintenance, false);
const c = createClient(e.API_URL, e.ANON_KEY, {
  global: {
    headers: { "x-govrp-world-generation": runtime.data.generation_id },
  },
  auth: { persistSession: false },
});
const auth = await c.auth.signInWithPassword(actor);
if (auth.error) throw Error(auth.error.message);
const rpc = async (name, args = {}) => {
  const r = await c.rpc(name, args);
  if (r.error) throw Error(`${name}: ${r.error.message}`);
  return r.data;
};
const profile = await c
  .from("profiles")
  .select("onboarding_completed")
  .eq("id", actor.id)
  .single();
if (!profile.data.onboarding_completed) {
  await rpc("update_my_account_identity", {
    p_real_full_name: "Pessoa Fictícia Recuperada",
    p_real_date_of_birth: "1990-05-12",
    p_phone: "11987654321",
    p_phone_country_code: "+55",
  });
  await rpc("start_citizen_onboarding");
  const bucket = await service.storage.createBucket("avatars", {
    public: true,
  });
  if (bucket.error && !/already exists/.test(bucket.error.message))
    throw Error(bucket.error.message);
  const response = await fetch("http://127.0.0.1:3199/api/citizens/avatar", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.data.session.access_token}`,
      "x-govrp-world-generation": runtime.data.generation_id,
      "Content-Type": "image/png",
    },
    body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const upload = await response.json();
  assert.equal(response.status, 201, upload.error);
  await rpc("save_citizen_identity", {
    p_full_name: "Marina Horizonte",
    p_username: `Nova.${crypto.randomUUID().slice(0, 6)}`,
    p_date_of_birth: "2001-09-07",
    p_character_bio: "Nova cidadã de um universo reiniciado.",
    p_avatar_url: upload.publicUrl,
    p_character_gender: "female",
  });
  await rpc("save_citizen_origin", {
    p_birth_state_code: "SP",
    p_birth_city_code: "3550308",
    p_birth_city_name: "São Paulo",
    p_residence_state_code: "RJ",
    p_residence_city_code: "3304557",
    p_residence_city_name: "Rio de Janeiro",
  });
  await rpc("save_citizen_aspiration", {
    p_initial_aspiration: "entrepreneurship",
  });
  for (const type of ["CPF", "RG", "Título de Eleitor", "CTD"])
    await rpc("issue_citizen_onboarding_document", { p_document_type: type });
  await rpc("ensure_citizen_bank_account");
  await rpc("finalize_citizen_onboarding");
}
const account = await c
  .from("accounts")
  .select("*")
  .eq("user_id", actor.id)
  .single();
assert.equal(account.error, null);
assert.ok(Number(account.data.balance) > 0);
const existingBusiness = await c
  .from("businesses")
  .select("id")
  .eq("owner_id", actor.id)
  .limit(1);
if (!existingBusiness.data.length) {
  const doc = await rpc("issue_document_request", {
    p_document_type: "CNPJ",
    p_metadata: {
      business_type_id: "padaria",
      company_name: "Padaria Nova Geração",
    },
  });
  assert.equal(doc.success, true, doc.message);
  const cnpj = await c
    .from("documents")
    .select("id")
    .eq("user_id", actor.id)
    .eq("type", "CNPJ")
    .single();
  assert.equal(cnpj.error, null);
  const registered = await fetch(
    "http://127.0.0.1:3199/api/businesses/register",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.data.session.access_token}`,
        "x-govrp-world-generation": runtime.data.generation_id,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessTypeId: "padaria",
        companyName: "Padaria Nova Geração",
        description: "Empresa criada após o reset controlado do mundo.",
        idempotencyKey: crypto.randomUUID(),
        cnpjId: cnpj.data.id,
        brand: { region_code: "RJ" },
      }),
    },
  );
  const business = await registered.json();
  assert.equal(registered.status, 200, business.error);
  assert.equal(business.business.owner_id, actor.id);
}
await rpc("claim_daily_check_in");
const products = await c
  .from("products")
  .select("id,price")
  .not("state_enterprise_id", "is", null)
  .gt("stock", 0)
  .lt("price", 30)
  .limit(1);
assert.ok(products.data?.length, "Catálogo estrutural disponível.");
await rpc("buy_product", {
  p_product_id: products.data[0].id,
  p_payment_method: "balance",
  p_card_id: null,
  p_idempotency_key: crypto.randomUUID(),
});
assert.equal(
  (await c.from("user_inventory").select("id").eq("user_id", actor.id)).data
    .length,
  1,
);
console.log(
  "✓ Após reset: identidade → origem → aspiração → quatro documentos → conta R$ 1.000 → CNPJ → empresa via API → compra real e inventário.",
);
