import { Briefcase, GraduationCap, Landmark, Newspaper, Scale, Shield, User } from 'lucide-react';

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
  { key: 'politics', title: 'Política', icon: Landmark, tone: 'blue', description: 'Partidos, eleições, Parlamento e vida pública.' },
  { key: 'entrepreneurship', title: 'Empreendedorismo', icon: Briefcase, tone: 'amber', description: 'Empresas, investimentos, economia e patrimônio.' },
  { key: 'justice', title: 'Justiça', icon: Scale, tone: 'violet', description: 'Direito, leis, tribunais e carreiras jurídicas.' },
  { key: 'security', title: 'Segurança Pública', icon: Shield, tone: 'cyan', description: 'Proteção da sociedade, denúncias e carreira policial.' },
  { key: 'communication', title: 'Comunicação', icon: Newspaper, tone: 'rose', description: 'Imprensa, debate público, reputação e influência.' },
  { key: 'knowledge', title: 'Conhecimento e carreira', icon: GraduationCap, tone: 'orange', description: 'Formação, profissão e desenvolvimento pessoal.' },
  { key: 'civil_life', title: 'Vida Civil', icon: User, tone: 'slate', description: 'Explore o GOVRP sem definir um objetivo agora.' },
];

export const ASPIRATION_TONES = {
  blue: { icon: 'text-blue-300', selected: 'border-blue-400 bg-blue-500/10 ring-blue-400/20', check: 'text-blue-300' },
  amber: { icon: 'text-amber-300', selected: 'border-amber-400 bg-amber-500/10 ring-amber-400/20', check: 'text-amber-300' },
  violet: { icon: 'text-violet-300', selected: 'border-violet-400 bg-violet-500/10 ring-violet-400/20', check: 'text-violet-300' },
  cyan: { icon: 'text-cyan-300', selected: 'border-cyan-400 bg-cyan-500/10 ring-cyan-400/20', check: 'text-cyan-300' },
  rose: { icon: 'text-rose-300', selected: 'border-rose-400 bg-rose-500/10 ring-rose-400/20', check: 'text-rose-300' },
  orange: { icon: 'text-orange-300', selected: 'border-orange-400 bg-orange-500/10 ring-orange-400/20', check: 'text-orange-300' },
  slate: { icon: 'text-slate-300', selected: 'border-slate-300 bg-slate-500/10 ring-slate-300/20', check: 'text-slate-200' },
};

export const getProgressIndex = (step) => {
  if (step === 'welcome') return 0;
  if (step === 'completed') return PROGRESS_STEPS.length - 1;
  return Math.max(0, PROGRESS_STEPS.findIndex((item) => item.key === step));
};

export const getDocument = (documents, type) =>
  documents?.find((document) => document.type === type && document.is_valid !== false) || null;
