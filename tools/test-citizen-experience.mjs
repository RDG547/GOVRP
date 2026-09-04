import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';

const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
  }));
if (!local.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');
process.env.VITE_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SECRET_KEY = local.SECRET_KEY || local.SERVICE_ROLE_KEY;
const { citizenAvatarHandler } = await import('../server/citizens/avatar.js');

const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false } });
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const invokeAvatarApi = async ({ method, accessToken, body, contentType = 'application/json' }) => {
  const request = Readable.from(body ? [body] : []);
  request.method = method;
  request.headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': contentType,
  };
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload = '') { this.body = payload; },
  };
  await citizenAvatarHandler(request, response);
  return {
    status: response.statusCode,
    data: response.body ? JSON.parse(response.body) : {},
  };
};

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const email = `citizen-${suffix}@govrp.local`;
const password = `Govrp!${crypto.randomUUID()}Aa1`;
const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const userId = created.data.user.id;
const initialProfile = await service.from('profiles').upsert({
  id: userId,
  username: `u_${suffix}`,
  full_name: 'Cidadão em criação',
  role: 'Cidadão',
  onboarding_completed: false,
  onboarding_step: 'welcome',
  onboarding_version: 2,
  onboarding_mode: 'standard',
  username_is_generated: true,
}, { onConflict: 'id' });
if (initialProfile.error) throw initialProfile.error;
const client = createClient(local.API_URL, local.ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const login = await client.auth.signInWithPassword({ email, password });
if (login.error) throw login.error;
const accessToken = login.data.session.access_token;

const privateIdentity = await client.rpc('update_my_account_identity', {
  p_real_full_name: 'Pessoa Real de Validação',
  p_real_date_of_birth: '1990-05-12',
  p_phone: '11987654321',
  p_phone_country_code: '+55',
});
if (privateIdentity.error) throw privateIdentity.error;
assert(privateIdentity.data.real_full_name === 'Pessoa Real de Validação', 'dados reais ficam registrados na área privada da conta');

const start = await client.rpc('start_citizen_onboarding');
if (start.error) throw start.error;
assert(start.data.onboarding_step === 'identity', 'conta completa inicia a criação do personagem');

const prematureFinish = await client.rpc('finalize_citizen_onboarding');
assert(Boolean(prematureFinish.error), 'cidadania incompleta não pode ser finalizada');

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const uploaded = await invokeAvatarApi({ method: 'POST', accessToken, body: png, contentType: 'image/png' });
if (uploaded.status !== 201) throw new Error(uploaded.data.error || 'Upload de teste falhou.');
const uploadedPath = uploaded.data.path;
const uploadedUrl = uploaded.data.publicUrl;
assert(uploadedUrl.includes('/storage/v1/object/public/avatars/'), 'foto própria é enviada para a pasta segura do cidadão');

const invalidIdentity = await client.rpc('save_citizen_identity', {
  p_full_name: 'Marina 123 Horizonte',
  p_username: `Marina.${suffix}`,
  p_date_of_birth: '2001-09-07',
  p_character_bio: null,
  p_avatar_url: uploadedUrl,
  p_character_gender: 'female',
});
assert(Boolean(invalidIdentity.error), 'nome civil rejeita números e símbolos incompatíveis');

const identity = await client.rpc('save_citizen_identity', {
  p_full_name: 'Marina Horizonte',
  p_username: `Marina.${suffix}`,
  p_date_of_birth: '2001-09-07',
  p_character_bio: 'Personagem criado para validar a experiência completa de cidadania.',
  p_avatar_url: uploadedUrl,
  p_character_gender: 'female',
});
if (identity.error) throw identity.error;
assert(identity.data.character_gender === 'female' && identity.data.avatar_url === uploadedUrl, 'sexo e foto do personagem persistem juntos');
assert(identity.data.username === `Marina.${suffix}`, 'nome de usuário preserva maiúsculas e minúsculas escolhidas');

const directGenderChange = await client.from('profiles').update({ character_gender: 'male' }).eq('id', userId);
assert(Boolean(directGenderChange.error), 'campo oficial do personagem não pode ser adulterado diretamente');

const origin = await client.rpc('save_citizen_origin', {
  p_birth_state_code: 'SP',
  p_birth_city_code: '3550308',
  p_birth_city_name: 'São Paulo',
  p_residence_state_code: 'RJ',
  p_residence_city_code: '3304557',
  p_residence_city_name: 'Rio de Janeiro',
});
if (origin.error) throw origin.error;
const aspiration = await client.rpc('save_citizen_aspiration', { p_initial_aspiration: 'communication' });
if (aspiration.error) throw aspiration.error;

for (const type of ['CPF', 'RG', 'Título de Eleitor', 'CTD']) {
  const issued = await client.rpc('issue_citizen_onboarding_document', { p_document_type: type });
  if (issued.error) throw issued.error;
  assert(issued.data.created === true, `${type} é emitido a partir dos dados oficiais`);
}

const bank = await client.rpc('ensure_citizen_bank_account');
if (bank.error) throw bank.error;
assert(bank.data.created === true && Number(bank.data.account.balance) === 1000, 'conta bancária inicial é criada uma única vez');
const objectivesBeforeTransfer = await client.rpc('refresh_my_citizen_objectives');
if (objectivesBeforeTransfer.error) throw objectivesBeforeTransfer.error;
const firstTransferBefore = objectivesBeforeTransfer.data.find((objective) => objective.objective_key === 'first_bank_transfer');
assert(firstTransferBefore && Number(firstTransferBefore.progress) === 0, 'saldo automático do onboarding não conclui a primeira movimentação');

// Simula voltar à etapa de identidade, trocar a imagem e continuar sem criar
// documentos ou conta duplicados.
const providedAvatar = `https://api.dicebear.com/7.x/adventurer/svg?seed=govrp-female-${suffix}`;
const editedIdentity = await client.rpc('save_citizen_identity', {
  p_full_name: 'Marina Horizonte',
  p_username: `Marina.${suffix}`,
  p_date_of_birth: '2001-09-07',
  p_character_bio: 'Biografia revisada ao voltar uma etapa antes da conclusão.',
  p_avatar_url: providedAvatar,
  p_character_gender: 'female',
});
if (editedIdentity.error) throw editedIdentity.error;
assert(editedIdentity.data.onboarding_step === 'origin' && editedIdentity.data.avatar_url === providedAvatar, 'voltar permite editar e substituir a foto imediatamente');
const removeUpload = await invokeAvatarApi({
  method: 'DELETE',
  accessToken,
  body: Buffer.from(JSON.stringify({ path: uploadedPath })),
});
if (removeUpload.status !== 200) throw new Error(removeUpload.data.error || 'Remoção de teste falhou.');
const remainingUpload = await service.storage.from('avatars').list(userId);
if (remainingUpload.error) throw remainingUpload.error;
assert(!remainingUpload.data.some((file) => file.name === uploadedPath.split('/').at(-1)), 'troca para avatar fornecido remove o upload anterior');

for (const call of [
  client.rpc('save_citizen_origin', {
    p_birth_state_code: 'SP', p_birth_city_code: '3550308', p_birth_city_name: 'São Paulo',
    p_residence_state_code: 'RJ', p_residence_city_code: '3304557', p_residence_city_name: 'Rio de Janeiro',
  }),
]) {
  const result = await call;
  if (result.error) throw result.error;
}
const aspirationAgain = await client.rpc('save_citizen_aspiration', { p_initial_aspiration: 'communication' });
if (aspirationAgain.error) throw aspirationAgain.error;
for (const type of ['CPF', 'RG', 'Título de Eleitor', 'CTD']) {
  const existing = await client.rpc('issue_citizen_onboarding_document', { p_document_type: type });
  if (existing.error) throw existing.error;
  assert(existing.data.created === false, `${type} é preservado ao continuar novamente`);
}
const existingBank = await client.rpc('ensure_citizen_bank_account');
if (existingBank.error) throw existingBank.error;
assert(existingBank.data.created === false && existingBank.data.account.id === bank.data.account.id, 'conta existente é preservada ao refazer etapas');

const finish = await client.rpc('finalize_citizen_onboarding');
if (finish.error) throw finish.error;
assert(finish.data.profile.onboarding_completed && finish.data.profile.onboarding_step === 'completed', 'fluxo completo concede a cidadania');
assert(finish.data.profile.avatar_url === providedAvatar && finish.data.profile.character_gender === 'female', 'foto e sexo continuam corretos depois da conclusão');

const [documents, accounts, lifecycle, publicProfile, privateAfter] = await Promise.all([
  service.from('documents').select('type').eq('user_id', userId).eq('is_valid', true),
  service.from('accounts').select('id').eq('user_id', userId),
  service.from('citizen_lifecycle_events').select('event_type').eq('user_id', userId),
  anon.from('public_citizen_profiles').select('full_name,avatar_url,citizenship_created_at').eq('id', userId).single(),
  client.rpc('get_my_account_identity'),
]);
for (const result of [documents, accounts, lifecycle, publicProfile, privateAfter]) if (result.error) throw result.error;
assert(new Set(documents.data.map((document) => document.type)).size === 4 && accounts.data.length === 1, 'documentos e conta não são duplicados');
assert(lifecycle.data.some((event) => event.event_type === 'citizenship_granted'), 'concessão fica registrada no histórico do cidadão');
assert(publicProfile.data.full_name === 'Marina Horizonte' && !('real_full_name' in publicProfile.data), 'perfil público não expõe a identidade real da conta');
assert(privateAfter.data[0].real_full_name === 'Pessoa Real de Validação', 'identidade real permanece separada após a cidadania');

const editAfterFinish = await client.rpc('save_citizen_identity', {
  p_full_name: 'Nome Indevido', p_username: `indevido.${suffix}`, p_date_of_birth: '2000-01-01',
  p_character_bio: null, p_avatar_url: null, p_character_gender: 'male',
});
assert(Boolean(editAfterFinish.error), 'identidade oficial concluída não é reaberta por RPC de onboarding');

const recipientSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8);
const recipientCreated = await service.auth.admin.createUser({
  email: `citizen-recipient-${recipientSuffix}@govrp.local`,
  password: `Govrp!${crypto.randomUUID()}Aa1`,
  email_confirm: true,
});
if (recipientCreated.error) throw recipientCreated.error;
const recipientId = recipientCreated.data.user.id;
const recipientProfile = await service.from('profiles').upsert({
  id: recipientId,
  username: `recipient.${recipientSuffix}`,
  full_name: 'Destinatário de Validação',
  role: 'Cidadão',
  onboarding_completed: true,
  onboarding_step: 'completed',
}, { onConflict: 'id' });
if (recipientProfile.error) throw recipientProfile.error;
const recipientAccount = await service.from('accounts').insert({
  user_id: recipientId,
  agency_number: '0001',
  account_number: `${Date.now()}${recipientSuffix}`.slice(0, 18),
  balance: 0,
}).select('id').single();
if (recipientAccount.error) throw recipientAccount.error;
const voluntaryTransfer = await client.rpc('execute_transfer', {
  p_sender_id: userId,
  p_recipient_id: recipientId,
  p_amount: 10,
  p_description: 'Primeira movimentação voluntária',
  p_idempotency_key: crypto.randomUUID(),
});
if (voluntaryTransfer.error) throw voluntaryTransfer.error;
const objectivesAfterTransfer = await client.rpc('refresh_my_citizen_objectives');
if (objectivesAfterTransfer.error) throw objectivesAfterTransfer.error;
const firstTransferAfter = objectivesAfterTransfer.data.find((objective) => objective.objective_key === 'first_bank_transfer');
assert(Number(firstTransferAfter.progress) === 1 && firstTransferAfter.completed_at, 'movimentação iniciada pelo cidadão conclui o objetivo correto');

const constitution = await anon.rpc('get_country_constitution', { p_country_code: 'BR' });
if (constitution.error) throw constitution.error;
const articleCount = constitution.data.sections.reduce((total, section) => total + section.articles.length, 0);
assert(constitution.data.version === '1.0' && articleCount === 15, 'Constituição pública vem da versão persistida no banco');

process.stdout.write(`✓ ${checks.length} testes reais da experiência de cidadania concluídos.\n`);
