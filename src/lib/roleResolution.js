import { resolveActiveElectionOfficeRolesForUser } from './electionOfficeSync.js';

export const EFFECTIVE_ROLE_PRIORITY = [
  'Admin',
  'Presidente',
  'Vice-Presidente',
  'Presidente da Câmara',
  'Presidente da Câmara dos Deputados',
  'Vice-Presidente da Câmara dos Deputados',
  'Presidente do Senado',
  'Vice-Presidente do Senado',
  'Vice-Presidente do Senado Federal',
  'Presidente do STF',
  'Presidente do Banco Nacional',
  'Presidente do Portal Eleitoral',
  'Ministro',
  'Senador',
  'Deputado',
  'Juiz',
  'Diretor-Geral de Polícia',
  'Comandante-Geral das Forças Armadas',
  'Comandante da Agência de Inteligência',
  'Policial',
  'Agente Secreto',
  'Militar',
  'Cidadão',
  'Usuário',
];

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];
const todayDate = () => new Date().toISOString().slice(0, 10);
const SENATE_PARLIAMENTARY_ROLES = ['Senador', 'Presidente do Senado', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal'];
const CHAMBER_PARLIAMENTARY_ROLES = ['Deputado', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Vice-Presidente da Câmara dos Deputados'];
const TERM_BOUND_OFFICE_ROLES = ['Presidente', 'Vice-Presidente', 'Deputado', 'Senador'];
const isManualRoleOverride = (profile = {}) => profile?.manual_role_override === true;

const getProfileRolesAffectedByElectionOffice = (officeRole) => {
  if (officeRole === 'Presidente') {
    return ['Presidente', 'Vice-Presidente'];
  }

  if (officeRole === 'Deputado' || officeRole === 'Senador') {
    return [officeRole];
  }

  return [];
};

export const isManualElectionRoleSuperseded = (profile = {}, syncState = null) => {
  if (!isManualRoleOverride(profile) || !profile?.role || !profile?.role_assigned_at) {
    return false;
  }

  const assignedAtMs = new Date(profile.role_assigned_at).getTime();

  if (!Number.isFinite(assignedAtMs)) {
    return false;
  }

  const settlements = Array.isArray(syncState?.settlements) ? syncState.settlements : [];

  return settlements.some((settlement) => {
    if (!getProfileRolesAffectedByElectionOffice(settlement?.office_role).includes(profile.role)) {
      return false;
    }

    const termStartMs = new Date(settlement?.term_start_at).getTime();
    return Number.isFinite(termStartMs) && termStartMs > assignedAtMs;
  });
};

export const getStoredTitles = (profile = {}) =>
  Array.isArray(profile?.titles) ? profile.titles.filter(Boolean) : [];

export const getProfileRolePool = (profile = {}, syncState = null) => {
  const activeElectionRoles = resolveActiveElectionOfficeRolesForUser(syncState, profile?.id);
  const activeElectionRoleSet = new Set(activeElectionRoles);
  const manualOverrideActive = isManualRoleOverride(profile) && !isManualElectionRoleSuperseded(profile, syncState);
  const includeStoredRole = (role) =>
    role &&
    (!TERM_BOUND_OFFICE_ROLES.includes(role) ||
      activeElectionRoleSet.has(role) ||
      manualOverrideActive);
  const storedRoles = [
    includeStoredRole(profile?.role) ? profile.role : null,
    ...getStoredTitles(profile).filter(includeStoredRole),
  ];

  if (!profile?.id) {
    return dedupe(storedRoles);
  }

  return dedupe([
    ...storedRoles,
    ...activeElectionRoles,
  ]);
};

export const resolvePrimaryRoleFromPool = (rolePool = [], fallbackRole = 'Usuário') =>
  EFFECTIVE_ROLE_PRIORITY.find((role) => rolePool.includes(role)) ||
  rolePool.find(Boolean) ||
  fallbackRole;

export const resolvePrimaryRole = (profile = {}, syncState = null, fallbackRole = null) => {
  const rolePool = getProfileRolePool(profile, syncState);
  const fallback = fallbackRole || profile?.role || 'Usuário';
  const safeFallback = TERM_BOUND_OFFICE_ROLES.includes(fallback) && !rolePool.includes(fallback)
    ? 'Cidadão'
    : fallback;

  return resolvePrimaryRoleFromPool(rolePool, safeFallback);
};

export const isActiveDateOnly = (dateValue) => !dateValue || dateValue >= todayDate();

export const resolveParliamentHouseIdFromRole = (role = '', houses = []) => {
  const senateHouse = houses.find((house) => house?.id === 'fedcba09-8765-4321-0987-654321fedcba') || houses.find((house) => house?.name?.toLowerCase().includes('senado'));
  const chamberHouse = houses.find((house) => house?.id === 'a1b2c3d4-e5f6-7890-1234-567890abcdef') || houses.find((house) => /c[aâ]mara|deputad/i.test(house?.name || '')) || houses.find((house) => house?.id !== senateHouse?.id);

  if (SENATE_PARLIAMENTARY_ROLES.includes(role)) {
    return senateHouse?.id || null;
  }

  if (CHAMBER_PARLIAMENTARY_ROLES.includes(role)) {
    return chamberHouse?.id || null;
  }

  return null;
};

export const resolveLegislativeRoleFromPool = (rolePool = []) => {
  if (rolePool.some((role) => SENATE_PARLIAMENTARY_ROLES.includes(role))) {
    return 'Senador';
  }

  if (rolePool.some((role) => CHAMBER_PARLIAMENTARY_ROLES.includes(role))) {
    return 'Deputado';
  }

  return null;
};

export const resolveLegislativeRoleForHouse = (profile = {}, syncState = null, houseId = null, houses = []) => {
  const rolePool = getProfileRolePool(profile, syncState);
  const legislativeRole = resolveLegislativeRoleFromPool(rolePool);

  if (!legislativeRole) {
    return null;
  }

  if (!houseId || !houses.length) {
    return legislativeRole;
  }

  const expectedHouseId = resolveParliamentHouseIdFromRole(legislativeRole, houses);
  return !expectedHouseId || expectedHouseId === houseId ? legislativeRole : null;
};

export const profileMatchesParliamentHouse = (profile = {}, syncState = null, houseId, houses = []) =>
  getProfileRolePool(profile, syncState).some(
    (role) => resolveParliamentHouseIdFromRole(role, houses) === houseId
  );

export const filterCompatibleParliamentMembers = (members = [], syncState = null, houses = []) =>
  members.filter((member) => {
    if (!member?.user_id || !member?.house_id || !isActiveDateOnly(member.term_end_date)) {
      return false;
    }

    const profile = {
      ...(member.profile || {}),
      id: member.user_id,
    };

    // A persisted mandate is authoritative; public profiles intentionally omit private
    // election override metadata and must not hide an active member.
    return (!member.term_start_date || member.term_start_date <= todayDate()) &&
      (!profile.role || resolveParliamentHouseIdFromRole(profile.role, houses) === member.house_id ||
        getStoredTitles(profile).some(role => resolveParliamentHouseIdFromRole(role, houses) === member.house_id));
  });
