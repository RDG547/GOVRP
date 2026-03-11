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
import { Loader2, Settings, UserCheck, UserX, Check, X, UserMinus, Building, User, Crown } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import ImageUploader from '@/components/ImageUploader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

const politicalOrientations = ['Extrema Esquerda', 'Esquerda', 'Centro-Esquerda', 'Centro', 'Centro-Direita', 'Direita', 'Extrema-Direita'];
const roleHierarchy = { 'Dono': 4, 'Presidente': 3, 'Vice-Presidente': 2, 'Membro': 1 };

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
        orientation: party.orientation || '',
    });

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        const leaderIds = [formData.owner_id, formData.president_id, formData.vice_president_id].filter(Boolean);
        const uniqueLeaderIds = new Set(leaderIds);

        if (leaderIds.length !== uniqueLeaderIds.size) {
            toast({ title: 'Erro de Validação', description: 'Um membro não pode ocupar mais de um cargo de liderança (Dono, Presidente, Vice).', variant: 'destructive' });
            return;
        }

        setLoading(true);
        try {
            let finalLogoUrl = formData.logo_url;
            if (logoFile) {
                const { data: uploadData, error: uploadError } = await supabase.storage.from('public-assets').upload(`party-logos/${Date.now()}-${logoFile.name}`, logoFile);
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
                p_orientation: formData.orientation,
            });

            if (error || !data.success) throw new Error(error?.message || data.message || "Erro desconhecido");
            
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
                    <Label htmlFor="name">Nome do Partido</Label>
                    <Input id="name" value={formData.name} onChange={(e) => setFormData(p=>({...p, name: e.target.value}))} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="acronym">Sigla</Label>
                    <Input id="acronym" value={formData.acronym} onChange={(e) => setFormData(p=>({...p, acronym: e.target.value}))} />
                </div>
            </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {userRole === 'Dono' && (
                    <div className="space-y-2">
                        <Label htmlFor="owner">Dono</Label>
                        <Select onValueChange={(v) => setFormData(p => ({...p, owner_id: v}))} value={formData.owner_id || ''}>
                          <SelectTrigger><SelectValue placeholder="Selecione um novo dono" /></SelectTrigger>
                          <SelectContent>{members.map(m => <SelectItem key={m.profile.id} value={m.profile.id}>{m.profile.full_name}</SelectItem>)}</SelectContent>
                        </Select>
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="president">Presidente</Label>
                    <Select onValueChange={(v) => setFormData(p => ({...p, president_id: v}))} value={formData.president_id || ''}>
                      <SelectTrigger><SelectValue placeholder="Selecione um presidente" /></SelectTrigger>
                      <SelectContent>{members.map(m => <SelectItem key={m.profile.id} value={m.profile.id}>{m.profile.full_name}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="vice_president">Vice-Presidente</Label>
                    <Select onValueChange={(v) => setFormData(p => ({...p, vice_president_id: v}))} value={formData.vice_president_id || ''}>
                      <SelectTrigger><SelectValue placeholder="Selecione um vice" /></SelectTrigger>
                      <SelectContent>{members.map(m => <SelectItem key={m.profile.id} value={m.profile.id}>{m.profile.full_name}</SelectItem>)}</SelectContent>
                    </Select>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="orientation">Orientação Política</Label>
                <Select onValueChange={(v) => setFormData(p => ({...p, orientation: v}))} value={formData.orientation}>
                    <SelectTrigger><SelectValue placeholder="Selecione a orientação" /></SelectTrigger>
                    <SelectContent>{politicalOrientations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
            </div>
             <div className="space-y-2">
                <Label htmlFor="description">Descrição Curta</Label>
                <Input id="description" value={formData.description} onChange={(e) => setFormData(p=>({...p, description: e.target.value}))} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="ideology">Ideologia</Label>
                <Textarea id="ideology" value={formData.ideology} onChange={(e) => setFormData(p=>({...p, ideology: e.target.value}))} />
            </div>
            <div className="space-y-2">
                <Label htmlFor="statute">Estatuto</Label>
                <Textarea id="statute" value={formData.statute} onChange={(e) => setFormData(p=>({...p, statute: e.target.value}))} rows={5} />
            </div>
            <ImageUploader onUrlChange={(url) => setFormData(p=>({...p, logo_url: url}))} onFileChange={setLogoFile} initialUrl={formData.logo_url} label="Logo do Partido" />
            <DialogFooter>
                <Button type="submit" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
    const [isOpen, setIsOpen] = useState(false);
    const [currentTab, setCurrentTab] = useState('edit');
    const [affiliationMode, setAffiliationMode] = useState(party.affiliation_mode);
    const [suggestions, setSuggestions] = useState([]);
    const [requests, setRequests] = useState([]);
    const [members, setMembers] = useState([]);
    const [expelReason, setExpelReason] = useState('');
    const [memberToExpel, setMemberToExpel] = useState(null);
    const [isExpelDialogOpen, setIsExpelDialogOpen] = useState(false);
    
    const userMemberRecord = members.find(m => m.user_id === user.id);
    const userRole = userMemberRecord?.role;
    const canManageMembers = userRole === 'Dono' || userRole === 'Presidente';
    const canManageRequests = userRole === 'Dono' || userRole === 'Presidente' || userRole === 'Vice-Presidente';

    const getMemberPartyRole = (member) => {
        if (party.owner_id === member.user_id) return "Dono(a) do Partido";
        if (party.president_id === member.user_id) return "Presidente do Partido";
        if (party.vice_president_id === member.user_id) return "Vice-Presidente do Partido";
        return "Membro do Partido";
    };

    const fetchData = useCallback(async (tab) => {
        setLoading(true);
        try {
            if (tab === 'requests') {
                const { data, error } = await supabase.from('party_affiliation_requests').select('*, user:profiles(id, full_name, avatar_url)').eq('party_id', party.id).eq('status', 'pending');
                if (error) throw error;
                setRequests(data || []);
            } else if (tab === 'suggestions') {
                const { data, error } = await supabase.from('bill_suggestions').select('*, author:profiles(full_name)').eq('target_id', party.id).eq('target_type', 'party').order('created_at', { ascending: false });
                if (error) throw error;
                setSuggestions(data || []);
            } else if (tab === 'members' || tab === 'edit') {
                const { data, error } = await supabase.from('party_members').select('*, user_id, profile:profiles(id, full_name, avatar_url, role)').eq('party_id', party.id);
                if (error) throw error;
                setMembers(data.map(m => ({ ...m, role: getMemberPartyRole({ user_id: m.user_id })})).sort((a, b) => (roleHierarchy[b.role] || 0) - (roleHierarchy[a.role] || 0)) || []);
            }
        } catch (error) {
            toast({ title: 'Erro ao buscar dados', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [party.id, toast]);

    useEffect(() => {
        if (isOpen) {
            fetchData(currentTab);
        }
    }, [isOpen, currentTab, fetchData]);
    
    const handleRespondToRequest = async (requestId, isApproved) => {
        setLoading(true);
        const { data, error } = await supabase.rpc('respond_to_affiliation_request', { p_request_id: requestId, p_is_approved: isApproved });
        if (error || !data.success) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            fetchData('requests');
            onAction();
        }
        setLoading(false);
    };

    const handleExpelMember = async () => {
        if (!memberToExpel || !expelReason) {
            toast({title: "Erro", description: "O motivo da expulsão é obrigatório.", variant: "destructive"});
            return;
        }
        setLoading(true);
        const { data, error } = await supabase.rpc('expel_party_member', { p_party_id: party.id, p_member_id_to_expel: memberToExpel.user_id, p_reason: expelReason });

        if (error || !data.success) {
            toast({ title: "Erro", description: data?.message || error.message, variant: "destructive" });
        } else {
            toast({ title: "Sucesso!", description: data.message });
            fetchData('members');
            onAction();
        }
        setLoading(false);
        setIsExpelDialogOpen(false);
        setExpelReason('');
    };

    const handleToggleAffiliationMode = async (checked) => {
        const newMode = checked ? 'manual' : 'automatic';
        setLoading(true);
        const {data, error} = await supabase.rpc('toggle_party_affiliation_mode', { p_party_id: party.id, p_mode: newMode });
        if(error || !data.success) {
            toast({ title: 'Erro', description: error?.message || data.message, variant: 'destructive' });
        } else {
            setAffiliationMode(newMode);
            toast({ title: 'Sucesso!', description: data.message });
            onAction();
        }
        setLoading(false);
    }
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant={isFromDetailsPage ? "default" : "secondary"} size={isFromDetailsPage ? "default" : "sm"}>
                    <Settings className="mr-2 h-4 w-4" />Gerenciar
                </Button>
            </DialogTrigger>
            <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Gerenciar {party.name}</DialogTitle></DialogHeader>
                <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="edit">Editar</TabsTrigger>
                        <TabsTrigger value="members">Membros</TabsTrigger>
                        <TabsTrigger value="requests">Pedidos</TabsTrigger>
                        <TabsTrigger value="settings">Ajustes</TabsTrigger>
                    </TabsList>
                    <TabsContent value="edit" className="pt-4">
                        <EditPartyForm party={party} onAction={onAction} closeDialog={() => setIsOpen(false)} userRole={userRole} members={members} />
                    </TabsContent>
                     <TabsContent value="members" className="pt-4">
                        <h3 className="font-semibold mb-2">Membros do Partido</h3>
                        {loading ? <Loader2 className="animate-spin mx-auto" /> : (
                            <div className="space-y-2 max-h-80 overflow-y-auto">
                                {members.length > 0 ? members.map(m => {
                                    const memberRoleLevel = roleHierarchy[m.role] || 0;
                                    const userRoleLevel = roleHierarchy[userRole] || 0;
                                    const canExpel = canManageMembers && userRoleLevel > memberRoleLevel;

                                    return (
                                        <Card key={m.user_id} className="bg-background/50 flex items-center justify-between p-3">
                                            <div className="flex items-center gap-3">
                                                <Avatar><AvatarImage src={m.profile.avatar_url} alt={m.profile.full_name} /><AvatarFallback>{m.profile.full_name.charAt(0)}</AvatarFallback></Avatar>
                                                <div>
                                                    <p className="font-medium">{m.profile.full_name}</p>
                                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Badge variant="secondary" className="flex items-center gap-1"><Building size={12}/>{getMemberPartyRole({user_id: m.user_id})}</Badge>
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
                                                <Button size="icon" className="h-8 w-8 bg-green-500 hover:bg-green-600" onClick={() => handleRespondToRequest(req.id, true)}><Check size={16} /></Button>
                                                <Button size="icon" className="h-8 w-8 bg-red-500 hover:bg-red-600" onClick={() => handleRespondToRequest(req.id, false)}><X size={16} /></Button>
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
                           <Switch id="affiliation-mode" checked={affiliationMode === 'manual'} onCheckedChange={handleToggleAffiliationMode} disabled={loading} />
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
                      <Button variant="destructive" onClick={handleExpelMember} disabled={loading || !expelReason}>
                        {loading ? <Loader2 className="animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
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