import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Settings, Shield, User, Banknote, Bell, ArrowRight, Mail, Phone, TrendingUp, Activity, PiggyBank, Users, LayoutDashboard, Calendar, Briefcase, AtSign, Fingerprint } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatPhone, formatCurrency, formatCPF } from '@/lib/utils';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import PageHeader from '@/components/layout/PageHeader';

const StatCard = ({ title, value, icon: Icon, color, description }) => (
  <Card className="glass-effect h-full">
    <CardContent className="p-6 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-400 font-medium">{title}</p>
          <div className={`p-2 rounded-lg bg-slate-800/60 ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <p className="text-3xl font-bold text-white">{value}</p>
      </div>
      {description && <p className="text-xs text-gray-500 mt-2">{description}</p>}
    </CardContent>
  </Card>
);

const ProfileInfoRow = ({ icon: Icon, label, value, colorClass = 'text-gray-400' }) => (
    <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} />
        <div className="flex-1">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm font-medium text-white truncate">{value}</p>
        </div>
    </div>
);

const Dashboard = () => {
  const { user } = useAuth();
  const [data, setData] = useState({
    balance: 0,
    investments: 0,
    followers: 0,
    following: 0,
    notifications: [],
    transactions: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setLoading(true);

      const { data: accountData } = await supabase.from('accounts').select('id, balance').eq('user_id', user.id).maybeSingle();
      const { data: investmentsData } = await supabase.rpc('get_total_invested_by_user', { p_user_id: user.id });
      const { count: followersCount } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('following_id', user.id);
      const { count: followingCount } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('follower_id', user.id);
      const { data: notifData } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(3);
      
      let transactions = [];
      if (accountData) {
        const { data: transData } = await supabase.from('transactions').select('*').or(`from_account_id.eq.${accountData.id},to_account_id.eq.${accountData.id}`).order('created_at', { ascending: false }).limit(3);
        transactions = transData || [];
      }
      
      setData({
        balance: accountData?.balance || 0,
        investments: investmentsData || 0,
        followers: followersCount || 0,
        following: followingCount || 0,
        notifications: notifData || [],
        transactions: transactions,
      });
      setLoading(false);
    };

    fetchData();
  }, [user]);

  const COLORS = ['#34D399', '#60A5FA'];
  const chartData = [
    { name: 'Saldo em Conta', value: data.balance },
    { name: 'Total Investido', value: data.investments },
  ].filter(item => item.value > 0);

  const activityFeed = [...data.notifications, ...data.transactions]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);

  return (
    <>
      <Helmet>
        <title>Dashboard - GOV.RP</title>
        <meta name="description" content="Seu painel de controle pessoal no GOV.RP." />
      </Helmet>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <PageHeader
            icon={LayoutDashboard}
            title="Bem-vindo,"
            gradientText={user?.full_name || user?.username}
            description="Seu resumo de atividades e finanças na plataforma."
            iconColor="text-purple-400"
          />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
            <StatCard title="Saldo em Conta" value={formatCurrency(data.balance * 100)} icon={Banknote} color="text-green-400" description="Disponível para uso imediato." />
            <StatCard title="Total Investido" value={formatCurrency(data.investments * 100)} icon={PiggyBank} color="text-blue-400" description="Seu patrimônio em crescimento." />
            <StatCard title="Seguidores no X" value={data.followers} icon={Users} color="text-sky-400" description={`${data.following} seguindo`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-6">
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Activity /> Atividade Recente</CardTitle>
                  <CardDescription>Suas últimas notificações e transações.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? <p className="text-gray-400">Carregando...</p> : 
                    activityFeed.length > 0 ? (
                      <ul className="space-y-4">
                        {activityFeed.map(item => (
                          <li key={item.id} className="flex items-start gap-4 text-sm">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type?.startsWith('investment') ? 'bg-blue-500/20' : item.type ? 'bg-green-500/20' : 'bg-purple-500/20'}`}>
                              {item.content ? <Bell className="w-4 h-4 text-purple-400" /> : <Banknote className="w-4 h-4 text-green-400" />}
                            </div>
                            <div className="flex-1">
                              <p className="text-white">{item.content || item.description}</p>
                              <p className="text-xs text-gray-500">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}</p>
                            </div>
                            <Link to={item.link || '/services/bank'}><Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white"><ArrowRight className="w-4 h-4"/></Button></Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-gray-400 text-center py-4">Nenhuma atividade recente.</p>
                    )}
                </CardContent>
              </Card>
            </div>
            
            <div className="lg:col-span-2 space-y-6">
               <Card className="glass-effect">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><TrendingUp /> Resumo Financeiro</CardTitle>
                  <CardDescription>Distribuição do seu patrimônio.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div style={{ width: '100%', height: 200 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#8884d8" labelLine={false} label={({ name, percent }) => chartData.length > 1 ? `${(percent * 100).toFixed(0)}%` : name}>
                          {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(value) => formatCurrency(value * 100)} wrapperClassName="!bg-slate-800/80 !border-slate-700 !rounded-lg" />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-effect">
                  <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                          <span className="flex items-center gap-2"><User /> Seu Perfil</span>
                          <Link to="/settings">
                              <Button variant="ghost" size="sm"><Settings className="w-4 h-4 mr-2" /> Editar</Button>
                          </Link>
                      </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                      <div className="flex items-center gap-4 pb-4 border-b border-white/10">
                          <img src={user?.avatar_url} alt="Avatar" className="w-16 h-16 rounded-full object-cover border-2 border-blue-400" />
                          <div>
                              <h3 className="text-xl font-bold text-white">{user?.full_name}</h3>
                              <p className="text-sm text-blue-300">@{user?.username}</p>
                          </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                          <ProfileInfoRow icon={Mail} label="E-mail" value={user?.email || 'N/A'} colorClass="text-purple-400" />
                          <ProfileInfoRow icon={Phone} label="Telefone" value={user?.phone ? formatPhone(user.phone) : 'N/A'} colorClass="text-green-400" />
                          <ProfileInfoRow icon={Fingerprint} label="CPF" value={user?.cpf ? formatCPF(user.cpf) : 'N/A'} colorClass="text-sky-400" />
                          <ProfileInfoRow icon={Briefcase} label="Cargo" value={user?.role} colorClass="text-yellow-400" />
                          <ProfileInfoRow icon={Calendar} label="Membro desde" value={new Date(user?.created_at).toLocaleDateString('pt-BR')} colorClass="text-red-400" />
                          {user?.x_handle && <ProfileInfoRow icon={AtSign} label="X Handle" value={`@${user.x_handle}`} colorClass="text-indigo-400" />}
                      </div>
                  </CardContent>
              </Card>

              {user?.role === 'Admin' && (
                 <Card className="glass-effect border-red-500/30">
                    <CardHeader><CardTitle className="text-red-400">Painel do Administrador</CardTitle></CardHeader>
                    <CardContent>
                      <p className="text-gray-300 mb-4">Acesso à área de gerenciamento do sistema.</p>
                      <Link to="/admin"><Button className="w-full bg-gradient-to-r from-red-600 to-orange-500"><Shield className="mr-2 h-4 w-4" /> Acessar Admin</Button></Link>
                    </CardContent>
                </Card>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Dashboard;