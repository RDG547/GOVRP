export const PUBLIC_PROFILE_FIELDS = 'id,citizen_id,full_name,username,avatar_url,role,titles,party_affiliation,x_username,x_handle,x_avatar_url';
export const unavailablePublicProfile = (id) => ({ id, full_name: 'Cidadão indisponível', username: '', avatar_url: '', role: 'Cidadão' });

// Share concurrent reads of the same profile IDs between widgets in a tab.
// This cache holds only in-flight promises (not stale profile data), so every
// later Realtime update still fetches fresh values without requiring F5.
const profileRequestsInFlight = new WeakMap();

const fetchProfileGroup = (client, ids) => {
  let requests = profileRequestsInFlight.get(client);
  if (!requests) {
    requests = new Map();
    profileRequestsInFlight.set(client, requests);
  }
  const key = [...ids].sort().join(',');
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = Promise.resolve(client.rpc('get_public_party_profiles', { p_ids: ids }).select(PUBLIC_PROFILE_FIELDS));
  requests.set(key, pending);
  void pending.finally(() => {
    if (requests.get(key) === pending) requests.delete(key);
  }).catch(() => {});
  return pending;
};

export async function fetchPublicProfileRows(ids, client) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const groups = [];
  for (let i = 0; i < uniqueIds.length; i += 100) groups.push(uniqueIds.slice(i, i + 100));
  const results = await Promise.all(groups.map((group) => fetchProfileGroup(client, group)));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return new Map(results.flatMap((result) => result.data || []).map((profile) => [profile.id, { ...profile, full_name: profile.full_name || profile.username || 'Cidadão indisponível' }]));
}

export async function fetchCitizenDirectory(client) {
  if (!client) client = (await import('@/lib/supabaseClient')).supabase;
  const data = [];
  for (let offset = 0; ; offset += 100) {
    const result = await client.rpc('search_citizens', { p_limit: 100, p_offset: offset });
    if (result.error) return { data: null, error: result.error };
    data.push(...(result.data || []));
    if (data.length >= Number(result.data?.[0]?.total_count || 0) || !result.data?.length) break;
  }
  return { data, error: null };
}
