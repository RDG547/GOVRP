import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { fetchPublicParties, PARTY_REALTIME_TABLES } from '@/lib/parties';
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, PlusCircle, LogIn, LogOut, Info, Users, CheckCircle2, AlertTriangle, Calendar, Filter, Star, Settings, Compass } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import CreatePartyDialog from '@/components/parties/CreatePartyDialog';
import PartyManagementDialog from '@/components/parties/PartyManagementDialog';
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const politicalOrientations = ['Todos', 'Extrema Esquerda', 'Esquerda', 'Centro-Esquerda', 'Centro', 'Centro-Direita', 'Direita', 'Extrema Direita'];

const orientationColors = {
  'Extrema Esquerda': 'bg-red-900 hover:bg-red-800 text-white',
  'Esquerda': 'bg-red-600 hover:bg-red-500 text-white',
  'Centro-Esquerda': 'bg-red-400 hover:bg-red-300 text-black',
  'Centro': 'bg-gray-500 hover:bg-gray-400 text-white',
  'Centro-Direita': 'bg-blue-500 hover:bg-blue-400 text-white',
  'Direita': 'bg-blue-600 hover:bg-blue-500 text-white',
  'Extrema Direita': 'bg-blue-900 hover:bg-blue-800 text-white',
  'Não definido': 'bg-gray-700 hover:bg-gray-600 text-white'
};

const PARTY_LEADERSHIP_FIELDS = ['owner', 'president', 'vice_president'];

const suppressDuplicatePartyLeaders = (partyList = []) => {
    const occupiedLeaderParties = new Map();

    return partyList.map((party) => {
        const normalizedParty = { ...party };

        PARTY_LEADERSHIP_FIELDS.forEach((field) => {
            const fieldId = `${field}_id`;
            const conflictKey = `${field}_conflict`;
            const leaderId = party[fieldId];

            if (!leaderId) {
                return;
            }

            const occupiedPartyId = occupiedLeaderParties.get(leaderId);
            if (occupiedPartyId && occupiedPartyId !== party.id) {
                normalizedParty[fieldId] = null;
                normalizedParty[field] = null;
                normalizedParty[conflictKey] = true;
                return;
            }

            if (!occupiedPartyId) {
                occupiedLeaderParties.set(leaderId, party.id);
            }
        });

        return normalizedParty;
    });
};

const PoliticalParties = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [parties, setParties] = useState([]);
    const [pendingRequest, setPendingRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [userAffiliation, setUserAffiliation] = useState(null);
    const [orientationFilter, setOrientationFilter] = useState('Todos');

    const fetchData = useCallback(async () => {
        try {
            const [data, requestResult] = await Promise.all([
                fetchPublicParties(),
                user?.id ? supabase.from('party_affiliation_requests').select('id,party_id,status').eq('user_id', user.id).eq('status', 'pending').limit(1).maybeSingle() : Promise.resolve({ data: null }),
            ]);
            if (requestResult.error) throw requestResult.error;
            const affiliationParty = data.find(party => party.members.some(member => member.user_id === user?.id));
            const member = affiliationParty?.members.find(item => item.user_id === user?.id);
            setUserAffiliation(member ? { ...member, party_id: affiliationParty.id, party: affiliationParty } : null);
            setPendingRequest(member ? null : requestResult.data);
            const sorted = [...data].sort((a, b) => Number(b.id === affiliationParty?.id) - Number(a.id === affiliationParty?.id));
            setParties(sorted);
        } catch (error) {
            toast({ title: 'Erro ao buscar partidos', description: error.message, variant: 'destructive' });
        } finally { setLoading(false); }
    }, [user?.id, toast]);

    useEffect(() => { void fetchData(); }, [fetchData]);
    useDomainRealtime('parties', user?.id, PARTY_REALTIME_TABLES, fetchData);
    const visibleParties = parties.filter(party => orientationFilter === 'Todos' || party.orientation === orientationFilter);

    const handleAffiliate = async (partyId) => {
        setActionLoading(partyId);
        const { data, error } = await supabase.rpc('request_party_affiliation', { p_party_id: partyId });
        if(error || !data?.success) {
            toast({ title: 'Erro', description: error?.message || data?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });

            fetchData();
        }
        setActionLoading(null);
    }

    const handleDisaffiliate = async () => {
        if (!userAffiliation) return;

        setActionLoading('disaffiliate');
        const { data, error } = await supabase.rpc('disaffiliate_from_party', {
            p_party_id: userAffiliation.party_id
        });

        if(error || !data?.success) {
            toast({ title: 'Erro', description: error?.message || data?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            fetchData();
        }
        setActionLoading(null);
    };

    const handleCancelRequest = async () => {
        if(!pendingRequest) return;
        setActionLoading(pendingRequest.party_id);
        const {data, error} = await supabase.rpc('cancel_affiliation_request', { p_request_id: pendingRequest.id });
        if(error || !data?.success) {
            toast({ title: 'Erro', description: error?.message || data?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            fetchData();
        }
        setActionLoading(null);
    }

    if (loading && parties.length === 0) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;

    const renderAffiliationButton = (party) => {
      const isLoading = actionLoading === party.id;
      if (userAffiliation?.party_id === party.id) {
          return (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="w-full" disabled={actionLoading}><LogOut className="mr-2 h-4 w-4" /> Desfiliar-se</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Confirmar Desfiliação</AlertDialogTitle><AlertDialogDescription>Tem certeza que deseja sair do partido? {userAffiliation.role === 'Dono' && 'A liderança será transferida automaticamente.'}</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleDisaffiliate}>Confirmar Saída</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
      }
      if (pendingRequest?.party_id === party.id) {
          return <Button variant="secondary" className="w-full" onClick={handleCancelRequest} disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <>Cancelar Pedido</>}</Button>;
      }

      const affiliateAction = () => handleAffiliate(party.id);

      if (userAffiliation && userAffiliation.party_id !== party.id) {
        return (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogIn className="mr-2 h-4 w-4" />} Filiar-se</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Trocar de partido?</AlertDialogTitle><AlertDialogDescription>Você já é membro de "{userAffiliation.party.name}". Para entrar em "{party.name}", primeiro desfilie-se do partido atual. A solicitação não altera sua filiação automaticamente.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={affiliateAction}>Continuar</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      }

      return <Button className="w-full" onClick={affiliateAction} disabled={isLoading || !!pendingRequest}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogIn className="mr-2 h-4 w-4" />} Filiar-se</Button>
    }

    return (
        <>
            <Helmet><title>Partidos Políticos - GOV.RP</title></Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                 <PageHeader icon={Users} title="Partidos" gradientText="Políticos" description="Organize-se, defenda suas ideias e concorra ao poder." iconColor="text-rose-400" centered={true} />
                <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-muted-foreground" />
                        <Select onValueChange={setOrientationFilter} value={orientationFilter}>
                            <SelectTrigger className="w-full md:w-[240px]">
                                <SelectValue placeholder="Filtrar por orientação" />
                            </SelectTrigger>
                            <SelectContent>
                                {politicalOrientations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <CreatePartyDialog onPartyCreated={fetchData} userAffiliation={userAffiliation} />
                </div>
                {loading ? (
                    <div className="flex justify-center items-center min-h-[40vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>
                ) : visibleParties.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {visibleParties.map(party => {
                            const memberCount = party.members?.length || 0;
                            const isActive = memberCount >= 5;
                            const isUserParty = userAffiliation?.party_id === party.id;
                            const userIsLeader = [party.owner_id, party.president_id, party.vice_president_id].includes(user?.id);

                            return (
                                <motion.div key={party.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                                    <Card className={`glass-effect flex flex-col h-full hover:border-primary transition-colors duration-300 ${isUserParty ? 'border-primary' : ''} ${!isActive && 'border-dashed border-amber-500'}`}>
                                        <CardHeader>
                                            <div className="relative space-y-3">
                                                <div className="flex items-center gap-3 pr-8">
                                                    <img
                                                      src={party.logo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${party.acronym}`}
                                                      alt={party.name}
                                                      className="h-14 w-14 shrink-0 rounded-lg bg-secondary p-1 object-cover"
                                                    />
                                                    <CardTitle className="text-foreground">{party.name} ({party.acronym})</CardTitle>
                                                </div>
                                                <CardDescription className="text-muted-foreground">{party.description}</CardDescription>
                                                {isUserParty && <Star className="absolute top-0 right-0 w-5 h-5 text-yellow-400 fill-yellow-400" />}
                                            </div>
                                        </CardHeader>
                                        <CardContent className="flex-grow space-y-2">
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Calendar className="w-4 h-4" />
                                                <span>Fundado em {format(new Date(party.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>
                                            </div>
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Compass className="w-4 h-4" />
                                                <Badge className={cn(orientationColors[party.orientation || 'Não definido'])}>
                                                  {party.orientation || 'Não definido'}
                                                </Badge>
                                            </div>
                                            <div>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className={`inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold rounded-full ${isActive ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-300'}`}>
                                                                {isActive ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                                                                {isActive ? 'Ativo' : 'Em Formação'}
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>{isActive ? 'Este partido está apto para disputar eleições.' : 'Necessário 5 membros para se tornar ativo.'}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </div>
                                            <p className="text-sm text-muted-foreground">Dono: {party.owner?.full_name || (party.owner_conflict ? 'Conflito de liderança' : 'Não definido')}</p>
                                            <p className="text-sm text-muted-foreground">Presidente: {party.president?.full_name || (party.president_conflict ? 'Conflito de liderança' : 'Não definido')}</p>
                                            <p className="text-sm text-muted-foreground">Vice-Presidente: {party.vice_president?.full_name || (party.vice_president_conflict ? 'Conflito de liderança' : 'Não definido')}</p>
                                            <p className="text-sm text-muted-foreground">Fundador: {party.founder?.full_name || 'Desconhecido'}</p>
                                            <p className="text-sm text-muted-foreground">Membros: {memberCount}</p>
                                            <p className="text-sm text-muted-foreground">Filiação: <span className="font-semibold">{party.affiliation_mode === 'automatic' ? 'Automática' : 'Manual'}</span></p>
                                        </CardContent>
                                        <CardFooter className="flex-col gap-2 items-center">
                                            <div className="w-full flex flex-col sm:flex-row gap-2">
                                                {renderAffiliationButton(party)}
                                                <Link to={`/services/political-parties/${party.id}`} className="w-full">
                                                    <Button variant="outline" className="w-full"><Info className="mr-2 h-4 w-4" />Detalhes</Button>
                                                </Link>
                                            </div>
                                            {userIsLeader &&
                                              <div className="w-full mt-2 flex justify-center">
                                                <PartyManagementDialog party={party} onAction={fetchData} />
                                              </div>
                                            }
                                        </CardFooter>
                                    </Card>
                                </motion.div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="text-center py-20 border-2 border-dashed border-border rounded-lg">
                        <h3 className="text-xl font-semibold">Nenhum partido encontrado</h3>
                        <p className="text-muted-foreground mt-2">Nenhum partido corresponde ao filtro selecionado ou ainda não há partidos criados.</p>
                    </div>
                )}
            </div>
        </>
    );
};

export default PoliticalParties;
