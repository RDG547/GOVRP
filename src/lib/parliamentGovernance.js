import { fetchPublicProfileRows as fetchPublicProfiles } from './publicProfileQueries.js';
import {
  HOUSE_PRESIDENT_ROLES,
  HOUSE_VICE_PRESIDENT_ROLES,
  PARLIAMENT_LEADERSHIP_ROLES,
  autoCloseExpiredVotings,
} from './parliament.js';
import { resolveParliamentHouseIdFromRole } from './roleResolution.js';

export const PARLIAMENT_HOUSE_IDS = {
  chamber: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  senate: 'fedcba09-8765-4321-0987-654321fedcba',
};

export const DEFAULT_PARLIAMENT_HOUSE_ID = PARLIAMENT_HOUSE_IDS.chamber;

export const COMMISSION_TYPE_OPTIONS = [
  {
    value: 'permanent',
    label: 'Comissão Permanente',
    description: 'Estrutura contínua da Casa para matérias recorrentes.',
  },
  {
    value: 'temporary',
    label: 'Comissão Temporária',
    description: 'Depende de maioria simples do plenário e oficialização da Presidência.',
  },
  {
    value: 'cpi',
    label: 'CPI',
    description: 'Comissão de inquérito criada por requerimento de 1/3 da Casa.',
  },
  {
    value: 'cpmi',
    label: 'CPMI',
    description: 'Comissão mista de inquérito com apoio qualificado nas duas Casas.',
  },
];

export const COMMISSION_STATUS_META = {
  draft: {
    label: 'Rascunho',
    className: 'bg-muted text-muted-foreground border-border',
  },
  collecting_support: {
    label: 'Coletando Apoios',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  pending_plenary: {
    label: 'Aguardando Plenário',
    className: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  approved_pending_officialization: {
    label: 'Aguardando Oficialização',
    className: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  active: {
    label: 'Ativa',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  completed: {
    label: 'Encerrada',
    className: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  },
  rejected: {
    label: 'Rejeitada',
    className: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  archived: {
    label: 'Arquivada',
    className: 'bg-muted text-muted-foreground border-border',
  },
};

export const LEADERSHIP_POSITION_OPTIONS = [
  { value: 'president', label: 'Presidente da Casa' },
  { value: 'vice_president', label: 'Vice-Presidente da Casa' },
];

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

const todayDate = () => new Date().toISOString().slice(0, 10);

const isDateActive = (dateValue) => !dateValue || dateValue >= todayDate();

const mapById = (rows = []) =>
  rows.reduce((accumulator, row) => {
    accumulator[row.id] = row;
    return accumulator;
  }, {});

const mergeProfilesIntoMembers = (members = [], profilesMap = {}, partiesMap = {}) =>
  members.map((member) => ({
    ...member,
    profile: profilesMap[member.user_id] || null,
    party: member.party_id ? partiesMap[member.party_id] || null : null,
  }));

const fetchProfilesMap = async (supabase, profileIds = []) => {
  const ids = dedupe(profileIds);
  if (!ids.length) {
    return {};
  }

  return Object.fromEntries(await fetchPublicProfiles(ids, supabase));
};

const fetchPartiesMap = async (supabase, partyIds = []) => {
  const ids = dedupe(partyIds);
  if (!ids.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('political_parties')
    .select('id, name, acronym, logo_url')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return mapById(data || []);
};

const fetchParliamentMembersMap = async (supabase, memberIds = []) => {
  const ids = dedupe(memberIds);
  if (!ids.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('parliament_members')
    .select('id, user_id, house_id, party_id, term_start_date, term_end_date')
    .in('id', ids);

  if (error) {
    throw error;
  }

  const members = data || [];
  const [profilesMap, partiesMap] = await Promise.all([
    fetchProfilesMap(
      supabase,
      members.map((member) => member.user_id)
    ),
    fetchPartiesMap(
      supabase,
      members.map((member) => member.party_id)
    ),
  ]);

  return mapById(mergeProfilesIntoMembers(members, profilesMap, partiesMap));
};

export const isGovernanceSchemaMissing = (error) => {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
  return /parliament_(commission|leadership)/i.test(message);
};

export const isInquiryCommission = (commissionType = '') =>
  commissionType === 'cpi' || commissionType === 'cpmi';

export const isSenateHouseName = (houseName = '') =>
  houseName.toLowerCase().includes('senado');

export const getCommissionTypeLabel = (commissionType = '') =>
  COMMISSION_TYPE_OPTIONS.find((option) => option.value === commissionType)?.label || commissionType;

export const getCommissionStatusMeta = (status = '') =>
  COMMISSION_STATUS_META[status] || {
    label: status,
    className: 'bg-muted text-muted-foreground border-border',
  };

export const getCommissionScopeLabel = (scope = '') =>
  scope === 'mixed' ? 'Comissão Mista' : 'Casa Legislativa';

export const getLeadershipPositionLabel = (houseName = '', position = '') => {
  const isSenate = isSenateHouseName(houseName);

  if (position === 'president') {
    return isSenate ? 'Presidente do Senado' : 'Presidente da Câmara dos Deputados';
  }

  if (position === 'vice_president') {
    return isSenate ? 'Vice-Presidente do Senado Federal' : 'Vice-Presidente da Câmara dos Deputados';
  }

  return position;
};

export const canManageParliamentGovernance = (role = '') =>
  role === 'Admin' || role === 'Presidente' || PARLIAMENT_LEADERSHIP_ROLES.includes(role);

export const getLeadershipElectionStatusMeta = (status = '') => {
  switch (status) {
    case 'open':
      return {
        label: 'Aberta',
        className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    case 'closed':
      return {
        label: 'Concluída',
        className: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      };
    case 'tied':
      return {
        label: 'Empatada',
        className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    case 'cancelled':
      return {
        label: 'Cancelada',
        className: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      };
    default:
      return {
        label: status,
        className: 'bg-muted text-muted-foreground border-border',
      };
  }
};

export const refreshParliamentGovernanceState = async (supabase) => {
  await autoCloseExpiredVotings(supabase);

  const { error } = await supabase.rpc('refresh_parliament_leadership_terms');
  if (error && !isGovernanceSchemaMissing(error)) {
    throw error;
  }

  return {
    schemaReady: !error,
    error: error || null,
  };
};

export const fetchCommissionGovernanceData = async (supabase, { houseId = null } = {}) => {
  try {
    let baseHouseLinksQuery = supabase
      .from('parliament_commission_houses')
      .select('commission_id, house_id');

    if (houseId) {
      baseHouseLinksQuery = baseHouseLinksQuery.eq('house_id', houseId);
    }

    const { data: matchingHouseLinks, error: matchingHouseLinksError } = await baseHouseLinksQuery;
    if (matchingHouseLinksError) {
      throw matchingHouseLinksError;
    }

    const commissionIds = dedupe((matchingHouseLinks || []).map((row) => row.commission_id));
    if (!commissionIds.length) {
      return {
        schemaReady: true,
        commissions: [],
      };
    }

    const [
      commissionsResponse,
      houseLinksResponse,
      housesResponse,
      commissionMembersResponse,
      commissionSupportsResponse,
    ] = await Promise.all([
      supabase
        .from('parliament_commissions')
        .select('id, title, summary, purpose, scope, type, status, requested_by, officialized_by, voting_id, reporter_member_id, officialized_at, opened_at, closed_at, final_report, final_report_submitted_at, created_at, updated_at')
        .in('id', commissionIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('parliament_commission_houses')
        .select('commission_id, house_id')
        .in('commission_id', commissionIds),
      supabase.from('parliament_houses').select('id, name, description'),
      supabase
        .from('parliament_commission_members')
        .select('commission_id, member_id, role, appointed_at, appointed_by')
        .in('commission_id', commissionIds),
      supabase
        .from('parliament_commission_supports')
        .select('commission_id, member_id, created_at')
        .in('commission_id', commissionIds),
    ]);

    if (commissionsResponse.error) {
      throw commissionsResponse.error;
    }
    if (houseLinksResponse.error) {
      throw houseLinksResponse.error;
    }
    if (housesResponse.error) {
      throw housesResponse.error;
    }
    if (commissionMembersResponse.error) {
      throw commissionMembersResponse.error;
    }
    if (commissionSupportsResponse.error) {
      throw commissionSupportsResponse.error;
    }

    const commissions = commissionsResponse.data || [];
    const houseLinks = houseLinksResponse.data || [];
    const housesMap = mapById(housesResponse.data || []);
    const commissionMembers = commissionMembersResponse.data || [];
    const commissionSupports = commissionSupportsResponse.data || [];

    const relatedHouseIds = dedupe(houseLinks.map((link) => link.house_id));
    const relatedMemberIds = dedupe([
      ...commissionMembers.map((item) => item.member_id),
      ...commissionSupports.map((item) => item.member_id),
      ...commissions.map((item) => item.reporter_member_id),
    ]);
    const relatedProfileIds = dedupe([
      ...commissions.map((item) => item.requested_by),
      ...commissions.map((item) => item.officialized_by),
      ...commissionMembers.map((item) => item.appointed_by),
    ]);
    const relatedVotingIds = dedupe(commissions.map((item) => item.voting_id));

    const [
      parliamentMembersMap,
      profilesMap,
      activeMembersResponse,
      votingsResponse,
      votingVotesResponse,
    ] = await Promise.all([
      fetchParliamentMembersMap(supabase, relatedMemberIds),
      fetchProfilesMap(supabase, relatedProfileIds),
      relatedHouseIds.length
        ? supabase
            .from('parliament_members')
            .select('id, house_id, term_end_date')
            .in('house_id', relatedHouseIds)
        : Promise.resolve({ data: [], error: null }),
      relatedVotingIds.length
        ? supabase
            .from('parliament_votings')
            .select('id, house_id, title, description, type, related_id, status, end_date, created_at')
            .in('id', relatedVotingIds)
        : Promise.resolve({ data: [], error: null }),
      relatedVotingIds.length
        ? supabase
            .from('parliament_voting_votes')
            .select('voting_id, member_id, vote, created_at')
            .in('voting_id', relatedVotingIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (activeMembersResponse.error) {
      throw activeMembersResponse.error;
    }
    if (votingsResponse.error) {
      throw votingsResponse.error;
    }
    if (votingVotesResponse.error) {
      throw votingVotesResponse.error;
    }

    const activeMembersByHouse = (activeMembersResponse.data || []).reduce((accumulator, item) => {
      if (!isDateActive(item.term_end_date)) {
        return accumulator;
      }

      accumulator[item.house_id] = (accumulator[item.house_id] || 0) + 1;
      return accumulator;
    }, {});

    const housesByCommission = houseLinks.reduce((accumulator, row) => {
      accumulator[row.commission_id] = accumulator[row.commission_id] || [];
      if (housesMap[row.house_id]) {
        accumulator[row.commission_id].push(housesMap[row.house_id]);
      }
      return accumulator;
    }, {});

    const membersByCommission = commissionMembers.reduce((accumulator, row) => {
      accumulator[row.commission_id] = accumulator[row.commission_id] || [];
      accumulator[row.commission_id].push({
        ...row,
        member: parliamentMembersMap[row.member_id] || null,
        appointedBy: profilesMap[row.appointed_by] || null,
      });
      return accumulator;
    }, {});

    const supportsByCommission = commissionSupports.reduce((accumulator, row) => {
      accumulator[row.commission_id] = accumulator[row.commission_id] || [];
      accumulator[row.commission_id].push({
        ...row,
        member: parliamentMembersMap[row.member_id] || null,
      });
      return accumulator;
    }, {});

    const votingMap = mapById(votingsResponse.data || []);
    const votesByVoting = (votingVotesResponse.data || []).reduce((accumulator, row) => {
      accumulator[row.voting_id] = accumulator[row.voting_id] || [];
      accumulator[row.voting_id].push(row);
      return accumulator;
    }, {});

    return {
      schemaReady: true,
      commissions: commissions.map((commission) => {
        const houses = housesByCommission[commission.id] || [];
        const supports = supportsByCommission[commission.id] || [];

        return {
          ...commission,
          houses,
          requester: profilesMap[commission.requested_by] || null,
          officializer: profilesMap[commission.officialized_by] || null,
          reporter: commission.reporter_member_id ? parliamentMembersMap[commission.reporter_member_id] || null : null,
          members: membersByCommission[commission.id] || [],
          supports,
          supportStatusByHouse: houses.map((house) => {
            const signed = supports.filter((support) => support.member?.house_id === house.id).length;
            const activeMembers = activeMembersByHouse[house.id] || 0;
            const required = Math.max(1, Math.ceil(Math.max(activeMembers, 1) / 3));

            return {
              house,
              signed,
              activeMembers,
              required,
            };
          }),
          voting: commission.voting_id
            ? {
                ...votingMap[commission.voting_id],
                votes: votesByVoting[commission.voting_id] || [],
              }
            : null,
        };
      }),
    };
  } catch (error) {
    if (isGovernanceSchemaMissing(error)) {
      return {
        schemaReady: false,
        commissions: [],
        error,
      };
    }

    throw error;
  }
};

export const fetchLeadershipGovernanceData = async (supabase, { houseId = null } = {}) => {
  try {
    let electionsQuery = supabase
      .from('parliament_leadership_elections')
      .select('id, house_id, position, title, description, status, created_by, winner_member_id, start_at, end_at, concluded_at, created_at, updated_at')
      .order('created_at', { ascending: false });
    let termsQuery = supabase
      .from('parliament_leadership_terms')
      .select('id, house_id, position, member_id, elected_by_election_id, status, term_start_date, term_end_date, concluded_at, created_at, updated_at')
      .order('term_start_date', { ascending: false });

    if (houseId) {
      electionsQuery = electionsQuery.eq('house_id', houseId);
      termsQuery = termsQuery.eq('house_id', houseId);
    }

    const [electionsResponse, termsResponse, housesResponse] = await Promise.all([
      electionsQuery,
      termsQuery,
      supabase.from('parliament_houses').select('id, name, description'),
    ]);

    if (electionsResponse.error) {
      throw electionsResponse.error;
    }
    if (termsResponse.error) {
      throw termsResponse.error;
    }
    if (housesResponse.error) {
      throw housesResponse.error;
    }

    const elections = electionsResponse.data || [];
    const terms = termsResponse.data || [];
    const housesMap = mapById(housesResponse.data || []);
    const electionIds = dedupe(elections.map((item) => item.id));
    const relatedMemberIds = dedupe([
      ...elections.map((item) => item.winner_member_id),
      ...terms.map((item) => item.member_id),
    ]);
    const relatedProfileIds = dedupe(elections.map((item) => item.created_by));

    const [candidatesResponse, votesResponse] = await Promise.all([
      electionIds.length
        ? supabase
            .from('parliament_leadership_candidates')
            .select('id, election_id, member_id, nominated_by, manifesto, created_at')
            .in('election_id', electionIds)
        : Promise.resolve({ data: [], error: null }),
      electionIds.length
        ? supabase
            .from('parliament_leadership_votes')
            .select('id, election_id, voter_member_id, candidate_id, created_at')
            .in('election_id', electionIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (candidatesResponse.error) {
      throw candidatesResponse.error;
    }
    if (votesResponse.error) {
      throw votesResponse.error;
    }

    const candidates = candidatesResponse.data || [];
    const votes = votesResponse.data || [];

    const parliamentMembersMap = await fetchParliamentMembersMap(supabase, [
      ...relatedMemberIds,
      ...candidates.map((item) => item.member_id),
      ...votes.map((item) => item.voter_member_id),
    ]);
    const profilesMap = await fetchProfilesMap(supabase, [
      ...relatedProfileIds,
      ...candidates.map((item) => item.nominated_by),
    ]);

    const votesByCandidate = votes.reduce((accumulator, vote) => {
      accumulator[vote.candidate_id] = (accumulator[vote.candidate_id] || 0) + 1;
      return accumulator;
    }, {});

    const votesByElection = votes.reduce((accumulator, vote) => {
      accumulator[vote.election_id] = accumulator[vote.election_id] || [];
      accumulator[vote.election_id].push(vote);
      return accumulator;
    }, {});

    const candidatesByElection = candidates.reduce((accumulator, candidate) => {
      accumulator[candidate.election_id] = accumulator[candidate.election_id] || [];
      accumulator[candidate.election_id].push({
        ...candidate,
        votes: votesByCandidate[candidate.id] || 0,
        member: parliamentMembersMap[candidate.member_id] || null,
        nominatedBy: profilesMap[candidate.nominated_by] || null,
      });
      return accumulator;
    }, {});

    return {
      schemaReady: true,
      terms: terms.map((term) => ({
        ...term,
        house: housesMap[term.house_id] || null,
        member: parliamentMembersMap[term.member_id] || null,
      })),
      elections: elections.map((election) => ({
        ...election,
        house: housesMap[election.house_id] || null,
        creator: profilesMap[election.created_by] || null,
        winner: election.winner_member_id ? parliamentMembersMap[election.winner_member_id] || null : null,
        candidates: candidatesByElection[election.id] || [],
        votes: votesByElection[election.id] || [],
      })),
    };
  } catch (error) {
    if (isGovernanceSchemaMissing(error)) {
      return {
        schemaReady: false,
        terms: [],
        elections: [],
        error,
      };
    }

    throw error;
  }
};

export const getCommissionHouseSummary = (commission) => {
  const houses = commission?.houses || [];
  if (!houses.length) {
    return 'Casa não vinculada';
  }

  if (houses.length === 1) {
    return houses[0].name;
  }

  return houses.map((house) => house.name).join(' + ');
};

export const isHouseLeadershipRole = (role = '') =>
  HOUSE_PRESIDENT_ROLES.includes(role) || HOUSE_VICE_PRESIDENT_ROLES.includes(role);
