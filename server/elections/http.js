import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import {
  canRunForPresidency,
  fetchExecutiveConstitutionalState,
  fetchExecutiveGovernanceSettings,
  fetchPotentialRunningMates,
  fetchPresidentialElectionHistory,
  saveExecutiveGovernanceSettings,
} from '../../src/lib/executiveGovernance.js';
import { normalizeOfficialGazetteSourceId } from '../../src/lib/officialGazette.js';

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
const AUTOMATIC_ELECTIONS_SETTINGS_KEY = 'automatic_elections';
const ACTIVE_CANDIDACY_STATUSES = ['Pendente', 'Approved'];
const ACTIVE_ELECTION_STATUSES_FOR_CANDIDACY = new Set(['scheduled', 'candidacy', 'voting']);
const VICE_CANDIDACY_INVITATION_TYPE = 'vice_candidacy_invitation';
const VICE_CANDIDACY_TRACKER_TYPE = 'vice_candidacy_request_sent';
const VICE_CANDIDACY_ACCEPTED_TYPE = 'vice_candidacy_request_accepted';
const VICE_CANDIDACY_REJECTED_TYPE = 'vice_candidacy_request_rejected';
const TERM_BOUND_PROFILE_ROLES = ['Presidente', 'Vice-Presidente', 'Deputado', 'Senador'];
const EXECUTIVE_PROFILE_ROLES = ['Presidente', 'Vice-Presidente', 'Ministro'];
const ROLE_CLEANUP_SELECT_WITH_OVERRIDE = 'id, role, titles, manual_role_override, role_assigned_at, role_assigned_by';
const ROLE_CLEANUP_SELECT_BASE = 'id, role, titles';
const MISSING_COLUMN_ERROR_CODES = new Set(['42703', 'PGRST204', 'PGRST205']);
const BASE_CITIZEN_ROLES = ['Usuário', 'Cidadão'];
const ELECTION_ROLE_PRIORITY = ['Presidente', 'Vice-Presidente', 'Senador', 'Deputado'];
const SYNC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SYNC_RATE_LIMIT_MAX_REQUESTS = 5;

let serverSupabase;
const syncRateLimitByUser = new Map();

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

const getPublicServerKey = () =>
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
  '';

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

const getUserScopedSupabase = (accessToken) =>
  createClient(
    getRequiredServerEnv('VITE_SUPABASE_URL'),
    getPublicServerKey() || getRequiredServerEnv('VITE_SUPABASE_ANON_KEY'),
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];
const toDateOnly = (value) => (typeof value === 'string' ? value.slice(0, 10) : '');
const trimString = (value) => (typeof value === 'string' ? value.trim() : '');
const getNotificationMetadata = (notification) =>
  notification?.metadata && typeof notification.metadata === 'object' ? notification.metadata : {};
const resolveProfileDisplayName = (profile, fallback = 'Cidadão') =>
  trimString(profile?.full_name) ||
  trimString(profile?.username) ||
  trimString(profile?.x_handle) ||
  fallback;
const isPendingNotificationStatus = (status) => trimString(status).toLowerCase() === 'pending';

const shouldRetryWithoutManualRoleOverride = (error) =>
  error &&
  (MISSING_COLUMN_ERROR_CODES.has(error.code) ||
    /manual_role_override/i.test(error.message || ''));

const fetchProfilesForRoleCleanup = async (supabase, profileIds = []) => {
  const ids = dedupe(profileIds);

  if (!ids.length) {
    return [];
  }

  let { data, error } = await supabase
    .from('profiles')
    .select(ROLE_CLEANUP_SELECT_WITH_OVERRIDE)
    .in('id', ids);

  if (shouldRetryWithoutManualRoleOverride(error)) {
    const retryResponse = await supabase
      .from('profiles')
      .select(ROLE_CLEANUP_SELECT_BASE)
      .in('id', ids);

    data = retryResponse.data;
    error = retryResponse.error;
  }

  if (error) {
    throw error;
  }

  return (data || []).map((profile) => ({
    ...profile,
    manual_role_override: Boolean(profile.manual_role_override),
  }));
};

const getProfileRolesAffectedByElectionOffice = (officeRole) => {
  if (officeRole === 'Presidente') {
    return ['Presidente', 'Vice-Presidente'];
  }

  if (officeRole === 'Deputado' || officeRole === 'Senador') {
    return [officeRole];
  }

  return [];
};

const doesElectionSettlementSupersedeManualRole = (profile = {}, settlements = []) => {
  if (!profile.manual_role_override || !profile.role_assigned_at || !profile.role) {
    return false;
  }

  const assignedAtMs = new Date(profile.role_assigned_at).getTime();

  if (!Number.isFinite(assignedAtMs)) {
    return false;
  }

  return (settlements || []).some((settlement) => {
    if (!settlement?.officeRole || !settlement?.termStartAt) {
      return false;
    }

    if (!getProfileRolesAffectedByElectionOffice(settlement.officeRole).includes(profile.role)) {
      return false;
    }

    const termStartMs = new Date(settlement.termStartAt).getTime();
    return Number.isFinite(termStartMs) && termStartMs > assignedAtMs;
  });
};

const fetchManualElectionRoleProfilesSupersededBySettlements = async (supabase, settlements = []) => {
  const affectedRoles = dedupe(
    (settlements || []).flatMap((settlement) =>
      getProfileRolesAffectedByElectionOffice(settlement?.officeRole)
    )
  );

  if (!affectedRoles.length) {
    return [];
  }

  let { data, error } = await supabase
    .from('profiles')
    .select(ROLE_CLEANUP_SELECT_WITH_OVERRIDE)
    .eq('manual_role_override', true)
    .in('role', affectedRoles);

  if (shouldRetryWithoutManualRoleOverride(error)) {
    return [];
  }

  if (error) {
    throw error;
  }

  return (data || [])
    .map((profile) => ({
      ...profile,
      manual_role_override: Boolean(profile.manual_role_override),
    }))
    .filter((profile) => doesElectionSettlementSupersedeManualRole(profile, settlements));
};

const updateProfileWithRoleOverrideFallback = async (supabase, userId, patch) => {
  let { error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId);

  if (shouldRetryWithoutManualRoleOverride(error)) {
    const basePatch = { ...patch };
    delete basePatch.manual_role_override;
    delete basePatch.role_assigned_at;
    delete basePatch.role_assigned_by;
    const retryResponse = await supabase
      .from('profiles')
      .update(basePatch)
      .eq('id', userId);

    error = retryResponse.error;
  }

  if (error) {
    throw error;
  }
};

const readJsonBody = async (request) => {
  if (request.body && typeof request.body === 'object') {
    return request.body;
  }

  if (typeof request.body === 'string') {
    return request.body.trim() ? JSON.parse(request.body) : {};
  }

  return await new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk;
    });

    request.on('end', () => {
      if (!rawBody.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(new Error('Corpo JSON invalido.'));
      }
    });

    request.on('error', reject);
  });
};

const getBearerToken = (request) => {
  const authorization = request.headers?.authorization || request.headers?.Authorization;

  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return authorization.slice(7).trim();
};

const createHttpError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureAuthenticatedRequester = async (supabase, request) => {
  const token = getBearerToken(request);

  if (!token) {
    throw createHttpError('Sessao invalida.', 401);
  }

  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData?.user?.id) {
    throw createHttpError('Nao foi possivel validar a sessao do usuario.', 401);
  }

  return {
    user: authData.user,
    accessToken: token,
  };
};

const ensureAdminRequester = async (supabase, request) => {
  const requester = await ensureAuthenticatedRequester(supabase, request);
  const profile = await fetchProfileById(supabase, requester.user.id);

  if (profile?.role !== 'Admin') {
    throw createHttpError('Apenas administradores podem sincronizar cargos eleitorais.', 403);
  }

  return { ...requester, profile };
};

const enforceElectionSyncRateLimit = (userId) => {
  const now = Date.now();
  const current = syncRateLimitByUser.get(userId);

  if (!current || now - current.startedAt >= SYNC_RATE_LIMIT_WINDOW_MS) {
    syncRateLimitByUser.set(userId, { startedAt: now, count: 1 });
    return;
  }

  if (current.count >= SYNC_RATE_LIMIT_MAX_REQUESTS) {
    throw createHttpError('Muitas sincronizações em pouco tempo. Aguarde um minuto.', 429);
  }

  current.count += 1;
};

const fetchProfileById = async (supabase, profileId) => {
  if (!profileId) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, role, x_handle')
    .eq('id', profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const fetchProfilesByIds = async (supabase, profileIds = []) => {
  const ids = dedupe(profileIds);

  if (!ids.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, avatar_url, role, x_handle')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []).reduce((accumulator, profile) => {
    accumulator[profile.id] = profile;
    return accumulator;
  }, {});
};

const fetchPartyMembership = async (supabase, userId) => {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('party_members')
    .select('party_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return data?.party_id || null;
};

const fetchPartyById = async (supabase, partyId) => {
  if (!partyId) {
    return null;
  }

  const { data, error } = await supabase
    .from('political_parties')
    .select('id, name, acronym, electoral_number')
    .eq('id', partyId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const fetchUserNotificationsByType = async (supabase, userId, type) => {
  if (!userId || !type) {
    return [];
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('id, user_id, sender_id, type, content, link, is_read, metadata, created_at')
    .eq('user_id', userId)
    .eq('type', type)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    throw error;
  }

  return data || [];
};

const matchesViceRequestMetadata = (
  metadata,
  {
    electionId = null,
    candidateUserId = null,
    viceCandidateId = null,
    status = 'pending',
  } = {}
) => {
  const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const notificationStatus = trimString(normalizedMetadata.status || 'pending').toLowerCase();

  if (status && notificationStatus !== trimString(status).toLowerCase()) {
    return false;
  }

  if (electionId && normalizedMetadata.election_id !== electionId) {
    return false;
  }

  if (candidateUserId && normalizedMetadata.candidate_user_id !== candidateUserId) {
    return false;
  }

  if (viceCandidateId && normalizedMetadata.vice_candidate_id !== viceCandidateId) {
    return false;
  }

  return true;
};

const updateNotificationMetadata = async (supabase, notificationId, metadata, extraPatch = {}) => {
  if (!notificationId) {
    return;
  }

  const { error } = await supabase
    .from('notifications')
    .update({
      metadata,
      ...extraPatch,
    })
    .eq('id', notificationId);

  if (error) {
    throw error;
  }
};

const updateTrackerNotificationsStatus = async (
  supabase,
  {
    candidateUserId,
    electionId,
    viceCandidateId,
    nextStatus,
    extraMetadata = {},
  }
) => {
  if (!candidateUserId || !electionId || !viceCandidateId || !nextStatus) {
    return;
  }

  const trackerNotifications = await fetchUserNotificationsByType(
    supabase,
    candidateUserId,
    VICE_CANDIDACY_TRACKER_TYPE
  );

  const matchingTrackers = trackerNotifications.filter((notification) =>
    matchesViceRequestMetadata(getNotificationMetadata(notification), {
      electionId,
      viceCandidateId,
      status: 'pending',
    })
  );

  for (const tracker of matchingTrackers) {
    const currentMetadata = getNotificationMetadata(tracker);
    await updateNotificationMetadata(supabase, tracker.id, {
      ...currentMetadata,
      status: nextStatus,
      responded_at: new Date().toISOString(),
      ...extraMetadata,
    });
  }
};

const cancelPendingViceInvitation = async (
  supabase,
  {
    trackerNotification,
    requesterId,
  }
) => {
  const trackerMetadata = getNotificationMetadata(trackerNotification);

  if (!matchesViceRequestMetadata(trackerMetadata, { status: 'pending' })) {
    throw createHttpError('Esta chapa nao esta mais aguardando aceite do vice.', 409);
  }

  if (trackerMetadata.candidate_user_id && trackerMetadata.candidate_user_id !== requesterId) {
    throw createHttpError('Voce nao tem permissao para retirar esta candidatura.', 403);
  }

  const electionId = trimString(trackerMetadata.election_id);
  const viceCandidateId = trimString(trackerMetadata.vice_candidate_id);
  const candidateName = trimString(trackerMetadata.candidate_name) || 'O candidato';
  const electionName = trimString(trackerMetadata.election_name) || 'a eleicao presidencial';

  await updateNotificationMetadata(supabase, trackerNotification.id, {
    ...trackerMetadata,
    status: 'cancelled',
    cancelled_at: new Date().toISOString(),
  }, { is_read: true });

  if (!electionId || !viceCandidateId) {
    return;
  }

  const viceInvitations = await fetchUserNotificationsByType(
    supabase,
    viceCandidateId,
    VICE_CANDIDACY_INVITATION_TYPE
  );

  const matchingInvitations = viceInvitations.filter((notification) =>
    matchesViceRequestMetadata(getNotificationMetadata(notification), {
      electionId,
      candidateUserId: requesterId,
      viceCandidateId,
      status: 'pending',
    })
  );

  for (const invitation of matchingInvitations) {
    const currentMetadata = getNotificationMetadata(invitation);
    await updateNotificationMetadata(supabase, invitation.id, {
      ...currentMetadata,
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    }, { is_read: true });
  }

  const { error: notificationError } = await supabase.from('notifications').insert({
    user_id: viceCandidateId,
    sender_id: requesterId,
    type: 'vice_candidacy_request_cancelled',
    content: `${candidateName} retirou o convite para compor chapa em "${electionName}".`,
    link: '/services/elections',
    is_read: false,
    metadata: {
      election_id: electionId,
      election_name: electionName,
      candidate_user_id: requesterId,
      status: 'cancelled',
    },
  });

  if (notificationError) {
    throw notificationError;
  }
};

const isElectionStillBlockingCandidacy = (election) => {
  const status = trimString(election?.status).toLowerCase();

  if (ACTIVE_ELECTION_STATUSES_FOR_CANDIDACY.has(status)) {
    return true;
  }

  if (election?.voting_end_date) {
    const votingEnd = new Date(election.voting_end_date).getTime();
    return Number.isFinite(votingEnd) && votingEnd > Date.now();
  }

  return false;
};

const fetchActiveCandidacyForUser = async (supabase, userId) => {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id, election_id, user_id, vice_candidate_id, status, election:elections(id, status, voting_end_date)')
    .eq('user_id', userId)
    .in('status', ACTIVE_CANDIDACY_STATUSES)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  return (data || []).find((candidate) => isElectionStillBlockingCandidacy(candidate.election)) || null;
};

const fetchElectionParticipantConflicts = async (supabase, electionId, participantIds = []) => {
  const ids = dedupe(participantIds);

  if (!electionId || !ids.length) {
    return [];
  }

  const { data, error } = await supabase
    .from('candidates')
    .select('id, election_id, user_id, vice_candidate_id, status')
    .eq('election_id', electionId)
    .in('status', ACTIVE_CANDIDACY_STATUSES)
    .or(
      ids
        .flatMap((id) => [`user_id.eq.${id}`, `vice_candidate_id.eq.${id}`])
        .join(',')
    );

  if (error) {
    throw error;
  }

  return data || [];
};

const fetchElectionById = async (supabase, electionId) => {
  if (!electionId) {
    return null;
  }

  const { data, error } = await supabase
    .from('elections')
    .select('id, name, status, election_type_id, election_types(id, name, voting_system, requires_vice_candidate)')
    .eq('id', electionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
};

const isPresidentialTicketElection = (election) => {
  const electionTypeName = trimString(election?.election_types?.name).toLowerCase();
  const electionName = trimString(election?.name).toLowerCase();

  return Boolean(election?.election_types?.requires_vice_candidate) ||
    electionTypeName === 'presidente' ||
    electionName.includes('presidencial');
};

const ensurePresidentialElectionSubmissionAllowed = async (supabase, election, requesterId) => {
  if (!election?.id || !isPresidentialTicketElection(election)) {
    throw createHttpError('Esta rota atende apenas candidaturas presidenciais em chapa.', 400);
  }

  if (election.status !== 'Candidacy') {
    throw createHttpError('A janela de registro desta eleição não está aberta.', 400);
  }

  const presidentialHistory = await fetchPresidentialElectionHistory(supabase);

  if (!canRunForPresidency(presidentialHistory.elections, requesterId)) {
    throw createHttpError(
      'Voce ja venceu as duas ultimas eleicoes presidenciais consecutivas e nao pode disputar novamente agora.',
      400
    );
  }
};

const addOneMonth = (dateValue) => {
  const date = new Date(dateValue);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
};

const getElectionStatusByDates = ({
  candidacy_start_date,
  candidacy_end_date,
  voting_start_date,
  voting_end_date,
}) => {
  const now = Date.now();

  if (voting_end_date && now >= new Date(voting_end_date).getTime()) {
    return 'Finished';
  }

  if (voting_start_date && now >= new Date(voting_start_date).getTime()) {
    return 'Voting';
  }

  if (candidacy_start_date && candidacy_end_date) {
    const candidacyStart = new Date(candidacy_start_date).getTime();
    const candidacyEnd = new Date(candidacy_end_date).getTime();

    if (now >= candidacyStart && now <= candidacyEnd) {
      return 'Candidacy';
    }
  }

  return 'Scheduled';
};

const parseElectionSequence = (name = '') => {
  const match = trimString(name).match(/^(\d+)[ªº]?\s+(.+)$/i);

  if (!match) {
    return {
      sequence: 1,
      suffix: trimString(name) || 'Eleição',
    };
  }

  return {
    sequence: Number(match[1]) || 1,
    suffix: trimString(match[2]) || 'Eleição',
  };
};

const formatElectionSequenceName = (name = '', nextSequence = 1) => {
  const parsed = parseElectionSequence(name);
  return `${nextSequence}ª ${parsed.suffix}`;
};

const incrementElectionDescription = (description = '', nextSequence = 1) =>
  trimString(description).replace(/^(\d+)[ªº]/, `${nextSequence}ª`);

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
  // Election results are historical. Current appointments are authoritative, including
  // resignations, impeachment and succession recorded after the original election.
  const [{ data: rows, error }, { data: settlement, error: settlementError }] = await Promise.all([
    supabase.from('election_office_assignments').select('*').eq('election_id', election.id),
    supabase.from('election_settlements').select('status').eq('election_id', election.id).maybeSingle(),
  ]);
  if (error || settlementError) throw error || settlementError;
  const assignments = (rows || []).filter(row => row.status === 'active' && new Date(row.term_starts_at).getTime() <= Date.now() && new Date(row.term_ends_at).getTime() > Date.now()).map(row => ({
    userId: row.profile_id, officeRole: row.office_role, electionId: row.election_id,
    electionName: election.name, termStartAt: row.term_starts_at, termEndAt: row.term_ends_at,
  }));
  return { electionId: election.id, officeRole, termStartAt, termEndAt, termActive,
    impactedProfileIds: dedupe((rows || []).map(row => row.profile_id)), assignments,
    status: termActive ? settlement?.status || 'no_votes' : 'expired' };

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
    .in('type', ['office_awarded', 'role_changed']);

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

const buildAssignmentIdentity = (assignment) => {
  const userId = assignment?.user_id || assignment?.userId || '';
  const officeRole = assignment?.office_role || assignment?.officeRole || '';
  const electionId = assignment?.election_id || assignment?.electionId || '';
  const termStartAt = toDateOnly(assignment?.term_start_at || assignment?.termStartAt || '');

  return `${userId}:${officeRole}:${electionId}:${termStartAt}`;
};

const formatGazetteDate = (value) => {
  if (!value) {
    return 'data indefinida';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'data indefinida';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  }).format(parsedDate);
};

const publishElectionOfficeGazetteEntries = async (supabase, { previousState, activeAssignments }) => {
  const previousAssignments = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments
    : [];
  const currentAssignments = (activeAssignments || []).map((assignment) => ({
    user_id: assignment.userId,
    office_role: assignment.officeRole,
    election_id: assignment.electionId,
    election_name: assignment.electionName,
    term_start_at: assignment.termStartAt,
    term_end_at: assignment.termEndAt,
  }));
  const previousKeys = new Set(previousAssignments.map(buildAssignmentIdentity));
  const currentKeys = new Set(currentAssignments.map(buildAssignmentIdentity));
  const grantedAssignments = currentAssignments.filter((assignment) => !previousKeys.has(buildAssignmentIdentity(assignment)));
  const revokedAssignments = previousAssignments.filter((assignment) => !currentKeys.has(buildAssignmentIdentity(assignment)));

  if (!grantedAssignments.length && !revokedAssignments.length) {
    return;
  }

  const profilesMap = await fetchProfilesByIds(supabase, [
    ...grantedAssignments.map((assignment) => assignment.user_id),
    ...revokedAssignments.map((assignment) => assignment.user_id),
  ]);
  const publishedAt = new Date().toISOString();
  const rows = [];

  for (const assignment of grantedAssignments) {
    const officeLabel = OFFICE_LABELS[assignment.office_role] || assignment.office_role;
    const profile = profilesMap[assignment.user_id] || null;
    const profileName = resolveProfileDisplayName(profile, 'Servidor eleito');
    const roleNoun = ['Presidente', 'Vice-Presidente'].includes(assignment.office_role) ? 'cargo' : 'mandato';

    rows.push({
      title: `Posse em ${officeLabel}: ${profileName}`,
      summary: `${profileName} teve seu ${roleNoun} de ${officeLabel} oficializado no Diário Oficial.`,
      content:
        `${profileName} passa a exercer ${officeLabel} em decorrência da eleição "${assignment.election_name || 'não identificada'}".` +
        ` Início do exercício: ${formatGazetteDate(assignment.term_start_at)}.` +
        (assignment.term_end_at ? ` Término previsto: ${formatGazetteDate(assignment.term_end_at)}.` : ''),
      type: 'Nomeacao e Exoneracao',
      source_id: normalizeOfficialGazetteSourceId(`office-grant-${buildAssignmentIdentity(assignment)}`),
      published_at: publishedAt,
    });
  }

  for (const assignment of revokedAssignments) {
    const officeLabel = OFFICE_LABELS[assignment.office_role] || assignment.office_role;
    const profile = profilesMap[assignment.user_id] || null;
    const profileName = resolveProfileDisplayName(profile, 'Servidor anteriormente investido');
    const roleNoun = ['Presidente', 'Vice-Presidente'].includes(assignment.office_role) ? 'cargo' : 'mandato';

    rows.push({
      title: `Encerramento de ${officeLabel}: ${profileName}`,
      summary: `${profileName} deixou o ${roleNoun} de ${officeLabel}.`,
      content:
        `${profileName} encerrou o exercício de ${officeLabel}.` +
        (assignment.election_name ? ` O ato decorre do encerramento do ciclo da eleição "${assignment.election_name}".` : ''),
      type: 'Nomeacao e Exoneracao',
      source_id: normalizeOfficialGazetteSourceId(`office-revoke-${buildAssignmentIdentity(assignment)}`),
      published_at: publishedAt,
    });
  }

  if (!rows.length) {
    return;
  }

  const { error } = await supabase.from('dou_entries').insert(rows);

  if (error) {
    throw error;
  }
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

const fetchAutomaticElectionSettings = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', AUTOMATIC_ELECTIONS_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.value && typeof data.value === 'object' ? data.value : { plans: {} };
};

const persistAutomaticElectionSettings = async (supabase, value) => {
  const { error } = await supabase
    .from('system_settings')
    .upsert(
      {
        key: AUTOMATIC_ELECTIONS_SETTINGS_KEY,
        value,
        description: 'Agenda eleições automáticas recorrentes.',
      },
      {
        onConflict: 'key',
      }
    );

  if (error) {
    throw error;
  }
};

const ensureAutomaticRecurringElections = async (supabase) => {
  const settings = await fetchAutomaticElectionSettings(supabase);
  const plans = settings?.plans && typeof settings.plans === 'object' ? settings.plans : {};
  const now = Date.now();
  const createdElectionIds = [];
  let hasChanges = false;

  for (const [planId, rawPlan] of Object.entries(plans)) {
    const plan = rawPlan && typeof rawPlan === 'object' ? rawPlan : {};

    if (plan.enabled === false) {
      continue;
    }

    const lastElectionId = plan.last_election_id || plan.root_election_id || planId;
    if (!lastElectionId) {
      continue;
    }

    const { data: lastElection, error: lastElectionError } = await supabase
      .from('elections')
      .select('id, name, description, election_type_id, candidacy_start_date, candidacy_end_date, voting_start_date, voting_end_date')
      .eq('id', lastElectionId)
      .maybeSingle();

    if (lastElectionError) {
      throw lastElectionError;
    }

    if (!lastElection?.id || !lastElection.voting_end_date) {
      continue;
    }

    if (now < new Date(lastElection.voting_end_date).getTime()) {
      continue;
    }

    const nextDates = {
      candidacy_start_date: addOneMonth(lastElection.candidacy_start_date),
      candidacy_end_date: addOneMonth(lastElection.candidacy_end_date),
      voting_start_date: addOneMonth(lastElection.voting_start_date),
      voting_end_date: addOneMonth(lastElection.voting_end_date),
    };

    const { data: existingNextElection, error: existingNextElectionError } = await supabase
      .from('elections')
      .select('id, name')
      .eq('election_type_id', lastElection.election_type_id)
      .eq('candidacy_start_date', nextDates.candidacy_start_date)
      .eq('voting_start_date', nextDates.voting_start_date)
      .maybeSingle();

    if (existingNextElectionError) {
      throw existingNextElectionError;
    }

    const currentSequence = Number(plan.sequence || parseElectionSequence(lastElection.name).sequence || 1);
    const nextSequence = currentSequence + 1;

    if (existingNextElection?.id) {
      plans[planId] = {
        ...plan,
        last_election_id: existingNextElection.id,
        sequence: nextSequence,
        updated_at: new Date().toISOString(),
      };
      hasChanges = true;
      continue;
    }

    const nextElectionPayload = {
      name: formatElectionSequenceName(lastElection.name, nextSequence),
      description: incrementElectionDescription(lastElection.description || '', nextSequence),
      election_type_id: lastElection.election_type_id,
      ...nextDates,
      status: getElectionStatusByDates(nextDates),
    };

    const { data: newElection, error: createElectionError } = await supabase
      .from('elections')
      .insert(nextElectionPayload)
      .select('id')
      .single();

    if (createElectionError) {
      throw createElectionError;
    }

    createdElectionIds.push(newElection.id);
    plans[planId] = {
      ...plan,
      root_election_id: plan.root_election_id || planId,
      last_election_id: newElection.id,
      sequence: nextSequence,
      generated_election_ids: dedupe([...(plan.generated_election_ids || []), newElection.id]),
      updated_at: new Date().toISOString(),
    };
    hasChanges = true;
  }

  if (hasChanges) {
    await persistAutomaticElectionSettings(supabase, {
      ...settings,
      plans,
      updated_at: new Date().toISOString(),
    });
  }

  return createdElectionIds;
};

const resolveParliamentHouseId = async (supabase, officeRole) => {
  const configuredHouseId = PARLIAMENT_HOUSE_IDS[officeRole];

  if (configuredHouseId) {
    const { data: configuredHouse, error: configuredHouseError } = await supabase
      .from('parliament_houses')
      .select('id')
      .eq('id', configuredHouseId)
      .maybeSingle();

    if (configuredHouseError) {
      throw configuredHouseError;
    }

    if (configuredHouse?.id) {
      return configuredHouse.id;
    }
  }

  const namePattern = officeRole === 'Deputado' ? '%câmara%' : '%senado%';
  const { data: fallbackHouse, error: fallbackHouseError } = await supabase
    .from('parliament_houses')
    .select('id')
    .ilike('name', namePattern)
    .order('name')
    .limit(1)
    .maybeSingle();

  if (fallbackHouseError) {
    throw fallbackHouseError;
  }

  return fallbackHouse?.id || null;
};

const syncParliamentMemberships = async (supabase, { previousState, activeAssignments }) => {
  const legislativeAssignments = activeAssignments.filter((assignment) =>
    ['Deputado', 'Senador'].includes(assignment.officeRole)
  );
  const currentKeys = new Set();

  for (const assignment of legislativeAssignments) {
    const houseId = await resolveParliamentHouseId(supabase, assignment.officeRole);
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
    const houseId = await resolveParliamentHouseId(supabase, assignment.office_role);
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

const clearStaleProfileOfficeRoles = async (supabase, { previousState, activeAssignments, settlements }) => {
  const activeOfficeRolesByUser = new Map();

  for (const assignment of activeAssignments || []) {
    if (!assignment?.userId || !assignment?.officeRole) {
      continue;
    }

    if (!activeOfficeRolesByUser.has(assignment.userId)) {
      activeOfficeRolesByUser.set(assignment.userId, new Set());
    }

    activeOfficeRolesByUser.get(assignment.userId).add(assignment.officeRole);
  }

  const previousProfileIds = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments.map((assignment) => assignment.user_id)
    : [];
  const activeProfileIds = activeAssignments.map((assignment) => assignment.userId);
  const supersededManualProfiles = await fetchManualElectionRoleProfilesSupersededBySettlements(
    supabase,
    settlements
  );
  const candidateProfileIds = dedupe([
    ...previousProfileIds,
    ...activeProfileIds,
    ...supersededManualProfiles.map((profile) => profile.id),
  ]);

  if (!candidateProfileIds.length) {
    return;
  }

  const profiles = await fetchProfilesForRoleCleanup(supabase, candidateProfileIds);

  for (const profile of profiles || []) {
    const manualOverrideSuperseded = doesElectionSettlementSupersedeManualRole(profile, settlements);

    if (profile.manual_role_override && !manualOverrideSuperseded) {
      continue;
    }

    const activeRoles = activeOfficeRolesByUser.get(profile.id) || new Set();
    const currentRole = profile.role;
    const nextRole = TERM_BOUND_PROFILE_ROLES.includes(currentRole) && !activeRoles.has(currentRole)
      ? 'Cidadão'
      : currentRole;
    const currentTitles = Array.isArray(profile.titles) ? profile.titles : [];
    const nextTitles = currentTitles.filter(
      (title) => !TERM_BOUND_PROFILE_ROLES.includes(title) || activeRoles.has(title)
    );
    const patch = {};

    if (nextRole !== currentRole) {
      patch.role = nextRole;
    }

    if (nextTitles.length !== currentTitles.length) {
      patch.titles = nextTitles;
    }

    if (manualOverrideSuperseded) {
      patch.manual_role_override = false;
      patch.role_assigned_at = null;
      patch.role_assigned_by = null;
    }

    if (!Object.keys(patch).length) {
      continue;
    }

    await updateProfileWithRoleOverrideFallback(supabase, profile.id, patch);
  }
};

const syncActiveElectionProfileRoles = async (supabase, activeAssignments = []) => {
  const assignmentsByUser = new Map();

  for (const assignment of activeAssignments || []) {
    if (!assignment?.userId || !assignment?.officeRole) {
      continue;
    }

    if (!assignmentsByUser.has(assignment.userId)) {
      assignmentsByUser.set(assignment.userId, []);
    }

    assignmentsByUser.get(assignment.userId).push(assignment);
  }

  if (!assignmentsByUser.size) {
    return;
  }

  const profiles = await fetchProfilesForRoleCleanup(supabase, [...assignmentsByUser.keys()]);

  for (const profile of profiles) {
    if (profile.role === 'Admin') {
      continue;
    }

    const currentRoleIsElectionOrBase = TERM_BOUND_PROFILE_ROLES.includes(profile.role) ||
      BASE_CITIZEN_ROLES.includes(profile.role || '');

    if (!currentRoleIsElectionOrBase) {
      continue;
    }

    const assignments = assignmentsByUser.get(profile.id) || [];
    const selectedAssignment = [...assignments].sort(
      (left, right) =>
        ELECTION_ROLE_PRIORITY.indexOf(left.officeRole) -
        ELECTION_ROLE_PRIORITY.indexOf(right.officeRole)
    )[0];

    if (!selectedAssignment?.officeRole) {
      continue;
    }

    const patch = {
      role: selectedAssignment.officeRole,
      manual_role_override: false,
      role_assigned_at: null,
      role_assigned_by: null,
    };

    if (
      profile.role === patch.role &&
      profile.manual_role_override === false &&
      !profile.role_assigned_at &&
      !profile.role_assigned_by
    ) {
      continue;
    }

    await updateProfileWithRoleOverrideFallback(supabase, profile.id, patch);
  }
};

const clearMinistersWhenExecutiveTermChanges = async (supabase, { previousState, activeAssignments }) => {
  const currentPresident = activeAssignments.find((assignment) => assignment.officeRole === 'Presidente') || null;
  const previousPresident = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments.find((assignment) => assignment.office_role === 'Presidente') || null
    : null;
  // A change of holder within the same mandate preserves the cabinet.
  // Manual appointments and institutional vacancies also have no new electoral mandate.
  if ((!currentPresident && !previousPresident) ||
      (currentPresident && previousPresident?.election_id === currentPresident.electionId)) return [];

  const executiveTermChanged =
    !currentPresident ||
    previousPresident?.election_id !== currentPresident.electionId ||
    previousPresident?.user_id !== currentPresident.userId;

  if (!executiveTermChanged) {
    return [];
  }

  const { data: currentMinisters, error: ministersError } = await supabase
    .from('ministers')
    .select('user_id');

  if (ministersError) {
    throw ministersError;
  }

  const ministerUserIds = dedupe((currentMinisters || []).map((minister) => minister.user_id));

  if ((currentMinisters || []).length) {
    const { error: deleteError } = await supabase
      .from('ministers')
      .delete()
      .neq('user_id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      throw deleteError;
    }
  }

  if (ministerUserIds.length) {
    const profilesMap = await fetchProfilesByIds(supabase, ministerUserIds);
    const publishedAt = new Date().toISOString();
    const reasonLabel = currentPresident
      ? `mudança de governo decorrente da eleição "${currentPresident.electionName || 'não identificada'}"`
      : 'vacância do Poder Executivo';
    const gazetteRows = ministerUserIds.map((userId) => {
      const profile = profilesMap[userId] || null;
      const profileName = resolveProfileDisplayName(profile, 'Ministro exonerado');

      return {
        title: `Exoneração de ministro: ${profileName}`,
        summary: `${profileName} deixou o cargo de Ministro em razão de ${reasonLabel}.`,
        content: `${profileName} foi exonerado do cargo de Ministro em razão de ${reasonLabel}.`,
        type: 'Nomeacao e Exoneracao',
        source_id: normalizeOfficialGazetteSourceId(`minister-dismiss-${userId}-${currentPresident?.electionId || 'vacancy'}-${publishedAt}`),
        published_at: publishedAt,
      };
    });

    const { error: gazetteError } = await supabase.from('dou_entries').insert(gazetteRows);

    if (gazetteError) {
      throw gazetteError;
    }
  }

  const previousExecutiveUserIds = Array.isArray(previousState?.active_assignments)
    ? previousState.active_assignments
        .filter((assignment) => ['Presidente', 'Vice-Presidente'].includes(assignment?.office_role))
        .map((assignment) => assignment.user_id)
    : [];
  const activeExecutiveUserIds = (activeAssignments || [])
    .filter((assignment) => ['Presidente', 'Vice-Presidente'].includes(assignment?.officeRole))
    .map((assignment) => assignment.userId);
  const executiveProfileIds = dedupe([
    ...ministerUserIds,
    ...previousExecutiveUserIds,
    ...activeExecutiveUserIds,
  ]);

  if (!executiveProfileIds.length) {
    return ministerUserIds;
  }

  const staleProfiles = await fetchProfilesForRoleCleanup(supabase, executiveProfileIds);

  const activeExecutiveRolesByUser = new Map();
  for (const assignment of activeAssignments || []) {
    if (!['Presidente', 'Vice-Presidente'].includes(assignment.officeRole)) {
      continue;
    }

    if (!activeExecutiveRolesByUser.has(assignment.userId)) {
      activeExecutiveRolesByUser.set(assignment.userId, new Set());
    }

    activeExecutiveRolesByUser.get(assignment.userId).add(assignment.officeRole);
  }

  for (const profile of staleProfiles || []) {
    if (profile.manual_role_override) {
      continue;
    }

    const activeRoles = activeExecutiveRolesByUser.get(profile.id) || new Set();
    const nextRole = EXECUTIVE_PROFILE_ROLES.includes(profile.role) && !activeRoles.has(profile.role)
      ? 'Cidadão'
      : profile.role;
    const currentTitles = Array.isArray(profile.titles) ? profile.titles : [];
    const nextTitles = currentTitles.filter(
      (title) => !EXECUTIVE_PROFILE_ROLES.includes(title) || activeRoles.has(title)
    );
    const patch = {};

    if (nextRole !== profile.role) {
      patch.role = nextRole;
    }

    if (nextTitles.length !== currentTitles.length) {
      patch.titles = nextTitles;
    }

    if (!Object.keys(patch).length) {
      continue;
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', profile.id);

    if (updateError) {
      throw updateError;
    }
  }

  return ministerUserIds;
};

export const syncElectionOfficesState = async ({ accessToken } = {}) => {
  const supabase = getServerSupabase();
  const automaticElectionIds = await ensureAutomaticRecurringElections(supabase);
  const latestElections = await fetchLatestFinishedElections(supabase);
  const requesterSupabase = getUserScopedSupabase(accessToken);
  const previousState = await fetchStoredElectionOfficeState(supabase);
  const settlements = [];
  const activeAssignmentsByUser = new Map();
  const impactedProfileIds = new Set();

  for (const election of latestElections) {
    const { data: authoritativeSettlement, error: settlementError } = await requesterSupabase.rpc(
      'settle_election_offices',
      { p_election_id: election.id }
    );

    if (settlementError || authoritativeSettlement?.success === false) {
      throw settlementError || new Error('A apuração autoritativa da eleição falhou.');
    }

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

  await publishElectionOfficeGazetteEntries(supabase, {
    previousState,
    activeAssignments,
  });

  await syncParliamentMemberships(supabase, {
    previousState,
    activeAssignments,
  });

  await syncActiveElectionProfileRoles(supabase, activeAssignments);

  const clearedMinisterUserIds = await clearMinistersWhenExecutiveTermChanges(supabase, {
    previousState,
    activeAssignments,
  });

  await clearStaleProfileOfficeRoles(supabase, {
    previousState,
    activeAssignments,
    settlements,
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
    ...clearedMinisterUserIds,
  ]);

  return {
    processedElectionIds: settlements.map((settlement) => settlement.electionId),
    automaticElectionIds,
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

  const supabase = getServerSupabase();

  try {
    const requester = await ensureAdminRequester(supabase, request);
    enforceElectionSyncRateLimit(requester.user.id);
    const result = await syncElectionOfficesState({ accessToken: requester.accessToken });
    json(response, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;
    console.error('[elections:sync-offices]', error);
    json(response, statusCode, {
      error: error instanceof Error ? error.message : 'Não foi possível sincronizar os cargos eleitorais.',
    });
  }
};

export const submitPresidentialCandidacyHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const { user: requester } = await ensureAuthenticatedRequester(supabase, request);
    const payload = await readJsonBody(request);
    const electionId = trimString(payload.electionId);
    const selectedViceCandidateId = trimString(payload.viceCandidateId);
    const bio = trimString(payload.bio);
    const proposals = trimString(payload.proposals);
    const campaignPhotoUrl = trimString(payload.campaignPhotoUrl);

    if (!electionId || !selectedViceCandidateId || !bio || !proposals || !campaignPhotoUrl) {
      throw createHttpError('Dados incompletos para registrar a chapa presidencial.', 400);
    }

    if (selectedViceCandidateId === requester.id) {
      throw createHttpError('Voce nao pode escolher a si mesmo como vice-presidente.', 400);
    }

    const election = await fetchElectionById(supabase, electionId);

    if (!election?.id) {
      throw createHttpError('Eleicao nao encontrada.', 404);
    }

    await ensurePresidentialElectionSubmissionAllowed(supabase, election, requester.id);

    const [
      requesterProfile,
      viceProfile,
      requesterPartyId,
      activeCandidacy,
      pendingTrackerNotifications,
      vicePendingInvitations,
      electionParticipantConflicts,
    ] = await Promise.all([
      fetchProfileById(supabase, requester.id),
      fetchProfileById(supabase, selectedViceCandidateId),
      fetchPartyMembership(supabase, requester.id),
      fetchActiveCandidacyForUser(supabase, requester.id),
      fetchUserNotificationsByType(supabase, requester.id, VICE_CANDIDACY_TRACKER_TYPE),
      fetchUserNotificationsByType(supabase, selectedViceCandidateId, VICE_CANDIDACY_INVITATION_TYPE),
      fetchElectionParticipantConflicts(supabase, electionId, [requester.id, selectedViceCandidateId]),
    ]);

    if (!requesterProfile?.id) {
      throw createHttpError('Perfil do candidato nao encontrado.', 404);
    }

    if (!viceProfile?.id) {
      throw createHttpError('Perfil do vice-presidente nao encontrado.', 404);
    }

    if (['Admin', 'Presidente'].includes(viceProfile.role)) {
      throw createHttpError('O usuario selecionado nao pode compor a chapa como vice-presidente.', 400);
    }

    if (activeCandidacy?.id) {
      throw createHttpError('Voce ja possui uma candidatura ativa no momento.', 409);
    }

    if (
      pendingTrackerNotifications.some((notification) =>
        isPendingNotificationStatus(getNotificationMetadata(notification).status)
      )
    ) {
      throw createHttpError('Ja existe uma chapa presidencial aguardando aceite do vice em seu nome.', 409);
    }

    if (
      vicePendingInvitations.some((notification) =>
        matchesViceRequestMetadata(getNotificationMetadata(notification), {
          electionId,
          status: 'pending',
        })
      )
    ) {
      throw createHttpError('O vice selecionado ja possui um convite pendente para esta eleicao.', 409);
    }

    if (electionParticipantConflicts.length) {
      throw createHttpError(
        'Um dos participantes ja esta vinculado a outra candidatura ativa nesta eleicao.',
        409
      );
    }

    const party = await fetchPartyById(supabase, requesterPartyId);
    const electoralNumber = trimString(payload.electoralNumber);
    if (electoralNumber && (!/^[0-9]{2}$/.test(electoralNumber) || (party ? electoralNumber !== party.electoral_number : !electoralNumber.startsWith('0')))) {
      throw createHttpError('Confira o número eleitoral da chapa e o prefixo partidário.', 400);
    }
    const candidateName = resolveProfileDisplayName(requesterProfile, 'Candidato');
    const viceName = resolveProfileDisplayName(viceProfile, 'Vice indicado');
    const nowIso = new Date().toISOString();

    const invitationMetadata = {
      status: 'pending',
      submitted_at: nowIso,
      election_id: election.id,
      election_name: election.name,
      party_id: party?.id || null,
      party_name: party?.name || null,
      party_acronym: party?.acronym || null,
      candidate_user_id: requester.id,
      candidate_name: candidateName,
      vice_candidate_id: viceProfile.id,
      vice_candidate_name: viceName,
      political_name: requesterProfile.full_name,
      bio,
      proposals,
      campaign_photo_url: campaignPhotoUrl,
      electoral_number: electoralNumber || null,
    };

    const trackerMetadata = {
      ...invitationMetadata,
      status: 'pending',
    };

    const { data: invitationRow, error: invitationError } = await supabase.from('notifications')
      .insert({
        user_id: viceProfile.id,
        sender_id: requester.id,
        type: VICE_CANDIDACY_INVITATION_TYPE,
        content: `${candidateName} convidou voce para compor a chapa presidencial da eleicao "${election.name}".`,
        link: '/services/elections',
        is_read: false,
        metadata: invitationMetadata,
      })
      .select('id')
      .single();

    if (invitationError) {
      throw invitationError;
    }

    const { error: trackerError } = await supabase.from('notifications').insert({
        user_id: requester.id,
        sender_id: requester.id,
        type: VICE_CANDIDACY_TRACKER_TYPE,
        content: `Convite de vice-presidente enviado para ${viceName} na eleicao "${election.name}".`,
        link: '/services/elections',
        is_read: false,
        metadata: trackerMetadata,
      });

    if (trackerError) {
      if (invitationRow?.id) {
        await supabase.from('notifications').delete().eq('id', invitationRow.id);
      }
      throw trackerError;
    }

    json(response, 200, {
      success: true,
      pendingViceApproval: true,
      message:
        'O convite foi enviado ao vice escolhido. A candidatura seguira para analise quando ele aceitar a chapa.',
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;

    console.error('[elections:submit-presidential-candidacy]', error);
    json(response, statusCode, {
      error:
        error instanceof Error ? error.message : 'Nao foi possivel registrar a chapa presidencial.',
    });
  }
};

export const respondViceCandidacyInvitationHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const { user: requester } = await ensureAuthenticatedRequester(supabase, request);
    const payload = await readJsonBody(request);
    const invitationNotificationId = trimString(payload.notificationId);
    const accepted = Boolean(payload.accepted);

    if (!invitationNotificationId) {
      throw createHttpError('Convite nao informado.', 400);
    }

    const { data: invitationNotification, error: invitationError } = await supabase
      .from('notifications')
      .select('id, user_id, sender_id, type, content, link, is_read, metadata, created_at')
      .eq('id', invitationNotificationId)
      .maybeSingle();

    if (invitationError) {
      throw invitationError;
    }

    if (!invitationNotification?.id || invitationNotification.type !== VICE_CANDIDACY_INVITATION_TYPE) {
      throw createHttpError('Convite de vice nao encontrado.', 404);
    }

    if (invitationNotification.user_id !== requester.id) {
      throw createHttpError('Voce nao tem permissao para responder este convite.', 403);
    }

    const invitationMetadata = getNotificationMetadata(invitationNotification);

    if (!matchesViceRequestMetadata(invitationMetadata, { status: 'pending' })) {
      throw createHttpError('Este convite de vice ja foi respondido.', 409);
    }

    const electionId = trimString(invitationMetadata.election_id);
    const candidateUserId = trimString(invitationMetadata.candidate_user_id);
    const viceCandidateId = trimString(invitationMetadata.vice_candidate_id || requester.id);

    if (!electionId || !candidateUserId || !viceCandidateId) {
      throw createHttpError('Os dados do convite estao incompletos.', 400);
    }

    const [
      election,
      candidateProfile,
      viceProfile,
      candidateActiveCandidacy,
      electionParticipantConflicts,
    ] = await Promise.all([
      fetchElectionById(supabase, electionId),
      fetchProfileById(supabase, candidateUserId),
      fetchProfileById(supabase, viceCandidateId),
      fetchActiveCandidacyForUser(supabase, candidateUserId),
      fetchElectionParticipantConflicts(supabase, electionId, [candidateUserId, viceCandidateId]),
    ]);

    if (!election?.id) {
      throw createHttpError('A eleicao vinculada a este convite nao foi encontrada.', 404);
    }

    if (election.status !== 'Candidacy') {
      throw createHttpError('A fase de candidaturas desta eleicao ja foi encerrada.', 400);
    }

    if (!candidateProfile?.id || !viceProfile?.id) {
      throw createHttpError('Nao foi possivel localizar os perfis da chapa.', 404);
    }

    const candidateName = resolveProfileDisplayName(candidateProfile, 'Candidato');
    const viceName = resolveProfileDisplayName(viceProfile, 'Vice indicado');

    if (!accepted) {
      await updateNotificationMetadata(supabase, invitationNotification.id, {
        ...invitationMetadata,
        status: 'rejected',
        responded_at: new Date().toISOString(),
      }, { is_read: true });

      await updateTrackerNotificationsStatus(supabase, {
        candidateUserId,
        electionId,
        viceCandidateId,
        nextStatus: 'rejected',
      });

      const { error: candidateNotificationError } = await supabase.from('notifications').insert({
        user_id: candidateUserId,
        sender_id: requester.id,
        type: VICE_CANDIDACY_REJECTED_TYPE,
        content: `${viceName} recusou compor sua chapa presidencial na eleicao "${election.name}". Escolha outro vice para seguir.`,
        link: '/services/elections',
        is_read: false,
        metadata: {
          election_id: electionId,
          election_name: election.name,
          vice_candidate_id: viceCandidateId,
          vice_candidate_name: viceName,
        },
      });

      if (candidateNotificationError) {
        throw candidateNotificationError;
      }

      json(response, 200, {
        success: true,
        message: 'Convite recusado. O candidato ja foi notificado para indicar outro vice.',
      });
      return;
    }

    if (candidateActiveCandidacy?.id) {
      throw createHttpError('O candidato ja possui uma candidatura ativa e este convite nao pode mais ser aceito.', 409);
    }

    if (electionParticipantConflicts.length) {
      throw createHttpError(
        'Um dos participantes ja esta vinculado a outra candidatura ativa nesta eleicao.',
        409
      );
    }

    const { data: candidateRow, error: candidateInsertError } = await supabase
      .from('candidates')
      .insert({
        election_id: electionId,
        user_id: candidateUserId,
        party_id: invitationMetadata.party_id || null,
        vice_candidate_id: viceCandidateId,
        political_name: trimString(invitationMetadata.political_name),
        bio: trimString(invitationMetadata.bio),
        proposals: trimString(invitationMetadata.proposals),
        campaign_photo_url: trimString(invitationMetadata.campaign_photo_url),
        electoral_number: invitationMetadata.electoral_number || null,
        status: 'Pendente',
      })
      .select('id')
      .single();

    if (candidateInsertError) {
      throw candidateInsertError;
    }

    await updateNotificationMetadata(supabase, invitationNotification.id, {
      ...invitationMetadata,
      status: 'accepted',
      responded_at: new Date().toISOString(),
      candidate_id: candidateRow?.id || null,
    }, { is_read: true });

    await updateTrackerNotificationsStatus(supabase, {
      candidateUserId,
      electionId,
      viceCandidateId,
      nextStatus: 'accepted',
      extraMetadata: {
        candidate_id: candidateRow?.id || null,
      },
    });

    const { error: acceptedNotificationError } = await supabase.from('notifications').insert({
      user_id: candidateUserId,
      sender_id: requester.id,
      type: VICE_CANDIDACY_ACCEPTED_TYPE,
      content: `${viceName} aceitou compor sua chapa presidencial na eleicao "${election.name}". A candidatura foi enviada para analise.`,
      link: '/services/elections',
      is_read: false,
      metadata: {
        election_id: electionId,
        election_name: election.name,
        vice_candidate_id: viceCandidateId,
        vice_candidate_name: viceName,
        candidate_id: candidateRow?.id || null,
      },
    });

    if (acceptedNotificationError) {
      throw acceptedNotificationError;
    }

    json(response, 200, {
      success: true,
      message: 'Chapa aceita com sucesso. A candidatura presidencial foi enviada para analise.',
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;

    console.error('[elections:respond-vice-candidacy-invitation]', error);
    json(response, statusCode, {
      error:
        error instanceof Error ? error.message : 'Nao foi possivel responder ao convite de vice.',
    });
  }
};

export const cancelCandidacyHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const { user: requester } = await ensureAuthenticatedRequester(supabase, request);
    const payload = await readJsonBody(request);
    const candidateId = trimString(payload.candidateId);
    const trackerNotificationId = trimString(payload.trackerNotificationId);

    if (!candidateId && !trackerNotificationId) {
      throw createHttpError('Informe a candidatura ou o convite pendente que deseja retirar.', 400);
    }

    if (trackerNotificationId) {
      const { data: trackerNotification, error: trackerError } = await supabase
        .from('notifications')
        .select('id, user_id, sender_id, type, content, link, is_read, metadata, created_at')
        .eq('id', trackerNotificationId)
        .maybeSingle();

      if (trackerError) {
        throw trackerError;
      }

      if (!trackerNotification?.id || trackerNotification.type !== VICE_CANDIDACY_TRACKER_TYPE) {
        throw createHttpError('Convite pendente nao encontrado.', 404);
      }

      if (trackerNotification.user_id !== requester.id) {
        throw createHttpError('Voce nao tem permissao para retirar esta candidatura.', 403);
      }

      await cancelPendingViceInvitation(supabase, {
        trackerNotification,
        requesterId: requester.id,
      });

      json(response, 200, {
        success: true,
        message: 'Convite de vice retirado. A candidatura nao sera enviada.',
      });
      return;
    }

    const { data: candidacy, error: candidacyError } = await supabase
      .from('candidates')
      .select('id, election_id, user_id, vice_candidate_id, status, political_name, election:elections(name)')
      .eq('id', candidateId)
      .maybeSingle();

    if (candidacyError) {
      throw candidacyError;
    }

    if (!candidacy?.id) {
      throw createHttpError('Candidatura nao encontrada.', 404);
    }

    if (candidacy.user_id !== requester.id) {
      throw createHttpError('Voce nao tem permissao para retirar esta candidatura.', 403);
    }

    if (!ACTIVE_CANDIDACY_STATUSES.includes(candidacy.status)) {
      throw createHttpError('Apenas candidaturas pendentes ou aprovadas podem ser retiradas.', 400);
    }

    const { error: deleteError } = await supabase
      .from('candidates')
      .delete()
      .eq('id', candidacy.id);

    if (deleteError) {
      throw deleteError;
    }

    if (candidacy.vice_candidate_id) {
      const { error: viceNotificationError } = await supabase.from('notifications').insert({
        user_id: candidacy.vice_candidate_id,
        sender_id: requester.id,
        type: 'vice_candidacy_cancelled',
        content: `A candidatura "${candidacy.political_name || 'presidencial'}" foi retirada pelo candidato principal.`,
        link: '/services/elections',
        is_read: false,
        metadata: {
          candidate_id: candidacy.id,
          election_id: candidacy.election_id,
          election_name: candidacy.election?.name || null,
          status: 'cancelled',
        },
      });

      if (viceNotificationError) {
        throw viceNotificationError;
      }
    }

    json(response, 200, {
      success: true,
      message: 'Candidatura retirada com sucesso.',
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;

    console.error('[elections:cancel-candidacy]', error);
    json(response, statusCode, {
      error: error instanceof Error ? error.message : 'Nao foi possivel retirar a candidatura.',
    });
  }
};

export const resignPresidencyHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const { user: requester, accessToken } = await ensureAuthenticatedRequester(supabase, request);
    const executiveState = await fetchExecutiveConstitutionalState(supabase);
    const currentPresidentId = executiveState?.currentPresidentProfile?.id || null;
    const currentViceId = executiveState?.currentViceProfile?.id || null;

    if (!currentPresidentId || currentPresidentId !== requester.id) {
      throw createHttpError('Apenas o presidente em exercicio pode registrar a renuncia.', 403);
    }

    const userScopedSupabase = getUserScopedSupabase(accessToken);
    const { data, error } = await userScopedSupabase.rpc('resign_presidency');

    if (error || !data?.success) {
      throw createHttpError(data?.message || error?.message || 'Nao foi possivel registrar a renuncia presidencial.', 400);
    }

    if (currentViceId && executiveState?.currentTerm?.id) {
      const settings = await fetchExecutiveGovernanceSettings(supabase);

      await saveExecutiveGovernanceSettings(supabase, {
        ...settings.value,
        officeVacancy: {
          vacant: false,
          since: null,
          reason: '',
          triggered_by: null,
        },
        presidentialSuccession: {
          promoted_president_id: currentViceId,
          previous_vice_id: currentViceId,
          former_president_id: currentPresidentId,
          term_election_id: executiveState.currentTerm.id,
          promoted_at: new Date().toISOString(),
          reason: 'Renuncia presidencial',
          triggered_by: requester.id,
        },
      });

      const { error: successionNotificationError } = await supabase.from('notifications').insert([
        {
          user_id: currentViceId,
          sender_id: requester.id,
          type: 'executive_succession',
          content: 'Com a renuncia presidencial, voce assumiu automaticamente a Presidencia da Republica.',
          link: '/dashboard/president',
          is_read: false,
          metadata: {
            succession_type: 'vice_assumed_presidency',
            term_election_id: executiveState.currentTerm.id,
            former_president_id: currentPresidentId,
          },
        },
        {
          user_id: currentPresidentId,
          sender_id: requester.id,
          type: 'executive_succession',
          content: 'Sua renuncia foi registrada e a Vice-Presidencia assumiu automaticamente a Presidencia da Republica.',
          link: '/services/elections',
          is_read: false,
          metadata: {
            succession_type: 'vice_assumed_presidency',
            term_election_id: executiveState.currentTerm.id,
            successor_id: currentViceId,
          },
        },
      ]);

      if (successionNotificationError) {
        throw successionNotificationError;
      }

      json(response, 200, {
        success: true,
        viceAssumedOffice: true,
        message: 'Renuncia registrada com sucesso. O vice-presidente assumiu automaticamente a Presidencia.',
      });
      return;
    }

    const settings = await fetchExecutiveGovernanceSettings(supabase);
    await saveExecutiveGovernanceSettings(supabase, {
      ...settings.value,
      officeVacancy: {
        vacant: true,
        since: new Date().toISOString(),
        reason: 'Renuncia presidencial',
        triggered_by: requester.id,
      },
      presidentialSuccession: null,
    });

    json(response, 200, {
      success: true,
      viceAssumedOffice: false,
      message: 'Renuncia registrada com sucesso. O cargo presidencial ficou vago por ausencia de vice ativo.',
    });
  } catch (error) {
    const statusCode = error?.statusCode || 500;

    console.error('[elections:resign-presidency]', error);
    json(response, statusCode, {
      error:
        error instanceof Error ? error.message : 'Nao foi possivel registrar a renuncia presidencial.',
    });
  }
};
