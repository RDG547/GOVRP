export const SALARY_TABLE = [
  { role: 'Presidente', title: 'Presidente da República', salary: 35000 },
  { role: 'Vice-Presidente', title: 'Vice-Presidente', salary: 24500 },
  { role: 'Deputado', title: 'Deputado Federal', salary: 10500 },
  { role: 'Senador', title: 'Senador', salary: 17500 },
  { role: 'Presidente do Senado', title: 'Presidente do Senado', salary: 24500 },
  { role: 'Presidente da Câmara', title: 'Presidente da Câmara', salary: 21000 },
  { role: 'Ministro', title: 'Ministro de Estado', salary: 17500 },
];

const SALARY_ROLE_PRIORITY = [
  'Presidente',
  'Vice-Presidente',
  'Presidente do Senado',
  'Presidente da Câmara',
  'Ministro',
  'Senador',
  'Deputado',
];

const SALARY_ROLE_ALIASES = {
  'Presidente da Camara': 'Presidente da Câmara',
  'Presidente da Câmara dos Deputados': 'Presidente da Câmara',
  'Vice-Presidente da Câmara dos Deputados': 'Deputado',
  'Vice-Presidente do Senado': 'Senador',
  'Vice-Presidente do Senado Federal': 'Senador',
};

const SALARY_INFO_BY_ROLE = SALARY_TABLE.reduce((accumulator, item) => {
  accumulator[item.role] = item;
  return accumulator;
}, {});

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

export const normalizeSalaryRole = (role = '') => {
  if (!role) {
    return null;
  }

  return SALARY_ROLE_ALIASES[role] || (SALARY_INFO_BY_ROLE[role] ? role : null);
};

export const getSalaryInfoByRole = (role = '') => {
  const normalizedRole = normalizeSalaryRole(role);
  return normalizedRole ? SALARY_INFO_BY_ROLE[normalizedRole] || null : null;
};

export const resolveSalaryInfoFromRolePool = (rolePool = []) => {
  const normalizedRolePool = dedupe(rolePool.map((role) => normalizeSalaryRole(role)).filter(Boolean));
  const salaryRole = SALARY_ROLE_PRIORITY.find((role) => normalizedRolePool.includes(role));

  if (!salaryRole) {
    return null;
  }

  return SALARY_INFO_BY_ROLE[salaryRole] || null;
};
