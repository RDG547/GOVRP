import { supabase } from './supabaseClient';
import { fetchPublicProfileRows } from './publicProfileQueries.js';
export { PUBLIC_PROFILE_FIELDS, unavailablePublicProfile } from './publicProfileQueries.js';
export const fetchPublicProfiles = (ids, client = supabase) => fetchPublicProfileRows(ids, client);
