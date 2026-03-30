import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const TRACKED_OFFICE_ROLES = ['Presidente', 'Vice-Presidente', 'Deputado', 'Senador'];
const OFFICE_LABELS = {
  Presidente: 'Presidente da República',
  'Vice-Presidente': 'Vice-Presidente da República',
  Deputado: 'Deputado Federal',
  Senador: 'Senador',
};
const OFFICE_LINKS = {
  Presidente: '/dashboard',
  'Vice-Presidente': '/dashboard',
  Deputado: '/services/parliament',
  Senador: '/services/parliament',
};
const PARLIAMENT_HOUSE_IDS = {
  Deputado: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  Senador: 'fedcba09-8765-4321-0987-654321fedcba',
};
const EXECUTIVE_GOVERNANCE_SETTINGS_KEY = 'executive_governance';
const ELECTION_OFFICE_SYNC_SETTINGS_KEY = 'election_office_sync';

let serverSupabase;

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

const handleOptions = (request, response) => {
  if (request.method !== 'OPTIONS') {
    return false;
  }

  response.statusCode = 204;
  response.end();
  return true;
};

const ensureMethod = (request, response, expectedMethod) => {
  if (handleOptions(request, response)) {
    return false;
  }

  if (request.method !== expectedMethod) {
    response.setHeader('Allow', `${expectedMethod}, OPTIONS`);
    json(response, 405, { error: 'Método não permitido.' });
    return false;
  }

  return true;
};

const getRequiredServerEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`A variável ${name} não foi configurada no servidor.`);
  }

  return value;
};

const getServerSupabase = () => {
  if (!serverSupabase) {
    serverSupabase = createClient(
      getRequiredServerEnv('VITE_SUPABASE_URL'),
      getRequiredServerEnv('SUPABASE_SECRET_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return serverSupabase;
};

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];
const toDateOnly = (value) => (typeof value === 'string' ? value.slice(0, 10) : '');

const addOneMonth = (dateValue) => {
  const date = new Date(dateValue);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
};

const isTermActive = (termEndAt) => {
  if (!termEndAt) {
    return false;
  }

  return new Date(termEndAt).getTime() > Date.now();
};

const addAssignment = (assignmentsMap, userId, assignment) => {
  if (!userId) {
    return;
  }

  if (!assignmentsMap.has(userId)) {
    assignmentsMap.set(userId, []);
  }

  assignmentsMap.get(userId).push(assignment);
};

const fetchLatestFinishedElections = async (supabase) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('elections')
    .select('id, name, voting_end_date, election_type_id, election_types(id, name, voting_system, requires_vice_candidate)')
    .lte('voting_end_date', nowIso)
    .order('voting_end_date', { ascending: false });

  if (error) {
    throw error;
  }

  const latestByType = new Map();

  for (const election of data || []) {
    if (latestByType.has(election.election_type_id)) {
      continue;
    }

    latestByType.set(election.election_type_id, election);
  }

  return [...latestByType.values()];
};

const fetchApprovedCandidates = async (supabase, electionId) => {
  const { data, error } = await supabase
    .from('candidates')
    .select('id, user_id, vice_candidate_id, status')
    .eq('election_id', electionId)
    .eq('status', 'Approved');

  if (error) {
    throw error;
  }

  return data || [];
};

const fetchElectionResults = async (supabase, electionId) => {
  const { data, error } = await supabase.rpc('get_election_results', {
    p_election_id: electionId,
  });

  if (error) {
    throw error;
  }

  return data || [];
};

const resolveElectionAssignments = async (supabase, election) => {
  const electionType = election.election_types;
  const officeRole = electionType?.name;
  const termStartAt = election.voting_end_date;
  const termEndAt = addOneMonth(termStartAt);
  const termActive = isTermActive(termEndAt);
  const approvedCandidates = await fetchApprovedCandidates(supabase, election.id);
  const results = await fetchElectionResults(supabase, election.id);
  const candidateMap = approvedCandidates.reduce((accumulator, candidate) => {
    accumulator[candidate.id] = candidate;
    return accumulator;
  }, {});
  const impactedProfileIds = dedupe(
    approvedCandidates.flatMap((candidate) => [candidate.user_id, candidate.vice_candidate_id])
  );

  if (!officeRole || !TRACKED_OFFICE_ROLES.includes(officeRole)) {
    return {
      electionId: election.id,
      officeRole,
      termStartAt,
      termEndAt,
      termActive,
      impactedProfileIds,
      assignments: [],
      status: 'unsupported',
    };
  }

  if (!results.length) {
    return {
      electionId: election.id,
      officeRole,
      termStartAt,
      termEndAt,
      termActive,
      impactedProfileIds,
      assignments: [],
      status: 'no_votes',
    };
  }

  if (electionType?.voting_system === 'majoritarian') {
    const sortedResults = [...results].sort(
      (left, right) => Number(right.vote_count || 0) - Number(left.vote_count || 0)
    );
    const topVoteCount = Number(sortedResults[0]?.vote_count || 0);

    if (topVoteCount <= 0) {
      return {
        electionId: election.id,
        officeRole,
        termStartAt,
        termEndAt,
        termActive,
        impactedProfileIds,
        assignments: [],
        status: 'no_votes',
      };
    }

    const tiedLeaders = sortedResults.filter(
      (result) => Number(result.vote_count || 0) === topVoteCount
    );

    if (tiedLeaders.length !== 1) {
      return {
        electionId: election.id,
        officeRole,
        termStartAt,
        termEndAt,
        termActive,
        impactedProfileIds,
        assignments: [],
        status: 'tied',
      };
    }

    const winningCandidate = candidateMap[tiedLeaders[0].candidate_id];

    if (!winningCandidate?.user_id || !termActive) {
      return {
        electionId: election.id,
        officeRole,
        termStartAt,
        termEndAt,
        termActive,
        impactedProfileIds,
        assignments: [],
        status: termActive ? 'missing_candidate' : 'expired',
      };
    }

    const assignments = [
      {
        userId: winningCandidate.user_id,
        officeRole,
        electionId: election.id,
        electionName: election.name,
        termStartAt,
        termEndAt,
      },
    ];

    if (officeRole === 'Presidente' && winningCandidate.vice_candidate_id) {
      assignments.push({
        userId: winningCandidate.vice_candidate_id,
        officeRole: 'Vice-Presidente',
        electionId: election.id,
        electionName: election.name,
        termStartAt,
        termEndAt,
      });
    }

    return {
      electionId: election.id,
      officeRole,
      termStartAt,
      termEndAt,
      termActive,
      impactedProfileIds,
      assignments,
      status: 'settled',
    };
  }

  const proportionalWinners = results
    .filter((result) => Number(result.vote_count || 0) > 0)
    .map((result) => candidateMap[result.candidate_id])
    .filter((candidate) => candidate?.user_id);

  return {
    electionId: election.id,
    officeRole,
    termStartAt,
    termEndAt,
    termActive,
    impactedProfileIds,
    assignments: termActive
      ? proportionalWinners.map((candidate) => ({
          userId: candidate.user_id,
          officeRole,
          electionId: election.id,
          electionName: election.name,
          termStartAt,
          termEndAt,
        }))
      : [],
    status: proportionalWinners.length ? (termActive ? 'settled' : 'expired') : 'no_votes',
  };
};

const buildNotificationKey = ({ userId, electionId, officeRole }) =>
  `${userId}:${electionId}:${officeRole}`;

const fetchExistingOfficeNotifications = async (supabase, userIds = []) => {
  if (!userIds.length) {
    return new Set();
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('user_id, metadata')
    .in('user_id', userIds)
    .eq('type', 'office_awarded');

  if (error) {
    throw error;
  }

  const keys = new Set();

  for (const notification of data || []) {
    const officeRole = notification?.metadata?.office_role;
    const electionId = notification?.metadata?.election_id;

    if (!notification?.user_id || !officeRole || !electionId) {
      continue;
    }

    keys.add(
      buildNotificationKey({
        userId: notification.user_id,
        electionId,
        officeRole,
      })
    );
  }

  return keys;
};

const buildOfficeNotification = (assignment) => {
  const officeLabel = OFFICE_LABELS[assignment.officeRole] || assignment.officeRole;
  const link = OFFICE_LINKS[assignment.officeRole] || '/dashboard';
  const roleNoun = assignment.officeRole === 'Presidente' || assignment.officeRole === 'Vice-Presidente'
    ? 'cargo'
    : 'mandato';

  return {
    user_id: assignment.userId,
    content: `Seu ${roleNoun} de ${officeLabel} foi oficializado ao fim da eleição "${assignment.electionName}".`,
    link,
    type: 'office_awarded',
    metadata: {
      office_role: assignment.officeRole,
      office_label: officeLabel,
      election_id: assignment.electionId,
      election_name: assignment.electionName,
      term_start_at: assignment.termStartAt,
      term_end_at: assignment.termEndAt,
      first_grant: true,
      popup_pending: true,
      popup_shown_at: null,
    },
  };
};

const clearExecutiveVacancyIfNeeded = async (supabase, assignments = []) => {
  if (!assignments.some((assignment) => assignment.officeRole === 'Presidente')) {
    return false;
  }

  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', EXECUTIVE_GOVERNANCE_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const currentValue = data?.value || {};
  const currentVacancy = currentValue.officeVacancy || {};

  if (!currentVacancy.vacant) {
    return false;
  }

  const nextValue = {
    ...currentValue,
    officeVacancy: {
      vacant: false,
      since: null,
      reason: '',
      triggered_by: null,
    },
  };

  const { error: updateError } = await supabase
    .from('system_settings')
    .upsert(
      {
        key: EXECUTIVE_GOVERNANCE_SETTINGS_KEY,
        value: nextValue,
      },
      {
        onConflict: 'key',
      }
    );

  if (updateError) {
    throw updateError;
  }

  return true;
};

const fetchStoredElectionOfficeState = async (supabase) => {
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

const persistElectionOfficeState = async (supabase, payload) => {
  const { error } = await supabase
    .from('system_settings')
    .upsert(
      {
        key: ELECTION_OFFICE_SYNC_SETTINGS_KEY,
        value: payload,
      },
      {
        onConflict: 'key',
      }
    );

  if (error) {
    throw error;
  }
};

const syncParliamentMemberships = async (supabase, { previousState, activeAssignments }) => {
  const legislativeAssignments = activeAssignments.filter((assignment) =>
    ['Deputado', 'Senador'].includes(assignment.officeRole)
  );
  const currentKeys = new Set();

  for (const assignment of legislativeAssignments) {
    const houseId = PARLIAMENT_HOUSE_IDS[assignment.officeRole];
    const termStartDate = toDateOnly(assignment.termStartAt);
    const termEndDate = toDateOnly(assignment.termEndAt);

    if (!houseId || !assignment.userId || !termStartDate || !termEndDate) {
      continue;
    }

    const membershipKey = `${assignment.userId}:${houseId}:${termStartDate}`;
    currentKeys.add(membershipKey);

    const { data: existingMembership, error: existingMembershipError } = await supabase
      .from('parliament_members')
      .select('id, term_start_date, term_end_date')
      .eq('user_id', assignment.userId)
      .eq('house_id', houseId)
      .eq('term_start_date', termStartDate)
      .maybeSingle();

    if (existingMembershipError) {
      throw existingMembershipError;
    }

    if (!existingMembership) {
      const { error: insertError } = await supabase.from('parliament_members').insert({
        user_id: assignment.userId,
        house_id: houseId,
        party_id: null,
        term_start_date: termStartDate,
        term_end_date: termEndDate,
      });

      if (insertError) {
        throw insertError;
      }

      continue;
    }

    if (existingMembership.term_end_date !== termEndDate) {
      const { error: updateError } = await supabase
        .from('parliament_members')
        .update({ term_end_date: termEndDate })
        .eq('id', existingMembership.id);

      if (updateError) {
        throw updateError;
      }
    }
  }

  const previousAssignments = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments.filter((assignment) =>
        ['Deputado', 'Senador'].includes(assignment?.office_role)
      )
    : [];

  for (const assignment of previousAssignments) {
    const houseId = PARLIAMENT_HOUSE_IDS[assignment.office_role];
    const termStartDate = toDateOnly(assignment.term_start_at);
    const membershipKey = `${assignment.user_id}:${houseId}:${termStartDate}`;

    if (!houseId || !assignment.user_id || !termStartDate || currentKeys.has(membershipKey)) {
      continue;
    }

    const { error: expireError } = await supabase
      .from('parliament_members')
      .update({
        term_end_date: toDateOnly(new Date().toISOString()),
      })
      .eq('user_id', assignment.user_id)
      .eq('house_id', houseId)
      .eq('term_start_date', termStartDate);

    if (expireError) {
      throw expireError;
    }
  }
};

export const syncElectionOfficesState = async () => {
  const supabase = getServerSupabase();
  const latestElections = await fetchLatestFinishedElections(supabase);
  const previousState = await fetchStoredElectionOfficeState(supabase);
  const settlements = [];
  const activeAssignmentsByUser = new Map();
  const impactedProfileIds = new Set();

  for (const election of latestElections) {
    const settlement = await resolveElectionAssignments(supabase, election);
    settlements.push(settlement);

    for (const profileId of settlement.impactedProfileIds || []) {
      impactedProfileIds.add(profileId);
    }

    for (const assignment of settlement.assignments || []) {
      addAssignment(activeAssignmentsByUser, assignment.userId, assignment);
    }
  }

  const activeAssignments = [...activeAssignmentsByUser.values()].flat();
  const serializedAssignments = activeAssignments.map((assignment) => ({
    user_id: assignment.userId,
    office_role: assignment.officeRole,
    election_id: assignment.electionId,
    election_name: assignment.electionName,
    term_start_at: assignment.termStartAt,
    term_end_at: assignment.termEndAt,
  }));
  const serializedSettlements = settlements.map((settlement) => ({
    election_id: settlement.electionId,
    office_role: settlement.officeRole,
    status: settlement.status,
    winner_count: settlement.assignments.length,
    term_start_at: settlement.termStartAt,
    term_end_at: settlement.termEndAt,
  }));

  await persistElectionOfficeState(supabase, {
    updated_at: new Date().toISOString(),
    active_assignments: serializedAssignments,
    settlements: serializedSettlements,
  });

  await syncParliamentMemberships(supabase, {
    previousState,
    activeAssignments,
  });

  await clearExecutiveVacancyIfNeeded(supabase, activeAssignments);

  const existingNotificationKeys = await fetchExistingOfficeNotifications(
    supabase,
    dedupe(activeAssignments.map((assignment) => assignment.userId))
  );

  const notificationsToInsert = [];

  for (const assignment of activeAssignments) {
    const notificationKey = buildNotificationKey(assignment);

    if (existingNotificationKeys.has(notificationKey)) {
      continue;
    }

    notificationsToInsert.push(buildOfficeNotification(assignment));
    existingNotificationKeys.add(notificationKey);
  }

  if (notificationsToInsert.length) {
    const { error } = await supabase.from('notifications').insert(notificationsToInsert);

    if (error) {
      throw error;
    }
  }

  const previousUserIds = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments.map((assignment) => assignment.user_id)
    : [];
  const changedUserIds = dedupe([
    ...previousUserIds,
    ...serializedAssignments.map((assignment) => assignment.user_id),
    ...impactedProfileIds,
  ]);

  return {
    processedElectionIds: settlements.map((settlement) => settlement.electionId),
    grantedUserIds: dedupe(activeAssignments.map((assignment) => assignment.userId)),
    changedUserIds,
    notificationsCreated: notificationsToInsert.length,
    settlements: settlements.map((settlement) => ({
      electionId: settlement.electionId,
      officeRole: settlement.officeRole,
      status: settlement.status,
      winnerCount: settlement.assignments.length,
    })),
  };
};

export const syncElectionOfficesHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  try {
    const result = await syncElectionOfficesState();
    json(response, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    console.error('[elections:sync-offices]', error);
    json(response, 500, {
      error: error instanceof Error ? error.message : 'Não foi possível sincronizar os cargos eleitorais.',
    });
  }
};
