import React, { lazy, Suspense } from 'react';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '@/contexts/AuthContext';
import ErrorPage from '@/pages/ErrorPage';
import PageHeader from '@/components/layout/PageHeader';
import { Shield, Gavel, Award, Scale, Users as MinisterIcon, Loader2, Eye, ShieldCheck as ArmedForcesIcon, Siren } from 'lucide-react';
import { motion } from 'framer-motion';

const PresidentDashboard = lazy(() => import('./panels/PresidentDashboard'));
const MinisterDashboard = lazy(() => import('./panels/MinisterDashboard'));
const ParliamentarianDashboard = lazy(() => import('./panels/ParliamentarianDashboard'));
const JudgeDashboard = lazy(() => import('./panels/JudgeDashboard'));
const PolicePanel = lazy(() => import('@/pages/services/Police'));
const AGIESPanel = lazy(() => import('@/pages/services/AGIES'));
const ArmedForcesPanel = lazy(() => import('@/pages/services/ArmedForces'));

const dashboards = {
    'Presidente': {
        icon: Award,
        title: 'Painel Presidencial',
        description: 'Gerencie o executivo, emita decretos e lidere a nação.',
        color: 'text-yellow-400',
        component: PresidentDashboard
    },
    'Ministro': {
        icon: MinisterIcon,
        title: 'Painel Ministerial',
        description: 'Gerencie sua pasta, proponha políticas e execute projetos.',
        color: 'text-green-400',
        component: MinisterDashboard
    },
    'Parlamentar': {
        icon: Scale,
        title: 'Painel Parlamentar',
        description: 'Proponha leis, participe de votações e represente seus eleitores.',
        color: 'text-blue-400',
        component: ParliamentarianDashboard
    },
    'Juiz': {
        icon: Gavel,
        title: 'Painel Judicial',
        description: 'Julgue casos, emita sentenças e garanta a justiça.',
        color: 'text-red-400',
        component: JudgeDashboard
    },
    'Police': {
        icon: Siren,
        title: 'Painel Policial',
        description: 'Servir e proteger a comunidade. Registre e consulte ocorrências.',
        color: 'text-blue-500',
        component: PolicePanel
    },
    'AGIES': {
        icon: Eye,
        title: 'Painel AGIES',
        description: 'Agência de Inteligência e Espionagem Suprema. A vigilância é a nossa virtude.',
        color: 'text-red-500',
        component: AGIESPanel
    },
    'Forças Armadas': {
        icon: ArmedForcesIcon,
        title: 'Painel das Forças Armadas',
        description: 'Defendendo a soberania e a segurança da nação.',
        color: 'text-emerald-500',
        component: ArmedForcesPanel
    }
};

const RoleDashboard = () => {
  const { user } = useAuth();
  
  const roleKey = ['Deputado', 'Senador'].includes(user?.role) ? 'Parlamentar' : user?.role;
  const dashboardConfig = dashboards[roleKey];

  if (!dashboardConfig) {
    return <ErrorPage title="Acesso Indisponível" message="Você não possui um cargo com painel de controle." />;
  }

  const { icon: Icon, title, description, color, component: DashboardComponent } = dashboardConfig;

  return (
    <>
      <Helmet>
        <title>{title} - GOV.RP</title>
        <meta name="description" content={description} />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <PageHeader
                icon={Icon}
                title={title}
                gradientText={user.role}
                description={description}
                iconColor={color}
            />
            <div className="glass-effect p-0 sm:p-4 md:p-8 rounded-lg mt-8">
                <Suspense fallback={<div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
                    <DashboardComponent />
                </Suspense>
            </div>
        </motion.div>
      </div>
    </>
  );
};

export default RoleDashboard;