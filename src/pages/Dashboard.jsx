
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Landmark, Briefcase, FileText, MessageSquare, Settings, ShieldCheck, Scale, Vote, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const quickAccessLinks = [
  { name: 'Banco Nacional', icon: Landmark, path: '/services/bank', color: 'text-green-400' },
  { name: 'Negócios Livres', icon: Briefcase, path: '/services/business', color: 'text-blue-400' },
  { name: 'Documentos (DIC)', icon: FileText, path: '/services/dic', color: 'text-purple-400' },
  { name: 'Rede Social (X)', icon: MessageSquare, path: '/services/x', color: 'text-sky-400' },
];

const CitizenDashboard = () => (
  <>
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle>Acesso Rápido</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {quickAccessLinks.map(item => (
          <Link to={item.path} key={item.name}>
            <motion.div whileHover={{ scale: 1.05 }} className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-lg h-32 hover:bg-white/10 transition-colors">
              <item.icon className={`w-10 h-10 mb-2 ${item.color}`} />
              <span className="text-sm text-center text-white">{item.name}</span>
            </motion.div>
          </Link>
        ))}
      </CardContent>
    </Card>
    
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle>Atividade Recente</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-gray-400 text-center py-8">Nenhuma atividade recente para exibir.</p>
      </CardContent>
    </Card>
  </>
);

const PresidentDashboard = () => (
  <>
    <Card className="glass-effect">
      <CardHeader><CardTitle>Poderes Executivos</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Button variant="outline"><Scale className="mr-2 h-4 w-4" /> Sancionar Leis</Button>
        <Button variant="outline"><Vote className="mr-2 h-4 w-4" /> Convocar Eleições</Button>
        <Button variant="outline"><ShieldCheck className="mr-2 h-4 w-4" /> Decretos Nacionais</Button>
      </CardContent>
    </Card>
    <Card className="glass-effect">
      <CardHeader><CardTitle>Visão Geral da Nação</CardTitle></CardHeader>
      <CardContent><p className="text-gray-400">Gráficos e estatísticas nacionais aparecerão aqui.</p></CardContent>
    </Card>
  </>
);

const AdminDashboardLink = () => (
    <Card className="glass-effect mt-8">
        <CardHeader>
            <CardTitle>Painel do Administrador</CardTitle>
        </CardHeader>
        <CardContent>
            <p className="text-gray-300 mb-4">Acesso à área de gerenciamento do sistema.</p>
            <Link to="/admin">
                <Button className="w-full bg-gradient-to-r from-red-600 to-orange-500">
                    <Shield className="mr-2 h-4 w-4" /> Acessar Admin
                </Button>
            </Link>
        </CardContent>
    </Card>
);


const Dashboard = () => {
  const { user } = useAuth();

  const renderDashboardByRole = () => {
    switch (user?.role) {
      case 'Presidente':
        return <PresidentDashboard />;
      default:
        return <CitizenDashboard />;
    }
  };

  return (
    <>
      <Helmet>
        <title>Dashboard - GOV.RP</title>
        <meta name="description" content="Seu painel de controle pessoal no GOV.RP." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-2">
            Bem-vindo, <span className="gradient-text">{user?.full_name || user?.username}</span>!
          </h1>
          <p className="text-lg text-gray-400">Seu painel de controle de <span className="font-semibold text-white">{user?.role}</span>.</p>

          <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            <div className="lg:col-span-2 space-y-8">
              {renderDashboardByRole()}
            </div>

            <div className="space-y-8">
              <Card className="glass-effect">
                <CardHeader className="items-center text-center">
                  <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar" className="w-24 h-24 rounded-full object-cover border-2 border-blue-400 mb-4" />
                  <CardTitle className="text-2xl">{user?.full_name}</CardTitle>
                  <p className="text-blue-300">@{user?.username}</p>
                  <p className="text-sm text-gray-400 bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full mt-2">{user?.role}</p>
                </CardHeader>
                <CardContent>
                  <Link to="/settings">
                    <Button variant="outline" className="w-full border-white/20 hover:bg-white/10">
                      <Settings className="w-4 h-4 mr-2" /> Editar Perfil
                    </Button>
                  </Link>
                </CardContent>
              </Card>
              {user?.role === 'Admin' && <AdminDashboardLink />}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Dashboard;
