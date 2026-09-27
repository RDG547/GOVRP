import PartyCustomizationForm from './PartyCustomizationForm';
import PartyColorPicker from '@/components/parties/PartyColorPicker';
import CitizenSelector from '@/components/CitizenSelector';
import { politicalOrientations, orientationColors } from '@/lib/partyIdentity';
import { fetchPublicProfiles, unavailablePublicProfile } from '@/lib/publicProfiles';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { PARTY_REALTIME_TABLES } from '@/lib/parties';
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Loader2, Settings, Save, Pencil, Users, Inbox, UserCheck, UserX, Check, X, UserMinus, Building, User, Crown, Hash, Compass, FileText, Lightbulb, ScrollText, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ImageUploader from '@/components/ImageUploader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { buildStoragePath } from '@/lib/security';
import UserSelectOption from '@/components/UserSelectOption';

const roleHierarchy = { 'Dono': 4, 'Presidente': 3, 'Vice-Presidente': 2, 'Membro': 1 };
const leadershipFieldLabels = {
    owner_id: 'dono',
    president_id: 'presidente',
    vice_president_id: 'vice-presidente',
};
const partyRoleLabels = {
    'Dono': 'Dono(a) do Partido',
    'Presidente': 'Presidente do Partido',
    'Vice-Presidente': 'Vice-Presidente do Partido',
    'Membro': 'Membro do Partido',
};

const EditPartyForm = ({ party, onAction, closeDialog, userRole, members }) => {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [logoFile, setLogoFile] = useState(null);
    const [formData, setFormData] = useState({
        name: party.name || '',
        acronym: party.acronym || '',
        ideology: party.ideology || '',
        statute: party.statute || '',
        logo_url: party.logo_url || '',
        owner_id: party.owner_id || '',
        president_id: party.president_id || '',
        vice_president_id: party.vice_president_id || '',
        description: party.description || '',
        orientation: party.orientation || '', color: party.color || '#64748B',
    });

    const handleSubmit = async (e) => {
        e.preventDefault();

        const leaderIds = [formData.owner_id, formData.president_id, formData.vice_president_id].filter(Boolean);
        const viceDuplicatesCoreRole =
            formData.vice_president_id &&
            [formData.owner_id, formData.president_id].filter(Boolean).includes(formData.vice_president_id);

        if (viceDuplicatesCoreRole) {
            toast({ title: 'Erro de Validação', description: 'O vice-presidente deve ser diferente do dono e do presidente.', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            if (leaderIds.length) {
                const { data: otherParties, error: leaderConflictError } = await supabase
                    .from('political_parties')
                    .select('id, name, acronym, owner_id, president_id, vice_president_id')
                    .neq('id', party.id).neq('status', 'Encerrado');

                if (leaderConflictError) {
                    throw leaderConflictError;
                }

                const leaderConflict = (otherParties || []).find((otherParty) =>
                    Object.keys(leadershipFieldLabels).some((field) => leaderIds.includes(otherParty[field]))
                );

                if (leaderConflict) {
                    const conflictField = Object.keys(leadershipFieldLabels).find((field) => leaderIds.includes(leaderConflict[field]));
                    throw new Error(`Este usuário já ocupa cargo de ${leadershipFieldLabels[conflictField]} no partido ${leaderConflict.name} (${leaderConflict.acronym}).`);
                }
            }

            let finalLogoUrl = formData.logo_url;
            if (logoFile) {
                const { data: uploadData, error: uploadError } = await supabase.storage.from('public-assets').upload(buildStoragePath({ prefix: 'party-logos', entityId: party.id, fileName: logoFile.name }), logoFile);
                if (uploadError) throw new Error(`Erro no upload do logo: ${uploadError.message}`);
                finalLogoUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;
            }

            const { data, error } = await supabase.rpc('update_party_details', {
                p_party_id: party.id,
                p_name: formData.name,
                p_acronym: formData.acronym,
                p_ideology: formData.ideology,
                p_statute: formData.statute,
                p_logo_url: finalLogoUrl,
                p_owner_id: formData.owner_id || null,
                p_president_id: formData.president_id || null,
                p_vice_president_id: formData.vice_president_id || null,
                p_description: formData.description,
                p_orientation: formData.orientation, p_color: formData.color,
            });

            if (error || !data?.success) throw new Error(error?.message || data?.message || "Erro desconhecido");

            toast({ title: 'Sucesso!', description: 'Dados do partido atualizados.' });
            if(onAction) onAction();
            if(closeDialog) closeDialog();
        } catch (error) {
            toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="name" className="flex items-center gap-2"><Building className="h-4 w-4 text-primary"/>Nome do Partido</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData(p=>({...p, name: e.target.value}))} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="acronym" className="flex items-center gap-2"><Hash className="h-4 w-4 text-primary"/>Sigla</Label>
                    <Input id="acronym" value={formData.acronym} onChange={(e) => setFormData(p=>({...p, acronym: e.target.value}))} />
                </div>
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {userRole === 'Dono' && (
                    <div className="space-y-2">
                        <Label htmlFor="owner" className="flex items-center gap-2"><Crown className="h-4 w-4 text-primary"/>Dono</Label>
                        <CitizenSelector label="Selecionar dono" value={formData.owner_id || ''} eligibleIds={members.map(member => member.profile.id)} onChange={id => setFormData(current => ({...current, owner_id: id}))} />
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="president" className="flex items-center gap-2"><Shield className="h-4 w-4 text-primary"/>Presidente</Label>
                    <CitizenSelector label="Selecionar presidente" value={formData.president_id || ''} eligibleIds={members.map(member => member.profile.id)} onChange={id => setFormData(current => ({...current, president_id: id}))} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="vice_president" className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-primary"/>Vice-Presidente</Label>
                    <CitizenSelector label="Selecionar vice-presidente" value={formData.vice_president_id || ''} eligibleIds={members.map(member => member.profile.id)} onChange={id => setFormData(current => ({...current, vice_president_id: id}))} />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="orientation" className="flex items-center gap-2"><Compass className="h-4 w-4 text-primary"/>Orientação Política</Label>
                <Select onValueChange={(v) => setFormData(p => ({...p, orientation: v}))} value={formData.orientation}>
                    <SelectTrigger><SelectValue placeholder="Selecione a orientação" /></SelectTrigger>
                    <SelectContent>{politicalOrientations.map(o => <SelectItem key={o} value={o}><span className={`rounded px-2 py-1 text-xs ${orientationColors[o]}`}>{o}</span></SelectItem>)}</SelectContent>
                </Select>
            </div>
             <div className="space-y-2">
                <Label htmlFor="description" className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary"/>Descrição Curta</Label>
                <Input id="description" value={formData.description} onChange={(e) => setFormData(p=>({...p, description: e.target.value}))} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="ideology" className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary"/>Ideologia</Label>
                <Textarea id="ideology" value={formData.ideology} onChange={(e) => setFormData(p=>({...p, ideology: e.target.value}))} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="statute" className="flex items-center gap-2"><ScrollText className="h-4 w-4 text-primary"/>Estatuto</Label>
                <Textarea id="statute" value={formData.statute} onChange={(e) => setFormData(p=>({...p, statute: e.target.value}))} rows={5} />
            </div>
            <PartyColorPicker party={formData} value={formData.color} onChange={color => setFormData(current => ({...current, color}))}/>
            <ImageUploader previewOnly onUrlChange={(url) => setFormData(p=>({...p, logo_url: url}))} onFileChange={setLogoFile} initialUrl={formData.logo_url} label="Logo do Partido" />
            <DialogFooter>
                <Button type="submit" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                    Salvar Alterações
                </Button>
            </DialogFooter>
        </form>
    );
};

const PartyManagementDialog = ({ party, onAction, isFromDetailsPage = false }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [actingId, setActingId] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const [currentTab, setCurrentTab] = useState('edit');
    const [affiliationMode, setAffiliationMode] = useState(party.affiliation_mode);
    const [suggestions, setSuggestions] = useState([]);
    const [requests, setRequests] = useState([]);
    const [members, setMembers] = useState([]);
    const [expelReason, setExpelReason] = useState('');
    const [memberToExpel, setMemberToExpel] = useState(null);
    const [isExpelDialogOpen, setIsExpelDialogOpen] = useState(false);

    const getEffectivePartyRole = useCallback((userId) => {
        if (!userId) {
            return null;
        }

        if (party.owner_id === userId) return 'Dono';
        if (party.president_id === userId) return 'Presidente';
        if (party.vice_president_id === userId) return 'Vice-Presidente';
        return 'Membro';
    }, [party.owner_id, party.president_id, party.vice_president_id]);

    const getMemberPartyRoleLabel = useCallback((userId) => {
        const roleKey = getEffectivePartyRole(userId) || 'Membro';
        return partyRoleLabels[roleKey] || partyRoleLabels.Membro;
    }, [getEffectivePartyRole]);

    const userRole = getEffectivePartyRole(user?.id);
    const canManageMembers = userRole === 'Dono' || userRole === 'Presidente';
    const canManageRequests = userRole === 'Dono' || userRole === 'Presidente' || userRole === 'Vice-Presidente';

    const fetchData = useCallback(async (tab, quiet = false) => {
        if (!quiet) setLoading(true);
        try {
            if (tab === 'requests') {
                const { data, error } = await supabase.from('party_affiliation_requests').select('id,user_id,party_id,status,created_at').eq('party_id', party.id).eq('status', 'pending');
                if (error) throw error;
                const profiles = await fetchPublicProfiles((data || []).map(request => request.user_id));
                setRequests((data || []).map(request => ({ ...request, user: profiles.get(request.user_id) || unavailablePublicProfile(request.user_id) })));
            } else if (tab === 'suggestions') {
                const { data, error } = await supabase.from('bill_suggestions').select('*, author:profiles!bill_suggestions_author_id_fkey(full_name)').eq('target_id', party.id).eq('target_type', 'party').order('created_at', { ascending: false });
                if (error) throw error;
                setSuggestions(data || []);
            } else if (tab === 'members' || tab === 'edit') {
                const { data, error } = await supabase.from('party_members').select('id,party_id,user_id,role,joined_at').eq('party_id', party.id);
                if (error) throw error;
                const profiles = await fetchPublicProfiles((data || []).map(member => member.user_id));
                setMembers(
                    (data || [])
                        .map((member) => {
                            const partyRole = getEffectivePartyRole(member.user_id) || 'Membro';

                            return {
                                ...member,
                                profile: profiles.get(member.user_id) || unavailablePublicProfile(member.user_id),
                                party_role: partyRole,
                                party_role_label: getMemberPartyRoleLabel(member.user_id),
                            };
                        })
                        .sort((left, right) => (roleHierarchy[right.party_role] || 0) - (roleHierarchy[left.party_role] || 0))
                );
            }
        } catch (error) {
            toast({ title: 'Erro ao buscar dados', description: error.message, variant: 'destructive' });
        } finally {
            if (!quiet) setLoading(false);
        }
    }, [getEffectivePartyRole, getMemberPartyRoleLabel, party.id, toast]);

    useEffect(() => {
        if (isOpen) {
            fetchData(currentTab);
        }
    }, [isOpen, currentTab, fetchData]);

    useDomainRealtime('parties', user?.id, PARTY_REALTIME_TABLES, () => fetchData(currentTab, true), isOpen);

    const handleRespondToRequest = async (requestId, isApproved) => {
        if (actingId) return;
        setActingId(requestId);
        const { data, error } = await supabase.rpc('respond_to_affiliation_request', { p_request_id: requestId, p_is_approved: isApproved });
        if (error || !data?.success) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            setRequests(current => current.filter(request => request.id !== requestId));
            await fetchData('requests', true);
            onAction();
        }
        setActingId(null);
    };

    const handleExpelMember = async () => {
        if (!memberToExpel || !expelReason) {
            toast({title: "Erro", description: "O motivo da expulsão é obrigatório.", variant: "destructive"});
            return;
        }
        if (actingId) return;
        setActingId(memberToExpel.id);
        const { data, error } = await supabase.rpc('expel_party_member', { p_party_id: party.id, p_member_id_to_expel: memberToExpel.user_id, p_reason: expelReason });

        if (error || !data?.success) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            await fetchData('members', true);
            onAction();
        }
        setActingId(null);
        setIsExpelDialogOpen(false);
        setExpelReason('');
    };

    const handleToggleAffiliationMode = async (checked) => {
        const newMode = checked ? 'manual' : 'automatic';
        if (actingId) return;
        setActingId('settings');
        const {data, error} = await supabase.rpc('toggle_party_affiliation_mode', { p_party_id: party.id, p_mode: newMode });
        if(error || !data?.success) {
            toast({ title: 'Erro', description: error?.message || data.message, variant: 'destructive' });
        } else {
            setAffiliationMode(newMode);
            toast({ title: 'Sucesso!', description: data.message });
            onAction();
        }
        setActingId(null);
    }

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant={isFromDetailsPage ? "default" : "secondary"} size={isFromDetailsPage ? "default" : "sm"}>
                    <Settings className="mr-2 h-4 w-4" />Gerenciar
                </Button>
            </DialogTrigger>
            <DialogContent className="glass-effect grid-cols-1 [&>*]:min-w-0 max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Gerenciar {party.name}</DialogTitle></DialogHeader>
                <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
                    <TabsList className="grid h-auto w-full grid-cols-2 gap-2 sm:grid-cols-3 [&>button]:min-w-0 [&>button]:whitespace-normal [&>button]:px-1 [&>button]:text-xs">
                        <TabsTrigger value="edit"><Pencil className="mr-2 h-4 w-4"/>Editar</TabsTrigger>
                        <TabsTrigger value="members"><Users className="mr-2 h-4 w-4"/>Membros</TabsTrigger>
                        <TabsTrigger value="requests"><Inbox className="mr-2 h-4 w-4"/>Pedidos</TabsTrigger>
                        <TabsTrigger value="customization"><Settings className="mr-2 h-4 w-4"/>Personalização</TabsTrigger><TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4"/>Ajustes</TabsTrigger>
                    </TabsList>
                    <TabsContent value="customization" className="pt-4"><PartyCustomizationForm party={party} onAction={onAction}/></TabsContent><TabsContent value="edit" className="pt-4">
                        <EditPartyForm party={party} onAction={onAction} closeDialog={() => setIsOpen(false)} userRole={userRole} members={members} />
                    </TabsContent>
                     <TabsContent value="members" className="pt-4">
                        <h3 className="font-semibold mb-2">Membros do Partido</h3>
                        {loading ? <Loader2 className="animate-spin mx-auto" /> : (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {members.length > 0 ? members.map(m => {
                                    const memberRoleLevel = roleHierarchy[m.party_role] || 0;
                                    const userRoleLevel = roleHierarchy[userRole] || 0;
                                    const canExpel = canManageMembers && userRoleLevel > memberRoleLevel;

                                    return (
                                        <Card key={m.user_id} className="bg-background/50 flex items-center justify-between p-3">
                                            <div className="flex items-center gap-3">
                                                <Avatar><AvatarImage src={m.profile.avatar_url} alt={m.profile.full_name} /><AvatarFallback>{m.profile.full_name.charAt(0)}</AvatarFallback></Avatar>
                                                <div>
                                                    <p className="font-medium">{m.profile.full_name}</p>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Badge variant="secondary" className="flex items-center gap-1"><Building size={12}/>{m.party_role_label}</Badge>
                                                        <Badge variant="outline" className="flex items-center gap-1"><User size={12}/>{m.profile.role}</Badge>
                                                    </div>
                                                </div>
                                            </div>
                                            {canExpel && (
                                                <Button size="icon" variant="destructive" className="h-8 w-8" onClick={() => { setMemberToExpel(m); setIsExpelDialogOpen(true); }}>
                                                    <UserMinus size={16} />
                                                </Button>
                                            )}
                                        </Card>
                                    );
                                }) : <p className="text-center text-muted-foreground py-4">Nenhum membro encontrado.</p>}
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="requests" className="pt-4">
                        <h3 className="font-semibold mb-2">Pedidos de Filiação</h3>
                        {loading ? <Loader2 className="animate-spin mx-auto" /> : (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {requests.length > 0 ? requests.map(req => (
                                    <Card key={req.id} className="bg-background/50 flex items-center justify-between p-4">
                                        <div className="flex items-center gap-3">
                                            <Avatar><AvatarImage src={req.user.avatar_url} alt={req.user.full_name} /><AvatarFallback>{req.user.full_name.charAt(0)}</AvatarFallback></Avatar>
                                            <p className="font-medium">{req.user.full_name}</p>
                                        </div>
                                        {canManageRequests && (
                                            <div className="flex gap-2">
                                                <Button size="icon" className="h-8 w-8 bg-green-500 hover:bg-green-600" disabled={Boolean(actingId)} aria-label="Aprovar filiação" onClick={() => handleRespondToRequest(req.id, true)}>{actingId === req.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}</Button>
                                                <Button size="icon" className="h-8 w-8 bg-red-500 hover:bg-red-600" disabled={Boolean(actingId)} aria-label="Recusar filiação" onClick={() => handleRespondToRequest(req.id, false)}><X size={16} /></Button>
                                            </div>
                                        )}
                                    </Card>
                                )) : <p className="text-center text-muted-foreground py-4">Nenhum pedido pendente.</p>}
                            </div>
                        )}
                    </TabsContent>
                    <TabsContent value="settings" className="space-y-4 pt-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                           <div>
                             <Label htmlFor="affiliation-mode" className="text-base">Filiação Manual</Label>
                             <p className="text-sm text-muted-foreground">Exigir aprovação para novos membros.</p>
                           </div>
                           <Switch id="affiliation-mode" checked={affiliationMode === 'manual'} onCheckedChange={handleToggleAffiliationMode} disabled={loading || Boolean(actingId)} />
                        </div>
                    </TabsContent>
                </Tabs>
                <Dialog open={isExpelDialogOpen} onOpenChange={setIsExpelDialogOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Expulsar Membro</DialogTitle>
                      <DialogDescription>
                        Você está prestes a expulsar {memberToExpel?.profile.full_name}. Por favor, forneça um motivo.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                      <Label htmlFor="expel-reason">Motivo da Expulsão</Label>
                      <Textarea id="expel-reason" value={expelReason} onChange={(e) => setExpelReason(e.target.value)} />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsExpelDialogOpen(false)}>Cancelar</Button>
                      <Button variant="destructive" onClick={handleExpelMember} disabled={Boolean(actingId) || !expelReason}>
                        {actingId ? <Loader2 className="animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
                        Confirmar Expulsão
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
            </DialogContent>
        </Dialog>
    );
}

export default PartyManagementDialog;
