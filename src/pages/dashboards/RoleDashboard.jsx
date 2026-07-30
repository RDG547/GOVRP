import React, { lazy, Suspense } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  Award,
  Eye,
  Gavel,
  Landmark,
  LayoutDashboard,
  LineChart,
  Loader2,
  Scale,
  ShieldCheck as ArmedForcesIcon,
  Siren,
  Users as MinisterIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import ErrorPage from '@/pages/ErrorPage';
import PageHeader from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PARLIAMENT_LEADERSHIP_ROLES } from '@/lib/parliament';
import { hasAnyJusticeRole } from '@/lib/justice/constants';

const PresidentDashboard = lazy(() => import('./panels/PresidentDashboard'));
const MinisterDashboard = lazy(() => import('./panels/MinisterDashboard'));
const ParliamentarianDashboard = lazy(() => import('./panels/ParliamentarianDashboard'));
const JudgeDashboard = lazy(() => import('./panels/JudgeDashboard'));
const PolicePanel = lazy(() => import('@/pages/services/Police'));
const AGIESPanel = lazy(() => import('@/pages/services/AGIES'));
const ArmedForcesPanel = lazy(() => import('@/pages/services/ArmedForces'));
const BankManagementPanel = lazy(() => import('@/components/bank/BankManagementPanel'));
const EmbeddedEconomyPanel = lazy(
  () => import('@/features/economy/components/EmbeddedEconomyPanel')
);
const AuthorityJusticeDashboard = lazy(
  () => import('@/features/justice/pages/AuthorityJusticeDashboard')
);
const CitizenJusticeDashboard = lazy(
  () => import('@/features/justice/pages/CitizenJusticeDashboard')
);

const dashboards = {
  Presidente: {
    icon: Award,
    title: 'Painel Presidencial',
    description: 'Governe com orçamento, indicadores, consequências econômicas e segurança jurídica.',
    color: 'text-yellow-400',
    component: PresidentDashboard,
    economyView: 'government',
  },
  Ministro: {
    icon: MinisterIcon,
    title: 'Painel Ministerial',
    description: 'Gerencie sua pasta, proponha políticas e acompanhe o impacto econômico nacional.',
    color: 'text-green-400',
    component: MinisterDashboard,
    economyView: 'government',
  },
  'Presidente do Banco Nacional': {
    icon: Landmark,
    title: 'Painel do Banco Nacional',
    description: 'Administre crédito e juros com os dados reais da política monetária.',
    color: 'text-emerald-400',
    component: BankManagementPanel,
    economyView: 'centralBank',
  },
  Parlamentar: {
    icon: Scale,
    title: 'Painel Parlamentar',
    description: 'Legisle com acesso aos efeitos econômicos e jurídicos das decisões públicas.',
    color: 'text-blue-400',
    component: ParliamentarianDashboard,
    economyView: 'public',
  },
  Juiz: {
    icon: Gavel,
    title: 'Painel Judicial',
    description: 'Analise pedidos, processos, prazos, mandados e execução penal auditável.',
    color: 'text-red-400',
    component: JudgeDashboard,
    economyView: 'public',
  },
  Police: {
    icon: Siren,
    title: 'Painel Policial',
    description: 'Transforme ocorrências em missões, investigações e pedidos judiciais.',
    color: 'text-blue-500',
    component: PolicePanel,
    economyView: 'public',
  },
  AGIES: {
    icon: Eye,
    title: 'Painel AGIES',
    description: 'Inteligência estratégica integrada ao cenário econômico e jurídico nacional.',
    color: 'text-red-500',
    component: AGIESPanel,
    economyView: 'public',
  },
  'Forças Armadas': {
    icon: ArmedForcesIcon,
    title: 'Painel das Forças Armadas',
    description: 'Defesa nacional contextualizada por estabilidade, orçamento e atividade econômica.',
    color: 'text-emerald-500',
    component: ArmedForcesPanel,
    economyView: 'public',
  },
};

const resolveRoleKey = (user, forcedRole) => {
  if (forcedRole) return forcedRole;

  const rolePool = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role].filter(Boolean);

  if (rolePool.includes('Presidente')) return 'Presidente';
  if (rolePool.includes('Presidente do Banco Nacional')) return 'Presidente do Banco Nacional';
  if (rolePool.some((role) => `${role}`.startsWith('Ministro'))) return 'Ministro';
  if (['Deputado', 'Senador', ...PARLIAMENT_LEADERSHIP_ROLES].some((role) => rolePool.includes(role))) {
    return 'Parlamentar';
  }
  if (rolePool.some((role) => ['Juiz', 'Presidente do STF'].includes(role))) return 'Juiz';
  if (rolePool.some((role) => ['Police', 'Policial', 'Delegado'].includes(role))) return 'Police';
  if (rolePool.some((role) => ['AGIES', 'Agente Secreto'].includes(role))) return 'AGIES';
  if (rolePool.some((role) => ['Forças Armadas', 'Militar'].includes(role))) return 'Forças Armadas';
  return user?.role;
};

const RoleDashboard = ({ forcedRole = null }) => {
  const { user } = useAuth();
  const roleKey = resolveRoleKey(user, forcedRole);
  const dashboardConfig = dashboards[roleKey];

  if (!dashboardConfig) {
    return (
      <ErrorPage
        title="Acesso Indisponível"
        message="Você não possui um cargo com painel de controle."
      />
    );
  }

  const {
    icon: Icon,
    title,
    description,
    color,
    component: DashboardComponent,
    economyView,
  } = dashboardConfig;
  const justiceAuthority = hasAnyJusticeRole(user);
  const defaultTab = ['Juiz', 'Police'].includes(roleKey)
    ? 'justice'
    : roleKey === 'Presidente do Banco Nacional'
      ? 'economy'
      : 'office';

  return (
    <>
      <Helmet>
        <title>{title} - GOV.RP</title>
        <meta name="description" content={description} />
      </Helmet>
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <PageHeader
            icon={Icon}
            title={title}
            gradientText={roleKey}
            description={description}
            iconColor={color}
            centered
          />

          <Tabs defaultValue={defaultTab} className="mt-8 space-y-6">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-2 bg-muted/50 p-2">
              <TabsTrigger value="office">
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Funções do cargo
              </TabsTrigger>
              <TabsTrigger value="economy">
                <LineChart className="mr-2 h-4 w-4" />
                Economia
              </TabsTrigger>
              <TabsTrigger value="justice">
                <Scale className="mr-2 h-4 w-4" />
                Justiça
              </TabsTrigger>
            </TabsList>

            <TabsContent value="office">
              <div className="glass-effect rounded-lg p-0 sm:p-4 md:p-8">
                <Suspense
                  fallback={(
                    <div className="flex h-64 items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}
                >
                  <DashboardComponent />
                </Suspense>
              </div>
            </TabsContent>

            <TabsContent value="economy">
              <Suspense
                fallback={(
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}
              >
                <EmbeddedEconomyPanel view={economyView} />
              </Suspense>
            </TabsContent>

            <TabsContent value="justice">
              <Suspense
                fallback={(
                  <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}
              >
                {justiceAuthority
                  ? <AuthorityJusticeDashboard />
                  : <CitizenJusticeDashboard />}
              </Suspense>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </>
  );
};

export default RoleDashboard;
