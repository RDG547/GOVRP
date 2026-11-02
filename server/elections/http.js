import {withWorldRequest,worldServerFetch} from '../world/request.js';
import {assertRealWorldAction,isPlatformAdmin} from '../admin/development.js';
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
      {global:{fetch:worldServerFetch},
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
      global: {fetch:worldServerFetch,
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

const updateProfileIfUnchanged = async (supabase, profile, patch) => {
  let query = supabase.from('profiles').update(patch).eq('id', profile.id)
    .eq('role', profile.role).eq('manual_role_override', profile.manual_role_override);
  query = profile.role_assigned_at ? query.eq('role_assigned_at', profile.role_assigned_at) : query.is('role_assigned_at', null);
  const { error } = await query;
  if (error) throw error;
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

  await assertRealWorldAction(supabase,authData.user.id);
  return {
    user: authData.user,
    accessToken: token,
  };
};

const ensureAdminRequester = async (supabase, request) => {
  const requester = await ensureAuthenticatedRequester(supabase, request);
  const profile = await fetchProfileById(supabase, requester.user.id);

  if (!await isPlatformAdmin(supabase,requester.user.id)) {
    throw createHttpError('Apenas administradores podem sincronizar cargos eleitorais.', 403);
  }

  await assertRealWorldAction(supabase,requester.user.id);
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
    .select('id, name, voting_end_date, original_term_ends_at, election_type_id, election_types(id, name, voting_system, requires_vice_candidate)')
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
  const termEndAt = election.original_term_ends_at || addOneMonth(termStartAt);
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
      .select('id, name, description, election_type_id, seats_available, candidacy_start_date, candidacy_end_date, voting_start_date, voting_end_date')
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
      seats_available: lastElection.seats_available ?? null,
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

export const syncElectionOfficesState = async ({ accessToken } = {}) => {
  const supabase = getServerSupabase();
  const requesterSupabase = getUserScopedSupabase(accessToken);
  const automaticElectionIds = await ensureAutomaticRecurringElections(supabase);
  const elections = await fetchLatestFinishedElections(supabase);
  const settlements = [];
  for (const election of elections) {
    const { data, error } = await requesterSupabase.rpc('settle_election_offices', { p_election_id: election.id });
    if (error || data?.success === false) throw error || new Error('Não foi possível concluir a apuração.');
    settlements.push({ electionId: election.id, status: data.status, officeRole: election.election_types?.name, winnerCount: data.winners?.length || 0 });
  }
  // Reconciliation, expiry and the shared snapshot are one locked transaction.
  // A delayed HTTP response cannot overwrite a newer presidency or membership.
  const { error } = await requesterSupabase.rpc('reconcile_current_electoral_offices');
  if (error) throw error;
  const state = await fetchStoredElectionOfficeState(supabase);
  const assignments = state.active_assignments || [];
  return { processedElectionIds: elections.map(e => e.id), automaticElectionIds,
    grantedUserIds: dedupe(assignments.map(a => a.user_id)), changedUserIds: dedupe(assignments.map(a => a.user_id)), notificationsCreated: 0, settlements };
};

const raw_syncElectionOfficesHandler = async (request, response) => {
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

const raw_submitPresidentialCandidacyHandler = async (request, response) => {
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
    if (!/^[0-9]{2}$/.test(electoralNumber)) {
      throw createHttpError('Informe um número com 2 dígitos para a chapa presidencial.', 400);
    }
    if (party && electoralNumber !== party.electoral_number) {
      throw createHttpError(`Use o número eleitoral do partido: ${party.electoral_number}.`, 400);
    }
    const {data:numberConflicts,error:numberError}=await supabase.from('candidates').select('id,status').eq('election_id',electionId).eq('electoral_number',electoralNumber);
    if(numberError)throw numberError;
    if((numberConflicts||[]).some(candidate=>!['rejected','rejeitado','cancelled','cancelado','cancelada','withdrawn'].includes(String(candidate.status||'').toLowerCase()))) {
      throw createHttpError('Este número já está sendo utilizado nesta eleição.',409);
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

const raw_respondViceCandidacyInvitationHandler = async (request, response) => {
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
      if (candidateInsertError.message?.includes('Este número já está') || (candidateInsertError.code==='23505' && candidateInsertError.message?.includes('candidate_electoral_number_unique'))) {
        throw createHttpError('Este número já está sendo utilizado nesta eleição.',409);
      }
      if (/^(Use |Informe |Defina |O partido)/.test(candidateInsertError.message||'')) throw createHttpError(candidateInsertError.message,400);
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

const raw_cancelCandidacyHandler = async (request, response) => {
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

      const { data: invitationElection, error: invitationElectionError } = await supabase.from('elections')
        .select('status,voting_start_date').eq('id', trackerNotification.metadata?.election_id).maybeSingle();
      if (invitationElectionError) throw invitationElectionError;
      if (!invitationElection || Date.now() >= Date.parse(invitationElection.voting_start_date) || ['Voting','Finished','Cancelled'].includes(invitationElection.status)) {
        throw createHttpError('O prazo de retirada terminou. Este convite permanece no histórico eleitoral.', 400);
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

    const scoped = getUserScopedSupabase(requester.accessToken);
    const { error: withdrawalError } = await scoped.rpc('withdraw_my_candidacy', { p_candidate_id: candidateId });
    if (withdrawalError) throw createHttpError(withdrawalError.message, 400);

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

const raw_resignPresidencyHandler = async (request, response) => {
  if (!ensureMethod(request, response, 'POST')) {
    return;
  }

  const supabase = getServerSupabase();

  try {
    const { user: requester, accessToken } = await ensureAuthenticatedRequester(supabase, request);
    const userScopedSupabase = getUserScopedSupabase(accessToken);
    const { data, error } = await userScopedSupabase.rpc('resign_presidency');
    if (error || !data?.success) throw createHttpError(data?.message || error?.message || 'Não foi possível registrar a renúncia.', 400);
    const result = await userScopedSupabase.rpc('get_executive_state');
    json(response, 200, { success: true, viceAssumedOffice: result.data?.government?.source === 'vice_succession', message: data.message });
  } catch (error) {
    const statusCode = error?.statusCode || 500;

    console.error('[elections:resign-presidency]', error);
    json(response, statusCode, {
      error:
        error instanceof Error ? error.message : 'Nao foi possivel registrar a renuncia presidencial.',
    });
  }
};

export const syncElectionOfficesHandler=(request,response)=>withWorldRequest(request,()=>raw_syncElectionOfficesHandler(request,response));
export const submitPresidentialCandidacyHandler=(request,response)=>withWorldRequest(request,()=>raw_submitPresidentialCandidacyHandler(request,response));
export const respondViceCandidacyInvitationHandler=(request,response)=>withWorldRequest(request,()=>raw_respondViceCandidacyInvitationHandler(request,response));
export const cancelCandidacyHandler=(request,response)=>withWorldRequest(request,()=>raw_cancelCandidacyHandler(request,response));
export const resignPresidencyHandler=(request,response)=>withWorldRequest(request,()=>raw_resignPresidencyHandler(request,response));
