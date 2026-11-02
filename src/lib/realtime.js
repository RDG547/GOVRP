import { supabase } from './supabaseClient';

// Share subscriptions between consumers; authorization still belongs to RLS.
// Never retain payloads when the last consumer (or its authenticated scope) leaves.
const channels = new Map();
let sequence = 0;
// Keep live subscriptions, but avoid a burst of database reads for each change.
const REALTIME_BATCH_MS = 800;
const PRIORITY_BATCH_MS = 120;
const PRIORITY_DOMAINS = new Set(['role-notifications', 'my-invitations', 'notification-feed']);

export function subscribeToDomain(domain, scope, tables, listener) {
  const specs = tables.map((table) => typeof table === 'string' ? { table } : table);
  const key = JSON.stringify([domain, scope, specs]);
  let entry = channels.get(key);
  if (!entry) {
    entry = { listeners: new Set(), pending: [], timer: null, disposed: false, dirtyWhileHidden: false, disconnected: false };
    const emit = (payload) => {
      if (entry.disposed) return;
      // Background tabs still receive websocket events, but read fresh data only
      // when foregrounded. This reduces duplicated work across open accounts.
      if (document.visibilityState === 'hidden') {
        entry.dirtyWhileHidden = true;
        return;
      }
      entry.pending.push(payload);
      if (entry.timer) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (entry.disposed) return;
        if (document.visibilityState === 'hidden') {
          entry.pending = [];
          entry.dirtyWhileHidden = true;
          return;
        }
        const changes = entry.pending.splice(0);
        entry.listeners.forEach((callback) => {
          try { Promise.resolve(callback(changes)).catch(error => console.warn(`Atualização de ${domain} indisponível:`, error?.message)); }
          catch (error) { console.warn(`Atualização de ${domain} indisponível:`, error?.message); }
        });
      }, PRIORITY_DOMAINS.has(domain) ? PRIORITY_BATCH_MS : REALTIME_BATCH_MS);
    };
    entry.sync = () => emit({ eventType: 'SYNC' });
    const broadcast = specs.find(spec => spec.broadcast);
    let channel = supabase.channel(broadcast?.topic || `govrp:${domain}:${scope}:${++sequence}`);
    specs.forEach((spec) => {
      channel = spec.broadcast
        ? channel.on('broadcast', { event: spec.broadcast }, ({ payload }) => emit({ eventType: 'PUBLIC_PROFILE', new: payload }))
        : channel.on('postgres_changes', { event: '*', schema: 'public', ...spec }, emit);
    });
    entry.channel = channel.subscribe((status, error) => {
      if (entry.disposed) return;
      if (status === 'SUBSCRIBED') {
        entry.disconnected = false;
        // A reconnect might have missed database events: recover once from
        // the authoritative state, not with an endless polling loop.
        entry.sync();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        entry.disconnected = true;
        entry.dirtyWhileHidden = true;
        if (status !== 'CLOSED') console.warn(`Realtime ${domain}: ${status}`, error?.message || 'Tentaremos sincronizar na reconexão.');
      }
    });
    entry.resume = () => {
      if (document.visibilityState !== 'visible' || !entry.dirtyWhileHidden || entry.disconnected) return;
      entry.dirtyWhileHidden = false;
      entry.sync();
    };
    entry.onOnline = () => {
      // When the websocket resumes it will emit SUBSCRIBED. Do not duplicate
      // that recovery fetch with a separate online-event refresh.
      entry.dirtyWhileHidden = true;
      entry.resume();
    };
    document.addEventListener('visibilitychange', entry.resume);
    window.addEventListener('online', entry.onOnline);
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
    window.removeEventListener('online', entry.onOnline);
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
