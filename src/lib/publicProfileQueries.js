export const PUBLIC_PROFILE_FIELDS = 'id,citizen_id,full_name,username,avatar_url,role,titles,party_affiliation,x_username,x_handle,x_avatar_url';
export const unavailablePublicProfile = (id) => ({ id, full_name: 'Cidadão indisponível', username: '', avatar_url: '', role: 'Cidadão' });

export async function fetchPublicProfileRows(ids, client) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const groups = [];
  for (let i = 0; i < uniqueIds.length; i += 100) groups.push(uniqueIds.slice(i, i + 100));
  const results = await Promise.all(groups.map((group) => client.rpc('get_public_party_profiles', { p_ids: group }).select(PUBLIC_PROFILE_FIELDS)));
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
