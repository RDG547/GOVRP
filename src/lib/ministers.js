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

  const { data: profiles, error: profilesError } = await client
    .from('profiles')
    .select('id, full_name')
    .in('id', profileIds);

  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));

  return {
    data: ministers.map((minister) => ({
      ...minister,
      profile: profilesById.get(minister.user_id) || unavailableProfile(minister.user_id),
    })),
    error: null,
    warning: profilesError || null,
  };
};
