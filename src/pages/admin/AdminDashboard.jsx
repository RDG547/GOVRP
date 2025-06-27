import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useParams, Link } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart2, Users, MessageCircle, Settings, Shield } from 'lucide-react';
import SiteAnalytics from '@/components/admin/SiteAnalytics';
import UserManagement from '@/components/admin/UserManagement';
import ContentModeration from '@/components/admin/ContentModeration';

const adminTabs = [
  { value: 'analytics', label: 'Análises', icon: BarChart2, component: <SiteAnalytics /> },
  { value: 'users', label: 'Usuários', icon: Users, component: <UserManagement /> },
  { value: 'content', label: 'Conteúdo', icon: MessageCircle, component: <ContentModeration /> },
  { value: 'settings', label: 'Configurações', icon: Settings, component: <div className="text-center py-10 text-white">Página de configurações em construção.</div> },
];

const AdminDashboard = () => {
  const { user } = useAuth();
  const { tab } = useParams();

  const activeTab = tab || 'analytics';

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
              <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
                <span className="gradient-text">Admin</span> Dashboard
              </h1>
              <p className="text-lg text-gray-400">Bem-vindo, {user?.full_name}.</p>
            </div>
             <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 mt-4 sm:mt-0">
                <Shield className="w-5 h-5 text-red-400"/>
                <span className="font-bold text-red-300">Acesso de Administrador</span>
            </div>
          </div>
          
          <Tabs value={activeTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 bg-black/20 p-1">
              {adminTabs.map(tabItem => (
                  <Link to={`/admin/${tabItem.value}`} key={tabItem.value}>
                    <TabsTrigger value={tabItem.value} className="w-full data-[state=active]:bg-slate-700 data-[state=active]:text-white">
                        <tabItem.icon className="w-4 h-4 mr-2" />
                        {tabItem.label}
                    </TabsTrigger>
                  </Link>
              ))}
            </TabsList>
            
            <div className="mt-6">
                {adminTabs.map(tabItem => (
                    <TabsContent key={tabItem.value} value={tabItem.value}>
                        {tabItem.component}
                    </TabsContent>
                ))}
            </div>
          </Tabs>

        </motion.div>
      </div>
    </>
  );
};

export default AdminDashboard;