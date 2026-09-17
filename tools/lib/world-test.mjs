import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
export const local = Object.fromEntries(execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' }).split(/\r?\n/).filter(line => line.includes('=')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
if (new URL(local.API_URL).hostname !== '127.0.0.1') throw new Error('Testes exigem o Supabase local.');
export const clients = [];
export const service = createClient(local.API_URL, local.SECRET_KEY || local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
export async function request(promise) { const result = await promise; if (result.error) throw new Error(result.error.message, { cause: result.error }); return result.data; }
export const rpc = (client, name, args) => request(client.rpc(name, args));
export async function actor(label, role = 'Cidadão', extra = {}) {
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const email = `world-${label}-${suffix}@govrp.local`, password = `Govrp!${crypto.randomUUID()}Aa1`;
  const data = await request(service.auth.admin.createUser({ email, password, email_confirm: true }));
  const id = data.user.id;
  await request(service.from('profiles').upsert({ id, username: `world${suffix}`, x_handle: `world${suffix}`, x_username: `Teste ${label} ${suffix}`, full_name: `Teste ${label}`, role, manual_role_override: true, onboarding_completed: true, onboarding_step: 'completed', tutorial_dont_show_again: true, ...extra }));
  const client = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); clients.push(client);
  await request(client.auth.signInWithPassword({ email, password }));
  return { id, client, email, password, handle: `world${suffix}` };
}
export const subscribe = channel => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Realtime não conectou.')), 15000);
  channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(channel); } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) { clearTimeout(timeout); reject(new Error(status)); } });
});
export async function waitFor(check, label, timeout = 15000) {
  const start = Date.now();
  while (!await check()) { if (Date.now() - start > timeout) throw new Error(`Tempo esgotado: ${label}`); await new Promise(resolve => setTimeout(resolve, 100)); }
}
export const cleanup = () => Promise.all(clients.map(client => client.removeAllChannels()));

export async function ensureParliamentHouses() {
  await request(service.from('parliament_houses').upsert([{id:'a1b2c3d4-e5f6-7890-1234-567890abcdef',name:'Câmara dos Deputados'},{id:'fedcba09-8765-4321-0987-654321fedcba',name:'Senado Federal'}], {onConflict:'id',ignoreDuplicates:true}));
}
