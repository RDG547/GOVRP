import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Settings, Shield, User, Banknote, Bell, ArrowRight, Mail, Phone, TrendingUp, Activity, PiggyBank, Users, LayoutDashboard, Calendar, Briefcase, AtSign, Fingerprint, Flag, Star, BookOpen, Car, Globe, Building, HelpCircle, Contact } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { formatDistanceToNow, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatPhone, formatCurrency, formatCPF, formatRG } from '@/lib/utils';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
import PageHeader from '@/components/layout/PageHeader';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const StatCard = ({ title, value, icon: Icon, color, description }) => (
  <Card className="glass-effect h-full">
    <CardContent className="p-6 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>
          <div className={`p-2 rounded-lg bg-secondary ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <p className="text-3xl font-bold text-foreground">{value}</p>
      </div>
      {description && <p className="text-xs text-muted-foreground mt-2">{description}</p>}
    </CardContent>
  </Card>
);

const ProfileInfoRow = ({ icon: Icon, label, value, colorClass = 'text-muted-foreground' }) => (
    <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 flex-shrink-0 ${colorClass}`} />
        <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <Popover>
              <PopoverTrigger asChild>
                <p className="text-sm font-medium text-foreground truncate cursor-pointer">{value || 'N/A'}</p>
              </PopoverTrigger>
              <PopoverContent className="w-auto max-w-xs break-words">
                <p>{value || 'N/A'}</p>
              </PopoverContent>
            </Popover>
        </div>
    </div>
);

const Dashboard = () => {
  const { user, setTriggerTutorial, refreshUser } = useAuth();
  const { toast } = useToast();
  const [dontShowTutorial, setDontShowTutorial] = useState(user?.has_seen_tutorial === true);
  const [data, setData] = useState({
    balance: 0,
    investments: 0,
    followers: 0,
    following: 0,
    activityFeed: [],
    party: null,
    reputation: 0,
    documents: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      setDontShowTutorial(user.has_seen_tutorial === true);
    }
  }, [user]);

  const handleTutorialToggle = async (checked) => {
    setDontShowTutorial(checked);
    try {
      const { error } = await supabase.rpc('mark_tutorial_seen', { p_dont_show_again: checked });
      if (error) throw error;
      await refreshUser();
      toast({
        title: "Preferência salva!",
        description: `O tutorial ${checked ? 'não será mais exibido' : 'será exibido'} no próximo login.`,
      });
    } catch (error) {
      toast({
        title: "Erro",
        description: "Não foi possível salvar sua preferência.",
        variant: "destructive",
      });
      setDontShowTutorial(!checked); // Revert on error
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      setLoading(true);

      const sevenDaysAgo = subDays(new Date(), 7).toISOString();

      const { data: accountData } = await supabase.from('accounts').select('id, balance').eq('user_id', user.id).maybeSingle();
      const { data: investmentsData } = await supabase.rpc('get_total_invested_by_user', { p_user_id: user.id });
      const { count: followersCount } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('following_id', user.id);
      const { count: followingCount } = await supabase.from('followers').select('*', { count: 'exact', head: true }).eq('follower_id', user.id);
      const { data: notifData } = await supabase.from('notifications').select('*').eq('user_id', user.id).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false });
      const { data: partyData, error: partyError } = await supabase.rpc('get_user_party_affiliation', { p_user_id: user.id });
      if (partyError) console.error("Party Affiliation Error:", partyError);
      const { data: documentsData } = await supabase.from('documents').select('*').eq('user_id', user.id);
      
      let transactions = [];
      if (accountData) {
        const { data: transData } = await supabase.from('transactions').select('*').or(`from_account_id.eq.${accountData.id},to_account_id.eq.${accountData.id}`).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false });
        transactions = transData || [];
      }
      
      const combinedActivity = [...(notifData || []), ...transactions]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setData({
        balance: accountData?.balance || 0,
        investments: investmentsData || 0,
        followers: followersCount || 0,
        following: followingCount || 0,
        activityFeed: combinedActivity,
        party: partyData?.is_affiliated ? partyData : null,
        reputation: user.reputation_points || 0,
        documents: documentsData || [],
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

  const hasRolePanel = ['Presidente', 'Ministro', 'Parlamentar', 'Juiz', 'Deputado', 'Senador', 'Police', 'AGIES', 'Forças Armadas'].some(role => (Array.isArray(user?.role) ? user.role.includes(role) : user?.role === role));
  
  const getDoc = (type) => data.documents.find(d => d.type === type);

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <StatCard title="Saldo em Conta" value={formatCurrency(data.balance * 100)} icon={Banknote} color="text-green-400" description="Disponível para uso imediato." />
            <StatCard title="Total Investido" value={formatCurrency(data.investments * 100)} icon={PiggyBank} color="text-blue-400" description="Seu patrimônio em crescimento." />
            <StatCard title="Reputação" value={data.reputation} icon={Star} color="text-yellow-400" description="Sua influência na comunidade." />
            <StatCard title="Seguidores no X" value={data.followers} icon={Users} color="text-sky-400" description={`${data.following} seguindo`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-6">
              {hasRolePanel && (
                 <Card className="glass-effect border-purple-500/30">
                    <CardHeader><CardTitle className="text-purple-400">Painel de Cargos</CardTitle></CardHeader>
                    <CardContent>
                      <p className="text-muted-foreground mb-4">Acesso rápido às ferramentas e informações dos seus cargos.</p>
                      <Link to="/role-dashboard"><Button className="w-full bg-gradient-to-r from-purple-600 to-indigo-500"><Shield className="mr-2 h-4 w-4" /> Acessar Painel de Controle</Button></Link>
                    </CardContent>
                </Card>
              )}
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Activity /> Atividade Recente</CardTitle>
                  <CardDescription>Suas últimas notificações e transações dos últimos 7 dias.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? <p className="text-muted-foreground">Carregando...</p> : 
                    data.activityFeed.length > 0 ? (
                      <div className="max-h-96 overflow-y-auto custom-scrollbar pr-2">
                        <ul className="space-y-4">
                          {data.activityFeed.map(item => (
                            <li key={item.id} className="flex items-start gap-4 text-sm">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.type?.startsWith('investment') ? 'bg-blue-500/20' : item.type ? 'bg-green-500/20' : 'bg-purple-500/20'}`}>
                                {item.content ? <Bell className="w-4 h-4 text-purple-400" /> : <Banknote className="w-4 h-4 text-green-400" />}
                              </div>
                              <div className="flex-1">
                                <p className="text-foreground">{item.content || item.description}</p>
                                <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(item.created_at), { addSuffix: true, locale: ptBR })}</p>
                              </div>
                              <Link to={item.link || '/services/bank'}><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground"><ArrowRight className="w-4 h-4"/></Button></Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-4">Nenhuma atividade recente.</p>
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
                        <RechartsTooltip formatter={(value) => formatCurrency(value * 100)} wrapperClassName="!bg-popover/80 !border-border !rounded-lg" contentStyle={{backgroundColor: 'transparent', border: 'none'}} />
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
                      <div className="flex items-center gap-4 pb-4 border-b border-border">
                          <img src={user?.avatar_url} alt="Avatar" className="w-16 h-16 rounded-full object-cover border-2 border-primary" />
                          <div>
                              <h3 className="text-xl font-bold text-foreground">{user?.full_name}</h3>
                              <p className="text-sm text-primary">@{user?.username}</p>
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-4 pt-4">
                          <ProfileInfoRow icon={Mail} label="E-mail" value={user?.email} colorClass="text-purple-400" />
                          <ProfileInfoRow icon={Phone} label="Telefone" value={formatPhone(user?.phone)} colorClass="text-green-400" />
                          <ProfileInfoRow icon={Fingerprint} label="CPF" value={formatCPF(getDoc('CPF')?.document_number)} colorClass="text-sky-400" />
                          <ProfileInfoRow icon={Contact} label="RG" value={formatRG(getDoc('RG')?.document_number)} colorClass="text-sky-400" />
                          <ProfileInfoRow icon={Car} label="CNH" value={getDoc('CNH')?.document_number} colorClass="text-blue-400" />
                          <ProfileInfoRow icon={Globe} label="Passaporte" value={getDoc('Passport')?.document_number} colorClass="text-green-400" />
                          <ProfileInfoRow icon={Building} label="CNPJ" value={getDoc('CNPJ')?.document_number} colorClass="text-yellow-400" />
                          <ProfileInfoRow icon={Briefcase} label="CTD" value={getDoc('CTD')?.document_number} colorClass="text-indigo-400" />
                          <ProfileInfoRow icon={Briefcase} label="Cargo(s)" value={Array.isArray(user?.role) ? user.role.join(', ') : user?.role} colorClass="text-yellow-400" />
                          <ProfileInfoRow icon={Calendar} label="Membro desde" value={new Date(user?.created_at).toLocaleDateString('pt-BR')} colorClass="text-red-400" />
                          {data.party ? (
                            <ProfileInfoRow icon={Flag} label="Filiação Partidária" value={`${data.party.name} (${data.party.acronym})`} colorClass="text-orange-400" />
                          ) : (
                            <ProfileInfoRow icon={Flag} label="Filiação Partidária" value="Nenhuma" colorClass="text-gray-500" />
                          )}
                          {user?.x_handle && <ProfileInfoRow icon={AtSign} label="@ do X" value={`@${user.x_handle}`} colorClass="text-indigo-400" />}
                      </div>
                  </CardContent>
              </Card>
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><HelpCircle /> Tutorial</CardTitle>
                  <CardDescription>Controle a exibição do tutorial de boas-vindas.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="tutorial-switch" className="text-base">Não mostrar tutorial no login</Label>
                      <Switch
                        id="tutorial-switch"
                        checked={dontShowTutorial}
                        onCheckedChange={handleTutorialToggle}
                      />
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setTriggerTutorial(true)}>
                        <BookOpen className="mr-2 h-4 w-4" />
                        Refazer Tutorial
                    </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
};

export default Dashboard;