import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1).trim().replace(/^"|"$/g, '')];
  }));
if (!env.API_URL?.includes('127.0.0.1')) throw new Error('Este teste só pode executar no Supabase local.');

const service = createClient(env.API_URL, env.SECRET_KEY || env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const checks = [];
const assert = (condition, label) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const createActor = async (label, role) => {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `ux-${label}-${suffix}@govrp.local`;
  const password = `Govrp!${crypto.randomUUID()}Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  const profile = await service.from('profiles').upsert({
    id, username: `${label}${suffix}`, full_name: `Teste ${label}`, role,
    onboarding_completed: true, onboarding_step: 'completed',
  }, { onConflict: 'id' });
  if (profile.error) throw profile.error;
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  return { id, client };
};

const [admin, citizen] = await Promise.all([
  createActor('adminux', 'Admin'),
  createActor('citizenux', 'Cidadão'),
]);

const createdTicket = await citizen.client.rpc('create_support_ticket', {
  p_requester_name: 'Cidadão de Teste',
  p_requester_email: 'cidadao.teste@govrp.local',
  p_requester_phone: '+5511999999999',
  p_request_type: 'support',
  p_subject: 'Validação da exclusão lógica',
  p_message: 'Mensagem suficiente para validar o histórico de suporte.',
  p_attachment_path: null,
});
if (createdTicket.error) throw createdTicket.error;
const ticketId = createdTicket.data.ticket_id;

const citizenBefore = await citizen.client.from('support_tickets').select('id,deleted_at').eq('id', ticketId).single();
if (citizenBefore.error) throw citizenBefore.error;
assert(citizenBefore.data.id === ticketId && citizenBefore.data.deleted_at === null, 'cidadão visualiza o próprio ticket ativo');

const forbiddenArchive = await citizen.client.rpc('admin_archive_support_ticket', { p_ticket_id: ticketId, p_reason: 'Tentativa indevida' });
assert(Boolean(forbiddenArchive.error), 'cidadão não pode excluir ticket pela ação administrativa');

const archived = await admin.client.rpc('admin_archive_support_ticket', {
  p_ticket_id: ticketId,
  p_reason: 'Encerramento controlado pelo teste funcional.',
});
if (archived.error) throw archived.error;
assert(archived.data.success === true, 'Admin exclui logicamente o ticket com confirmação autoritativa');

const [citizenAfter, adminAfter, audit] = await Promise.all([
  citizen.client.from('support_tickets').select('id').eq('id', ticketId),
  admin.client.from('support_tickets').select('id,deleted_at,deleted_by,deletion_reason').eq('id', ticketId).single(),
  service.from('security_audit_log').select('actor_id,action').eq('target_id', ticketId).eq('action', 'support_ticket_archived').single(),
]);
if (adminAfter.error || audit.error) throw adminAfter.error || audit.error;
assert(citizenAfter.data.length === 0, 'ticket excluído deixa de aparecer para o cidadão');
assert(adminAfter.data.deleted_at && adminAfter.data.deleted_by === admin.id && adminAfter.data.deletion_reason, 'registro preserva autor, data e motivo da exclusão');
assert(audit.data.actor_id === admin.id, 'exclusão mantém trilha administrativa protegida');

const replyAfterArchive = await citizen.client.rpc('reply_to_support_ticket', {
  p_ticket_id: ticketId, p_message: 'Tentativa posterior', p_attachment_path: null,
});
assert(Boolean(replyAfterArchive.error), 'ticket excluído não aceita novas mensagens');
const manageAfterArchive = await admin.client.rpc('admin_manage_support_ticket', {
  p_ticket_id: ticketId, p_status: 'open', p_priority: 'urgent', p_assigned_to: admin.id,
});
assert(Boolean(manageAfterArchive.error), 'ticket excluído não pode voltar silenciosamente à fila');

await service.from('support_tickets').delete().eq('id', ticketId);
await Promise.all([service.auth.admin.deleteUser(admin.id), service.auth.admin.deleteUser(citizen.id)]);

process.stdout.write(`✓ ${checks.length} testes reais dos refinamentos de suporte concluídos.\n`);
