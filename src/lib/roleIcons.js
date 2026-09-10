import { User, Crown, Building2, Landmark, Gavel, Shield, Scale, Briefcase, ShieldCheck, Medal, Eye, GraduationCap, Vote } from 'lucide-react';

export const ROLE_ALIASES = {
  'Presidente da Câmara': 'Presidente da Câmara dos Deputados',
  'Vice-Presidente do Senado': 'Vice-Presidente do Senado Federal',
  'Diretor da Polícia Federal': 'Diretor-Geral de Polícia',
  'Comandante das Forças Armadas': 'Comandante-Geral das Forças Armadas',
};
export const canonicalRole = role => ROLE_ALIASES[role] || role;
export const ROLE_ICONS = {
  'Presidente do Portal Eleitoral': Vote, 'Agente Penitenciário': Shield, 'Diretor Penitenciário': ShieldCheck,
  Admin: ShieldCheck, Presidente: Crown, 'Vice-Presidente': Crown, Deputado: Building2, Senador: Landmark,
  'Presidente da Câmara dos Deputados': Building2, 'Vice-Presidente da Câmara dos Deputados': Building2,
  'Presidente do Senado': Landmark, 'Vice-Presidente do Senado Federal': Landmark,
  'Presidente do STF': Gavel, Juiz: Gavel, Policial: Shield, Delegado: ShieldCheck, Promotor: Scale,
  Advogado: Scale, 'Defensor Público': Scale, Ministro: Briefcase, 'Diretor-Geral de Polícia': ShieldCheck,
  'Comandante-Geral das Forças Armadas': Medal, 'Comandante da Agência de Inteligência': Eye,
  'Presidente do Banco Nacional': Landmark, 'Agente Secreto': Eye, Militar: Medal,
  Professor: GraduationCap, Cidadão: User, Usuário: User,
};
export const roleIcon = role => ROLE_ICONS[canonicalRole(role)] || User;

export const officialRoleCapabilities = role => ({
  'Diretor-Geral de Polícia': ['Diretor-Geral de Polícia','Policial','Delegado'],
  'Comandante-Geral das Forças Armadas': ['Comandante-Geral das Forças Armadas','Militar'],
  'Comandante da Agência de Inteligência': ['Comandante da Agência de Inteligência','Agente Secreto'],
})[canonicalRole(role)] || [canonicalRole(role)];
