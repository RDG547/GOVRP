import { internalElectionPhase } from '@/lib/parliamentGovernance';
import ParliamentRoleBadges from '@/components/parliament/ParliamentRoleBadges';
import BillHistory, { CountdownTimer } from '@/components/parliament/BillHistory';
import { hydrateBillHistory } from '@/lib/billHistory';
import { formatDateTimeBR } from '@/lib/dateTime';
import { formatDateBR } from '@/lib/dateTime';
import { formatLocaleBR } from '@/lib/dateTime';
import PartyIdentity from '@/components/parliament/PartyIdentity';
import { fetchPublicProfiles } from '@/lib/publicProfiles';
import { PARLIAMENT_REALTIME_TABLES, parliamentSectionsForEvents } from '@/lib/parliamentRealtime';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import {
  Check,
  FileText,
  Hand,
  Inbox,
  Landmark,
  Loader2,
  ScrollText,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  UserX,
  Users,
  Vote,
  Scale,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/layout/PageHeader';
import GovernanceMigrationAlert from '@/components/parliament/GovernanceMigrationAlert';
import {
  PARLIAMENT_MANDATE_DURATION_LABEL,
  PARLIAMENT_PANEL_ROLES,
  PARLIAMENT_RULE_SECTIONS,
  autoCloseExpiredVotings,
} from '@/lib/parliament';
import { fetchElectionOfficeSyncState } from '@/lib/electionOfficeSync';
import {
  fetchCommissionGovernanceData,
  fetchLeadershipGovernanceData,
  getCommissionHouseSummary,
  getCommissionStatusMeta,
  getCommissionTypeLabel,
  getLeadershipElectionStatusMeta,
  getLeadershipPositionLabel,
  isGovernanceSchemaMissing,
  refreshParliamentGovernanceState,
} from '@/lib/parliamentGovernance';
import { filterCompatibleParliamentMembers, resolveLegislativeRoleForHouse } from '@/lib/roleResolution';
import { useQueuedRefresh } from '@/hooks/use-queued-refresh';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { usePublicProfileChanges } from '@/hooks/use-public-profile-changes';

const PARLIAMENT_RULE_ICON_MAP = {
  commissions: Users,
  terms: FileText,
  senate: Landmark,
};

const PLEBISCITE_COLORS = {
  Sim: '#22c55e',
  Não: '#ef4444',
  Abstenção: '#6b7280',
};

const ParliamentRulesSection = () => (
  <section className="mt-12">
    <div className="mb-6 text-center">
      <h2 className="text-3xl font-bold text-foreground">
        Estrutura <span className="gradient-text">Institucional</span>
      </h2>
      <p className="mx-auto mt-3 max-w-3xl text-muted-foreground">
        O funcionamento do Parlamento segue regras claras sobre comissões, mandatos mensais, mesa diretora e competências próprias de cada Casa.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {PARLIAMENT_RULE_SECTIONS.map((section) => {
        const Icon = PARLIAMENT_RULE_ICON_MAP[section.id] || FileText;

        return (
          <Card key={section.id} className="glass-effect h-full border-white/10">
            <CardHeader>
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                Regra
              </div>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.items.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/5 p-4">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <p className="text-sm leading-relaxed text-muted-foreground">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  </section>
);

const CitizenActions = ({ onPlebAction }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [isPlebChoiceOpen, setIsPlebChoiceOpen] = useState(false);
  const [isPlebFormOpen, setIsPlebFormOpen] = useState(false);
  const [suggestionData, setSuggestionData] = useState({
    title: '',
    suggestion: '',
    target_type: 'house',
    target_id: '',
    bill_type: 'PL',
  });
  const [plebisciteData, setPlebisciteData] = useState({ title: '', description: '' });
  const [parliamentarians, setParliamentarians] = useState([]);
  const [parties, setParties] = useState([]);
  const [houses, setHouses] = useState([]);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: housesData, error: housesError }, syncState] = await Promise.all([
        supabase.from('parliament_houses').select('id, name'),
        fetchElectionOfficeSyncState(supabase).catch((error) => {
          console.error('Erro ao carregar cargos eleitorais para sugestões parlamentares:', error);
          return null;
        }),
      ]);
      if (housesError) {
        throw housesError;
      }
      setHouses(housesData || []);

      const { data: partiesData, error: partiesError } = await supabase
        .from('political_parties')
        .select('id, name, acronym, logo_url')
        .eq('is_active', true);
      if (partiesError) {
        throw partiesError;
      }
      setParties(partiesData || []);

      const { data: targets, error: targetsError } = await supabase.rpc('get_bill_suggestion_targets');
      if (targetsError) throw targetsError;
      const logos = new Map((partiesData || []).map(party => [party.acronym, party.logo_url]));
      setParliamentarians((targets || []).map(target => ({ ...target, party_logo_url: logos.get(target.party_acronym) })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    } catch (error) {
      toast({
        title: 'Erro ao carregar destinos',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isSuggestOpen) {
      fetchTargets();
    }
  }, [fetchTargets, isSuggestOpen]);

  useDomainRealtime('suggestion-targets', 'public', ['parliament_members', 'party_members', 'political_parties'], fetchTargets, isSuggestOpen);
  usePublicProfileChanges(fetchTargets, isSuggestOpen);

  const handleSuggestionSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.rpc('submit_bill_suggestion', {
      p_title: suggestionData.title,
      p_suggestion: suggestionData.suggestion,
      p_target_type: suggestionData.target_type,
      p_target_id: suggestionData.target_id,
      p_bill_type: suggestionData.bill_type,
    });

    if (error || (data && !data.success)) {
      toast({
        title: 'Erro ao enviar sugestão',
        description: error?.message || data?.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Sugestão enviada', description: data.message });
      setIsSuggestOpen(false);
      setSuggestionData({
        title: '',
        suggestion: '',
        target_type: 'house',
        target_id: '',
        bill_type: 'PL',
      });
    }

    setLoading(false);
  };

  const handlePlebisciteSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.rpc('request_plebiscite', {
      p_title: plebisciteData.title,
      p_description: plebisciteData.description,
    });

    if (error || (data && !data.success)) {
      toast({
        title: 'Erro ao solicitar plebiscito',
        description: error?.message || data?.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Solicitação enviada', description: data.message });
      setIsPlebFormOpen(false);
      setPlebisciteData({ title: '', description: '' });
    }

    setLoading(false);
  };

  const targetOptions =
    suggestionData.target_type === 'house'
      ? houses
      : suggestionData.target_type === 'party'
        ? parties
        : parliamentarians;

  return (
    <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
      <Dialog open={isSuggestOpen} onOpenChange={setIsSuggestOpen}>
        <DialogTrigger asChild>
          <Card className="glass-effect cursor-pointer transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-primary" />
                Sugerir Projeto
              </CardTitle>
              <CardDescription>Envie uma ideia legislativa diretamente ao Parlamento.</CardDescription>
            </CardHeader>
          </Card>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sugerir Projeto</DialogTitle>
            <DialogDescription>Sua ideia pode se tornar uma proposta legislativa.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSuggestionSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="target_type">Enviar para</Label>
              <Select
                value={suggestionData.target_type}
                onValueChange={(value) =>
                  setSuggestionData((current) => ({ ...current, target_type: value, target_id: '' }))
                }
              >
                <SelectTrigger id="target_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="house">Casa Legislativa</SelectItem>
                  <SelectItem value="party">Partido Político</SelectItem>
                  <SelectItem value="parliamentarian">Parlamentar Específico</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_id">Destino específico</Label>
              <Select
                value={suggestionData.target_id}
                onValueChange={(value) => setSuggestionData((current) => ({ ...current, target_id: value }))}
                disabled={loading}
              >
                <SelectTrigger id="target_id">
                  <SelectValue placeholder={loading ? 'Carregando...' : 'Selecione...'} />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((target) => (
                    <SelectItem key={target.id} value={target.id}>
                      <span className="flex items-center gap-2">
                        {target.role && <Avatar className="h-7 w-7"><AvatarImage src={target.avatar_url} /><AvatarFallback>{target.name?.[0] || 'P'}</AvatarFallback></Avatar>}
                        <span>{suggestionData.target_type === 'party' ? <PartyIdentity party={target} /> : target.name}{target.role && <span className="ml-1 text-xs text-muted-foreground">· {target.role} · <PartyIdentity party={target.party_name ? { name: target.party_name, acronym: target.party_acronym, logo_url: target.party_logo_url } : null} /></span>}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bill_type">Tipo</Label>
                <Select
                  value={suggestionData.bill_type}
                  onValueChange={(value) => setSuggestionData((current) => ({ ...current, bill_type: value }))}
                >
                  <SelectTrigger id="bill_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PL">PL</SelectItem>
                    <SelectItem value="PEC">PEC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="title">Título</Label>
                <Input
                  id="title"
                  value={suggestionData.title}
                  onChange={(event) => setSuggestionData((current) => ({ ...current, title: event.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="suggestion">Sugestão</Label>
              <Textarea
                id="suggestion"
                value={suggestionData.suggestion}
                onChange={(event) => setSuggestionData((current) => ({ ...current, suggestion: event.target.value }))}
                placeholder="Descreva a ideia de forma detalhada..."
                required
              />
            </div>

            <DialogFooter>
              <Button type="submit" disabled={loading || !suggestionData.target_id}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Enviar Sugestão
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isPlebChoiceOpen} onOpenChange={setIsPlebChoiceOpen}>
        <DialogTrigger asChild>
          <Card className="glass-effect cursor-pointer transition-colors hover:bg-accent/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Vote className="h-5 w-5 text-primary" />
                Plebiscitos e Referendos
              </CardTitle>
              <CardDescription>Participe de consultas populares ou solicite uma nova votação.</CardDescription>
            </CardHeader>
          </Card>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Plebiscitos e Referendos</DialogTitle>
            <DialogDescription>Escolha a ação que deseja realizar.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-4">
            <Button
              onClick={() => {
                setIsPlebChoiceOpen(false);
                setIsPlebFormOpen(true);
              }}
            >
              <FileText className="mr-2 h-4 w-4" />
              Solicitar nova votação
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsPlebChoiceOpen(false);
                onPlebAction();
              }}
            >
              <Hand className="mr-2 h-4 w-4" />
              Participar de consulta ativa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isPlebFormOpen} onOpenChange={setIsPlebFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Solicitar Plebiscito</DialogTitle>
            <DialogDescription>Proponha um tema para consulta popular.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePlebisciteSubmit} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="pleb_title">Título</Label>
              <Input
                id="pleb_title"
                value={plebisciteData.title}
                onChange={(event) => setPlebisciteData((current) => ({ ...current, title: event.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pleb_desc">Descrição / Justificativa</Label>
              <Textarea
                id="pleb_desc"
                value={plebisciteData.description}
                onChange={(event) => setPlebisciteData((current) => ({ ...current, description: event.target.value }))}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Solicitar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const ParliamentMembersList = ({ members = [] }) => {
  if (!members.length) {
    return <p className="py-8 text-center text-muted-foreground">Nenhum membro nesta Casa no momento.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <Card key={member.id} className="glass-effect">
          <CardContent className="flex items-center gap-4 p-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={member.profile?.avatar_url} alt={member.profile?.full_name} />
              <AvatarFallback>{member.profile?.full_name?.charAt(0) || 'P'}</AvatarFallback>
            </Avatar>
            <div>
              {member.profile?.x_handle ? (
                <Link to={`/services/x/profile/${member.profile.x_handle}`} className="font-semibold hover:underline">
                  {member.profile.full_name}
                </Link>
              ) : (
                <p className="font-semibold">{member.profile?.full_name || 'Parlamentar'}</p>
              )}
              <ParliamentRoleBadges role={member.profile?.role}/><p className="text-sm text-muted-foreground"><PartyIdentity party={member.party} /></p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mandato de {PARLIAMENT_MANDATE_DURATION_LABEL}.<br/>Início: {member.term_start_at ? formatDateTimeBR(member.term_start_at) : formatDateBR(member.term_start_date)}<br/>Fim: {member.term_end_at ? formatDateTimeBR(member.term_end_at) : formatDateBR(member.term_end_date)}{(member.term_start_at||member.term_end_at)&&' · Brasília'}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const PlebisciteList = ({ plebiscites = [], userVote = {}, onVote, user }) => {
  const { toast } = useToast();
  const [votingOn, setVotingOn] = useState(null);

  const handleVote = async (plebisciteId, vote) => {
    setVotingOn(plebisciteId);
    const { data, error } = await supabase.rpc('cast_plebiscite_vote', {
      p_plebiscite_id: plebisciteId,
      p_vote: vote,
    });

    if (error || (data && !data.success)) {
      toast({
        title: 'Erro ao votar',
        description: data?.message || error?.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Voto computado', description: data.message });
      onVote();
    }

    setVotingOn(null);
  };

  const getStatusInfo = (status) => {
    switch (status) {
      case 'Pendente':
        return { text: 'Em Análise', color: 'bg-yellow-500/20 text-yellow-300' };
      case 'Ativo':
        return { text: 'Ativo', color: 'bg-green-500/20 text-green-300' };
      case 'Rejeitado':
        return { text: 'Rejeitado', color: 'bg-red-500/20 text-red-300' };
      case 'Aprovado':
        return { text: 'Aprovado', color: 'bg-blue-500/20 text-blue-300' };
      case 'Reprovado':
        return { text: 'Reprovado', color: 'bg-purple-500/20 text-purple-300' };
      default:
        return { text: status, color: 'bg-muted text-muted-foreground' };
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {plebiscites.length ? (
        plebiscites.map((plebiscite) => {
          const statusInfo = getStatusInfo(plebiscite.status);
          const isVoting = votingOn === plebiscite.id;
          const currentUserVote = userVote?.[plebiscite.id];
          const canVote = user && user.role !== 'Usuário';

          const chartData = [
            { name: 'Sim', value: plebiscite.votes_sim || 0 },
            { name: 'Não', value: plebiscite.votes_nao || 0 },
            { name: 'Abstenção', value: plebiscite.votes_abstencao || 0 },
          ].filter((item) => item.value > 0);

          return (
            <motion.div key={plebiscite.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="glass-effect flex h-full flex-col">
                <CardHeader>
                  <CardTitle>{plebiscite.title}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={plebiscite.author_avatar_url} alt={plebiscite.author_name} />
                      <AvatarFallback>{plebiscite.author_name?.[0] || 'C'}</AvatarFallback>
                    </Avatar>
                    <CardDescription>
                      Sugerido por {plebiscite.author_name}{' '}
                      {formatDistanceToNow(new Date(plebiscite.created_at), { addSuffix: true, locale: ptBR })}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="flex-grow">
                  <p className="text-sm text-muted-foreground">{plebiscite.description}</p>
                  {plebiscite.status === 'Ativo' && plebiscite.end_date ? (
                    <div className="mt-3">
                      <CountdownTimer endDate={plebiscite.end_date} />
                    </div>
                  ) : null}
                  {plebiscite.status === 'Ativo' ? (
                    <div className="mt-4 h-48 w-full">
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie
                            data={chartData.length ? chartData : [{ name: 'Sem votos', value: 1 }]}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={60}
                            label={chartData.length > 0}
                          >
                            {chartData.length ? (
                              chartData.map((entry, index) => (
                                <Cell key={`${entry.name}-${index}`} fill={PLEBISCITE_COLORS[entry.name]} />
                              ))
                            ) : (
                              <Cell fill="#4b5563" />
                            )}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : null}
                </CardContent>
                <CardFooter className="flex-col items-start gap-4">
                  <span className={`rounded-full px-2 py-1 text-xs ${statusInfo.color}`}>{statusInfo.text}</span>
                  {plebiscite.status === 'Ativo' && canVote ? (
                    isVoting ? (
                      <div className="flex w-full justify-center">
                        <Loader2 className="animate-spin" />
                      </div>
                    ) : currentUserVote ? (
                      <p className="w-full text-center text-sm text-muted-foreground">
                        Seu voto: <span className="font-bold">{currentUserVote}</span>
                      </p>
                    ) : (
                      <div className="flex w-full gap-2">
                        <Button size="sm" className="flex-1 bg-green-600 hover:bg-green-700" onClick={() => handleVote(plebiscite.id, 'Sim')}>
                          <ThumbsUp className="mr-2 h-4 w-4" />
                          Sim
                        </Button>
                        <Button size="sm" className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => handleVote(plebiscite.id, 'Não')}>
                          <ThumbsDown className="mr-2 h-4 w-4" />
                          Não
                        </Button>
                        <Button size="sm" className="flex-1 bg-gray-600 hover:bg-gray-700" onClick={() => handleVote(plebiscite.id, 'Abstenção')}>
                          <UserX className="mr-2 h-4 w-4" />
                          Abster
                        </Button>
                      </div>
                    )
                  ) : null}
                </CardFooter>
              </Card>
            </motion.div>
          );
        })
      ) : (
        <p className="col-span-full py-10 text-center text-muted-foreground">Nenhum plebiscito encontrado.</p>
      )}
    </div>
  );
};

const CommissionList = ({ commissions = [], governanceSchemaReady }) => {
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredCommissions = useMemo(
    () =>
      commissions.filter((commission) => {
        const typeMatches = typeFilter === 'all' || commission.type === typeFilter;
        const statusMatches = statusFilter === 'all' || commission.status === statusFilter;
        return typeMatches && statusMatches;
      }),
    [commissions, statusFilter, typeFilter]
  );

  return (
    <div className="space-y-6">
      {!governanceSchemaReady ? <GovernanceMigrationAlert compact /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="Filtrar tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="permanent">Permanentes</SelectItem>
            <SelectItem value="temporary">Temporárias</SelectItem>
            <SelectItem value="cpi">CPIs</SelectItem>
            <SelectItem value="cpmi">CPMIs</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries({
              collecting_support: 'Coletando Apoios',
              pending_plenary: 'Aguardando Plenário',
              approved_pending_officialization: 'Aguardando Oficialização',
              active: 'Ativas',
              completed: 'Encerradas',
              rejected: 'Rejeitadas',
            }).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {filteredCommissions.length ? (
          filteredCommissions.map((commission) => {
            const statusMeta = getCommissionStatusMeta(commission.status);

            return (
              <Card key={commission.id} className="glass-effect flex h-full flex-col">
                <CardHeader>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                      {getCommissionTypeLabel(commission.type)}
                    </Badge>
                    <Badge variant="outline" className={statusMeta.className}>
                      {statusMeta.label}
                    </Badge>
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                      {getCommissionHouseSummary(commission)}
                    </Badge>
                  </div>
                  <CardTitle>{commission.title}</CardTitle>
                  <CardDescription>{commission.summary}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Objetivo</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{commission.purpose}</p>
                  </div>

                  {commission.supportStatusByHouse?.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {commission.supportStatusByHouse.map((item) => (
                        <div key={item.house.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <p className="text-sm font-medium text-foreground">{item.house.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Apoios: <span className="font-medium text-foreground">{item.signed}</span> de{' '}
                            <span className="font-medium text-foreground">{item.required}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Composição</p>
                      <p className="mt-2 text-sm text-foreground">{commission.members.length} integrante(s)</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Relatoria</p>
                      <p className="mt-2 text-sm text-foreground">
                        {commission.reporter?.profile?.full_name || 'Relator não designado'}
                      </p>
<PartyIdentity party={commission.reporter?.party} className="text-sm" />
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Relatório Final</p>
                      <p className="mt-2 text-sm text-foreground">{commission.final_report ? 'Protocolado' : 'Pendente'}</p>
                    </div>
                  </div>

                  {commission.final_report ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                      <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Relatório final</p>
                      <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-emerald-50/90">{commission.final_report}</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        ) : (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            Nenhuma comissão encontrada para o filtro selecionado.
          </p>
        )}
      </div>
    </div>
  );
};

const LeadershipList = ({ houseId, houses = [], terms = [], elections = [], governanceSchemaReady }) => {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const filteredTerms = houseId === 'all' ? terms : terms.filter((term) => term.house_id === houseId);
  const filteredElections = houseId === 'all' ? elections : elections.filter((election) => election.house_id === houseId);

  return (
    <div className="space-y-6">
      {!governanceSchemaReady ? <GovernanceMigrationAlert compact /> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {filteredTerms.filter((term) => term.status === 'active').length ? (
          filteredTerms
            .filter((term) => term.status === 'active')
            .map((term) => (
              <Card key={term.id} className="glass-effect border-white/10">
                <CardHeader>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                      {term.house?.name}
                    </Badge>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                      Mandato Ativo
                    </Badge>
                  </div>
                  <CardTitle>{getLeadershipPositionLabel(term.house?.name || '', term.position)}</CardTitle>
                  <CardDescription>
                    Mandato até {formatDateBR(term.term_end_date)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-4">
                  <Avatar className="h-14 w-14">
                    <AvatarImage src={term.member?.profile?.avatar_url} />
                    <AvatarFallback>{term.member?.profile?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-semibold text-foreground">
                      {term.member?.profile?.full_name || 'Parlamentar'}
                    </p>
<PartyIdentity party={term.member?.party} className="text-sm" />
                    <p className="text-sm text-muted-foreground">Mandato mensal da mesa diretora.</p>
                  </div>
                </CardContent>
              </Card>
            ))
        ) : (
          <Card className="glass-effect border-white/10">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Nenhum mandato ativo de mesa diretora foi registrado no filtro atual.
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="glass-effect border-white/10">
        <CardHeader>
          <CardTitle>Histórico de Eleições Internas</CardTitle>
          <CardDescription>
            Acompanhe a abertura, o resultado e o status das disputas internas de cada Casa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredElections.length ? (
            filteredElections.map((election) => {
              const statusMeta = { ...getLeadershipElectionStatusMeta(election.status), label:internalElectionPhase(election,now) };
              return (
                <Card key={election.id} className="border-white/10 bg-background/50">
                  <CardHeader>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={statusMeta.className}>
                        {statusMeta.label}
                      </Badge>
                      <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                        {election.house?.name}
                      </Badge>
                    </div>
                    <CardTitle>{election.title}</CardTitle>
                    <CardDescription>
                      {getLeadershipPositionLabel(election.house?.name || '', election.position)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {election.description ? (
                      <p className="text-sm text-muted-foreground">{election.description}</p>
                    ) : null}
                    {election.winner ? (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Eleito</p>
                        <p className="mt-2 text-sm text-emerald-50">
                          {election.winner.profile?.full_name || 'Parlamentar'}
                        </p>
<PartyIdentity party={election.winner?.party} className="text-sm" />
                      </div>
                    ) : null}
                    <div className="grid gap-3 md:grid-cols-2">
                      {election.candidates.map((candidate) => (
                        <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={candidate.member?.profile?.avatar_url} />
                              <AvatarFallback>{candidate.member?.profile?.full_name?.charAt(0) || 'C'}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium text-foreground">
                                {candidate.member?.profile?.full_name || 'Parlamentar'}
                              </p>
<PartyIdentity party={candidate.member?.party} className="text-sm" />
                              <p className="text-sm text-muted-foreground">{candidate.votes} voto(s)</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma eleição interna registrada para o filtro selecionado.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const Parliament = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [houses, setHouses] = useState([]);
  const [bills, setBills] = useState([]);
  const [plebiscites, setPlebiscites] = useState([]);
  const [userPlebiscitesVotes, setUserPlebiscitesVotes] = useState({});
  const [allMembers, setAllMembers] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [leadershipTerms, setLeadershipTerms] = useState([]);
  const [leadershipElections, setLeadershipElections] = useState([]);
  const [governanceSchemaReady, setGovernanceSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('members');
  const [selectedHouse, setSelectedHouse] = useState('all');

  const loadParliamentData = useCallback(async (refreshGovernance = false, events = null) => {
    const sections = parliamentSectionsForEvents(events);
    try {
      if (refreshGovernance === true) await autoCloseExpiredVotings(supabase);

      const governanceRefresh = refreshGovernance === true ? await refreshParliamentGovernanceState(supabase).catch((error) => {
        if (isGovernanceSchemaMissing(error)) {
          return { schemaReady: false, error };
        }
        throw error;
      }) : { schemaReady: true };

      if (sections.includes('members')) {
      const [{ data: housesData, error: housesError }, syncState] = await Promise.all([
        supabase.from('parliament_houses').select('*'),
        fetchElectionOfficeSyncState(supabase).catch((error) => {
          console.error('Erro ao carregar cargos eleitorais do parlamento:', error);
          return null;
        }),
      ]);
      if (housesError) {
        throw housesError;
      }
      setHouses(housesData || []);

      const { data: membersData, error: membersError } = await supabase
        .from('parliament_members')
        .select('*, profile:profiles(id,full_name,avatar_url,role,titles,x_handle), party:political_parties!parliament_members_party_id_fkey(name, acronym, logo_url, color)');
      if (membersError) {
        throw membersError;
      }
      const publicProfiles = await fetchPublicProfiles((membersData || []).map(member => member.user_id));
      setAllMembers(
        filterCompatibleParliamentMembers((membersData || []).map(member => (() => {const assignment=syncState?.active_assignments?.find(item=>item.user_id===member.user_id);return {...member,profile:publicProfiles.get(member.user_id)||member.profile,term_start_at:assignment?.term_start_at,term_end_at:assignment?.term_end_at};})()), syncState, housesData || [])
      );

      }
      if (sections.includes('bills')) {
      const { data: billsData, error: billsError } = await supabase
        .from('bills')
        .select('*, author:profiles(full_name, avatar_url), house:parliament_houses(id, name)')
        .order('created_at', { ascending: false });
      if (billsError) {
        throw billsError;
      }

      setBills(await hydrateBillHistory(billsData || [], supabase));

      }
      if (sections.includes('plebiscites')) {
      const { data: plebiscitesData, error: plebiscitesError } = await supabase
        .from('plebiscites')
        .select('id, title, description, status, author_id, start_date, end_date, created_at, updated_at, approved_by_house_id, author_name, author_avatar_url, votes_sim, votes_nao, votes_abstencao')
        .order('created_at', { ascending: false });
      if (plebiscitesError) {
        throw plebiscitesError;
      }
      setPlebiscites(plebiscitesData || []);

      }
      if (sections.includes('governance')) {
      const [commissionsResponse, leadershipResponse] = await Promise.all([
        fetchCommissionGovernanceData(supabase),
        fetchLeadershipGovernanceData(supabase),
      ]);

      setCommissions(commissionsResponse.commissions || []);
      setLeadershipTerms(leadershipResponse.terms || []);
      setLeadershipElections(leadershipResponse.elections || []);
      setGovernanceSchemaReady(
        Boolean(governanceRefresh?.schemaReady) &&
          Boolean(commissionsResponse.schemaReady) &&
          Boolean(leadershipResponse.schemaReady)
      );

      }
      if (sections.includes('plebiscites') && user) {
        const { data: plebVotes, error: plebVotesError } = await supabase
          .from('plebiscite_votes')
          .select('plebiscite_id, vote')
          .eq('voter_id', user.id);
        if (plebVotesError) {
          throw plebVotesError;
        }
        setUserPlebiscitesVotes(
          (plebVotes || []).reduce((accumulator, vote) => {
            accumulator[vote.plebiscite_id] = vote.vote;
            return accumulator;
          }, {})
        );
      } else if (!user) {
        setUserPlebiscitesVotes({});
      }
    } catch (error) {
      toast({
        title: 'Erro ao carregar dados do parlamento',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, user?.id]);

  const fetchParliamentData = useQueuedRefresh(loadParliamentData, [false]);
  useEffect(() => { void fetchParliamentData(true); }, [fetchParliamentData, loadParliamentData]);
  useDomainRealtime('parliament', user?.id, PARLIAMENT_REALTIME_TABLES, events => fetchParliamentData(false, events));
  usePublicProfileChanges(() => fetchParliamentData());

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const filteredMembers = selectedHouse === 'all' ? allMembers : allMembers.filter((member) => member.house_id === selectedHouse);
  const filteredBills = selectedHouse === 'all' ? bills : bills.filter((bill) => bill.house_id === selectedHouse);
  const filteredCommissions =
    selectedHouse === 'all'
      ? commissions
      : commissions.filter((commission) => commission.houses.some((house) => house.id === selectedHouse));

  const membersByHouse = houses.reduce((accumulator, house) => {
    accumulator[house.id] = filteredMembers.filter((member) => member.house_id === house.id);
    return accumulator;
  }, {});

  const rolePool = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role].filter(Boolean);
  const hasParliamentPanel = rolePool.some((role) => PARLIAMENT_PANEL_ROLES.includes(role));

  return (
    <>
      <Helmet>
        <title>Parlamento Cidadão - GOV.RP</title>
        <meta name="description" content="Acompanhe as atividades legislativas, comissões e a mesa diretora do Parlamento." />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={Scale}
          title="Parlamento"
          gradientText="Cidadão"
          description="Acompanhe projetos, comissões, eleições internas e a composição institucional do poder legislativo."
          iconColor="text-yellow-400"
          centered={true}
        >
          {hasParliamentPanel ? (
            <Button asChild>
              <Link to="/services/parliament/panel">Ir para o Painel Parlamentar</Link>
            </Button>
          ) : null}
        </PageHeader>

        <CitizenActions onPlebAction={() => setActiveTab('plebiscites')} />

        <div className="mt-12">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="mb-8 flex flex-col items-center justify-between gap-4 md:flex-row">
              <div className="w-full overflow-x-auto scroll-smooth pb-2 custom-scrollbar md:w-auto" role="region" aria-label="Seções do Parlamento" tabIndex={0}>
                <TabsList className="flex h-auto min-w-max flex-nowrap justify-start">
                  <TabsTrigger className="shrink-0" value="members"><Users className="mr-2 h-4 w-4" />Membros</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="bills"><ScrollText className="mr-2 h-4 w-4" />Histórico de Projetos</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="commissions"><Users className="mr-2 h-4 w-4" />Comissões</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="leadership"><Landmark className="mr-2 h-4 w-4" />Mesa Diretora</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="plebiscites"><Vote className="mr-2 h-4 w-4" />Plebiscitos</TabsTrigger>
                  <TabsTrigger value="institution"><Landmark className="mr-2 h-4 w-4" />Como funciona</TabsTrigger>
              </TabsList>
              </div>

              <Select onValueChange={setSelectedHouse} value={selectedHouse}>
                <SelectTrigger className="w-full md:w-[260px]">
                  <SelectValue placeholder="Filtrar por Casa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Casas</SelectItem>
                  {houses.map((house) => (
                    <SelectItem key={house.id} value={house.id}>
                      {house.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <TabsContent value="members">
              {(selectedHouse === 'all' ? houses : houses.filter((house) => house.id === selectedHouse)).map((house) => (
                <div key={house.id} className="mb-8">
                  <h2 className="mb-4 flex items-center gap-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    <Landmark className="h-6 w-6" />
                    {house.name}
                  </h2>
                  <ParliamentMembersList members={membersByHouse[house.id]} />
                </div>
              ))}
            </TabsContent>

            <TabsContent value="bills">
              <h2 className="mb-4 text-2xl font-bold">Histórico de Projetos</h2>
              <BillHistory bills={filteredBills} />
            </TabsContent>

            <TabsContent value="commissions">
              <CommissionList commissions={filteredCommissions} governanceSchemaReady={governanceSchemaReady} />
            </TabsContent>

            <TabsContent value="leadership">
              <LeadershipList
                houseId={selectedHouse}
                houses={houses}
                terms={leadershipTerms}
                elections={leadershipElections}
                governanceSchemaReady={governanceSchemaReady}
              />
            </TabsContent>

            <TabsContent value="plebiscites">
              <PlebisciteList plebiscites={plebiscites} userVote={userPlebiscitesVotes} onVote={fetchParliamentData} user={user} />
            </TabsContent>
            <TabsContent value="institution"><ParliamentRulesSection /></TabsContent>
          </Tabs>
        </div>

      </div>
    </>
  );
};

export default Parliament;
