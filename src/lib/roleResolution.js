import { resolveActiveElectionOfficeRolesForUser } from './electionOfficeSync';

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
  'Ministro',
  'Senador',
  'Deputado',
  'Juiz',
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

export const getStoredTitles = (profile = {}) =>
  Array.isArray(profile?.titles) ? profile.titles.filter(Boolean) : [];

export const getProfileRolePool = (profile = {}, syncState = null) => {
  if (!profile?.id) {
    return dedupe([profile?.role, ...getStoredTitles(profile)]);
  }

  return dedupe([
    profile.role,
    ...getStoredTitles(profile),
    ...resolveActiveElectionOfficeRolesForUser(syncState, profile.id),
  ]);
};

export const resolvePrimaryRoleFromPool = (rolePool = [], fallbackRole = 'Usuário') =>
  EFFECTIVE_ROLE_PRIORITY.find((role) => rolePool.includes(role)) ||
  rolePool.find(Boolean) ||
  fallbackRole;

export const resolvePrimaryRole = (profile = {}, syncState = null, fallbackRole = null) =>
  resolvePrimaryRoleFromPool(
    getProfileRolePool(profile, syncState),
    fallbackRole || profile?.role || 'Usuário'
  );

export const isActiveDateOnly = (dateValue) => !dateValue || dateValue >= todayDate();

export const resolveParliamentHouseIdFromRole = (role = '', houses = []) => {
  const senateHouse = houses.find((house) => house?.name?.toLowerCase().includes('senado'));
  const chamberHouse = houses.find((house) => house?.id !== senateHouse?.id);

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

    return Boolean(resolveLegislativeRoleForHouse(profile, syncState, member.house_id, houses));
  });
