import { supabase } from './supabaseClient';
import { fetchPublicProfiles, unavailablePublicProfile } from './publicProfiles';

export const PARTY_REALTIME_TABLES = ['political_parties', 'party_members', 'party_affiliation_requests', 'bill_suggestions'];

export async function fetchPublicParties(partyId) {
  let query = supabase.from('political_parties').select('*,members:party_members(id,user_id,role,joined_at)').order('created_at');
  if (partyId) query = query.eq('id', partyId);
  const { data, error } = await query;
  if (error) throw error;
  const fields = ['founder', 'owner', 'president', 'vice_president'];
  const profiles = await fetchPublicProfiles((data || []).flatMap((party) => [
    ...fields.map((field) => party[`${field}_id`]), ...(party.members || []).map((member) => member.user_id),
  ]));
  return (data || []).map((party) => ({
    ...party,
    ...Object.fromEntries(fields.map((field) => [field, party[`${field}_id`] ? profiles.get(party[`${field}_id`]) || unavailablePublicProfile(party[`${field}_id`]) : null])),
    members: (party.members || []).map((member) => ({ ...member, profile: profiles.get(member.user_id) || unavailablePublicProfile(member.user_id) })),
  }));
}
