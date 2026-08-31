let inFlightSync = null;
let lastCompletedSyncAt = 0;
let lastSyncResult = null;

const MIN_SYNC_INTERVAL_MS = 30 * 1000;
export const ELECTION_OFFICE_SYNC_SETTINGS_KEY = 'election_office_sync';

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

export const syncElectionOffices = async ({ force = false, accessToken = '' } = {}) => {
  const now = Date.now();

  if (!force && inFlightSync) {
    return inFlightSync;
  }

  if (!force && lastSyncResult && now - lastCompletedSyncAt < MIN_SYNC_INTERVAL_MS) {
    return lastSyncResult;
  }

  inFlightSync = fetch('/api/elections/sync-offices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || 'Não foi possível sincronizar os cargos eleitorais.');
      }

      lastSyncResult = payload;
      lastCompletedSyncAt = Date.now();
      return payload;
    })
    .catch((error) => {
      console.error('Error syncing election offices:', error);
      throw error;
    })
    .finally(() => {
      inFlightSync = null;
    });

  return inFlightSync;
};

export const fetchElectionOfficeSyncState = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', ELECTION_OFFICE_SYNC_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.value || {};
};

export const resolveActiveElectionOfficeRolesForUser = (syncState, userId) => {
  if (!userId) {
    return [];
  }

  const activeAssignments = Array.isArray(syncState?.active_assignments)
    ? syncState.active_assignments
    : [];

  return dedupe(
    activeAssignments
      .filter((assignment) => {
        if (assignment?.user_id !== userId || !assignment?.office_role) {
          return false;
        }

        if (!assignment.term_end_at) {
          return true;
        }

        return new Date(assignment.term_end_at).getTime() > Date.now();
      })
      .map((assignment) => assignment.office_role)
  );
};
