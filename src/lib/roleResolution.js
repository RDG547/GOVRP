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
  const senateRoles = ['Senador', 'Presidente do Senado', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal'];
  const chamberRoles = ['Deputado', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Vice-Presidente da Câmara dos Deputados'];
  const senateHouse = houses.find((house) => house?.name?.toLowerCase().includes('senado'));
  const chamberHouse = houses.find((house) => house?.id !== senateHouse?.id);

  if (senateRoles.includes(role)) {
    return senateHouse?.id || null;
  }

  if (chamberRoles.includes(role)) {
    return chamberHouse?.id || null;
  }

  return null;
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

    const hasMatchingRole = profileMatchesParliamentHouse(profile, syncState, member.house_id, houses);
    const hasRegisteredHouse = !houses.length || houses.some((house) => house?.id === member.house_id);

    // The active parliament membership itself is authoritative enough for UI listings
    // when role sync is temporarily delayed.
    return hasMatchingRole || hasRegisteredHouse;
  });
