import { formatLocaleBR } from '@/lib/dateTime';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Settings, Shield, User, Banknote, Bell, ArrowRight, Mail, TrendingUp, Activity, PiggyBank, Users, LayoutDashboard, Calendar, Briefcase, AtSign, Fingerprint, Flag, Star, BookOpen, Car, Globe, Building, HelpCircle, Contact, Repeat, FileText as DocIcon, UserPlus, MessageSquare, Gavel, Award, Loader2, Landmark, MapPin, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { formatDistanceToNow, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatCurrency, formatCPF, formatRG, formatCNPJ } from '@/lib/utils';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
import PageHeader from '@/components/layout/PageHeader';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Inventory from '@/components/dashboard/Inventory';
import CitizenObjectives from '@/components/dashboard/CitizenObjectives';

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

const ActivityIcon = ({ type }) => {
    const iconMap = {
        'transfer': { icon: Banknote, color: 'text-green-400', bg: 'bg-green-500/20' },
        'transfer_received': { icon: Banknote, color: 'text-green-400', bg: 'bg-green-500/20' },
        'purchase': { icon: Briefcase, color: 'text-blue-400', bg: 'bg-blue-500/20' },
        'purchase_card': { icon: Briefcase, color: 'text-blue-400', bg: 'bg-blue-500/20' },
        'subscription_payment': { icon: Repeat, color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
        'subscription_payment_card': { icon: Repeat, color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
        'investment_application': { icon: TrendingUp, color: 'text-indigo-400', bg: 'bg-indigo-500/20' },
        'investment_withdrawal': { icon: PiggyBank, color: 'text-pink-400', bg: 'bg-pink-500/20' },
        'document_issued': { icon: DocIcon, color: 'text-purple-400', bg: 'bg-purple-500/20' },
        'x_follow': { icon: UserPlus, color: 'text-sky-400', bg: 'bg-sky-500/20' },
        'x_like': { icon: MessageSquare, color: 'text-sky-400', bg: 'bg-sky-500/20' },
        'x_repost': { icon: MessageSquare, color: 'text-sky-400', bg: 'bg-sky-500/20' },
        'x_dm': { icon: Mail, color: 'text-sky-400', bg: 'bg-sky-500/20' },
        'fine_issued': { icon: Gavel, color: 'text-red-400', bg: 'bg-red-500/20' },
        'criminal_record_new': { icon: Gavel, color: 'text-red-400', bg: 'bg-red-500/20' },
        'bill_suggestion_received': { icon: Award, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
        'bill_suggestion_received_party': { icon: Award, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
        'daily_check_in': { icon: Calendar, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
        'daily_check_in_reward': { icon: Calendar, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
        'salary_payment': { icon: Banknote, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
        'salary': { icon: Banknote, color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
        'political_points_awarded': { icon: Landmark, color: 'text-amber-400', bg: 'bg-amber-500/20' },
        'default': { icon: Bell, color: 'text-gray-400', bg: 'bg-gray-500/20' }
    };

    const { icon: Icon, color, bg } = iconMap[type] || iconMap.default;
    return (
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
            <Icon className={`w-4 h-4 ${color}`} />
        </div>
    );
};

const journeyCardsByAspiration = {
  politics: [
    ['Conheça os partidos', '/services/political-parties', Flag], ['Acompanhe o Parlamento', '/services/parliament/citizen', Landmark],
    ['Veja próximas eleições', '/services/elections', Calendar], ['Construa presença na Rede X', '/services/x/feed', MessageSquare],
  ],
  entrepreneurship: [
    ['Acesse o Banco', '/services/bank', Banknote], ['Explore Negócios Livres', '/services/business', Briefcase],
    ['Portal do Empreendedor', '/services/entrepreneur-portal', Building], ['Acompanhe a economia', '/services/economy', TrendingUp],
  ],
  justice: [
    ['Conheça a Justiça', '/services/justice', Gavel], ['Acompanhe o Parlamento', '/services/parliament/citizen', Landmark],
    ['Consulte seus documentos', '/services/dic', DocIcon], ['Desenvolva sua formação', '/services/education', BookOpen],
  ],
  security: [
    ['Segurança e Justiça', '/services/justice', Shield], ['Documentos oficiais', '/services/dic', DocIcon],
    ['Serviços ao cidadão', '/services', Landmark], ['Conheça a comunidade', '/community', Users],
  ],
  communication: [
    ['Publique na Rede X', '/services/x/feed', MessageSquare], ['Acompanhe as notícias', '/news', Mail],
    ['Observe a política', '/services/parliament/citizen', Landmark], ['Complete seu perfil', '/settings', User],
  ],
  knowledge: [
    ['Explore a Educação', '/services/education', BookOpen], ['Conheça os serviços', '/services', Landmark],
    ['Veja oportunidades', '/services/business', Briefcase], ['Participe da comunidade', '/community', Users],
  ],
  civil_life: [
    ['Conheça os serviços', '/services', Landmark], ['Acesse o Banco', '/services/bank', Banknote],
    ['Entre na Rede X', '/services/x/feed', MessageSquare], ['Complete seu perfil', '/settings', User],
  ],
};

const CitizenDashboard = () => {
  const { user, setTriggerTutorial, refreshUser } = useAuth();
  const { toast } = useToast();
  const [dontShowTutorial, setDontShowTutorial] = useState(false);
  const [data, setData] = useState({
    accountId: null,
    hasBankAccount: false,
    balance: 0,
    investments: 0,
    followers: 0,
    following: 0,
    activityFeed: [],
    party: null,
    reputation: 0,
    politicalPoints: 0,
    documents: [],
  });
  const [loading, setLoading] = useState(true);
  const [dailyCheckIn, setDailyCheckIn] = useState({
    loading: true,
    claiming: false,
    featureAvailable: true,
    status: null,
  });

  const isMissingDailyCheckInRpc = (error) =>
    error?.code === 'PGRST202' ||
    /daily_check_in/i.test(`${error?.message || ''} ${error?.details || ''}`);

  useEffect(() => {
    if (user) {
      setDontShowTutorial(user.has_seen_tutorial === true);
    }
  }, [user]);

  const fetchData = useCallback(async () => {
    if (!user) {
      return;
    }

    setLoading(true);
    setDailyCheckIn((currentState) => ({
      ...currentState,
      loading: true,
    }));

    const sevenDaysAgo = subDays(new Date(), 7).toISOString();

    try {
      const [
        accountResponse,
        investmentsResponse,
        followersResponse,
        followingResponse,
        notificationsResponse,
        partyResponse,
        documentsResponse,
        dailyCheckInResponse,
      ] = await Promise.all([
        supabase.from('accounts').select('id, balance').eq('user_id', user.id).maybeSingle(),
        supabase.rpc('get_total_invested_by_user', { p_user_id: user.id }),
        supabase.from('followers').select('*', { count: 'exact', head: true }).eq('following_id', user.id),
        supabase.from('followers').select('*', { count: 'exact', head: true }).eq('follower_id', user.id),
        supabase.from('notifications').select('*').eq('user_id', user.id).gte('created_at', sevenDaysAgo).order('created_at', { ascending: false }),
        supabase.rpc('get_user_party_affiliation', { p_user_id: user.id }),
        supabase.from('documents').select('*').eq('user_id', user.id),
        supabase.rpc('get_daily_check_in_status'),
      ]);

      if (accountResponse.error && accountResponse.error.code !== 'PGRST116') {
        throw accountResponse.error;
      }

      if (investmentsResponse.error) {
        throw investmentsResponse.error;
      }

      if (followersResponse.error) {
        throw followersResponse.error;
      }

      if (followingResponse.error) {
        throw followingResponse.error;
      }

      if (notificationsResponse.error) {
        throw notificationsResponse.error;
      }

      if (documentsResponse.error) {
        throw documentsResponse.error;
      }

      if (partyResponse.error) {
        console.error("Party Affiliation Error:", partyResponse.error);
      }

      let transactions = [];
      if (accountResponse.data) {
        const { data: transactionsData, error: transactionsError } = await supabase.rpc('get_user_transactions', { p_user_id: user.id });

        if (transactionsError) {
          throw transactionsError;
        }

        transactions = transactionsData || [];
      }

      const combinedActivity = [...(notificationsResponse.data || []), ...transactions]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      setData({
        accountId: accountResponse.data?.id || null,
        hasBankAccount: Boolean(accountResponse.data),
        balance: accountResponse.data?.balance || 0,
        investments: investmentsResponse.data || 0,
        followers: followersResponse.count || 0,
        following: followingResponse.count || 0,
        activityFeed: combinedActivity,
        party: partyResponse.data?.is_affiliated ? partyResponse.data : null,
        reputation: user.reputation_points || 0,
        politicalPoints: user.political_points || 0,
        documents: documentsResponse.data || [],
      });

      if (dailyCheckInResponse.error) {
        if (isMissingDailyCheckInRpc(dailyCheckInResponse.error)) {
          setDailyCheckIn((currentState) => ({
            ...currentState,
            loading: false,
            featureAvailable: false,
            status: null,
          }));
        } else {
          console.error("Daily Check-in Error:", dailyCheckInResponse.error);
          setDailyCheckIn((currentState) => ({
            ...currentState,
            loading: false,
            featureAvailable: true,
            status: null,
          }));
        }
      } else {
        setDailyCheckIn((currentState) => ({
          ...currentState,
          loading: false,
          featureAvailable: true,
          status: dailyCheckInResponse.data,
        }));
      }
    } catch (error) {
      console.error("Dashboard Error:", error);
      toast({
        title: "Erro ao carregar dashboard",
        description: "Não foi possível carregar todos os dados do seu painel.",
        variant: "destructive",
      });
      setDailyCheckIn((currentState) => ({
        ...currentState,
        loading: false,
      }));
    } finally {
      setLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [fetchData, user]);

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
      setDontShowTutorial(!checked);
    }
  };

  const handleClaimDailyCheckIn = async () => {
    setDailyCheckIn((currentState) => ({
      ...currentState,
      claiming: true,
    }));

    try {
      const { data: claimResult, error } = await supabase.rpc('claim_daily_check_in');

      if (error) {
        throw error;
      }

      if (!claimResult?.success) {
        toast({
          title: claimResult?.already_claimed ? "Check-in já registrado" : "Não foi possível registrar o check-in",
          description: claimResult?.message || "Tente novamente em instantes.",
          variant: claimResult?.already_claimed ? "default" : "destructive",
        });
        return;
      }

      toast({
        title: "Check-in diário realizado!",
        description: claimResult.message,
      });

      await Promise.all([refreshUser(), fetchData()]);
    } catch (error) {
      toast({
        title: "Erro ao registrar check-in",
        description: error.message || "Não foi possível registrar sua recompensa diária.",
        variant: "destructive",
      });
    } finally {
      setDailyCheckIn((currentState) => ({
        ...currentState,
        claiming: false,
      }));
    }
  };

  const COLORS = ['#34D399', '#60A5FA'];
  const chartData = [
    { name: 'Saldo em Conta', value: data.balance || 0 },
    { name: 'Total Investido', value: data.investments || 0 },
  ].filter(item => item.value > 0);

  const rolePool = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : Array.isArray(user?.role)
      ? user.role
      : [user?.role].filter(Boolean);
  const hasRolePanel = ['Presidente', 'Presidente do Banco Nacional', 'Ministro', 'Parlamentar', 'Juiz', 'Presidente do STF', 'Deputado', 'Senador', 'Presidente da Câmara', 'Presidente da Câmara dos Deputados', 'Presidente do Senado', 'Vice-Presidente da Câmara dos Deputados', 'Vice-Presidente do Senado', 'Vice-Presidente do Senado Federal', 'Police', 'AGIES', 'Forças Armadas'].some(role => rolePool.includes(role));
  
  const getDoc = (type) => data.documents.find(d => d.type === type);
  const journeyCards = journeyCardsByAspiration[user?.initial_aspiration] || journeyCardsByAspiration.civil_life;
  const firstSteps = [
    ['Criar cidadania', Boolean(user?.citizenship_created_at), '/settings'],
    ['Emitir documentos obrigatórios', ['CPF', 'RG', 'Título de Eleitor', 'CTD'].every((type) => Boolean(getDoc(type))), '/services/dic'],
    ['Abrir conta bancária', data.hasBankAccount, '/services/bank'],
    ['Personalizar avatar', Boolean(user?.avatar_url), '/settings'],
    ['Criar perfil na Rede X', Boolean(user?.x_handle), '/services/x/feed'],
  ];

  return (
    <>
      <Helmet>
        <title>Dashboard do Cidadão - GOV.RP</title>
        <meta name="description" content="Seu painel de controle pessoal no GOV.RP." />
      </Helmet>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <PageHeader
            icon={LayoutDashboard}
            title="Bem-vindo,"
            gradientText={user?.full_name || user?.username}
            description="Seu resumo de atividades e finanças na plataforma."
            iconColor="text-purple-400"
            centered={true}
          />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="glass-effect mb-6 overflow-hidden border-emerald-500/25">
            <CardHeader className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10">
              <CardTitle>Comece sua jornada</CardTitle>
              <CardDescription>Recomendações baseadas na sua aspiração inicial. Você continua livre para seguir qualquer caminho.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {journeyCards.map(([title, path, Icon]) => (
                <Link key={title} to={path} className="group rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-emerald-400/40 hover:bg-emerald-500/5">
                  <Icon className="h-6 w-6 text-emerald-400" />
                  <p className="mt-3 text-sm font-semibold">{title}</p>
                  <ArrowRight className="mt-3 h-4 w-4 text-muted-foreground transition group-hover:translate-x-1" />
                </Link>
              ))}
            </CardContent>
          </Card>

          <CitizenObjectives />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <StatCard title="Reputação" value={data.reputation} icon={Star} color="text-yellow-400" description="Sua influência na comunidade." />
            <StatCard title="Pontos Políticos" value={data.politicalPoints} icon={Landmark} color="text-amber-400" description="Seu capital político institucional." />
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
              <Inventory />
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
                              <ActivityIcon type={item.type} />
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
              <Card className="glass-effect border-blue-500/20">
                <CardHeader><CardTitle>Primeiros passos</CardTitle><CardDescription>Checklist opcional para conhecer o GOVRP.</CardDescription></CardHeader>
                <CardContent><ul className="space-y-3">{firstSteps.map(([label, completed, path]) => <li key={label}><Link to={path} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5">{completed ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <Circle className="h-5 w-5 text-slate-500" />}<span className={completed ? 'text-slate-400 line-through' : 'text-foreground'}>{label}</span></Link></li>)}</ul></CardContent>
              </Card>

              <Card className="glass-effect border-emerald-500/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Calendar className="text-emerald-400" /> Check-in Diário</CardTitle>
                  <CardDescription>Entre todos os dias para garantir saldo, reputacao e manter sua sequencia ativa.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {dailyCheckIn.loading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando status do check-in...
                    </div>
                  ) : !dailyCheckIn.featureAvailable ? (
                    <p className="text-sm text-muted-foreground">
                      O check-in diário será exibido automaticamente assim que a atualização do serviço for concluída.
                    </p>
                  ) : !dailyCheckIn.status?.has_bank_account ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Abra sua conta bancaria para receber recompensas em saldo e registrar sua sequencia diaria.
                      </p>
                      <Link to="/services/bank">
                        <Button className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600">
                          <Banknote className="mr-2 h-4 w-4" />
                          Abrir Conta Bancaria
                        </Button>
                      </Link>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                          <p className="text-xs text-muted-foreground">Sequencia atual</p>
                          <p className="text-2xl font-bold text-foreground">{dailyCheckIn.status?.current_streak || 0} dias</p>
                        </div>
                        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4">
                          <p className="text-xs text-muted-foreground">
                            {dailyCheckIn.status?.has_checked_in_today ? 'Proxima recompensa' : 'Recompensa de hoje'}
                          </p>
                          <p className="text-lg font-bold text-foreground">{formatCurrency(dailyCheckIn.status?.reward_preview_amount || 0)}</p>
                          <p className="text-xs text-muted-foreground">+{dailyCheckIn.status?.reputation_reward || 0} reputacao</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-muted-foreground space-y-2">
                        <p>
                          {dailyCheckIn.status?.has_checked_in_today
                            ? 'Seu check-in de hoje já foi registrado. Volte amanhã para continuar sua sequência.'
                            : dailyCheckIn.status?.current_streak > 0
                              ? `Seu proximo check-in sera o dia ${dailyCheckIn.status?.next_streak} da sequencia.`
                              : 'Faca o primeiro check-in para iniciar sua sequencia diaria.'}
                        </p>
                        {dailyCheckIn.status?.weekly_bonus_amount > 0 && (
                          <p className="text-amber-300">
                            Esse resgate inclui bônus semanal de {formatCurrency(dailyCheckIn.status.weekly_bonus_amount)}.
                          </p>
                        )}
                        {dailyCheckIn.status?.last_checked_in_at && (
                          <p className="text-xs">
                            Último registro {formatDistanceToNow(new Date(dailyCheckIn.status.last_checked_in_at), { addSuffix: true, locale: ptBR })}.
                          </p>
                        )}
                      </div>

                      <Button
                        className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600"
                        onClick={handleClaimDailyCheckIn}
                        disabled={dailyCheckIn.claiming || !dailyCheckIn.status?.can_claim_today}
                      >
                        {dailyCheckIn.claiming ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Registrando check-in...
                          </>
                        ) : dailyCheckIn.status?.has_checked_in_today ? (
                          'Check-in já realizado hoje'
                        ) : (
                          'Fazer Check-in Diário'
                        )}
                      </Button>
                    </>
                  )}
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
                          <ProfileInfoRow icon={MapPin} label="Residência" value={user?.residence_city_name ? `${user.residence_city_name}/${user.residence_state_code}` : user?.state_name} colorClass="text-green-400" />
                          <ProfileInfoRow icon={User} label="Nascimento do cidadão" value={user?.date_of_birth ? formatLocaleBR(new Date(`${user.date_of_birth}T00:00:00`), 'toLocaleDateString', 'pt-BR') : null} colorClass="text-purple-400" />
                          <ProfileInfoRow icon={Fingerprint} label="CPF" value={formatCPF(getDoc('CPF')?.document_number)} colorClass="text-sky-400" />
                          <ProfileInfoRow icon={Contact} label="RG" value={formatRG(getDoc('RG')?.document_number)} colorClass="text-sky-400" />
                          <ProfileInfoRow icon={Car} label="CNH" value={getDoc('CNH')?.document_number} colorClass="text-blue-400" />
                          <ProfileInfoRow icon={Globe} label="Passaporte" value={getDoc('Passport')?.document_number} colorClass="text-green-400" />
                          <ProfileInfoRow icon={Building} label="CNPJ" value={formatCNPJ(getDoc('CNPJ')?.document_number)} colorClass="text-yellow-400" />
                          <ProfileInfoRow icon={Briefcase} label="CTD" value={getDoc('CTD')?.document_number} colorClass="text-indigo-400" />
                          <ProfileInfoRow icon={Briefcase} label="Cargo(s)" value={Array.isArray(user?.role) ? user.role.join(', ') : user?.role} colorClass="text-yellow-400" />
                          <ProfileInfoRow icon={Calendar} label="Cidadão desde" value={user?.citizenship_created_at ? formatLocaleBR(new Date(user.citizenship_created_at), 'toLocaleDateString', 'pt-BR') : null} colorClass="text-red-400" />
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

export default CitizenDashboard;
