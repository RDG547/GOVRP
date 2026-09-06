import { supabase } from './supabaseClient';

// Share subscriptions between consumers; authorization still belongs to RLS.
// Never retain payloads when the last consumer (or its authenticated scope) leaves.
const channels = new Map();
let sequence = 0;

export function subscribeToDomain(domain, scope, tables, listener) {
  const specs = tables.map((table) => typeof table === 'string' ? { table } : table);
  const key = JSON.stringify([domain, scope, specs]);
  let entry = channels.get(key);
  if (!entry) {
    entry = { listeners: new Set(), pending: [], timer: null, disposed: false };
    const emit = (payload) => {
      if (entry.disposed) return;
      entry.pending.push(payload);
      if (entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const changes = entry.pending.splice(0);
        entry.listeners.forEach((callback) => {
          try { Promise.resolve(callback(changes)).catch(error => console.warn(`Atualização de ${domain} indisponível:`, error?.message)); }
          catch (error) { console.warn(`Atualização de ${domain} indisponível:`, error?.message); }
        });
      }, 120);
    };
    entry.sync = () => emit({ eventType: 'SYNC' });
    const broadcast = specs.find(spec => spec.broadcast);
    let channel = supabase.channel(broadcast?.topic || `govrp:${domain}:${scope}:${++sequence}`);
    specs.forEach((spec) => {
      channel = spec.broadcast
        ? channel.on('broadcast', { event: spec.broadcast }, ({ payload }) => emit({ eventType: 'PUBLIC_PROFILE', new: payload }))
        : channel.on('postgres_changes', { event: '*', schema: 'public', ...spec }, emit);
    });
    entry.channel = channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') entry.sync();
    });
    entry.resume = () => {
      if (document.visibilityState === 'visible') entry.sync();
    };
    document.addEventListener('visibilitychange', entry.resume);
    window.addEventListener('online', entry.sync);
    channels.set(key, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size) return;
    entry.disposed = true;
    clearTimeout(entry.timer);
    entry.pending = [];
    document.removeEventListener('visibilitychange', entry.resume);
    window.removeEventListener('online', entry.sync);
    void supabase.removeChannel(entry.channel);
    channels.delete(key);
  };
}

export function invalidateDomain(domain, scope) {
  for (const [key, entry] of channels) {
    const [entryDomain, entryScope] = JSON.parse(key);
    if (entryDomain === domain && (scope === undefined || scope === entryScope)) entry.sync();
  }
}
