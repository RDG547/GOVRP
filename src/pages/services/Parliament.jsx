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
import { formatDateTimeBR } from '@/lib/dateTime';

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

const LEGAL_EFFECT_LABELS = {
  corporate_tax_rate: 'Alíquota sobre empresas',
  consumption_tax_rate: 'Alíquota sobre consumo',
  business_license_fee: 'Taxa de abertura de empresa',
  public_safety_policy_index: 'Política de segurança',
  social_welfare_policy_index: 'Bem-estar social',
};

const formatLegalEffectValue = (effect) => {
  const value = Number(effect.effect_value || 0);
  if (effect.effect_key.endsWith('_rate')) return `${(value * 100).toLocaleString('pt-BR')}%`;
  if (effect.effect_key === 'business_license_fee') return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return value.toLocaleString('pt-BR');
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
        .select('id, name')
        .eq('is_active', true);
      if (partiesError) {
        throw partiesError;
      }
      setParties(partiesData || []);

      const { data: membersData, error: membersError } = await supabase
        .from('parliament_members')
        .select('id, user_id, house_id, term_start_date, term_end_date, profile:profiles(id, full_name, role, titles)');
      if (membersError) {
        throw membersError;
      }

      const compatibleMembers = filterCompatibleParliamentMembers(
        membersData || [],
        syncState,
        housesData || []
      );
      const activeAssignments = Array.isArray(syncState?.active_assignments)
        ? syncState.active_assignments.filter((assignment) => {
            if (!assignment?.user_id || !['Deputado', 'Senador'].includes(assignment?.office_role)) {
              return false;
            }

            if (!assignment.term_end_at) {
              return true;
            }

            return new Date(assignment.term_end_at).getTime() > Date.now();
          })
        : [];

      const memberProfileMap = compatibleMembers.reduce((accumulator, member) => {
        if (member?.user_id && member?.profile) {
          accumulator[member.user_id] = member.profile;
        }

        return accumulator;
      }, {});

      const missingProfileIds = [...new Set(
        activeAssignments
          .map((assignment) => assignment.user_id)
          .filter((userId) => userId && !memberProfileMap[userId])
      )];

      let fallbackProfilesMap = {};
      if (missingProfileIds.length) {
        const { data: missingProfiles, error: missingProfilesError } = await supabase
          .from('profiles')
          .select('id, full_name, role, titles')
          .in('id', missingProfileIds);

        if (missingProfilesError) {
          throw missingProfilesError;
        }

        fallbackProfilesMap = (missingProfiles || []).reduce((accumulator, profile) => {
          accumulator[profile.id] = profile;
          return accumulator;
        }, {});
      }

      const parliamentariansMap = new Map();

      compatibleMembers.forEach((member) => {
        const displayRole = resolveLegislativeRoleForHouse(
          {
            ...(member.profile || {}),
            id: member.user_id,
          },
          syncState,
          member.house_id,
          housesData || []
        );

        if (!displayRole) {
          return;
        }

        const fullName = member.profile?.full_name || 'Parlamentar';

        parliamentariansMap.set(member.user_id, {
          id: member.user_id,
          name: `${fullName} (${displayRole})`,
          role: displayRole,
        });
      });

      activeAssignments.forEach((assignment) => {
        if (parliamentariansMap.has(assignment.user_id)) {
          return;
        }

        const profile = fallbackProfilesMap[assignment.user_id] || memberProfileMap[assignment.user_id];
        const fullName = profile?.full_name || 'Parlamentar';

        parliamentariansMap.set(assignment.user_id, {
          id: assignment.user_id,
          name: `${fullName} (${assignment.office_role})`,
          role: assignment.office_role,
        });
      });

      setParliamentarians(
        [...parliamentariansMap.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      );
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
                      {target.name}
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
              <p className="text-sm text-muted-foreground">{member.party?.name || 'Sem partido'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mandato parlamentar com duração constitucional de {PARLIAMENT_MANDATE_DURATION_LABEL}.
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

const useCountdown = (endDate) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!endDate) {
      setTimeLeft('');
      return undefined;
    }

    const endTime = new Date(endDate).getTime();

    const tick = () => {
      const difference = endTime - Date.now();
      if (difference <= 0) {
        setTimeLeft('Encerrado');
        return;
      }

      const hours = Math.floor(difference / 3600000);
      const minutes = Math.floor((difference % 3600000) / 60000);
      const seconds = Math.floor((difference % 60000) / 1000);
      setTimeLeft(`${hours}h ${String(minutes).padStart(2, '0')}min ${String(seconds).padStart(2, '0')}s`);
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [endDate]);

  return timeLeft;
};

const CountdownTimer = ({ endDate }) => {
  const timeLeft = useCountdown(endDate);
  if (!timeLeft) {
    return null;
  }

  return <span className="text-xs text-blue-400">⏱ {timeLeft}</span>;
};

const BillList = ({ bills = [] }) => {
  const [statusFilter, setStatusFilter] = useState('all');
  const filteredBills =
    statusFilter === 'all'
      ? bills
      : bills.filter(
          (bill) =>
            bill.status === statusFilter ||
            (statusFilter === 'Em votação' && bill.status?.startsWith('Em votação')) ||
            (statusFilter === 'Aguardando ato presidencial' &&
              ['Aguardando sanção presidencial', 'Aguardando promulgação presidencial'].includes(bill.status)) ||
            (statusFilter === 'Convertido em norma' && ['Sancionado', 'Promulgado'].includes(bill.status)) ||
            (statusFilter === 'Vetado' &&
              ['Vetado integralmente', 'Vetado parcialmente'].includes(bill.status))
        );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Status</SelectItem>
            <SelectItem value="Em tramitação">Em Tramitação</SelectItem>
            <SelectItem value="Em votação">Em Votação</SelectItem>
            <SelectItem value="Aprovado">Aprovados</SelectItem>
            <SelectItem value="Aguardando ato presidencial">Aguardando Ato Presidencial</SelectItem>
            <SelectItem value="Convertido em norma">Convertidos em Norma</SelectItem>
            <SelectItem value="Vetado">Vetados</SelectItem>
            <SelectItem value="Rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredBills.length ? (
          filteredBills.map((bill) => {
            const activeVoting = bill.votings?.find((voting) => voting.status === 'active');
            const closedVotings = bill.votings?.filter((voting) => voting.status === 'closed') || [];
            const latestVoting = activeVoting || closedVotings[0];
            const allVotes = latestVoting?.votes || [];
            const votesFor = allVotes.filter((vote) => vote.vote === 'Aprovar').length;
            const votesAgainst = allVotes.filter((vote) => vote.vote === 'Rejeitar').length;
            const votesAbstain = allVotes.filter((vote) => vote.vote === 'Abster').length;
            const totalVotes = votesFor + votesAgainst + votesAbstain;

            const statusMeta = {
              'Em tramitação': { className: 'bg-yellow-500/20 text-yellow-300', label: 'Em Tramitação' },
              'Em votação': { className: 'bg-blue-500/20 text-blue-300', label: 'Em Votação' },
              'Em votação (2ª Casa)': { className: 'bg-indigo-500/20 text-indigo-300', label: 'Em Votação (2ª Casa)' },
              Aprovado: { className: 'bg-green-500/20 text-green-300', label: 'Aprovado' },
              'Aguardando sanção presidencial': { className: 'bg-amber-500/20 text-amber-300', label: 'Aguardando sanção presidencial' },
              'Aguardando promulgação presidencial': { className: 'bg-violet-500/20 text-violet-300', label: 'Aguardando promulgação presidencial' },
              Sancionado: { className: 'bg-emerald-500/20 text-emerald-300', label: 'Sancionado' },
              Promulgado: { className: 'bg-cyan-500/20 text-cyan-300', label: 'Promulgado' },
              'Vetado integralmente': { className: 'bg-rose-500/20 text-rose-300', label: 'Vetado integralmente' },
              'Vetado parcialmente': { className: 'bg-orange-500/20 text-orange-300', label: 'Vetado parcialmente' },
              Rejeitado: { className: 'bg-red-500/20 text-red-300', label: 'Rejeitado' },
            }[bill.status] || { className: 'bg-muted text-muted-foreground', label: bill.status };

            return (
              <motion.div key={bill.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="glass-effect flex h-full flex-col">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <Avatar className="h-11 w-11">
                        <AvatarImage src={bill.author?.avatar_url} alt={bill.author?.full_name} />
                        <AvatarFallback>{bill.author?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <CardTitle className="text-foreground">{bill.title}</CardTitle>
                        <CardDescription>
                          Autor: {bill.author?.full_name || 'Desconhecido'} | {bill.house?.name}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <p className="line-clamp-3 text-sm text-muted-foreground">{bill.summary}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Proposto em <span className="font-medium text-foreground">{formatDateTimeBR(bill.created_at)}</span>
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${statusMeta.className}`}>{statusMeta.label}</span>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{bill.type}</span>
                      {activeVoting?.end_date ? <CountdownTimer endDate={activeVoting.end_date} /> : null}
                    </div>
                    {bill.legal_effects?.length ? <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Efeito prático da norma</p>{bill.legal_effects.map((effect) => <p key={effect.id} className="mt-2 text-sm"><span className="font-medium">{LEGAL_EFFECT_LABELS[effect.effect_key] || effect.effect_key}:</span> {effect.operation === 'set' ? 'passa a' : effect.operation === 'add' ? 'varia em' : 'é multiplicado por'} {formatLegalEffectValue(effect)} <Badge variant="outline" className="ml-2">{effect.status === 'active' ? 'Em vigor' : 'Previsto'}</Badge></p>)}</div> : null}
                    {totalVotes ? (
                      <>
                        <div className="mt-4 space-y-2">
                          <div className="flex gap-1">
                            <Progress value={votesFor} max={totalVotes} className="h-2 flex-1" indicatorClassName="bg-green-500" />
                            <Progress
                              value={votesAgainst}
                              max={totalVotes}
                              className="h-2 flex-1"
                              indicatorClassName="bg-red-500"
                            />
                            <Progress
                              value={votesAbstain}
                              max={totalVotes}
                              className="h-2 flex-1"
                              indicatorClassName="bg-gray-500"
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-green-400">Aprovar: {votesFor}</span>
                            <span className="text-red-400">Rejeitar: {votesAgainst}</span>
                            <span className="text-gray-400">Abster: {votesAbstain}</span>
                          </div>
                        </div>
                      </>
                    ) : bill.status?.startsWith('Em votação') ? (
                      <p className="mt-4 text-center text-xs text-muted-foreground">Nenhum voto registrado ainda.</p>
                    ) : null}
                    {bill.status_history?.length ? (
                      <div className="mt-5 border-t border-white/10 pt-4">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Histórico de tramitação
                        </p>
                        <ol className="space-y-0">
                          {bill.status_history.map((event, index) => (
                            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                              {index < bill.status_history.length - 1 ? (
                                <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-white/10" />
                              ) : null}
                              <span aria-hidden="true" className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-blue-300 bg-slate-950" />
                              <div>
                                <p className="text-sm font-medium text-foreground">{event.event_label}</p>
                                <time dateTime={event.occurred_at} className="text-xs text-muted-foreground">
                                  {formatDateTimeBR(event.occurred_at)}
                                </time>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        ) : (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            Nenhum projeto encontrado para o filtro selecionado.
          </p>
        )}
      </div>
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
                    Mandato até {new Date(`${term.term_end_date}T00:00:00`).toLocaleDateString('pt-BR')}
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
              const statusMeta = getLeadershipElectionStatusMeta(election.status);
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

  const fetchParliamentData = useCallback(async () => {
    setLoading(true);
    try {
      await autoCloseExpiredVotings(supabase);

      const governanceRefresh = await refreshParliamentGovernanceState(supabase).catch((error) => {
        if (isGovernanceSchemaMissing(error)) {
          return { schemaReady: false, error };
        }
        throw error;
      });

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
        .select('*, profile:profiles(*), party:political_parties(name, acronym, logo_url)');
      if (membersError) {
        throw membersError;
      }
      setAllMembers(
        filterCompatibleParliamentMembers(membersData || [], syncState, housesData || [])
      );

      const { data: billsData, error: billsError } = await supabase
        .from('bills')
        .select('*, author:profiles(full_name, avatar_url), house:parliament_houses(id, name)')
        .order('created_at', { ascending: false });
      if (billsError) {
        throw billsError;
      }

      const billIds = (billsData || []).map((bill) => bill.id);
      let votingsMap = {};
      let historyMap = {};
      let effectsMap = {};
      if (billIds.length) {
        const [votingsResponse, historyResponse, effectsResponse] = await Promise.all([
          supabase
            .from('parliament_votings')
            .select('id, status, end_date, house_id, related_id, votes:parliament_voting_votes(vote, member_id)')
            .eq('type', 'bill')
            .in('related_id', billIds),
          supabase
            .from('bill_status_history')
            .select('id, bill_id, status, event_label, occurred_at')
            .in('bill_id', billIds)
            .order('occurred_at', { ascending: true }),
          supabase
            .from('law_effects')
            .select('id, source_id, effect_key, operation, effect_value, explanation, status, activated_at')
            .eq('source_kind', 'bill')
            .in('source_id', billIds),
        ]);

        const { data: votingsData, error: votingsError } = votingsResponse;

        if (votingsError) {
          throw votingsError;
        }

        (votingsData || []).forEach((voting) => {
          if (!votingsMap[voting.related_id]) {
            votingsMap[voting.related_id] = [];
          }
          votingsMap[voting.related_id].push(voting);
        });

        if (historyResponse.error) {
          console.warn('Histórico de tramitação ainda não está disponível:', historyResponse.error);
        } else {
          (historyResponse.data || []).forEach((event) => {
            if (!historyMap[event.bill_id]) historyMap[event.bill_id] = [];
            historyMap[event.bill_id].push(event);
          });
        }
        if (effectsResponse.error) {
          console.warn('Efeitos das normas ainda não estão disponíveis:', effectsResponse.error);
        } else {
          (effectsResponse.data || []).forEach((effect) => {
            if (!effectsMap[effect.source_id]) effectsMap[effect.source_id] = [];
            effectsMap[effect.source_id].push(effect);
          });
        }
      }

      setBills(
        (billsData || []).map((bill) => ({
          ...bill,
          votings: votingsMap[bill.id] || [],
          status_history: historyMap[bill.id] || [],
          legal_effects: effectsMap[bill.id] || [],
        }))
      );

      const { data: plebiscitesData, error: plebiscitesError } = await supabase
        .from('plebiscites')
        .select('id, title, description, status, author_id, start_date, end_date, created_at, updated_at, approved_by_house_id, author_name, author_avatar_url, votes_sim, votes_nao, votes_abstencao')
        .order('created_at', { ascending: false });
      if (plebiscitesError) {
        throw plebiscitesError;
      }
      setPlebiscites(plebiscitesData || []);

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

      if (user) {
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
      } else {
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
  }, [toast, user]);

  useEffect(() => {
    fetchParliamentData();
  }, [fetchParliamentData]);

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
        <ParliamentRulesSection />

        <div className="mt-12">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="mb-8 flex flex-col items-center justify-between gap-4 md:flex-row">
              <div className="w-full overflow-x-auto scroll-smooth pb-2 custom-scrollbar md:w-auto" role="region" aria-label="Seções do Parlamento" tabIndex={0}>
                <TabsList className="flex h-auto min-w-max flex-nowrap justify-start">
                  <TabsTrigger className="shrink-0" value="members">Membros</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="bills">Histórico de Projetos</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="commissions">Comissões</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="leadership">Mesa Diretora</TabsTrigger>
                  <TabsTrigger className="shrink-0" value="plebiscites">Plebiscitos</TabsTrigger>
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
              <BillList bills={filteredBills} />
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
          </Tabs>
        </div>
      </div>
    </>
  );
};

export default Parliament;
