import { supabase } from './supabaseClient';

export const PUBLIC_PROFILE_FIELDS = 'id,citizen_id,full_name,username,avatar_url,role,titles,party_affiliation,x_username,x_handle,x_avatar_url';
export const unavailablePublicProfile = (id) => ({ id, full_name: 'Cidadão indisponível', username: '', avatar_url: '', role: 'Cidadão' });

export async function fetchPublicProfiles(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const groups = [];
  for (let i = 0; i < uniqueIds.length; i += 100) groups.push(uniqueIds.slice(i, i + 100));
  const results = await Promise.all(groups.map((group) => supabase.from('public_citizen_profiles').select(PUBLIC_PROFILE_FIELDS).in('id', group)));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return new Map(results.flatMap((result) => result.data || []).map((profile) => [profile.id, { ...profile, full_name: profile.full_name || profile.username || 'Cidadão indisponível' }]));
}
