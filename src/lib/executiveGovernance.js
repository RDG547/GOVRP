import { mapBillTypeToGazetteType, publishOfficialGazetteEntry } from './officialGazette.js';
import { PARLIAMENT_HOUSE_IDS } from './parliamentGovernance.js';
import { fetchElectionOfficeSyncState } from './electionOfficeSync.js';
import { isManualElectionRoleSuperseded } from './roleResolution.js';

export const EXECUTIVE_GOVERNANCE_SETTINGS_KEY = 'executive_governance';
export const PRESIDENTIAL_TERM_MONTHS = 1;
export const PROVISIONAL_MEASURE_MAX_DAYS = 7;

export const PRESIDENTIAL_PENDING_BILL_STATUSES = [
  'Aguardando sanção presidencial',
  'Aguardando promulgação presidencial',
  'Aprovado',
];

export const PRESIDENTIAL_DECIDED_BILL_STATUSES = [
  'Sancionado',
  'Promulgado',
  'Vetado integralmente',
  'Vetado parcialmente',
];

export const EXECUTIVE_SPECIAL_OFFICES = [
  {
    key: 'federal_police_director',
    label: 'Diretor da Polícia Federal',
    description: 'Chefia a Polícia Federal e responde pela direção superior da corporação.',
    eligibleRoles: ['Policial', 'Cidadão'],
  },
  {
    key: 'armed_forces_commander',
    label: 'Comandante das Forças Armadas',
    description: 'Coordena as Forças Armadas e executa a cadeia de comando militar.',
    eligibleRoles: ['Militar', 'Cidadão'],
  },
  {
    key: 'national_bank_president',
    label: 'Presidente do Banco Nacional',
    description: 'Dirige o banco estatal, decide crédito e administra a política de juros.',
    eligibleRoles: ['Cidadão', 'Ministro', 'Deputado', 'Senador', 'Juiz', 'Policial', 'Agente Secreto', 'Militar'],
  },
];

const SUCCESSION_ROLE_FALLBACKS = {
  chamber_president: ['Presidente da Câmara dos Deputados', 'Presidente da Câmara'],
  senate_president: ['Presidente do Senado'],
  supreme_court_president: ['Presidente do STF'],
};
const EXECUTIVE_OFFICE_ROLES = ['Presidente', 'Vice-Presidente'];

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const parseDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value) => {
  const date = parseDate(value) || new Date();
  return date.toISOString();
};

const addMonthsIso = (value, months) => {
  const date = parseDate(value) || new Date();
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
};

const addDaysIso = (value, days) => {
  const date = parseDate(value) || new Date();
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString();
};

const isNowBetween = (startValue, endValue) => {
  const now = Date.now();
  const start = parseDate(startValue)?.getTime();
  const end = parseDate(endValue)?.getTime();

  if (start && now < start) {
    return false;
  }

  if (end && now > end) {
    return false;
  }

  return true;
};

const todayIso = () => new Date().toISOString();

const normalizeProvisionalMeasures = (measures = []) =>
  [...measures]
    .map((measure) => {
      const issuedAt = toIso(measure.issued_at || measure.issuedAt || todayIso());
      const expiresAt = toIso(
        measure.expires_at || measure.expiresAt || addDaysIso(issuedAt, PROVISIONAL_MEASURE_MAX_DAYS)
      );
      const expired = Date.now() > new Date(expiresAt).getTime();

      return {
        id: measure.id || createId(),
        title: measure.title || 'Medida Provisória',
        summary: measure.summary || '',
        content: measure.content || '',
        author_id: measure.author_id || measure.authorId || null,
        issued_at: issuedAt,
        expires_at: expiresAt,
        status: expired ? 'expired' : measure.status || 'active',
      };
    })
    .sort((left, right) => new Date(right.issued_at) - new Date(left.issued_at));

const normalizeExecutiveGovernanceValue = (rawValue = {}) => {
  const value = rawValue && typeof rawValue === 'object' ? rawValue : {};
  const officeVacancy = value.officeVacancy && typeof value.officeVacancy === 'object'
    ? {
        vacant: Boolean(value.officeVacancy.vacant),
        since: value.officeVacancy.since || null,
        reason: value.officeVacancy.reason || '',
        triggered_by: value.officeVacancy.triggered_by || value.officeVacancy.triggeredBy || null,
      }
    : {
        vacant: false,
        since: null,
        reason: '',
        triggered_by: null,
      };
  const presidentialSuccession =
    value.presidentialSuccession && typeof value.presidentialSuccession === 'object'
      ? {
          promoted_president_id:
            value.presidentialSuccession.promoted_president_id ||
            value.presidentialSuccession.promotedPresidentId ||
            null,
          previous_vice_id:
            value.presidentialSuccession.previous_vice_id ||
            value.presidentialSuccession.previousViceId ||
            null,
          former_president_id:
            value.presidentialSuccession.former_president_id ||
            value.presidentialSuccession.formerPresidentId ||
            null,
          term_election_id:
            value.presidentialSuccession.term_election_id ||
            value.presidentialSuccession.termElectionId ||
            null,
          promoted_at:
            value.presidentialSuccession.promoted_at ||
            value.presidentialSuccession.promotedAt ||
            null,
          reason: value.presidentialSuccession.reason || '',
          triggered_by:
            value.presidentialSuccession.triggered_by ||
            value.presidentialSuccession.triggeredBy ||
            null,
        }
      : null;

  return {
    officeVacancy,
    presidentialSuccession,
    specialAppointments:
      value.specialAppointments && typeof value.specialAppointments === 'object'
        ? value.specialAppointments
        : {},
    provisionalMeasures: normalizeProvisionalMeasures(value.provisionalMeasures || value.provisional_measures || []),
    billActions: Array.isArray(value.billActions) ? value.billActions : [],
  };
};

const mapById = (rows = []) =>
  rows.reduce((accumulator, row) => {
    accumulator[row.id] = row;
    return accumulator;
  }, {});

const fetchProfilesMap = async (supabase, profileIds = []) => {
  const ids = dedupe(profileIds);
  if (!ids.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role, username, x_handle')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return mapById(data || []);
};

const fetchPartiesMap = async (supabase, partyIds = []) => {
  const ids = dedupe(partyIds);
  if (!ids.length) {
    return {};
  }

  const { data, error } = await supabase
    .from('political_parties')
    .select('id, name, acronym, logo_url, ideology')
    .in('id', ids);

  if (error) {
    throw error;
  }

  return mapById(data || []);
};

export const fetchExecutiveGovernanceSettings = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value, description')
    .eq('key', EXECUTIVE_GOVERNANCE_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    exists: Boolean(data),
    description: data?.description || 'Governança constitucional do Poder Executivo.',
    value: normalizeExecutiveGovernanceValue(data?.value),
  };
};

export const saveExecutiveGovernanceSettings = async (supabase, nextValue) => {
  const payload = normalizeExecutiveGovernanceValue(nextValue);

  const { data, error } = await supabase
    .from('system_settings')
    .upsert(
      {
        key: EXECUTIVE_GOVERNANCE_SETTINGS_KEY,
        value: payload,
        description: 'Governança constitucional do Poder Executivo.',
      },
      { onConflict: 'key' }
    )
    .select('key, value, description')
    .single();

  if (error) {
    throw error;
  }

  return {
    exists: true,
    description: data?.description || 'Governança constitucional do Poder Executivo.',
    value: normalizeExecutiveGovernanceValue(data?.value),
  };
};

export const fetchPresidentialElectionType = async (supabase) => {
  const { data, error } = await supabase
    .from('election_types')
    .select('id, name, description, voting_system, requires_vice_candidate, is_public_vote')
    .eq('name', 'Presidente')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

export const fetchPresidentialElectionHistory = async (supabase) => {
  const presidentialType = await fetchPresidentialElectionType(supabase);

  if (!presidentialType?.id) {
    return {
      presidentialType: null,
      elections: [],
      currentTerm: null,
    };
  }

  const { data: elections, error: electionsError } = await supabase
    .from('elections')
    .select('id, name, description, status, election_type_id, candidacy_start_date, candidacy_end_date, voting_start_date, voting_end_date, created_at')
    .eq('election_type_id', presidentialType.id)
    .order('voting_end_date', { ascending: false });

  if (electionsError) {
    throw electionsError;
  }

  const electionIds = dedupe((elections || []).map((election) => election.id));
  if (!electionIds.length) {
    return {
      presidentialType,
      elections: [],
      currentTerm: null,
    };
  }

  const [{ data: candidates, error: candidatesError }, { data: votes, error: votesError }] = await Promise.all([
    supabase
      .from('candidates')
      .select('id, election_id, user_id, party_id, vice_candidate_id, political_name, bio, proposals, campaign_photo_url, status, created_at')
      .in('election_id', electionIds)
      .eq('status', 'Approved'),
    supabase
      .from('votes')
      .select('election_id, candidate_id')
      .in('election_id', electionIds),
  ]);

  if (candidatesError) {
    throw candidatesError;
  }

  if (votesError) {
    throw votesError;
  }

  const approvedCandidates = candidates || [];
  const voteRows = votes || [];
  const profileIds = dedupe([
    ...approvedCandidates.map((candidate) => candidate.user_id),
    ...approvedCandidates.map((candidate) => candidate.vice_candidate_id),
  ]);
  const partyIds = dedupe(approvedCandidates.map((candidate) => candidate.party_id));

  const [profilesMap, partiesMap] = await Promise.all([
    fetchProfilesMap(supabase, profileIds),
    fetchPartiesMap(supabase, partyIds),
  ]);

  const voteCounts = voteRows.reduce((accumulator, vote) => {
    if (!vote.candidate_id) {
      return accumulator;
    }

    accumulator[vote.candidate_id] = (accumulator[vote.candidate_id] || 0) + 1;
    return accumulator;
  }, {});

  const candidatesByElection = approvedCandidates.reduce((accumulator, candidate) => {
    accumulator[candidate.election_id] = accumulator[candidate.election_id] || [];
    accumulator[candidate.election_id].push({
      ...candidate,
      vote_count: voteCounts[candidate.id] || 0,
      profile: profilesMap[candidate.user_id] || null,
      vice_profile: candidate.vice_candidate_id ? profilesMap[candidate.vice_candidate_id] || null : null,
      party: candidate.party_id ? partiesMap[candidate.party_id] || null : null,
    });
    return accumulator;
  }, {});

  const history = (elections || []).map((election) => {
    const sortedCandidates = [...(candidatesByElection[election.id] || [])].sort((left, right) => {
      if (right.vote_count !== left.vote_count) {
        return right.vote_count - left.vote_count;
      }

      return new Date(left.created_at || 0) - new Date(right.created_at || 0);
    });
    const winner = sortedCandidates[0] || null;
    const tied =
      sortedCandidates.length > 1 && winner && sortedCandidates[1].vote_count === winner.vote_count;
    const termStartAt = toIso(election.voting_end_date || election.voting_start_date || election.created_at);
    const termEndAt = addMonthsIso(termStartAt, PRESIDENTIAL_TERM_MONTHS);

    return {
      ...election,
      election_type: presidentialType,
      candidates: sortedCandidates,
      winner: tied ? null : winner,
      is_tied: Boolean(tied),
      term_start_at: termStartAt,
      term_end_at: termEndAt,
      is_active: Boolean(!tied && winner && isNowBetween(termStartAt, termEndAt)),
    };
  });

  return {
    presidentialType,
    elections: history,
    currentTerm: history.find((election) => election.is_active) || null,
  };
};

export const getConsecutivePresidentialWins = (elections = [], userId) => {
  if (!userId) {
    return 0;
  }

  const completedTerms = elections.filter((election) => election.winner?.user_id);
  let consecutiveWins = 0;

  for (const election of completedTerms) {
    if (election.winner.user_id !== userId) {
      break;
    }

    consecutiveWins += 1;
  }

  return consecutiveWins;
};

export const canRunForPresidency = (elections = [], userId) =>
  getConsecutivePresidentialWins(elections, userId) < 2;

const fetchFallbackSuccessionProfiles = async (supabase) => {
  const roleFilters = dedupe(Object.values(SUCCESSION_ROLE_FALLBACKS).flat());
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role, username, x_handle')
    .in('role', roleFilters);

  if (error) {
    throw error;
  }

  return data || [];
};

const isMissingManualRoleMetadataError = (error) =>
  /manual_role_override|role_assigned_at|role_assigned_by/i.test(error?.message || '');

const fetchManualExecutiveOfficeProfiles = async (supabase) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role, username, x_handle, manual_role_override, role_assigned_at, role_assigned_by')
    .in('role', EXECUTIVE_OFFICE_ROLES)
    .eq('manual_role_override', true)
    .order('role_assigned_at', { ascending: false });

  if (error) {
    if (isMissingManualRoleMetadataError(error)) {
      return [];
    }

    throw error;
  }

  return data || [];
};

const fetchHouseLeadershipProfiles = async (supabase) => {
  const { data: terms, error: termsError } = await supabase
    .from('parliament_leadership_terms')
    .select('house_id, member_id, position, status, term_start_date, term_end_date')
    .eq('position', 'president')
    .eq('status', 'active');

  if (termsError) {
    return {};
  }

  const activeTerms = (terms || []).filter((term) => isNowBetween(term.term_start_date, term.term_end_date));
  const memberIds = dedupe(activeTerms.map((term) => term.member_id));
  if (!memberIds.length) {
    return {};
  }

  const { data: members, error: membersError } = await supabase
    .from('parliament_members')
    .select('id, user_id, house_id, term_start_date, term_end_date')
    .in('id', memberIds);

  if (membersError) {
    return {};
  }

  const profilesMap = await fetchProfilesMap(
    supabase,
    dedupe((members || []).map((member) => member.user_id))
  );

  return (members || []).reduce((accumulator, member) => {
    accumulator[member.house_id] = profilesMap[member.user_id] || null;
    return accumulator;
  }, {});
};

const resolveSuccessionLine = async (supabase) => {
  const [houseLeadershipProfiles, fallbackProfiles] = await Promise.all([
    fetchHouseLeadershipProfiles(supabase),
    fetchFallbackSuccessionProfiles(supabase),
  ]);

  const fallbackByRoles = fallbackProfiles.reduce((accumulator, profile) => {
    accumulator[profile.role] = profile;
    return accumulator;
  }, {});

  const chamberProfile =
    houseLeadershipProfiles[PARLIAMENT_HOUSE_IDS.chamber] ||
    SUCCESSION_ROLE_FALLBACKS.chamber_president
      .map((role) => fallbackByRoles[role])
      .find(Boolean) ||
    null;
  const senateProfile =
    houseLeadershipProfiles[PARLIAMENT_HOUSE_IDS.senate] ||
    SUCCESSION_ROLE_FALLBACKS.senate_president
      .map((role) => fallbackByRoles[role])
      .find(Boolean) ||
    null;
  const supremeCourtProfile =
    SUCCESSION_ROLE_FALLBACKS.supreme_court_president
      .map((role) => fallbackByRoles[role])
      .find(Boolean) || null;

  return [
    {
      key: 'chamber_president',
      label: 'Presidente da Câmara dos Deputados',
      profile: chamberProfile,
    },
    {
      key: 'senate_president',
      label: 'Presidente do Senado Federal',
      profile: senateProfile,
    },
    {
      key: 'supreme_court_president',
      label: 'Presidente do STF',
      profile: supremeCourtProfile,
    },
    {
      key: 'cda',
      label: 'Conselho dos Administradores (CDA)',
      profile: null,
      is_cda: true,
    },
  ];
};

const attachProfilesToSettings = async (supabase, settingsValue) => {
  const profileIds = dedupe([
    ...Object.values(settingsValue.specialAppointments || {}).map((item) => item?.user_id || item?.userId),
    ...settingsValue.provisionalMeasures.map((measure) => measure.author_id),
    ...settingsValue.billActions.map((action) => action.actor_id || action.actorId),
  ]);

  const profilesMap = await fetchProfilesMap(supabase, profileIds);

  return {
    ...settingsValue,
    specialAppointmentsDetailed: Object.fromEntries(
      EXECUTIVE_SPECIAL_OFFICES.map((office) => {
        const appointment = settingsValue.specialAppointments?.[office.key];
        const profileId = appointment?.user_id || appointment?.userId;

        return [
          office.key,
          appointment
            ? {
                ...appointment,
                office,
                user_id: profileId || null,
                profile: profileId ? profilesMap[profileId] || null : null,
              }
            : null,
        ];
      })
    ),
    provisionalMeasuresDetailed: settingsValue.provisionalMeasures.map((measure) => ({
      ...measure,
      author: measure.author_id ? profilesMap[measure.author_id] || null : null,
    })),
    billActionsDetailed: settingsValue.billActions.map((action) => ({
      ...action,
      actor: action.actor_id || action.actorId ? profilesMap[action.actor_id || action.actorId] || null : null,
    })),
  };
};

export const fetchPotentialRunningMates = async (supabase, { electionId = null, excludeUserId = null } = {}) => {
  const [{ data: profiles, error: profilesError }, { data: candidates, error: candidatesError }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, avatar_url, role, username')
      .order('full_name', { ascending: true }),
    electionId
      ? supabase.from('candidates').select('user_id, vice_candidate_id').eq('election_id', electionId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesError) {
    throw profilesError;
  }

  if (candidatesError) {
    throw candidatesError;
  }

  const unavailableIds = new Set(
    dedupe([
      excludeUserId,
      ...(candidates || []).map((candidate) => candidate.user_id),
      ...(candidates || []).map((candidate) => candidate.vice_candidate_id),
    ])
  );

  return (profiles || [])
    .filter((profile) => !unavailableIds.has(profile.id))
    .filter((profile) => !['Admin', 'Presidente'].includes(profile.role))
    .sort((left, right) => (left.full_name || left.username || '').localeCompare(right.full_name || right.username || ''));
};

export const fetchExecutiveConstitutionalState = async (supabase) => {
  const [
    { elections, currentTerm, presidentialType },
    settingsRow,
    successionLine,
    pendingBillsResponse,
    electionOfficeState,
    manualExecutiveProfiles,
  ] =
    await Promise.all([
      fetchPresidentialElectionHistory(supabase),
      fetchExecutiveGovernanceSettings(supabase),
      resolveSuccessionLine(supabase),
      supabase
        .from('bills')
        .select('id, title, summary, full_text, author_id, house_id, type, status, created_at, updated_at, house:parliament_houses(name), author:profiles(full_name, avatar_url)')
        .in('status', PRESIDENTIAL_PENDING_BILL_STATUSES)
        .order('updated_at', { ascending: false }),
      fetchElectionOfficeSyncState(supabase).catch((error) => {
        console.error('Erro ao carregar sincronização eleitoral do Executivo:', error);
        return null;
      }),
      fetchManualExecutiveOfficeProfiles(supabase),
    ]);

  if (pendingBillsResponse.error) {
    throw pendingBillsResponse.error;
  }

  const settings = await attachProfilesToSettings(supabase, settingsRow.value);
  const officeVacancy = settings.officeVacancy || { vacant: false };
  const presidentialSuccession = settings.presidentialSuccession || null;
  const successionApplies =
    Boolean(currentTerm?.id) &&
    Boolean(presidentialSuccession?.promoted_president_id) &&
    (!presidentialSuccession?.term_election_id ||
      presidentialSuccession.term_election_id === currentTerm.id);
  const vacancyStillApplies =
    !successionApplies &&
    officeVacancy.vacant &&
    (!currentTerm || !officeVacancy.since || new Date(officeVacancy.since) >= new Date(currentTerm.term_start_at));

  const activeManualExecutiveProfiles = (manualExecutiveProfiles || []).filter(
    (profile) => !isManualElectionRoleSuperseded(profile, electionOfficeState)
  );
  const manualPresidentProfile = activeManualExecutiveProfiles.find((profile) => profile.role === 'Presidente') || null;
  const manualViceProfile = activeManualExecutiveProfiles.find((profile) => profile.role === 'Vice-Presidente') || null;
  const electedPresidentProfile = currentTerm?.winner?.profile || null;
  const electedViceProfile = currentTerm?.winner?.vice_profile || null;
  const electedPresidentOfficeActive = Boolean(currentTerm?.id && electedPresidentProfile?.role === 'Presidente');
  const automaticViceSuccessionApplies = Boolean(
    currentTerm?.id &&
    !successionApplies &&
    !electedPresidentOfficeActive &&
    electedViceProfile
  );
  const currentPresidentProfile = successionApplies
    ? electedViceProfile || null
    : currentTerm
      ? automaticViceSuccessionApplies
        ? electedViceProfile
        : electedPresidentOfficeActive
          ? electedPresidentProfile
          : null
      : manualPresidentProfile;
  const currentViceProfile = (successionApplies || automaticViceSuccessionApplies)
    ? null
    : currentTerm
      ? electedViceProfile
      : manualViceProfile;
  const viceAssumedPresidency = Boolean(successionApplies || automaticViceSuccessionApplies);
  const effectivePresidentialSuccession = successionApplies
    ? presidentialSuccession
    : automaticViceSuccessionApplies
      ? {
          promoted_president_id: electedViceProfile.id,
          previous_vice_id: electedViceProfile.id,
          former_president_id: electedPresidentProfile?.id || null,
          term_election_id: currentTerm.id,
          promoted_at: null,
          reason: 'Vacância presidencial detectada',
          triggered_by: null,
          inferred: true,
        }
      : null;
  const manualExecutiveOfficeActive = !currentTerm && Boolean(manualPresidentProfile || manualViceProfile);
  const isVacant = vacancyStillApplies || !currentPresidentProfile;
  const actingAuthority = !isVacant
    ? {
        key: 'president',
        label: 'Presidente da República',
        profile: currentPresidentProfile,
      }
    : successionLine.find((entry) => entry.profile) || successionLine[successionLine.length - 1];

  return {
    presidentialType,
    presidentialElections: elections,
    currentTerm,
    currentPresidentProfile,
    currentViceProfile,
    electedPresidentProfile,
    electedViceProfile,
    manualPresidentProfile,
    manualViceProfile,
    manualExecutiveOfficeActive,
    executiveOfficeSource: currentTerm
      ? viceAssumedPresidency
        ? 'vice_succession'
        : 'election'
      : manualExecutiveOfficeActive
        ? 'manual_admin_role'
        : 'vacant',
    officeVacancy,
    presidentialSuccession: effectivePresidentialSuccession,
    viceAssumedPresidency,
    viceAssumptionSource: successionApplies
      ? 'registered_succession'
      : automaticViceSuccessionApplies
        ? 'detected_presidential_vacancy'
        : null,
    isVacant,
    actingAuthority,
    successionLine,
    settingsRowExists: settingsRow.exists,
    settings,
    pendingBills: pendingBillsResponse.data || [],
  };
};

export const markExecutiveOfficeVacancy = async (
  supabase,
  { reason = 'Vacância do cargo presidencial.', triggeredBy = null } = {}
) => {
  const settings = await fetchExecutiveGovernanceSettings(supabase);

  return saveExecutiveGovernanceSettings(supabase, {
    ...settings.value,
    officeVacancy: {
      vacant: true,
      since: todayIso(),
      reason,
      triggered_by: triggeredBy,
    },
  });
};

export const clearExecutiveOfficeVacancy = async (supabase) => {
  const settings = await fetchExecutiveGovernanceSettings(supabase);

  return saveExecutiveGovernanceSettings(supabase, {
    ...settings.value,
    officeVacancy: {
      vacant: false,
      since: null,
      reason: '',
      triggered_by: null,
    },
  });
};

export const appointExecutiveSpecialOffice = async (
  supabase,
  { officeKey, userId, actorId, note = '' }
) => {
  const office = EXECUTIVE_SPECIAL_OFFICES.find((entry) => entry.key === officeKey);
  if (!office) {
    throw new Error('Cargo privativo não encontrado.');
  }

  const [settingsRow, profilesMap] = await Promise.all([
    fetchExecutiveGovernanceSettings(supabase),
    fetchProfilesMap(supabase, [userId]),
  ]);

  const selectedProfile = profilesMap[userId];
  if (!selectedProfile) {
    throw new Error('Servidor público selecionado não foi encontrado.');
  }

  const nextValue = {
    ...settingsRow.value,
    specialAppointments: {
      ...(settingsRow.value.specialAppointments || {}),
      [office.key]: {
        user_id: userId,
        appointed_at: todayIso(),
        appointed_by: actorId,
        note,
      },
    },
  };

  await saveExecutiveGovernanceSettings(supabase, nextValue);

  await publishOfficialGazetteEntry(supabase, {
    title: `Nomeação para ${office.label}`,
    summary: `${selectedProfile.full_name || 'Servidor designado'} foi nomeado para ${office.label}.`,
    content:
      `${selectedProfile.full_name || 'Servidor designado'} passa a exercer o cargo de ${office.label}.` +
      (note ? ` Observação: ${note}` : ''),
    type: 'Nomeacao e Exoneracao',
    sourceId: `${office.key}-${userId}-${Date.now()}`,
  });
};

export const dismissExecutiveSpecialOffice = async (
  supabase,
  { officeKey, actorId, note = '' }
) => {
  const office = EXECUTIVE_SPECIAL_OFFICES.find((entry) => entry.key === officeKey);
  if (!office) {
    throw new Error('Cargo privativo não encontrado.');
  }

  const settingsRow = await fetchExecutiveGovernanceSettings(supabase);
  const currentAppointment = settingsRow.value.specialAppointments?.[office.key];
  const currentUserId = currentAppointment?.user_id || currentAppointment?.userId || null;
  const profilesMap = await fetchProfilesMap(supabase, currentUserId ? [currentUserId] : []);

  const specialAppointments = { ...(settingsRow.value.specialAppointments || {}) };
  delete specialAppointments[office.key];

  await saveExecutiveGovernanceSettings(supabase, {
    ...settingsRow.value,
    specialAppointments,
  });

  await publishOfficialGazetteEntry(supabase, {
    title: `Exoneração de ${office.label}`,
    summary: `${profilesMap[currentUserId]?.full_name || 'O ocupante'} deixou o cargo de ${office.label}.`,
    content:
      `${profilesMap[currentUserId]?.full_name || 'O ocupante'} foi exonerado do cargo de ${office.label}.` +
      (note ? ` Observação: ${note}` : ''),
    type: 'Nomeacao e Exoneracao',
    sourceId: `${office.key}-dismiss-${actorId}-${Date.now()}`,
  });
};

export const createExecutiveProvisionalMeasure = async (
  supabase,
  { title, summary, content, authorId }
) => {
  const settingsRow = await fetchExecutiveGovernanceSettings(supabase);
  const issuedAt = todayIso();
  const provisionalMeasure = {
    id: createId(),
    title,
    summary,
    content,
    author_id: authorId,
    issued_at: issuedAt,
    expires_at: addDaysIso(issuedAt, PROVISIONAL_MEASURE_MAX_DAYS),
    status: 'active',
  };

  await saveExecutiveGovernanceSettings(supabase, {
    ...settingsRow.value,
    provisionalMeasures: [provisionalMeasure, ...(settingsRow.value.provisionalMeasures || [])],
  });

  await publishOfficialGazetteEntry(supabase, {
    title,
    summary,
    content,
    type: 'Medida Provisoria',
    sourceId: provisionalMeasure.id,
  });

  return provisionalMeasure;
};

export const reviewPresidentialBill = async (
  supabase,
  { bill, action, actorId, reason = '', partialScope = '' }
) => {
  if (!bill?.id) {
    throw new Error('Projeto selecionado não foi encontrado.');
  }

  const normalizedAction = action?.toLowerCase();
  const isConstitutionalAmendment = `${bill.type || ''}`.toUpperCase().includes('PEC');

  if (isConstitutionalAmendment && normalizedAction !== 'promulgate') {
    throw new Error('Emendas constitucionais aguardam promulgação, não sanção ou veto.');
  }

  let nextStatus = bill.status;
  let gazetteType = mapBillTypeToGazetteType(bill.type || '');
  let gazetteTitle = bill.title;
  let gazetteSummary = bill.summary || '';
  let gazetteContent = bill.full_text || bill.summary || '';

  if (normalizedAction === 'sanction') {
    nextStatus = 'Sancionado';
    gazetteSummary = bill.summary || 'Lei sancionada e publicada pela Presidência da República.';
  } else if (normalizedAction === 'promulgate') {
    nextStatus = 'Promulgado';
    gazetteSummary = bill.summary || 'Texto promulgado e publicado pela Presidência da República.';
  } else if (normalizedAction === 'veto_total') {
    nextStatus = 'Vetado integralmente';
    gazetteType = 'Veto Presidencial';
    gazetteTitle = `Veto total ao projeto: ${bill.title}`;
    gazetteSummary = reason || 'Projeto vetado integralmente pela Presidência da República.';
    gazetteContent = reason || 'Veto total sem fundamentação adicional registrada.';
  } else if (normalizedAction === 'veto_partial') {
    nextStatus = 'Vetado parcialmente';
    gazetteType = 'Veto Presidencial';
    gazetteTitle = `Veto parcial ao projeto: ${bill.title}`;
    gazetteSummary = reason || 'Projeto vetado parcialmente pela Presidência da República.';
    gazetteContent =
      `Trechos alcançados pelo veto parcial: ${partialScope || 'Não especificados.'}` +
      (reason ? ` Fundamentação: ${reason}` : '');
  } else {
    throw new Error('Ação presidencial inválida.');
  }

  const { error: updateError } = await supabase.rpc('update_bill_status', {
    p_bill_id: bill.id,
    p_new_status: nextStatus,
  });

  if (updateError) {
    throw updateError;
  }

  const settingsRow = await fetchExecutiveGovernanceSettings(supabase);
  const actionRecord = {
    id: createId(),
    bill_id: bill.id,
    bill_title: bill.title,
    action: normalizedAction,
    resulting_status: nextStatus,
    actor_id: actorId,
    created_at: todayIso(),
    reason,
    partial_scope: partialScope,
  };

  await saveExecutiveGovernanceSettings(supabase, {
    ...settingsRow.value,
    billActions: [actionRecord, ...(settingsRow.value.billActions || [])].slice(0, 30),
  });

  await publishOfficialGazetteEntry(supabase, {
    title: gazetteTitle,
    summary: gazetteSummary,
    content: gazetteContent,
    type: gazetteType,
    sourceId: `${bill.id}-${normalizedAction}`,
  });

  return {
    ...actionRecord,
    type: gazetteType,
  };
};
