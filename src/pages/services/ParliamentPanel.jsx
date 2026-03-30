import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import {
  BadgeCheck,
  Check,
  ClipboardCheck,
  ClipboardList,
  Crown,
  FileText,
  Flag,
  Gavel,
  Landmark,
  Loader2,
  PlusCircle,
  Scale,
  ScrollText,
  ShieldCheck,
  UserPlus,
  UserX,
  Users,
  Vote,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import PageHeader from '@/components/layout/PageHeader';
import GovernanceMigrationAlert from '@/components/parliament/GovernanceMigrationAlert';
import {
  canManageParliamentVoting,
  ensureParliamentOperatorMember,
  finalizeParliamentVotingIfReady,
  PARLIAMENT_MANDATE_DURATION_LABEL,
  PARLIAMENT_RULE_SECTIONS,
  startBillVotingSessionWithNews,
} from '@/lib/parliament';
import { publishBillProposedNews } from '@/lib/newsPublisher';
import {
  canManageParliamentGovernance,
  COMMISSION_STATUS_META,
  COMMISSION_TYPE_OPTIONS,
  DEFAULT_PARLIAMENT_HOUSE_ID,
  fetchCommissionGovernanceData,
  fetchLeadershipGovernanceData,
  getCommissionHouseSummary,
  getCommissionStatusMeta,
  getCommissionTypeLabel,
  getLeadershipElectionStatusMeta,
  getLeadershipPositionLabel,
  isGovernanceSchemaMissing,
  isInquiryCommission,
  refreshParliamentGovernanceState,
  resolveParliamentHouseIdFromRole,
} from '@/lib/parliamentGovernance';

const PARLIAMENT_RULE_ICON_MAP = {
  commissions: Vote,
  terms: Gavel,
  senate: ShieldCheck,
};

const COLORS = {
  Aprovar: '#22c55e',
  Rejeitar: '#ef4444',
  Abster: '#6b7280',
};

const resolveHouseDetails = (houseId, availableHouses = []) => {
  const matchedHouse = availableHouses.find((item) => item.id === houseId);
  const houseName = matchedHouse?.name || 'Casa Legislativa';
  const isSenate = houseName.toLowerCase().includes('senado');

  return {
    id: houseId,
    name: houseName,
    memberRole: isSenate ? 'Senador' : 'Deputado',
    presidentRole: isSenate ? 'Presidente do Senado' : 'Presidente da Câmara dos Deputados',
  };
};

const StatusBadge = ({ status }) => {
  const statusConfig = {
    Pendente: {
      label: 'Em análise',
      className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    },
    rejeitada: {
      label: 'Rejeitada',
      className: 'bg-red-500/20 text-red-400 border-red-500/30',
    },
    aceita: {
      label: 'Aceita',
      className: 'bg-green-500/20 text-green-400 border-green-500/30',
    },
    em_votacao: {
      label: 'Em votação',
      className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    },
  };

  const meta = statusConfig[status] || {
    label: status,
    className: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  );
};

const GovernanceMetricCard = ({ title, value, description, icon: Icon }) => (
  <Card className="glass-effect border-white/10">
    <CardContent className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground">{value}</p>
          {description ? <p className="mt-2 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </CardContent>
  </Card>
);

const GovernanceRulesGrid = () => (
  <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
    {PARLIAMENT_RULE_SECTIONS.map((section) => {
      const Icon = PARLIAMENT_RULE_ICON_MAP[section.id] || Scale;

      return (
        <Card key={section.id} className="glass-effect border-white/10 h-full">
          <CardHeader>
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
              Diretriz
            </div>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>{section.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {section.items.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/5 p-4">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-sm text-muted-foreground leading-relaxed">{item}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      );
    })}
  </div>
);

const VotingChart = ({ votes = [] }) => {
  const chartData = [
    { name: 'Aprovar', value: votes.filter((vote) => vote.vote === 'Aprovar').length },
    { name: 'Rejeitar', value: votes.filter((vote) => vote.vote === 'Rejeitar').length },
    { name: 'Abster', value: votes.filter((vote) => vote.vote === 'Abster').length },
  ].filter((entry) => entry.value > 0);

  if (!chartData.length) {
    return null;
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} label>
            {chartData.map((entry, index) => (
              <Cell key={`${entry.name}-${index}`} fill={COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

const ParliamentPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [accessData, setAccessData] = useState({ hasAccess: false, reason: 'Verificando permissões...' });
  const [parliamentMember, setParliamentMember] = useState(null);
  const [house, setHouse] = useState(null);
  const [availableHouses, setAvailableHouses] = useState([]);
  const [adminTargetHouseId, setAdminTargetHouseId] = useState(DEFAULT_PARLIAMENT_HOUSE_ID);
  const [bills, setBills] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [plebisciteRequests, setPlebisciteRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [votings, setVotings] = useState([]);
  const [commissions, setCommissions] = useState([]);
  const [leadershipTerms, setLeadershipTerms] = useState([]);
  const [leadershipElections, setLeadershipElections] = useState([]);
  const [governanceSchemaReady, setGovernanceSchemaReady] = useState(true);
  const [activeMainTab, setActiveMainTab] = useState('projects');
  const [activeSubTab, setActiveSubTab] = useState('citizen_suggestions');
  const [billStatusFilter, setBillStatusFilter] = useState('all');
  const [commissionTypeFilter, setCommissionTypeFilter] = useState('all');
  const [commissionStatusFilter, setCommissionStatusFilter] = useState('all');
  const [isProposeBillOpen, setIsProposeBillOpen] = useState(false);
  const [newBill, setNewBill] = useState({ title: '', summary: '', full_text: '', type: 'PL' });
  const [proposingBill, setProposingBill] = useState(false);
  const [votingOn, setVotingOn] = useState(null);
  const [commissionActionId, setCommissionActionId] = useState('');
  const [leadershipActionId, setLeadershipActionId] = useState('');
  const [isCommissionDialogOpen, setIsCommissionDialogOpen] = useState(false);
  const [commissionForm, setCommissionForm] = useState({
    title: '',
    summary: '',
    purpose: '',
    type: 'temporary',
  });
  const [managedCommission, setManagedCommission] = useState(null);
  const [commissionAssignment, setCommissionAssignment] = useState({
    memberId: '',
    role: 'member',
  });
  const [reportCommission, setReportCommission] = useState(null);
  const [commissionReport, setCommissionReport] = useState('');
  const [isLeadershipDialogOpen, setIsLeadershipDialogOpen] = useState(false);
  const [leadershipElectionForm, setLeadershipElectionForm] = useState({
    position: 'president',
    description: '',
    durationHours: '24',
  });
  const [nominationElection, setNominationElection] = useState(null);
  const [nominationForm, setNominationForm] = useState({
    memberId: '',
    manifesto: '',
  });

  const canStartVote = canManageParliamentVoting(user?.role);
  const canManageGovernance = canManageParliamentGovernance(user?.role);
  const canParticipateInGovernance = Boolean(parliamentMember) && !['Admin', 'Presidente'].includes(user?.role);

  const filteredBills = useMemo(
    () =>
      billStatusFilter === 'all'
        ? bills
        : bills.filter((bill) =>
            bill.status === billStatusFilter ||
            (billStatusFilter === 'Em votação' && bill.status?.startsWith('Em votação')) ||
            (billStatusFilter === 'Aguardando ato presidencial' &&
              ['Aguardando sanção presidencial', 'Aguardando promulgação presidencial'].includes(bill.status)) ||
            (billStatusFilter === 'Convertido em norma' && ['Sancionado', 'Promulgado'].includes(bill.status)) ||
            (billStatusFilter === 'Vetado' &&
              ['Vetado integralmente', 'Vetado parcialmente'].includes(bill.status))
          ),
    [billStatusFilter, bills]
  );

  const filteredCommissions = useMemo(() => {
    return commissions.filter((commission) => {
      const typeMatches = commissionTypeFilter === 'all' || commission.type === commissionTypeFilter;
      const statusMatches = commissionStatusFilter === 'all' || commission.status === commissionStatusFilter;
      return typeMatches && statusMatches;
    });
  }, [commissionStatusFilter, commissionTypeFilter, commissions]);

  const activeLeadershipTerms = useMemo(
    () => leadershipTerms.filter((term) => term.status === 'active'),
    [leadershipTerms]
  );

  const leadershipByPosition = useMemo(
    () =>
      activeLeadershipTerms.reduce((accumulator, term) => {
        accumulator[term.position] = term;
        return accumulator;
      }, {}),
    [activeLeadershipTerms]
  );

  const commissionSummary = useMemo(
    () => ({
      active: commissions.filter((commission) => commission.status === 'active').length,
      pending: commissions.filter((commission) =>
        ['collecting_support', 'pending_plenary', 'approved_pending_officialization'].includes(commission.status)
      ).length,
      inquiry: commissions.filter((commission) => isInquiryCommission(commission.type)).length,
    }),
    [commissions]
  );

  const resolveVotingTitles = useCallback(
    async (votingsData = []) => {
      const billIds = votingsData.filter((item) => item.type === 'bill').map((item) => item.related_id);
      const suggestionIds = votingsData.filter((item) => item.type === 'suggestion').map((item) => item.related_id);
      const commissionIds = votingsData.filter((item) => item.type === 'commission').map((item) => item.related_id);

      const [billMapResponse, suggestionMapResponse, commissionMapResponse] = await Promise.all([
        billIds.length
          ? supabase.from('bills').select('id, title').in('id', billIds)
          : Promise.resolve({ data: [], error: null }),
        suggestionIds.length
          ? supabase.from('bill_suggestions').select('id, title').in('id', suggestionIds)
          : Promise.resolve({ data: [], error: null }),
        commissionIds.length
          ? supabase.from('parliament_commissions').select('id, title').in('id', commissionIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (billMapResponse.error) {
        throw billMapResponse.error;
      }
      if (suggestionMapResponse.error) {
        throw suggestionMapResponse.error;
      }
      if (commissionMapResponse.error && !isGovernanceSchemaMissing(commissionMapResponse.error)) {
        throw commissionMapResponse.error;
      }

      const billMap = (billMapResponse.data || []).reduce((accumulator, row) => {
        accumulator[row.id] = row;
        return accumulator;
      }, {});
      const suggestionMap = (suggestionMapResponse.data || []).reduce((accumulator, row) => {
        accumulator[row.id] = row;
        return accumulator;
      }, {});
      const commissionMap = (commissionMapResponse.data || []).reduce((accumulator, row) => {
        accumulator[row.id] = row;
        return accumulator;
      }, {});

      return votingsData.map((voting) => ({
        ...voting,
        relatedItem:
          voting.type === 'bill'
            ? billMap[voting.related_id] || null
            : voting.type === 'suggestion'
              ? suggestionMap[voting.related_id] || null
              : voting.type === 'commission'
                ? commissionMap[voting.related_id] || null
                : null,
      }));
    },
    []
  );

  const fetchPanelData = useCallback(async () => {
    if (!user) {
      return;
    }

    setLoading(true);

    try {
      const { data: housesData, error: housesError } = await supabase
        .from('parliament_houses')
        .select('id, name, description')
        .order('name');

      if (housesError) {
        throw housesError;
      }

      const effectiveRoles = Array.isArray(user?.effective_roles)
        ? user.effective_roles
        : [user?.role].filter(Boolean);
      const effectiveHouseRole =
        effectiveRoles.find((role) => resolveParliamentHouseIdFromRole(role, housesData || [])) ||
        user.role;
      const isAdministrativeViewer =
        effectiveRoles.includes('Admin') || effectiveRoles.includes('Presidente');
      const resolvedHouseId = isAdministrativeViewer
        ? adminTargetHouseId
        : resolveParliamentHouseIdFromRole(effectiveHouseRole, housesData || []);

      if (!isAdministrativeViewer && !resolvedHouseId) {
        setAccessData({
          hasAccess: false,
          reason: 'Seu cargo atual não está vinculado a uma Casa legislativa ativa.',
        });
        setLoading(false);
        return;
      }

      setAvailableHouses(housesData || []);
      if (!isAdministrativeViewer) {
        setAdminTargetHouseId(resolvedHouseId);
      }

      const selectedHouseId = resolvedHouseId || adminTargetHouseId || DEFAULT_PARLIAMENT_HOUSE_ID;
      const currentHouse = resolveHouseDetails(selectedHouseId, housesData || []);
      const currentOperator = await ensureParliamentOperatorMember(supabase, {
        userId: user.id,
        houseId: selectedHouseId,
        member: null,
      });

      setAccessData({ hasAccess: true });
      setParliamentMember(currentOperator);
      setHouse(currentHouse);

      const governanceRefresh = await refreshParliamentGovernanceState(supabase).catch((error) => {
        if (isGovernanceSchemaMissing(error)) {
          return { schemaReady: false, error };
        }

        throw error;
      });

      const [
        billsResponse,
        suggestionsResponse,
        plebiscitesResponse,
        membersResponse,
        votingsResponse,
        commissionsResponse,
        leadershipResponse,
      ] = await Promise.all([
        supabase
          .from('bills')
          .select('id, title, summary, full_text, status, type, created_at, author_id, house_id, author:profiles(id, full_name, avatar_url, role)')
          .eq('house_id', selectedHouseId)
          .order('created_at', { ascending: false }),
        supabase
          .from('bill_suggestions')
          .select('id, title, suggestion, status, author_id, target_type, target_id, created_at, author:profiles(id, full_name, avatar_url, role)')
          .eq('target_type', 'house')
          .eq('target_id', selectedHouseId)
          .order('created_at', { ascending: false }),
        supabase
          .from('plebiscites')
          .select('id, title, description, status, author:profiles(id, full_name, avatar_url)')
          .eq('status', 'Pendente')
          .order('created_at', { ascending: false }),
        supabase
          .from('parliament_members')
          .select('id, user_id, house_id, term_start_date, term_end_date, profile:profiles(id, full_name, avatar_url, x_handle, role), party:political_parties(name, acronym, logo_url)')
          .eq('house_id', selectedHouseId)
          .order('term_start_date', { ascending: false }),
        supabase
          .from('parliament_votings')
          .select('id, house_id, title, description, type, related_id, status, created_at, end_date, votes:parliament_voting_votes(vote, member_id)')
          .eq('house_id', selectedHouseId)
          .eq('status', 'active'),
        fetchCommissionGovernanceData(supabase, { houseId: selectedHouseId }),
        fetchLeadershipGovernanceData(supabase, { houseId: selectedHouseId }),
      ]);

      if (billsResponse.error) {
        throw billsResponse.error;
      }
      if (suggestionsResponse.error) {
        throw suggestionsResponse.error;
      }
      if (plebiscitesResponse.error) {
        throw plebiscitesResponse.error;
      }
      if (membersResponse.error) {
        throw membersResponse.error;
      }
      if (votingsResponse.error) {
        throw votingsResponse.error;
      }

      const enrichedVotings = await resolveVotingTitles(votingsResponse.data || []);

      setBills(billsResponse.data || []);
      setSuggestions(suggestionsResponse.data || []);
      setPlebisciteRequests(plebiscitesResponse.data || []);
      setMembers(
        (membersResponse.data || []).map((member) => ({
          parliament_member_id: member.id,
          user_id: member.user_id,
          full_name: member.profile?.full_name,
          avatar_url: member.profile?.avatar_url,
          x_handle: member.profile?.x_handle,
          role: member.profile?.role,
          party: member.party || null,
          term_start_date: member.term_start_date,
          term_end_date: member.term_end_date,
        }))
      );
      setVotings(enrichedVotings);
      setCommissions(commissionsResponse.commissions || []);
      setLeadershipTerms(leadershipResponse.terms || []);
      setLeadershipElections(leadershipResponse.elections || []);
      setGovernanceSchemaReady(
        Boolean(governanceRefresh?.schemaReady) &&
          Boolean(commissionsResponse.schemaReady) &&
          Boolean(leadershipResponse.schemaReady)
      );
    } catch (error) {
      console.error('Erro ao carregar painel do parlamento:', error);
      setAccessData({
        hasAccess: false,
        reason: error.message || 'Não foi possível carregar o painel parlamentar.',
      });
      toast({
        title: 'Erro ao carregar dados',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [adminTargetHouseId, resolveVotingTitles, toast, user]);

  useEffect(() => {
    fetchPanelData();
  }, [fetchPanelData]);

  useEffect(() => {
    if (!managedCommission) {
      return;
    }

    const updatedCommission = commissions.find((commission) => commission.id === managedCommission.id);
    setManagedCommission(updatedCommission || null);
  }, [commissions, managedCommission]);

  useEffect(() => {
    if (!reportCommission) {
      return;
    }

    const updatedCommission = commissions.find((commission) => commission.id === reportCommission.id);
    setReportCommission(updatedCommission || null);
  }, [commissions, reportCommission]);

  useEffect(() => {
    if (!nominationElection) {
      return;
    }

    const updatedElection = leadershipElections.find((election) => election.id === nominationElection.id);
    setNominationElection(updatedElection || null);
  }, [leadershipElections, nominationElection]);

  const resetCommissionForm = () =>
    setCommissionForm({
      title: '',
      summary: '',
      purpose: '',
      type: 'temporary',
    });

  const handleProposeBill = async () => {
    if (!house) {
      return;
    }

    setProposingBill(true);
    try {
      const billData = {
        ...newBill,
        author_id: user.id,
        house_id: house.id,
        author_role: user.role,
        status: 'Em tramitação',
      };

      const { error } = await supabase.from('bills').insert(billData).select('*').single();
      if (error) {
        throw error;
      }

      try {
        await publishBillProposedNews(supabase, {
          bill: {
            ...billData,
            title: newBill.title,
            summary: newBill.summary,
            type: newBill.type,
          },
          authorName: user.full_name || user.email,
          houseName: house.name,
        });
      } catch (newsError) {
        console.error('Erro ao publicar notícia de projeto:', newsError);
      }

      toast({ title: 'Sucesso', description: 'Projeto proposto com sucesso.' });
      setIsProposeBillOpen(false);
      setNewBill({ title: '', summary: '', full_text: '', type: 'PL' });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao propor projeto',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setProposingBill(false);
    }
  };

  const handleSuggestionStatus = async (suggestionId, status) => {
    try {
      if (status === 'aceita') {
        const { error } = await supabase.rpc('handle_suggestion_acceptance', {
          p_suggestion_id: suggestionId,
          p_house_id: house.id,
        });
        if (error) {
          throw error;
        }
        toast({
          title: 'Sugestão aceita',
          description: 'A sugestão foi enviada para votação da Casa.',
        });
        setActiveMainTab('votes');
      } else {
        const { error } = await supabase
          .from('bill_suggestions')
          .update({ status })
          .eq('id', suggestionId);
        if (error) {
          throw error;
        }
        toast({
          title: 'Sugestão rejeitada',
          description: 'A sugestão foi arquivada na Casa legislativa.',
        });
      }

      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao processar sugestão',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handlePlebiscitesStatus = async (plebisciteId, action) => {
    const rpcName = action === 'approve' ? 'approve_plebiscite' : 'reject_plebiscite';
    const rpcArgs =
      action === 'approve'
        ? { p_plebiscite_id: plebisciteId, p_house_id: house.id }
        : { p_plebiscite_id: plebisciteId };

    const { data, error } = await supabase.rpc(rpcName, rpcArgs);
    if (error || (data && !data.success)) {
      toast({
        title: 'Erro',
        description: data?.message || error?.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'Sucesso', description: data.message });
    fetchPanelData();
  };

  const handleStartBillVoting = async (bill) => {
    try {
      await startBillVotingSessionWithNews(supabase, {
        billId: bill.id,
        houseId: house.id,
        title: bill.title,
        description: bill.summary || 'Sessão de votação legislativa.',
        bill,
      });

      toast({
        title: 'Sessão aberta',
        description: 'O projeto foi colocado em votação.',
      });
      setActiveMainTab('votes');
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao iniciar votação',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleParliamentVote = async (votingId, vote) => {
    if (!parliamentMember) {
      return;
    }

    setVotingOn(votingId);

    try {
      const selectedVoting = votings.find((item) => item.id === votingId);
      const { data, error } = await supabase.rpc('cast_parliament_vote', {
        p_voting_id: votingId,
        p_member_id: parliamentMember.id,
        p_vote: vote,
      });

      if (error || (data && !data.success)) {
        toast({
          title: 'Erro ao votar',
          description: data?.message || error?.message,
          variant: 'destructive',
        });
      } else {
        const finalization = selectedVoting
          ? await finalizeParliamentVotingIfReady(supabase, { voting: selectedVoting })
          : { finalized: false };

        toast({
          title: 'Voto computado',
          description: finalization.finalized ? finalization.message : data.message,
        });

        fetchPanelData();
      }
    } catch (error) {
      toast({
        title: 'Erro ao registrar voto',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setVotingOn(null);
    }
  };

  const handleCreateCommission = async () => {
    setCommissionActionId('create');
    try {
      const houseIds =
        commissionForm.type === 'cpmi'
          ? (availableHouses || []).map((item) => item.id)
          : [house.id];

      const { data, error } = await supabase.rpc('create_parliament_commission', {
        p_title: commissionForm.title,
        p_summary: commissionForm.summary,
        p_purpose: commissionForm.purpose,
        p_type: commissionForm.type,
        p_house_ids: houseIds,
      });

      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'Não foi possível criar a comissão.');
      }

      toast({
        title: 'Comissão registrada',
        description: data.message,
      });
      setIsCommissionDialogOpen(false);
      resetCommissionForm();
      setActiveMainTab('commissions');
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao criar comissão',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCommissionActionId('');
    }
  };

  const runCommissionRpc = async (rpcName, args, successTitle, successDescription) => {
    setCommissionActionId(`${rpcName}:${args?.p_commission_id || ''}`);

    try {
      const { data, error } = await supabase.rpc(rpcName, args);
      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'A operação não pôde ser concluída.');
      }

      toast({
        title: successTitle,
        description: successDescription || data.message,
      });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCommissionActionId('');
    }
  };

  const handleAssignCommissionMember = async () => {
    if (!managedCommission || !commissionAssignment.memberId) {
      return;
    }

    await runCommissionRpc(
      'assign_parliament_commission_member',
      {
        p_commission_id: managedCommission.id,
        p_member_id: commissionAssignment.memberId,
        p_role: commissionAssignment.role,
      },
      'Composição atualizada',
      'O parlamentar foi atribuído à comissão.'
    );

    setCommissionAssignment({ memberId: '', role: 'member' });
  };

  const handleSubmitCommissionReport = async () => {
    if (!reportCommission) {
      return;
    }

    await runCommissionRpc(
      'submit_parliament_commission_report',
      {
        p_commission_id: reportCommission.id,
        p_report: commissionReport,
      },
      'Relatório protocolado'
    );

    setReportCommission(null);
    setCommissionReport('');
  };

  const handleCreateLeadershipElection = async () => {
    setLeadershipActionId('create-election');
    try {
      const { data, error } = await supabase.rpc('create_leadership_election', {
        p_house_id: house.id,
        p_position: leadershipElectionForm.position,
        p_description: leadershipElectionForm.description,
        p_duration_hours: Number(leadershipElectionForm.durationHours || 24),
      });

      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'Não foi possível abrir a eleição.');
      }

      toast({
        title: 'Eleição interna aberta',
        description: data.message,
      });
      setIsLeadershipDialogOpen(false);
      setLeadershipElectionForm({
        position: 'president',
        description: '',
        durationHours: '24',
      });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao abrir eleição',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLeadershipActionId('');
    }
  };

  const handleNominateCandidate = async () => {
    if (!nominationElection || !nominationForm.memberId) {
      return;
    }

    setLeadershipActionId(`nominate:${nominationElection.id}`);
    try {
      const { data, error } = await supabase.rpc('nominate_leadership_candidate', {
        p_election_id: nominationElection.id,
        p_member_id: nominationForm.memberId,
        p_manifesto: nominationForm.manifesto,
      });

      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'Não foi possível registrar a candidatura.');
      }

      toast({
        title: 'Candidatura registrada',
        description: data.message,
      });
      setNominationElection(null);
      setNominationForm({ memberId: '', manifesto: '' });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao registrar candidatura',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLeadershipActionId('');
    }
  };

  const handleCastLeadershipVote = async (electionId, candidateId) => {
    setLeadershipActionId(`vote:${electionId}:${candidateId}`);

    try {
      const { data, error } = await supabase.rpc('cast_leadership_vote', {
        p_election_id: electionId,
        p_candidate_id: candidateId,
      });

      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'Não foi possível registrar o voto.');
      }

      toast({
        title: 'Voto registrado',
        description: data.message,
      });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao votar',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLeadershipActionId('');
    }
  };

  const handleCloseLeadershipElection = async (electionId) => {
    setLeadershipActionId(`close:${electionId}`);

    try {
      const { data, error } = await supabase.rpc('close_leadership_election', {
        p_election_id: electionId,
      });

      if (error || (data && !data.success)) {
        throw error || new Error(data?.message || 'Não foi possível encerrar a eleição.');
      }

      toast({
        title: 'Eleição encerrada',
        description: data.message,
      });
      fetchPanelData();
    } catch (error) {
      toast({
        title: 'Erro ao encerrar eleição',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLeadershipActionId('');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (!accessData.hasAccess) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <Alert variant="destructive">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Acesso negado</AlertTitle>
          <AlertDescription>{accessData.reason}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Painel do Parlamento - GOV.RP</title>
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={Scale}
          title="Painel do"
          gradientText="Parlamento"
          description={`Atue na ${house?.name || 'Casa Legislativa'} com projetos, votações, comissões e mesa diretora.`}
          iconColor="text-yellow-400"
          centered={true}
        />

        <GovernanceRulesGrid />

        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          <GovernanceMetricCard
            title="Comissões Ativas"
            value={commissionSummary.active}
            description="Estruturas em funcionamento nesta Casa."
            icon={ClipboardList}
          />
          <GovernanceMetricCard
            title="Fluxos Pendentes"
            value={commissionSummary.pending}
            description="Requerimentos, votações e oficializações em aberto."
            icon={ScrollText}
          />
          <GovernanceMetricCard
            title="Comissões de Inquérito"
            value={commissionSummary.inquiry}
            description="CPIs e CPMIs acompanhadas pelo painel."
            icon={ShieldCheck}
          />
        </div>

        {(user?.role === 'Admin' || user?.role === 'Presidente') && (
          <div className="mb-6">
            <Label>Operando como gestor na Casa:</Label>
            <Select value={adminTargetHouseId} onValueChange={setAdminTargetHouseId}>
              <SelectTrigger className="mt-2 w-full md:w-[320px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableHouses.map((houseItem) => (
                  <SelectItem key={houseItem.id} value={houseItem.id}>
                    {houseItem.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 gap-2 md:grid-cols-6">
            <TabsTrigger value="projects">Projetos</TabsTrigger>
            <TabsTrigger value="votes">Votações</TabsTrigger>
            <TabsTrigger value="commissions">Comissões</TabsTrigger>
            <TabsTrigger value="leadership">Mesa Diretora</TabsTrigger>
            <TabsTrigger value="plebiscites">Plebiscitos</TabsTrigger>
            <TabsTrigger value="members">Membros</TabsTrigger>
          </TabsList>

          <motion.div
            key={house?.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="mt-6"
          >
            <TabsContent value="projects" className="space-y-6">
              <Tabs value={activeSubTab} onValueChange={setActiveSubTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="member_projects">Projetos dos Membros</TabsTrigger>
                  <TabsTrigger value="citizen_suggestions">Sugestões Populares</TabsTrigger>
                </TabsList>

                <TabsContent value="member_projects" className="mt-4">
                  <Card className="glass-effect">
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
                      <div>
                        <CardTitle>Projetos dos Membros ({house?.name})</CardTitle>
                        <CardDescription>
                          Projetos propostos por {house?.name?.toLowerCase().includes('senado') ? 'Senadores' : 'Deputados'} desta Casa.
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={billStatusFilter} onValueChange={setBillStatusFilter}>
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Filtrar status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos</SelectItem>
                            <SelectItem value="Em tramitação">Em tramitação</SelectItem>
                            <SelectItem value="Em votação">Em votação</SelectItem>
                            <SelectItem value="Aprovado">Aprovados</SelectItem>
                            <SelectItem value="Aguardando ato presidencial">Aguardando ato presidencial</SelectItem>
                            <SelectItem value="Convertido em norma">Convertidos em norma</SelectItem>
                            <SelectItem value="Vetado">Vetados</SelectItem>
                            <SelectItem value="Rejeitado">Rejeitados</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button onClick={() => setIsProposeBillOpen(true)}>
                          <PlusCircle className="mr-2 h-4 w-4" />
                          Propor Projeto
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {filteredBills.length ? (
                        filteredBills.map((bill) => {
                          const billStatusMeta = {
                            'Em tramitação': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
                            'Em votação': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
                            'Em votação (2ª Casa)': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
                            Aprovado: 'bg-green-500/20 text-green-300 border-green-500/30',
                            'Aguardando sanção presidencial': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
                            'Aguardando promulgação presidencial': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
                            Sancionado: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
                            Promulgado: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
                            'Vetado integralmente': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
                            'Vetado parcialmente': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
                            Rejeitado: 'bg-red-500/20 text-red-300 border-red-500/30',
                          };

                          return (
                            <Card key={bill.id} className="bg-background/50">
                              <CardHeader>
                                <div className="flex items-start gap-3">
                                  <Avatar className="h-11 w-11">
                                    <AvatarImage src={bill.author?.avatar_url} alt={bill.author?.full_name} />
                                    <AvatarFallback>{bill.author?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                                  </Avatar>
                                  <div className="flex-1">
                                    <CardTitle>
                                      {bill.title}{' '}
                                      <span className="text-sm font-normal text-muted-foreground">({bill.type})</span>
                                    </CardTitle>
                                    <CardDescription>Autor: {bill.author?.full_name || 'Desconhecido'}</CardDescription>
                                  </div>
                                  <Badge variant="outline" className={billStatusMeta[bill.status] || ''}>
                                    {bill.status}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent>
                                <p className="text-sm text-muted-foreground">{bill.summary}</p>
                              </CardContent>
                              {canStartVote && bill.status === 'Em tramitação' ? (
                                <CardFooter>
                                  <Button size="sm" onClick={() => handleStartBillVoting(bill)}>
                                    <Gavel className="mr-2 h-4 w-4" />
                                    Colocar em votação
                                  </Button>
                                </CardFooter>
                              ) : null}
                            </Card>
                          );
                        })
                      ) : (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          Nenhum projeto encontrado para o filtro selecionado.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="citizen_suggestions" className="mt-4">
                  <Card className="glass-effect">
                    <CardHeader>
                      <CardTitle>Sugestões Populares</CardTitle>
                      <CardDescription>
                        Sugestões enviadas por cidadãos para apreciação desta Casa legislativa.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {suggestions.length ? (
                        suggestions.map((suggestion) => (
                          <Card key={suggestion.id} className="bg-background/50">
                            <CardHeader>
                              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <CardTitle>{suggestion.title}</CardTitle>
                                  <div className="mt-2 flex items-center gap-2">
                                    <Avatar className="h-6 w-6">
                                      <AvatarImage src={suggestion.author?.avatar_url} />
                                      <AvatarFallback>{suggestion.author?.full_name?.charAt(0) || 'C'}</AvatarFallback>
                                    </Avatar>
                                    <CardDescription>
                                      Enviado por {suggestion.author?.full_name || 'Cidadão'}
                                    </CardDescription>
                                  </div>
                                </div>
                                <StatusBadge status={suggestion.status} />
                              </div>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground">{suggestion.suggestion}</p>
                            </CardContent>
                            {suggestion.status === 'Pendente' && canStartVote ? (
                              <CardFooter className="gap-2">
                                <Button size="sm" onClick={() => handleSuggestionStatus(suggestion.id, 'aceita')}>
                                  <Check className="mr-2 h-4 w-4" />
                                  Aceitar e votar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => handleSuggestionStatus(suggestion.id, 'rejeitada')}
                                >
                                  <X className="mr-2 h-4 w-4" />
                                  Rejeitar
                                </Button>
                              </CardFooter>
                            ) : null}
                          </Card>
                        ))
                      ) : (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          Nenhuma sugestão popular recebida nesta Casa.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="votes">
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle>Sessões de Votação</CardTitle>
                  <CardDescription>
                    Vote em projetos, sugestões e deliberações de comissão em tramitação na Casa.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {votings.length ? (
                    <div className="space-y-4">
                      {votings.map((voting) => {
                        const userHasVoted = (voting.votes || []).some((entry) => entry.member_id === parliamentMember?.id);
                        const votingLabel =
                          voting.type === 'commission'
                            ? 'Comissão Temporária'
                            : voting.type === 'suggestion'
                              ? 'Sugestão Popular'
                              : 'Projeto Legislativo';

                        return (
                          <Card key={voting.id} className="bg-background/50">
                            <CardHeader>
                              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div>
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                                      {votingLabel}
                                    </Badge>
                                  </div>
                                  <CardTitle>{voting.title || voting.relatedItem?.title || 'Votação em aberto'}</CardTitle>
                                  <CardDescription>{voting.description}</CardDescription>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent>
                              <VotingChart votes={voting.votes || []} />
                            </CardContent>
                            <CardFooter className="flex flex-wrap gap-2">
                              {votingOn === voting.id ? (
                                <Loader2 className="animate-spin" />
                              ) : userHasVoted ? (
                                <p className="text-sm text-muted-foreground">Seu voto já foi computado nesta sessão.</p>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                                    onClick={() => handleParliamentVote(voting.id, 'Aprovar')}
                                  >
                                    <Check className="mr-2 h-4 w-4" />
                                    Aprovar
                                  </Button>
                                  <Button size="sm" variant="destructive" onClick={() => handleParliamentVote(voting.id, 'Rejeitar')}>
                                    <X className="mr-2 h-4 w-4" />
                                    Rejeitar
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => handleParliamentVote(voting.id, 'Abster')}>
                                    <UserX className="mr-2 h-4 w-4" />
                                    Abster
                                  </Button>
                                </>
                              )}
                            </CardFooter>
                          </Card>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <Vote className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 text-lg font-semibold">Nenhuma votação em andamento</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Novas sessões aparecerão aqui assim que forem abertas na Casa.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="commissions" className="space-y-6">
              {!governanceSchemaReady ? <GovernanceMigrationAlert compact /> : null}

              <Card className="glass-effect border-white/10">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle>Comissões Parlamentares</CardTitle>
                    <CardDescription>
                      Gerencie comissões permanentes, temporárias, CPIs e CPMIs dentro das regras da Casa.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={commissionTypeFilter} onValueChange={setCommissionTypeFilter}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        {COMMISSION_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={commissionStatusFilter} onValueChange={setCommissionStatusFilter}>
                      <SelectTrigger className="w-[210px]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        {Object.entries(COMMISSION_STATUS_META).map(([value, meta]) => (
                          <SelectItem key={value} value={value}>
                            {meta.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={() => setIsCommissionDialogOpen(true)} disabled={!governanceSchemaReady}>
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Nova Comissão
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {filteredCommissions.length ? (
                    filteredCommissions.map((commission) => {
                      const statusMeta = getCommissionStatusMeta(commission.status);
                      const hasReporter = Boolean(commission.reporter);
                      const currentUserHasSupported = (commission.supports || []).some(
                        (support) => support.member?.id === parliamentMember?.id
                      );

                      return (
                        <Card key={commission.id} className="border-white/10 bg-background/50">
                          <CardHeader>
                            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                              <div>
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
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Requerente</p>
                                <p className="mt-2 text-sm font-medium text-foreground">
                                  {commission.requester?.full_name || 'Parlamentar'}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
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
                                      <span className="font-medium text-foreground">{item.required}</span> necessários
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
                                  {hasReporter ? commission.reporter?.profile?.full_name : 'Relator não designado'}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Relatório Final</p>
                                <p className="mt-2 text-sm text-foreground">
                                  {commission.final_report ? 'Protocolado' : 'Pendente'}
                                </p>
                              </div>
                            </div>

                            {commission.members.length ? (
                              <div className="flex flex-wrap gap-2">
                                {commission.members.slice(0, 6).map((item) => (
                                  <div
                                    key={`${commission.id}-${item.member_id}`}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-foreground"
                                  >
                                    <Avatar className="h-6 w-6">
                                      <AvatarImage src={item.member?.profile?.avatar_url} />
                                      <AvatarFallback>{item.member?.profile?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                                    </Avatar>
                                    <span>{item.member?.profile?.full_name || 'Parlamentar'}</span>
                                    <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                      {item.role}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}

                            {commission.final_report ? (
                              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Relatório final</p>
                                <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-emerald-50/90">
                                  {commission.final_report}
                                </p>
                              </div>
                            ) : null}
                          </CardContent>
                          <CardFooter className="flex flex-wrap gap-2">
                            {canParticipateInGovernance &&
                            isInquiryCommission(commission.type) &&
                            commission.status === 'collecting_support' &&
                            !currentUserHasSupported ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  runCommissionRpc(
                                    'sign_parliament_commission',
                                    { p_commission_id: commission.id },
                                    'Apoio registrado'
                                  )
                                }
                                disabled={commissionActionId === `sign_parliament_commission:${commission.id}`}
                              >
                                <ClipboardCheck className="mr-2 h-4 w-4" />
                                Apoiar requerimento
                              </Button>
                            ) : null}

                            {canManageGovernance &&
                            commission.type === 'temporary' &&
                            commission.status === 'pending_plenary' ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  runCommissionRpc(
                                    'open_temporary_commission_voting',
                                    { p_commission_id: commission.id },
                                    'Votação aberta'
                                  )
                                }
                                disabled={commissionActionId === `open_temporary_commission_voting:${commission.id}`}
                              >
                                <Vote className="mr-2 h-4 w-4" />
                                Abrir votação
                              </Button>
                            ) : null}

                            {canManageGovernance &&
                            commission.type === 'temporary' &&
                            commission.status === 'approved_pending_officialization' ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  runCommissionRpc(
                                    'officialize_parliament_commission',
                                    { p_commission_id: commission.id, p_reporter_member_id: null },
                                    'Comissão oficializada'
                                  )
                                }
                                disabled={commissionActionId === `officialize_parliament_commission:${commission.id}`}
                              >
                                <Flag className="mr-2 h-4 w-4" />
                                Oficializar
                              </Button>
                            ) : null}

                            {canManageGovernance && commission.status === 'active' ? (
                              <Button size="sm" variant="secondary" onClick={() => setManagedCommission(commission)}>
                                <UserPlus className="mr-2 h-4 w-4" />
                                Gerir membros
                              </Button>
                            ) : null}

                            {(canManageGovernance ||
                              (commission.reporter?.id && commission.reporter.id === parliamentMember?.id)) &&
                            commission.status === 'active' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setReportCommission(commission);
                                  setCommissionReport(commission.final_report || '');
                                }}
                              >
                                <FileText className="mr-2 h-4 w-4" />
                                {commission.final_report ? 'Atualizar relatório' : 'Protocolar relatório'}
                              </Button>
                            ) : null}

                            {canManageGovernance && commission.status === 'active' ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  runCommissionRpc(
                                    'close_parliament_commission',
                                    { p_commission_id: commission.id },
                                    'Comissão encerrada'
                                  )
                                }
                                disabled={commissionActionId === `close_parliament_commission:${commission.id}`}
                              >
                                <BadgeCheck className="mr-2 h-4 w-4" />
                                Encerrar comissão
                              </Button>
                            ) : null}
                          </CardFooter>
                        </Card>
                      );
                    })
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhuma comissão encontrada para o filtro atual.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="leadership" className="space-y-6">
              {!governanceSchemaReady ? <GovernanceMigrationAlert compact /> : null}

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {['president', 'vice_president'].map((position) => {
                  const activeTerm = leadershipByPosition[position];
                  const houseName = house?.name || 'Casa Legislativa';
                  const label = getLeadershipPositionLabel(houseName, position);

                  return (
                    <Card key={position} className="glass-effect border-white/10">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <CardTitle>{label}</CardTitle>
                            <CardDescription>
                              Mandato institucional com duração de {PARLIAMENT_MANDATE_DURATION_LABEL}.
                            </CardDescription>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                            {position === 'president' ? <Crown className="h-5 w-5 text-yellow-400" /> : <Landmark className="h-5 w-5 text-sky-400" />}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {activeTerm ? (
                          <div className="flex items-center gap-4">
                            <Avatar className="h-16 w-16">
                              <AvatarImage src={activeTerm.member?.profile?.avatar_url} />
                              <AvatarFallback>{activeTerm.member?.profile?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="text-lg font-semibold text-foreground">
                                {activeTerm.member?.profile?.full_name || 'Parlamentar'}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Mandato até {new Date(`${activeTerm.term_end_date}T00:00:00`).toLocaleDateString('pt-BR')}
                              </p>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Nenhum mandato ativo registrado para esta posição no momento.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Card className="glass-effect border-white/10">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
                  <div>
                    <CardTitle>Eleições Internas</CardTitle>
                    <CardDescription>
                      Abra eleições, registre candidaturas e apure a composição da mesa diretora.
                    </CardDescription>
                  </div>
                  <Button onClick={() => setIsLeadershipDialogOpen(true)} disabled={!governanceSchemaReady || !canManageGovernance}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Abrir eleição
                  </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                  {leadershipElections.length ? (
                    leadershipElections.map((election) => {
                      const statusMeta = getLeadershipElectionStatusMeta(election.status);
                      const userVote = (election.votes || []).find((vote) => vote.voter_member_id === parliamentMember?.id);

                      return (
                        <Card key={election.id} className="border-white/10 bg-background/50">
                          <CardHeader>
                            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                              <div>
                                <div className="mb-3 flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className={statusMeta.className}>
                                    {statusMeta.label}
                                  </Badge>
                                  <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
                                    {getLeadershipPositionLabel(election.house?.name || house?.name, election.position)}
                                  </Badge>
                                </div>
                                <CardTitle>{election.title}</CardTitle>
                                <CardDescription>{election.description || 'Eleição interna em andamento.'}</CardDescription>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Prazo</p>
                                <p className="mt-2 text-sm font-medium text-foreground">
                                  {new Date(election.end_at).toLocaleString('pt-BR')}
                                </p>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {election.candidates.length ? (
                              <div className="grid gap-4 md:grid-cols-2">
                                {election.candidates.map((candidate) => (
                                  <div key={candidate.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                    <div className="flex items-start gap-3">
                                      <Avatar className="h-10 w-10">
                                        <AvatarImage src={candidate.member?.profile?.avatar_url} />
                                        <AvatarFallback>{candidate.member?.profile?.full_name?.charAt(0) || 'C'}</AvatarFallback>
                                      </Avatar>
                                      <div className="flex-1">
                                        <p className="font-medium text-foreground">
                                          {candidate.member?.profile?.full_name || 'Parlamentar'}
                                        </p>
                                        <p className="text-sm text-muted-foreground">{candidate.votes} voto(s)</p>
                                      </div>
                                    </div>
                                    {candidate.manifesto ? (
                                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                        {candidate.manifesto}
                                      </p>
                                    ) : null}
                                    {election.status === 'open' && canParticipateInGovernance && !userVote ? (
                                      <Button
                                        size="sm"
                                        className="mt-4 w-full"
                                        onClick={() => handleCastLeadershipVote(election.id, candidate.id)}
                                        disabled={leadershipActionId === `vote:${election.id}:${candidate.id}`}
                                      >
                                        <Vote className="mr-2 h-4 w-4" />
                                        Votar neste candidato
                                      </Button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                Nenhuma candidatura registrada até o momento.
                              </p>
                            )}

                            {election.status !== 'open' && election.winner ? (
                              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                                <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Resultado</p>
                                <p className="mt-2 text-sm text-emerald-50">
                                  Eleito: {election.winner?.profile?.full_name || 'Parlamentar'}
                                </p>
                              </div>
                            ) : null}
                          </CardContent>
                          <CardFooter className="flex flex-wrap gap-2">
                            {election.status === 'open' && canParticipateInGovernance ? (
                              <Button size="sm" variant="secondary" onClick={() => setNominationElection(election)}>
                                <UserPlus className="mr-2 h-4 w-4" />
                                Registrar candidatura
                              </Button>
                            ) : null}

                            {election.status === 'open' && userVote ? (
                              <p className="text-sm text-muted-foreground">Seu voto já foi registrado nesta eleição.</p>
                            ) : null}

                            {election.status === 'open' && canManageGovernance ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCloseLeadershipElection(election.id)}
                                disabled={leadershipActionId === `close:${election.id}`}
                              >
                                <Crown className="mr-2 h-4 w-4" />
                                Encerrar eleição
                              </Button>
                            ) : null}
                          </CardFooter>
                        </Card>
                      );
                    })
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhuma eleição interna registrada para esta Casa no momento.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="plebiscites">
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle>Solicitações de Plebiscito</CardTitle>
                  <CardDescription>
                    Analise e delibere sobre pedidos de consulta popular encaminhados à Casa.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {plebisciteRequests.length ? (
                    plebisciteRequests.map((request) => (
                      <Card key={request.id} className="bg-background/50">
                        <CardHeader>
                          <CardTitle>{request.title}</CardTitle>
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={request.author?.avatar_url} />
                              <AvatarFallback>{request.author?.full_name?.charAt(0) || 'C'}</AvatarFallback>
                            </Avatar>
                            <CardDescription>Sugerido por {request.author?.full_name || 'Cidadão'}</CardDescription>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{request.description}</p>
                        </CardContent>
                        <CardFooter className="gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            onClick={() => handlePlebiscitesStatus(request.id, 'approve')}
                          >
                            <Check className="mr-2 h-4 w-4" />
                            Aprovar
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handlePlebiscitesStatus(request.id, 'reject')}>
                            <X className="mr-2 h-4 w-4" />
                            Rejeitar
                          </Button>
                        </CardFooter>
                      </Card>
                    ))
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Nenhuma solicitação de plebiscito pendente.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="members">
              <Card className="glass-effect">
                <CardHeader>
                  <CardTitle>
                    Membros {house?.name?.toLowerCase().includes('senado') ? 'do Senado' : `da ${house?.name}`}
                  </CardTitle>
                  <CardDescription>
                    Mandatos parlamentares com duração constitucional de {PARLIAMENT_MANDATE_DURATION_LABEL}.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {members.length ? (
                    members.map((member) => (
                      <Card key={member.parliament_member_id} className="bg-background/30 p-4 text-center">
                        <Avatar className="mx-auto mb-4 h-20 w-20">
                          <AvatarImage src={member.avatar_url} />
                          <AvatarFallback>{member.full_name?.charAt(0) || 'P'}</AvatarFallback>
                        </Avatar>
                        <CardTitle className="text-lg">{member.full_name}</CardTitle>
                        {member.x_handle ? (
                          <Link to={`/services/x/profile/${member.x_handle}`} className="text-sm text-primary hover:underline">
                            @{member.x_handle}
                          </Link>
                        ) : (
                          <CardDescription>{member.role || 'Parlamentar'}</CardDescription>
                        )}
                        {member.party ? (
                          <Badge variant="secondary" className="mt-3 inline-flex items-center gap-2">
                            <Avatar className="h-4 w-4">
                              <AvatarImage src={member.party.logo_url} />
                              <AvatarFallback>{member.party.acronym?.charAt(0) || 'P'}</AvatarFallback>
                            </Avatar>
                            {member.party.acronym || member.party.name}
                          </Badge>
                        ) : null}
                        <p className="mt-3 text-xs text-muted-foreground">
                          Encerramento registrado em{' '}
                          {member.term_end_date
                            ? new Date(`${member.term_end_date}T00:00:00`).toLocaleDateString('pt-BR')
                            : 'data não informada'}
                        </p>
                      </Card>
                    ))
                  ) : (
                    <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                      Nenhum parlamentar encontrado nesta Casa.
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </motion.div>
        </Tabs>
      </div>

      <Dialog open={isProposeBillOpen} onOpenChange={setIsProposeBillOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Propor Novo Projeto</DialogTitle>
            <DialogDescription>Preencha os detalhes do seu projeto legislativo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="bill-type">Tipo de Projeto</Label>
              <Select value={newBill.type} onValueChange={(value) => setNewBill((current) => ({ ...current, type: value }))}>
                <SelectTrigger id="bill-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PL">Projeto de Lei (PL)</SelectItem>
                  <SelectItem value="PEC">Proposta de Emenda à Constituição (PEC)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="bill-title">Título</Label>
              <Input
                id="bill-title"
                value={newBill.title}
                onChange={(event) => setNewBill((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="bill-summary">Resumo</Label>
              <Textarea
                id="bill-summary"
                value={newBill.summary}
                onChange={(event) => setNewBill((current) => ({ ...current, summary: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="bill-content">Texto Completo</Label>
              <Textarea
                id="bill-content"
                rows={10}
                value={newBill.full_text}
                onChange={(event) => setNewBill((current) => ({ ...current, full_text: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProposeBillOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleProposeBill} disabled={proposingBill}>
              {proposingBill ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Propor Projeto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCommissionDialogOpen} onOpenChange={setIsCommissionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Comissão</DialogTitle>
            <DialogDescription>
              Estruture uma comissão permanente, temporária, CPI ou CPMI dentro do rito institucional da Casa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="commission-type">Tipo</Label>
              <Select
                value={commissionForm.type}
                onValueChange={(value) => setCommissionForm((current) => ({ ...current, type: value }))}
              >
                <SelectTrigger id="commission-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMISSION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                {COMMISSION_TYPE_OPTIONS.find((option) => option.value === commissionForm.type)?.description}
              </p>
            </div>
            <div>
              <Label htmlFor="commission-title">Título</Label>
              <Input
                id="commission-title"
                value={commissionForm.title}
                onChange={(event) => setCommissionForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="commission-summary">Resumo</Label>
              <Textarea
                id="commission-summary"
                value={commissionForm.summary}
                onChange={(event) => setCommissionForm((current) => ({ ...current, summary: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="commission-purpose">Objetivo Institucional</Label>
              <Textarea
                id="commission-purpose"
                value={commissionForm.purpose}
                onChange={(event) => setCommissionForm((current) => ({ ...current, purpose: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCommissionDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateCommission} disabled={commissionActionId === 'create'}>
              {commissionActionId === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar Comissão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(managedCommission)} onOpenChange={(open) => !open && setManagedCommission(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Composição da Comissão</DialogTitle>
            <DialogDescription>{managedCommission?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="grid gap-4 md:grid-cols-[1fr,180px,auto]">
              <div>
                <Label htmlFor="commission-member">Parlamentar</Label>
                <Select
                  value={commissionAssignment.memberId}
                  onValueChange={(value) => setCommissionAssignment((current) => ({ ...current, memberId: value }))}
                >
                  <SelectTrigger id="commission-member">
                    <SelectValue placeholder="Selecione um parlamentar" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.parliament_member_id} value={member.parliament_member_id}>
                        {member.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="commission-member-role">Função</Label>
                <Select
                  value={commissionAssignment.role}
                  onValueChange={(value) => setCommissionAssignment((current) => ({ ...current, role: value }))}
                >
                  <SelectTrigger id="commission-member-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Membro</SelectItem>
                    <SelectItem value="chair">Presidência</SelectItem>
                    <SelectItem value="vice_chair">Vice-Presidência</SelectItem>
                    <SelectItem value="secretary">Secretaria</SelectItem>
                    <SelectItem value="reporter">Relatoria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={handleAssignCommissionMember} disabled={!commissionAssignment.memberId}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Atribuir
                </Button>
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              {managedCommission?.members?.length ? (
                managedCommission.members.map((item) => (
                  <div
                    key={`${managedCommission.id}-${item.member_id}`}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={item.member?.profile?.avatar_url} />
                        <AvatarFallback>{item.member?.profile?.full_name?.charAt(0) || 'P'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-foreground">{item.member?.profile?.full_name || 'Parlamentar'}</p>
                        <p className="text-sm text-muted-foreground">{item.role}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        runCommissionRpc(
                          'remove_parliament_commission_member',
                          {
                            p_commission_id: managedCommission.id,
                            p_member_id: item.member_id,
                          },
                          'Composição atualizada',
                          'O membro foi removido da comissão.'
                        )
                      }
                    >
                      <UserX className="mr-2 h-4 w-4" />
                      Remover
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum integrante atribuído até o momento.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reportCommission)} onOpenChange={(open) => !open && setReportCommission(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Relatório Final</DialogTitle>
            <DialogDescription>{reportCommission?.title}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="commission-report">Conteúdo do Relatório</Label>
            <Textarea
              id="commission-report"
              rows={12}
              value={commissionReport}
              onChange={(event) => setCommissionReport(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportCommission(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmitCommissionReport}>
              <FileText className="mr-2 h-4 w-4" />
              Protocolar Relatório
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isLeadershipDialogOpen} onOpenChange={setIsLeadershipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abrir Eleição Interna</DialogTitle>
            <DialogDescription>
              Registre uma nova disputa para compor a mesa diretora da Casa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="leadership-position">Cargo em disputa</Label>
              <Select
                value={leadershipElectionForm.position}
                onValueChange={(value) => setLeadershipElectionForm((current) => ({ ...current, position: value }))}
              >
                <SelectTrigger id="leadership-position">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="president">Presidente da Casa</SelectItem>
                  <SelectItem value="vice_president">Vice-Presidente da Casa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="leadership-description">Descrição</Label>
              <Textarea
                id="leadership-description"
                value={leadershipElectionForm.description}
                onChange={(event) => setLeadershipElectionForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="leadership-duration">Duração em horas</Label>
              <Input
                id="leadership-duration"
                type="number"
                min="1"
                value={leadershipElectionForm.durationHours}
                onChange={(event) => setLeadershipElectionForm((current) => ({ ...current, durationHours: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLeadershipDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateLeadershipElection} disabled={leadershipActionId === 'create-election'}>
              {leadershipActionId === 'create-election' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Abrir Eleição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(nominationElection)} onOpenChange={(open) => !open && setNominationElection(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Candidatura</DialogTitle>
            <DialogDescription>{nominationElection?.title}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="candidate-member">Parlamentar</Label>
              <Select
                value={nominationForm.memberId}
                onValueChange={(value) => setNominationForm((current) => ({ ...current, memberId: value }))}
              >
                <SelectTrigger id="candidate-member">
                  <SelectValue placeholder="Selecione o candidato" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.parliament_member_id} value={member.parliament_member_id}>
                      {member.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="candidate-manifesto">Manifesto</Label>
              <Textarea
                id="candidate-manifesto"
                rows={8}
                value={nominationForm.manifesto}
                onChange={(event) => setNominationForm((current) => ({ ...current, manifesto: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNominationElection(null)}>
              Cancelar
            </Button>
            <Button onClick={handleNominateCandidate} disabled={leadershipActionId.startsWith('nominate')}>
              {leadershipActionId.startsWith('nominate') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar Candidatura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ParliamentPanel;
