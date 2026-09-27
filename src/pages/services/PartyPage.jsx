import { brandFont } from '@/lib/brandFonts';
import { Info } from 'lucide-react';
import PartyColorPicker from '@/components/parties/PartyColorPicker';
import { partyColor } from '@/lib/partyIdentity';
import PartyTreasury from '@/components/parties/PartyTreasury';
import { orientationColors } from '@/lib/partyIdentity';
import PartyMemberActions from '@/components/parties/PartyMemberActions';
import PartyRoleBadges from '@/components/parties/PartyRoleBadges';
import { formatDateBR } from '@/lib/dateTime';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { fetchPublicParties, PARTY_REALTIME_TABLES } from '@/lib/parties';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Users, Calendar, Shield, Settings, Save, ChevronDown, ChevronUp, Edit, Trash2, Building, User, Inbox, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ImageUploader from '@/components/ImageUploader';
import PartyManagementDialog from '@/components/parties/PartyManagementDialog';
import { Textarea } from '@/components/ui/textarea';
import { buildStoragePath } from '@/lib/security';

const roleHierarchy = { 'Dono': 4, 'Presidente': 3, 'Vice-Presidente': 2, 'Membro': 1 };


const ExpandableText = ({ text, maxLength = 150 }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!text || text.length <= maxLength) {
        return <p className="text-lg md:text-xl mt-2 opacity-90 drop-shadow-md max-w-3xl mx-auto">{text}</p>;
    }

    return (
        <div>
            <p className="text-lg md:text-xl mt-2 opacity-90 drop-shadow-md max-w-3xl mx-auto">
                {isExpanded ? text : `${text.substring(0, maxLength)}...`}
            </p>
            <Button variant="link" onClick={() => setIsExpanded(!isExpanded)} className="text-white p-0 h-auto mt-1">
                {isExpanded ? "Ver menos" : "Ver mais"}
                {isExpanded ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
            </Button>
        </div>
    );
};

const PartyPage = () => {
    const { partyId } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const { toast } = useToast();
    const [party, setParty] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCustomizing, setIsCustomizing] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [editData, setEditData] = useState({ ideology: '', statute: '' });

    const fetchPartyData = useCallback(async () => {
        try {
            const [data] = await fetchPublicParties(partyId);
            if (!data) {
                setParty(null); setSuggestions([]);
                setLoadError('Este partido foi encerrado ou não está disponível.');
                return;
            }
            setLoadError('');
            setParty(data);


            const { data: suggestionsData, error: suggestionsError } = await supabase
                .from('bill_suggestions')
                .select('*, author:profiles!bill_suggestions_author_id_fkey(full_name)')
                .eq('target_id', partyId)
                .eq('target_type', 'party')
                .order('created_at', { ascending: false });

            if (suggestionsError) throw suggestionsError;
            setSuggestions(suggestionsData || []);

        } catch (error) {
            setLoadError(error.message);
            toast({ title: "Erro ao carregar dados", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [partyId, navigate, toast]);

    useEffect(() => {
        fetchPartyData();
    }, [fetchPartyData]);

    useDomainRealtime('parties', user?.id, PARTY_REALTIME_TABLES, fetchPartyData);

    const handleSaveChanges = async () => {
        setSaving(true);
        const { data, error } = await supabase.rpc('update_party_details', {
            p_party_id: party.id,
            p_name: party.name,
            p_acronym: party.acronym,
            p_ideology: editData.ideology,
            p_statute: editData.statute,
            p_logo_url: party.logo_url,
            p_owner_id: party.owner_id,
            p_president_id: party.president_id,
            p_vice_president_id: party.vice_president_id,
            p_description: party.description,
            p_orientation: party.orientation,
        });
        if (error || !data?.success) {
            toast({ title: "Erro ao salvar", description: error?.message || data?.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: "Dados do partido atualizados." });
            setIsEditing(false);
            fetchPartyData();
        }
        setSaving(false);
    };

    const userMemberRecord = party?.members?.find(m => m.user_id === user?.id);
    const userRole = !user?.id
        ? null
        : party?.owner_id === user.id
            ? 'Dono'
            : party?.president_id === user.id
                ? 'Presidente'
                : party?.vice_president_id === user.id
                    ? 'Vice-Presidente'
                    : userMemberRecord
                        ? 'Membro'
                        : null;
    const canManage = userRole === 'Dono' || userRole === 'Presidente' || userRole === 'Vice-Presidente';
    const isOwner = userRole === 'Dono';

    if (loading && !party) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="w-16 h-16 animate-spin text-primary" /></div>;
    }

    if (!party) return <div className="mx-auto max-w-xl p-8 text-center" role="alert"><p>{loadError || 'Partido indisponível.'}</p><Button className="mt-4" onClick={fetchPartyData}>Tentar novamente</Button><Button variant="ghost" onClick={() => navigate('/services/political-parties')}>Voltar aos partidos</Button></div>;

    const headerStyle = {
        borderBottom: `5px solid ${partyColor(party.color)}`,
        backgroundColor: party.customization?.header_url ? 'transparent' : '#1e293b',
        ...(party.customization?.header_url && {
            backgroundImage: `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url(${party.customization.header_url})`,
            backgroundBlendMode: 'multiply',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
        }),
    };

    const getMemberPartyRole = (member) => {
        const roles = [];
        if (party.owner_id === member.user_id) roles.push("Dono");
        if (party.president_id === member.user_id && !roles.includes("Dono")) roles.push("Presidente");
        if (party.vice_president_id === member.user_id) roles.push("Vice-Presidente");

        if (roles.length === 0) return "Membro";
        return roles.join(' e ');
    };

    return (
        <>
            <Helmet><title>{party.name} - Partidos Políticos</title><meta name="description" content={party.description} /></Helmet>
            <div className="min-h-screen">
                <header style={headerStyle} className="h-auto min-h-[20rem] py-10 relative flex items-center justify-center text-white shadow-lg">
                    <div className="relative min-w-0 max-w-full text-center z-10 p-4">
                        <img src={party.logo_url} alt={`Logo ${party.name}`} className="w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full border-4 border-white bg-background object-cover shadow-2xl mb-4" />
                        <h1 style={{fontFamily:brandFont(party.customization?.font_key)}} className="break-words text-4xl md:text-6xl font-extrabold tracking-tight drop-shadow-lg">{party.name} ({party.acronym})</h1>
                        <ExpandableText text={party.description} />
                    </div>
                    {canManage && (
                        <div className="absolute top-4 right-4 z-20 flex gap-2">
                            <PartyManagementDialog party={party} onAction={fetchPartyData} isFromDetailsPage={true} />

                        </div>
                    )}
                </header>

                <main className="container mx-auto px-4 py-8 md:py-12">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-2 space-y-8">
                            <Card className="glass-effect">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" style={{color:party.color}}/>Sobre o Partido</CardTitle>
                                    {isOwner && !isEditing && <Button variant="outline" size="sm" onClick={() => { setEditData({ ideology: party.ideology || '', statute: party.statute || '' }); setIsEditing(true); }}><Edit className="w-4 h-4 mr-2" />Editar</Button>}
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {isEditing ? (
                                        <div className="space-y-4">
                                            <div><Label htmlFor="ideology">Ideologia</Label><Textarea id="ideology" value={editData.ideology} onChange={(e) => setEditData(p => ({...p, ideology: e.target.value}))} rows={5} /></div>
                                            <div><Label htmlFor="statute">Estatuto</Label><Textarea id="statute" value={editData.statute} onChange={(e) => setEditData(p => ({...p, statute: e.target.value}))} rows={10} /></div>
                                            <div className="flex gap-2 justify-end">
                                                <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancelar</Button>
                                                <Button onClick={handleSaveChanges} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}Salvar</Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div><h3 className="font-semibold text-lg">Ideologia</h3><p className="text-muted-foreground whitespace-pre-wrap">{party.ideology}</p></div>
                                            <div><h3 className="font-semibold text-lg">Estatuto</h3><p className="text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">{party.statute}</p></div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                            <PartyTreasury party={party} />
                            {userMemberRecord && (
                                <Card className="glass-effect">
                                    <CardHeader><CardTitle className="flex items-center gap-2"><Inbox className="w-5 h-5" style={{color: party.color}}/> Sugestões Recebidas</CardTitle></CardHeader>
                                    <CardContent className="space-y-4 max-h-96 overflow-y-auto">
                                        {suggestions.length > 0 ? suggestions.map(s => (
                                            <div key={s.id} className="p-4 border rounded-lg bg-background/30">
                                                <p className="font-semibold">{s.title}</p>
                                                <p className="text-sm text-muted-foreground">{s.suggestion}</p>
                                                <p className="text-xs text-muted-foreground mt-2">Enviado por: {s.author?.full_name || 'Cidadão indisponível'}</p>
                                            </div>
                                        )) : <p className="text-muted-foreground text-center py-4">Nenhuma sugestão recebida.</p>}
                                    </CardContent>
                                </Card>
                            )}
                        </div>

                        <aside className="space-y-8">
                            <Card className="glass-effect">
                                <CardHeader><CardTitle className="flex items-center gap-2"><Info className="h-5 w-5" style={{color:party.color}}/>Informações Gerais</CardTitle></CardHeader>
                                <CardContent className="space-y-3 text-sm"><div className="flex items-center gap-3"><Avatar><AvatarImage src={party.founder?.avatar_url} /><AvatarFallback>{party.founder?.full_name?.charAt(0) || '?'}</AvatarFallback></Avatar><div><p className="font-semibold">{party.founder?.full_name || 'Cidadão indisponível'}</p><p className="text-xs text-muted-foreground">Fundador</p></div></div>
                                    <div className="flex items-center gap-3"><Shield className="w-5 h-5" style={{color: party.color}} /><Badge className={orientationColors[party.orientation || 'Não definido']}>{party.orientation || 'Não definido'}</Badge></div>
                                    <div className="flex items-center gap-3"><Calendar className="w-5 h-5" style={{color: party.color}} /><span>Fundado em {formatDateBR(party.created_at,{long:true})}</span></div>
                                    <div className="flex items-center gap-3"><Users className="w-5 h-5" style={{color: party.color}} /><span>{party.members.length} Membros</span></div>
                                </CardContent>
                            </Card>
                            <Card className="glass-effect">
                                <CardHeader><CardTitle className="flex items-center gap-2"><Crown className="h-5 w-5" style={{color:party.color}}/>Lideranças</CardTitle></CardHeader>
                                <CardContent className="space-y-4">

                                    {party.owner && <div className="flex items-center gap-3"><Avatar><AvatarImage src={party.owner.avatar_url} /><AvatarFallback>{party.owner.full_name.charAt(0)}</AvatarFallback></Avatar><div><p className="font-semibold">{party.owner.full_name}</p><PartyRoleBadges party={party} userId={party.owner_id}/></div><PartyMemberActions party={party} memberId={party.owner_id} onChange={fetchPartyData}/></div>}
                                    {party.president && <div className="flex items-center gap-3"><Avatar><AvatarImage src={party.president.avatar_url} /><AvatarFallback>{party.president.full_name.charAt(0)}</AvatarFallback></Avatar><div><p className="font-semibold">{party.president.full_name}</p><PartyRoleBadges party={party} userId={party.president_id}/></div><PartyMemberActions party={party} memberId={party.president_id} onChange={fetchPartyData}/></div>}
                                    {party.vice_president && <div className="flex items-center gap-3"><Avatar><AvatarImage src={party.vice_president.avatar_url} /><AvatarFallback>{party.vice_president.full_name.charAt(0)}</AvatarFallback></Avatar><div><p className="font-semibold">{party.vice_president.full_name}</p><PartyRoleBadges party={party} userId={party.vice_president_id}/></div><PartyMemberActions party={party} memberId={party.vice_president_id} onChange={fetchPartyData}/></div>}
                                </CardContent>
                            </Card>
                            <Card className="glass-effect">
                                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" style={{color:party.color}}/>Membros</CardTitle></CardHeader>
                                <CardContent className="space-y-2 max-h-72 overflow-y-auto">
                                    {[...party.members].sort((a, b) => (roleHierarchy[b.role] || 0) - (roleHierarchy[a.role] || 0)).map(member => (
                                        <div key={member.user_id} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/50">
                                            <Avatar className="w-8 h-8"><AvatarImage src={member.profile.avatar_url} /><AvatarFallback>{member.profile.full_name.charAt(0)}</AvatarFallback></Avatar>
                                            <div>
                                                <p className="font-medium text-sm">{member.profile.full_name}</p>
                                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                    <PartyRoleBadges party={party} userId={member.user_id}/>
                                                    <Badge variant="outline" className="flex items-center gap-1"><User size={12}/>{member.profile.role}</Badge>
                                                </div>
                                            </div>
                                            <PartyMemberActions party={party} memberId={member.user_id} onChange={fetchPartyData}/>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        </aside>
                    </div>
                </main>
            </div>
        </>
    );
};

export default PartyPage;
