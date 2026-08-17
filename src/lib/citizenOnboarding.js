import { Briefcase, GraduationCap, Landmark, Newspaper, Scale, Shield, UserRound } from 'lucide-react';

export const CITIZEN_ONBOARDING_VERSION = 2;

export const ONBOARDING_STEPS = [
  'welcome', 'identity', 'origin', 'profile', 'civil_documents',
  'mandatory_documents', 'initial_status', 'citizenship', 'completed',
];

export const PROGRESS_STEPS = [
  { key: 'identity', label: 'Identidade' },
  { key: 'origin', label: 'Origem' },
  { key: 'profile', label: 'Perfil' },
  { key: 'civil_documents', label: 'Documentos civis' },
  { key: 'mandatory_documents', label: 'Documentos obrigatórios' },
  { key: 'initial_status', label: 'Situação inicial' },
  { key: 'citizenship', label: 'Cidadania' },
];

export const ASPIRATIONS = [
  { key: 'politics', title: 'Política', icon: Landmark, description: 'Partidos, eleições, Parlamento e vida pública.' },
  { key: 'entrepreneurship', title: 'Empreendedorismo', icon: Briefcase, description: 'Empresas, investimentos, economia e patrimônio.' },
  { key: 'justice', title: 'Justiça', icon: Scale, description: 'Direito, leis, tribunais e carreiras jurídicas.' },
  { key: 'security', title: 'Segurança Pública', icon: Shield, description: 'Proteção da sociedade, denúncias e carreira policial.' },
  { key: 'communication', title: 'Comunicação', icon: Newspaper, description: 'Imprensa, debate público, reputação e influência.' },
  { key: 'knowledge', title: 'Conhecimento e carreira', icon: GraduationCap, description: 'Formação, profissão e desenvolvimento pessoal.' },
  { key: 'civil_life', title: 'Vida Civil', icon: UserRound, description: 'Explore o GOVRP sem definir um objetivo agora.' },
];

export const getProgressIndex = (step) => {
  if (step === 'welcome') return 0;
  if (step === 'completed') return PROGRESS_STEPS.length - 1;
  return Math.max(0, PROGRESS_STEPS.findIndex((item) => item.key === step));
};

export const getDocument = (documents, type) =>
  documents?.find((document) => document.type === type && document.is_valid !== false) || null;
