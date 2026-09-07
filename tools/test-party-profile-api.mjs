import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.includes('=')).map(line => {
  const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"|"$/g, '')];
}));
assert.equal(new URL(local.API_URL).hostname, '127.0.0.1', 'Somente ambiente local isolado.');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, options);
const visitor = createClient(local.API_URL, local.ANON_KEY, options);
const citizen = createClient(local.API_URL, local.ANON_KEY, options);
const actors = [];
const partyId = crypto.randomUUID();
const output = fileURLToPath(new URL(`./.party-api-${process.pid}.cjs`, import.meta.url));
const request = async promise => { const result = await promise; if (result.error) throw result.error; return result.data; };
let checks = 0;
const check = (label, value) => { assert(value, label); checks++; console.log(`✓ ${label}`); };
async function actor(legacy) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const email = `party-api-${suffix}@govrp.local`, password = `Govrp!${crypto.randomUUID()}Aa1`;
  const { user } = await request(service.auth.admin.createUser({ email, password, email_confirm: true }));
  actors.push(user.id);
  await request(service.from('profiles').upsert({ id: user.id, username: `party${suffix}`, full_name: legacy ? 'Fundador legado do RP' : 'Cidadão atual do RP', onboarding_completed: !legacy, onboarding_mode: legacy ? 'legacy_migration' : 'standard', onboarding_step: legacy ? 'identity' : 'completed' }));
  return { id: user.id, email, password };
}
try {
  // Bundle the real frontend loaders, injecting only their Supabase client.
  await build({
    stdin: { contents: "export { fetchPublicParties } from './src/lib/parties.js'; export { fetchPublicProfiles } from './src/lib/publicProfiles.js';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'client-injection', setup(builder) {
      builder.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'client', namespace: 'injected' }));
      builder.onLoad({ filter: /.*/, namespace: 'injected' }, () => ({ contents: 'export const supabase = null;', loader: 'js' }));
    } }],
  });
  const { fetchPublicParties, fetchPublicProfiles } = createRequire(import.meta.url)(output);
  const legacy = await actor(true), current = await actor(false);
  await request(citizen.auth.signInWithPassword({ email: current.email, password: current.password }));
  await request(service.from('political_parties').insert({ id: partyId, name: 'Partido de teste de API', acronym: `T${partyId.slice(0, 5)}`, founder_id: legacy.id, owner_id: legacy.id, president_id: legacy.id, vice_president_id: null, registration_number: `API-${partyId}`, status: 'active' }));
  await request(service.from('party_members').upsert([{ party_id: partyId, user_id: legacy.id, role: 'Presidente' }, { party_id: partyId, user_id: current.id, role: 'Membro' }], { onConflict: 'party_id,user_id' }));
  for (const [label, client] of [['visitante', visitor], ['cidadão autenticado', citizen]]) {
    const [party] = await fetchPublicParties(partyId, client);
    check(`${label}: card, modal e detalhes recebem nomes do dono, fundador e presidente`, ['owner', 'founder', 'president'].every(field => party[field]?.full_name === 'Fundador legado do RP'));
    check(`${label}: cargo sem ocupante permanece vago`, party.vice_president === null && party.vice_president_id === null);
    check(`${label}: membros legados e atuais recebem o perfil correto`, party.members.length === 2 && party.members.every(member => member.profile.full_name === (member.user_id === legacy.id ? 'Fundador legado do RP' : 'Cidadão atual do RP')));
    const list = await fetchPublicParties(undefined, client);
    check(`${label}: listagem e detalhe usam a mesma identidade`, list.find(item => item.id === partyId)?.owner.full_name === party.owner.full_name);
    const forbidden = await client.rpc('get_public_party_profiles', { p_ids: [legacy.id] }).select('email');
    check(`${label}: API não permite ampliar a projeção para e-mail`, Boolean(forbidden.error));
  }
  const ids = [...Array.from({ length: 104 }, () => crypto.randomUUID()), legacy.id, legacy.id, null];
  const batch = await fetchPublicProfiles(ids, citizen);
  check('carregamento distribui mais de 100 IDs sem perder membros nem duplicar perfis', batch.size === 1 && batch.get(legacy.id)?.full_name === 'Fundador legado do RP');
  await request(service.from('profiles').update({ full_name: 'Nome partidário atualizado' }).eq('id', legacy.id));
  const [updated] = await fetchPublicParties(partyId, citizen);
  check('nova consulta recebe alteração do nome legado', updated.owner.full_name === 'Nome partidário atualizado');
  await request(service.from('profiles').update({ deleted_at: new Date().toISOString() }).eq('id', legacy.id));
  const [deleted] = await fetchPublicParties(partyId, citizen);
  check('perfil excluído usa indisponível e não recupera nome antigo', deleted.owner.full_name === 'Cidadão indisponível');
  console.log(`\n${checks} verificações dos carregadores reais pela API local aprovadas.`);
} finally {
  rmSync(output, { force: true });
  await request(service.from('political_parties').delete().eq('id', partyId));
  for (const id of actors) await request(service.auth.admin.deleteUser(id));
  await citizen.auth.signOut();
}
