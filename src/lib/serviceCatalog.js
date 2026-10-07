import {
  HeartPulse,
  DollarSign,
  ShoppingBasket,
  Briefcase,
  Archive,
  CheckCircle2,
  Building2,
  Clock3,
  Droplet,
  Eye,
  FileText,
  Flame,
  Gavel,
  GraduationCap,
  Landmark,
  Library,
  MessageSquare,
  Scale,
  ShieldCheck,
  Smartphone,
  Store,
  Tally5,
  Users,
  Vote,
  Wifi,
  Wrench,
  Zap,
  Home,
  LineChart,
  Newspaper,
} from 'lucide-react';

export const SERVICE_AVAILABILITY_SETTINGS_KEY = 'service_availability';
export const GLOBAL_SERVICE_AVAILABILITY_KEY = '__site__';

export const SERVICE_MODE_OPTIONS = [
  {
    value: 'active',
    label: 'Ativo',
    icon: CheckCircle2,
    description: 'O serviço funciona normalmente para todos os usuários.',
  },
  {
    value: 'coming_soon',
    label: 'Em breve',
    icon: Clock3,
    description: 'O serviço exibe a página de lançamento futuro.',
  },
  {
    value: 'maintenance',
    label: 'Em manutenção',
    icon: Wrench,
    description: 'O serviço exibe o aviso de manutenção temporária.',
  },
];

export const SERVICE_MODE_META = SERVICE_MODE_OPTIONS.reduce((accumulator, option) => {
  accumulator[option.value] = option;
  return accumulator;
}, {});

export const SERVICE_CATEGORIES = [
  {
    name: 'Governo e Cidadania',
    services: [
      { key: '/services/bank', name: 'Banco Nacional', path: '/services/bank', icon: Landmark, color: 'text-green-400', description: 'Gerencie suas finanças, realize transferências e solicite cartões.' },
      { key: '/services/health', name: 'Sistema Nacional de Saúde (SNS)', path: '/services/health', icon: HeartPulse, color: 'text-rose-400', description: 'Atendimento público, hospitais e políticas de saúde do cidadão.' },
      { key: '/services/dic', name: 'Departamento de Identificação Civil', path: '/services/dic', icon: FileText, color: 'text-purple-400', description: 'Emita e gerencie seus documentos de identificação civil.' },
      { key: '/services/elections', name: 'Portal Eleitoral', path: '/services/elections', icon: Vote, color: 'text-teal-400', description: 'Exerça seu direito de voto e acompanhe os resultados eleitorais.' },
      { key: '/services/political-parties', name: 'Partidos Políticos', path: '/services/political-parties', icon: Users, color: 'text-red-400', description: 'Crie ou filie-se a um partido para participar da vida política.' },
      { key: '/services/parliament', name: 'Parlamento', path: '/services/parliament', icon: Scale, color: 'text-yellow-400', description: 'Proponha, debata e vote em projetos de lei que moldam a nação.' },
    ],
  },
  {
    name: 'Segurança e Justiça',
    services: [
      { key: '/services/justice', name: 'Central de Segurança e Justiça', path: '/services/justice', icon: Gavel, color: 'text-amber-300', description: 'Serviço unificado da Polícia e do Sistema Penal para registrar ocorrências, acompanhar processos e exercer funções de segurança e Justiça.' },
      { key: '/services/prison', name: 'Prisão', path: '/services/prison', icon: Tally5, color: 'text-slate-400', description: 'Acesse informações sobre o sistema prisional e detentos.' },
      { key: '/services/armed-forces', name: 'Forças Armadas', path: '/services/armed-forces', icon: ShieldCheck, color: 'text-emerald-500', description: 'Painel de controle e informações das Forças Armadas.' },
      { key: '/services/agies', name: 'Agência de Inteligência', path: '/services/agies', icon: Eye, color: 'text-red-500', description: 'A vigilância é a nossa virtude. (Acesso restrito)' },
    ],
  },
  {
    name: 'Economia',
    services: [
      { key: '/services/national-market', name: 'Mercado Nacional', path: '/services/national-market', icon: ShoppingBasket, color: 'text-orange-400', description: 'Compre alimentos e bebidas essenciais para o dia a dia do seu cidadão.' },
      { key: '/services/national-housing', name: 'Imobiliária Nacional', path: '/services/national-housing', icon: Home, color: 'text-emerald-400', description: 'Encontre e adquira sua residência dentro do GOVRP.' },
      { key: '/services/stock-exchange', name: 'Bolsa de Valores', path: '/services/stock-exchange', icon: LineChart, color: 'text-indigo-400', description: 'Negocie ações de empresas, acompanhe o GOVX e sua carteira de investimentos.' },
      { key: '/services/economy', name: 'Economia Nacional', path: '/services/economy', icon: DollarSign, color: 'text-cyan-300', description: 'Acompanhe PIB, inflação, emprego, poder de compra e as consequências das decisões econômicas.' },
      { key: '/services/my-work', name: 'Portal do Trabalhador', path: '/services/my-work', icon: Briefcase, color: 'text-amber-400', description: 'Vagas, carreira, experiência profissional e remuneração.' },
      { key: '/services/entrepreneur-portal', name: 'Portal do Empreendedor', path: '/services/entrepreneur-portal', icon: Building2, color: 'text-cyan-400', description: 'Hub empresarial para criar, gerir, investir e negociar com empresas da nação.' },
      { key: '/services/business', name: 'Negócios Livres', path: '/services/business', icon: Store, color: 'text-blue-400', description: 'Compre e venda produtos e serviços no marketplace da comunidade.' },
    ],
  },
  {
    name: 'Cultura e Educação',
    services: [
      { key: '/services/education', name: 'Ensino Superior', path: '/services/education', icon: GraduationCap, color: 'text-indigo-400', description: 'Ingresse na universidade, estude cursos profissionalizantes e avance na carreira.' },
      { key: '/services/x', name: 'X', path: '/services/x', icon: MessageSquare, color: 'text-sky-400', description: 'Conecte-se, compartilhe ideias e debata na rede social oficial.' },
      { key: '/services/library', name: 'Biblioteca Nacional', path: '/services/library', icon: Library, color: 'text-orange-400', description: 'Acesse um vasto acervo de livros, artigos e documentos históricos.' },
      { key: '/services/digital-archive', name: 'Acervo Digital', path: '/services/digital-archive', icon: Archive, color: 'text-rose-400', description: 'Explore o arquivo digital de eventos e documentos importantes.' },
      { key: '/news', name: 'Notícias e Diário Oficial', path: '/news', icon: Newspaper, color: 'text-cyan-300', description: 'Acompanhe imprensa, acontecimentos nacionais e publicações oficiais.' },
    ],
  },
  {
    name: 'Serviços Básicos',
    services: [
      { key: '/services/internet', name: 'Internet', path: '/services/internet', icon: Wifi, color: 'text-cyan-400', description: 'Contrate planos de internet para sua residência ou negócio.' },
      { key: '/services/electricity', name: 'Energia Elétrica', path: '/services/electricity', icon: Zap, color: 'text-yellow-400', description: 'Gerencie seu contrato de energia elétrica e pague suas contas.' },
      { key: '/services/water', name: 'Água', path: '/services/water', icon: Droplet, color: 'text-blue-400', description: 'Serviços de abastecimento de água e saneamento.' },
      { key: '/services/phone', name: 'Telefonia', path: '/services/phone', icon: Smartphone, color: 'text-violet-400', description: 'Planos de telefonia móvel e fixa para se manter conectado.' },
      { key: '/services/rent', name: 'Aluguel', path: '/services/rent', icon: Home, color: 'text-orange-400', description: 'Plataforma para aluguel de imóveis residenciais e comerciais.' },
      { key: '/services/maintenance', name: 'Manutenção', path: '/services/maintenance', icon: Wrench, color: 'text-gray-400', description: 'Contrate serviços de manutenção para sua casa ou empresa.' },
      { key: '/services/gas', name: 'Gás', path: '/services/gas', icon: Flame, color: 'text-orange-500', description: 'Gerencie seu contrato de gás encanado.' },
    ],
  },
];

export const ALL_SERVICES = SERVICE_CATEGORIES.flatMap((category) =>
  category.services.map((service) => ({
    ...service,
    category: category.name,
  }))
);

export const SERVICE_REGISTRY = ALL_SERVICES.reduce((accumulator, service) => {
  accumulator[service.key] = service;
  return accumulator;
}, {});

export const getServiceByKey = (serviceKey) => SERVICE_REGISTRY[serviceKey] || null;

export const normalizeServiceAvailabilitySettings = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((accumulator, [serviceKey, entry]) => {
    const mode = typeof entry?.mode === 'string' ? entry.mode : 'active';
    accumulator[serviceKey] = {
      mode,
      updated_at: entry?.updated_at || null,
    };
    return accumulator;
  }, {});
};

export const resolveServiceMode = (serviceAvailability, serviceKey) =>
  serviceAvailability?.[serviceKey]?.mode || 'active';

export const resolveGlobalServiceMode = (serviceAvailability) =>
  resolveServiceMode(serviceAvailability, GLOBAL_SERVICE_AVAILABILITY_KEY);

export const fetchServiceAvailabilitySettings = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', SERVICE_AVAILABILITY_SETTINGS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeServiceAvailabilitySettings(data?.value);
};
