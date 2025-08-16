import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { BarChart2, Users, MessageCircle, Settings, Shield, AlertTriangle, Crown, Loader2 } from 'lucide-react';
import SiteAnalytics from '@/components/admin/SiteAnalytics';
import UserManagement from '@/components/admin/UserManagement';
import ContentModeration from '@/components/admin/ContentModeration';
import SystemSettings from '@/components/admin/SystemSettings';

const adminTabs = [
  { value: 'analytics', label: 'Análises', icon: BarChart2, component: <SiteAnalytics /> },
  { value: 'users', label: 'Usuários', icon: Users, component: <UserManagement /> },
  { value: 'content', label: 'Conteúdo', icon: MessageCircle, component: <ContentModeration /> },
  { value: 'settings', label: 'Sistema', icon: Settings, component: <SystemSettings /> },
];

const AdminDashboard = () => {
  const { user, loading } = useAuth();
  const { tab = 'analytics' } = useParams();

  if (loading) {
    return <div className="flex justify-center items-center h-screen"><Loader2 className="w-16 h-16 animate-spin text-primary" /></div>;
  }

  if (user?.role !== 'Admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-3xl font-bold text-white">Acesso Negado</h1>
        <p className="text-muted-foreground mt-2">Você não tem permissão para acessar esta página.</p>
        <Link to="/dashboard">
          <Button className="mt-6">Voltar ao Dashboard</Button>
        </Link>
      </div>
    );
  }

  const currentTab = adminTabs.find(t => t.value === tab);
  if (!currentTab) {
    return <Navigate to="/admin-dashboard/analytics" replace />;
  }

  return (
    <>
      <Helmet>
        <title>Admin Dashboard - GOV.RP</title>
        <meta name="description" content="Painel de controle do administrador do GOV.RP." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-col sm:flex-row justify-between sm:items-center mb-8">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-2 flex items-center gap-3">
                <Crown className="w-8 h-8 text-yellow-400" />
                <span className="gradient-text">Admin</span> Dashboard
              </h1>
              <p className="text-lg text-muted-foreground">Bem-vindo, {user?.full_name}.</p>
            </div>
             <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 mt-4 sm:mt-0">
                <Shield className="w-5 h-5 text-red-400"/>
                <span className="font-bold text-red-300">Acesso de Administrador</span>
            </div>
          </div>
          
          <Tabs value={tab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 bg-secondary p-1 h-auto">
              {adminTabs.map(tabItem => (
                  <Link to={`/admin-dashboard/${tabItem.value}`} key={tabItem.value} className="flex-1">
                    <TabsTrigger value={tabItem.value} className="w-full data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                        <tabItem.icon className="w-4 h-4 mr-2" />
                        {tabItem.label}
                    </TabsTrigger>
                  </Link>
              ))}
            </TabsList>
            
            <div className="mt-6">
              {currentTab.component}
            </div>
          </Tabs>

        </motion.div>
      </div>
    </>
  );
};

export default AdminDashboard;