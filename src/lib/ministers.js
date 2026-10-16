import { fetchPublicProfileRows } from './publicProfileQueries.js';
const unavailableProfile = (userId) => ({
  id: userId,
  full_name: 'Perfil indisponível',
});

export const fetchActiveMinistersWithProfiles = async (client) => {
  const { data: ministers, error } = await client
    .from('ministers')
    .select('*')
    .eq('status', 'active')
    .order('appointed_at', { ascending: false });

  if (error) {
    return { data: null, error, warning: null };
  }

  const profileIds = [...new Set((ministers || []).map((minister) => minister.user_id).filter(Boolean))];

  if (profileIds.length === 0) {
    return { data: [], error: null, warning: null };
  }

  let profilesById = new Map(), profilesError = null;
  try { profilesById = await fetchPublicProfileRows(profileIds, client); }
  catch (error) { profilesError = error; }

  return {
    data: ministers.map((minister) => ({
      ...minister,
      profile: profilesById.get(minister.user_id) || unavailableProfile(minister.user_id),
    })),
    error: null,
    warning: profilesError || null,
  };
};
