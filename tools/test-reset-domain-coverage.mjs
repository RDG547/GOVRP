import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { processResetWorker } from "../server/admin/reset-worker.js";
const root = process.env.RESET_QA_DIRECTORY;
if (!root) throw Error("Informe RESET_QA_DIRECTORY.");
const e = JSON.parse(readFileSync(`${root}/qa-credentials.json`));
assert.equal(e.API_URL, "http://127.0.0.1:54431");
const admins = JSON.parse(readFileSync(`${root}/qa-actors.json`)).slice(0, 5);
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
    { input: q, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  ).trim();
const check = async (p) => {
  const r = await p;
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const service = createClient(e.API_URL, e.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const initial = await check(service.rpc("get_world_runtime"));
assert.equal(initial.maintenance, false);
const people = [];
for (let i = 0; i < 8; i++) {
  const email = `dominio-${crypto.randomUUID()}@example.invalid`,
    password = `Govrp!${crypto.randomUUID()}Aa1`,
    created = await check(
      service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { real_full_name: "Pessoa Fictícia de Domínio" },
      }),
    );
  people.push({ id: created.user.id, email, password });
}
const id = () => crypto.randomUUID(),
  business = id(),
  businessAccount = id(),
  card = id(),
  election = id(),
  candidate = id(),
  party = id(),
  occurrence = id(),
  investigation = id(),
  caseId = id(),
  decision = id(),
  sentence = id(),
  government = id(),
  residence = id();
const roles = [
  "Vice-Presidente",
  "Ministro",
  "Senador",
  "Juiz",
  "Delegado",
  "Agente da AGIES",
  "Promotor",
  "Cidadão",
];
sql(`BEGIN;SET LOCAL session_replication_role=replica;
 ${people.map((p, i) => `UPDATE public.profiles SET role='${roles[i]}',onboarding_completed=true,titles=ARRAY['${roles[i]}'],is_imprisoned=${i === 7 ? "true" : "false"} WHERE id='${p.id}';`).join("\n")}
 UPDATE public.profiles SET role='Presidente',onboarding_completed=true WHERE id='${admins[1].id}';
 UPDATE public.profiles SET role='Deputado',onboarding_completed=true WHERE id='${admins[2].id}';
 UPDATE public.profiles SET role='Cidadão',onboarding_completed=true WHERE id='${admins[3].id}';
 UPDATE public.profiles SET onboarding_completed=false,full_name=NULL WHERE id='${admins[4].id}';
 INSERT INTO public.accounts(user_id,account_number,agency_number,balance) SELECT id,'QA-'||id,'0001',10000 FROM public.profiles WHERE deleted_at IS NULL;
 INSERT INTO public.businesses(id,owner_id,business_type_id,name,region_code,bank_account_id) VALUES('${business}','${admins[3].id}','padaria','Empresa do Admin Fictício','SP','${businessAccount}');
 INSERT INTO public.accounts(id,account_kind,business_id,account_number,agency_number,balance) VALUES('${businessAccount}','business','${business}','QA-BUSINESS','0001',20000);
 INSERT INTO public.cards(id,user_id,card_number,card_holder_name,expiry_date,cvv,type,account_id,card_limit,used_limit) SELECT '${card}','${people[7].id}','4111111111111111','Cidadão Fictício','12/30','123','credit',id,1000,100 FROM public.accounts WHERE user_id='${people[7].id}';
 INSERT INTO public.card_invoices(card_id,user_id,closing_date,due_date,amount) VALUES('${card}','${people[7].id}',current_date,current_date+10,100);
 INSERT INTO public.loan_applications(user_id,amount) VALUES('${people[7].id}',500);
 INSERT INTO public.loans(user_id,amount,interest_rate) VALUES('${people[7].id}',500,5);
 INSERT INTO public.user_investments(user_id,investment_id,amount_invested) SELECT '${people[7].id}',id,100 FROM public.investment_options WHERE asset_symbol IS NOT NULL LIMIT 1;
 INSERT INTO public.political_parties(id,name,acronym,ideology,founder_id,owner_id,registration_number) VALUES('${party}','Partido Fictício de Domínio','PFD','Centro','${people[2].id}','${people[2].id}','QA-DOMAIN');
 INSERT INTO public.party_members(party_id,user_id) VALUES('${party}','${people[2].id}'),('${party}','${admins[2].id}');
 INSERT INTO public.party_treasuries(party_id,balance) VALUES('${party}',5000);
 INSERT INTO public.elections(id,name,candidacy_start_date,candidacy_end_date,voting_start_date,voting_end_date) VALUES('${election}','Eleição Fictícia',now()-interval '4 days',now()-interval '3 days',now()-interval '2 days',now()+interval '1 day');
 INSERT INTO public.candidates(id,election_id,user_id,political_name) VALUES('${candidate}','${election}','${people[2].id}','Candidato Fictício');
 INSERT INTO public.votes(election_id,voter_id,candidate_id) VALUES('${election}','${people[7].id}','${candidate}');
 INSERT INTO public.government_terms(id,original_president_id,head_id,election_id,term_starts_at,term_ends_at) VALUES('${government}','${admins[1].id}','${admins[1].id}','${election}',now()-interval '1 day',now()+interval '30 days');
 INSERT INTO public.ministers(user_id,ministry) VALUES('${people[1].id}','Fazenda');
 INSERT INTO public.minister_invitations(government_id,candidate_id,invited_by,ministry_id,expires_at) SELECT '${government}','${people[1].id}','${admins[1].id}',id,now()+interval '1 day' FROM public.government_ministries LIMIT 1;
 INSERT INTO public.parliament_members(user_id,house_id,term_start_date,term_end_date) SELECT '${admins[2].id}',id,current_date,current_date+30 FROM public.parliament_houses LIMIT 1;
 INSERT INTO public.parliament_members(user_id,house_id,term_start_date,term_end_date) SELECT '${people[2].id}',id,current_date,current_date+30 FROM public.parliament_houses ORDER BY id DESC LIMIT 1;
 INSERT INTO public.police_occurrences(id,type,title,details) VALUES('${occurrence}','denuncia','Ocorrência Fictícia','Fatos fictícios de domínio para validar o reset.');
 INSERT INTO public.criminal_investigations(id,occurrence_id,investigation_number,summary,delegate_id,created_by) VALUES('${investigation}','${occurrence}','QA-DOMAIN','Investigação Fictícia','${people[4].id}','${people[4].id}');
 INSERT INTO public.investigation_subjects(investigation_id,profile_id) VALUES('${investigation}','${people[7].id}');
 INSERT INTO public.criminal_cases(id,case_number,investigation_id,prosecutor_id,judge_id,title) VALUES('${caseId}','QA-DOMAIN','${investigation}','${people[6].id}','${people[3].id}','Processo Fictício');
 INSERT INTO public.judicial_decisions(id,case_id,decision_type,judge_id,summary,legal_reasoning,result) VALUES('${decision}','${caseId}','sentence','${people[3].id}','Condenação fictícia','Fundamentação fictícia para o teste','condenado');
 INSERT INTO public.sentences(id,case_id,decision_id,defendant_id,judge_id,sentence_type,base_sentence_units,final_sentence_units,real_duration_seconds,prison_regime) VALUES('${sentence}','${caseId}','${decision}','${people[7].id}','${people[3].id}','custodial',1,1,3600,'closed');
 INSERT INTO public.warrants(warrant_number,warrant_type,target_profile_id,case_id,issued_by,expires_at) VALUES('QA-DOMAIN','arrest','${people[7].id}','${caseId}','${people[3].id}',now()+interval '1 day');
 INSERT INTO public.prison_terms(sentence_id,inmate_id,facility_id,custody_status,security_level,original_duration_seconds,expected_release_at) SELECT '${sentence}','${people[7].id}',id,'serving','low',3600,now()+interval '1 hour' FROM public.prison_facilities LIMIT 1;
 INSERT INTO public.agies_missions(name,agent_id,target_kind,target_id) VALUES('Missão Fictícia','${people[5].id}','citizen','${people[7].id}');
 INSERT INTO public.government_projects(name,description,ministry,project_type,approved_budget,created_by,infrastructure_kind) VALUES('Obra Fictícia','Infraestrutura fictícia do universo anterior','Infraestrutura','infrastructure',1000,'${admins[1].id}','roads');
 INSERT INTO public.citizen_residences(id,owner_id,product_id,name,city,state,area_sqm,purchase_price) VALUES('${residence}','${people[7].id}','f2200000-0000-4000-8000-000000000001','Moradia Fictícia','Brasília','DF',24,750);
 INSERT INTO public.residence_leases(residence_id,tenant_id,landlord_id,price,period_days,max_periods,idempotency_key) VALUES('${residence}','${people[6].id}','${people[7].id}',30,7,10,gen_random_uuid());
 INSERT INTO public.user_services(user_id,service_type,plan_name,price) SELECT '${people[7].id}',s,'Plano Fictício',50 FROM unnest(ARRAY['Internet','Telefonia','Energia','Água','Gás','SNS'])s;
 INSERT INTO public.news_articles(author_id,title,content) VALUES('${admins[0].id}','Notícia Fictícia','Publicação do universo anterior para validar sua remoção.');
 SET LOCAL session_replication_role=origin;COMMIT;`);
const previous = sql(
  "SELECT id FROM private.rp_reset_requests WHERE scope='full_rp' AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
);
assert.equal(
  sql(
    `SELECT jsonb_array_length(private.validate_controlled_reset('${previous}') ->'orphans')`,
  ),
  "0",
  "As fixtures devem ser relacionalmente válidas antes do reset.",
);
const tables = [
  "cards",
  "card_invoices",
  "loan_applications",
  "loans",
  "user_investments",
  "political_parties",
  "party_members",
  "party_treasuries",
  "elections",
  "candidates",
  "votes",
  "government_terms",
  "ministers",
  "minister_invitations",
  "parliament_members",
  "police_occurrences",
  "criminal_investigations",
  "criminal_cases",
  "judicial_decisions",
  "sentences",
  "warrants",
  "prison_terms",
  "agies_missions",
  "government_projects",
  "citizen_residences",
  "residence_leases",
  "user_services",
  "news_articles",
  "businesses",
];
for (const table of tables)
  assert.ok(
    Number(sql(`SELECT count(*) FROM public.${table}`)) > 0,
    `Fixture obrigatória: ${table}`,
  );
const admin = createClient(e.API_URL, e.ANON_KEY, {
  global: { headers: { "x-govrp-world-generation": initial.generation_id } },
  auth: { persistSession: false, autoRefreshToken: false },
});
await check(admin.auth.signInWithPassword(admins[0]));
const baseline = {
  country_code: "BR",
  country_name: "Brasil",
  fetched_at: new Date().toISOString(),
  economy: {
    gdp: 2e12,
    growth: 2,
    inflation: 4,
    unemployment: 6,
    exchangeUsd: 5,
    exchangeEur: 6,
    gdpCurrency: "USD",
    referenceSources: ["QA fictício"],
    selic: 15,
  },
  demographics: { population: 2e8, area: 8e6 },
  politics: {},
  exchange_rates: { USD: 5, EUR: 6, GBP: 7, JPY: 0.04, CNY: 0.7 },
};
const plan = await check(
  admin.rpc("admin_prepare_rp_reset", {
    p_scope: "full_rp",
    p_country_snapshots: [baseline],
  }),
);
await check(
  admin.rpc("admin_start_controlled_reset", {
    p_request_id: plan.request_id,
    p_confirmation: "RESETAR GOVRP",
  }),
);
sql(
  "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname='govrp-controlled-reset-worker'",
);
const token = sql(
  `SELECT worker_token FROM private.rp_reset_requests WHERE id='${plan.request_id}'`,
);
for (let i = 0; i < 200; i++) {
  const r = await processResetWorker({
    client: service,
    requestId: plan.request_id,
    token,
    budgetMs: 4500,
  });
  if (r.failed)
    throw Error(
      sql(
        `SELECT last_error->>'message' FROM private.rp_reset_requests WHERE id='${plan.request_id}'`,
      ),
    );
  if (r.validated) break;
}
const final = await check(
  admin.rpc("admin_get_controlled_reset", { p_request_id: plan.request_id }),
);
assert.equal(final.status, "validated");
assert.equal(final.result.valid, true);
for (const table of tables)
  assert.equal(
    sql(`SELECT count(*) FROM public.${table}`),
    "0",
    `Domínio reiniciado: ${table}`,
  );
for (const person of [...admins, ...people]) {
  const c = createClient(e.API_URL, e.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await check(c.auth.signInWithPassword(person));
  assert.equal(
    await check(c.rpc("is_admin", { p_user_id: person.id })),
    admins.some((a) => a.id === person.id),
  );
}
writeFileSync(
  `${root}/qa-domain-result.json`,
  JSON.stringify({
    requestId: plan.request_id,
    tablesPopulatedAndCleared: tables,
    adminCases: [
      "principal",
      "presidente",
      "deputado",
      "empresario",
      "sem_personagem",
    ],
    commonRoles: roles,
    relationallyValidBeforeReset: true,
    validation: final.result,
  }),
  { mode: 0o600 },
);
console.log(
  `✓ ${tables.length} tabelas de todos os domínios povoadas e zeradas, inclusive Justiça/Prisão, eleições, governo, AGIES, faturas, empréstimos, imóveis e obras; cinco perfis Admin e oito comuns mantêm o acesso correto.`,
);
