import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, PlusCircle, LogIn, LogOut, Shield, Info, Building, User, Trash2, GitBranchPlus, Settings, Ban } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ImageUploader from '@/components/ImageUploader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const politicalOrientations = ['Extrema Esquerda', 'Esquerda', 'Centro-Esquerda', 'Centro', 'Centro-Direita', 'Direita', 'Extrema-Direita'];

const CreatePartyDialog = ({ onPartyCreated }) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '' });
    const [logoUrl, setLogoUrl] = useState('');
    const [logoFile, setLogoFile] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!formData.name || !formData.acronym || !formData.ideology || !formData.statute || !formData.description || !formData.orientation || (!logoFile && !logoUrl)) {
            toast({ title: 'Erro de Validação', description: 'Todos os campos, incluindo o logo, são obrigatórios.', variant: 'destructive' });
            return;
        }
        
        setLoading(true);
        let finalLogoUrl = logoUrl;
        if (logoFile) {
            const { data: uploadData, error: uploadError } = await supabase.storage.from('public-assets').upload(`party-logos/${Date.now()}-${logoFile.name}`, logoFile);
            if (uploadError) {
                toast({ title: "Erro no Upload", description: uploadError.message, variant: "destructive" });
                setLoading(false); return;
            }
            finalLogoUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;
        }

        const { data, error } = await supabase.rpc('create_political_party', {
            p_name: formData.name, p_acronym: formData.acronym, p_ideology: formData.ideology, p_logo_url: finalLogoUrl,
            p_statute: formData.statute, p_description: formData.description, p_orientation: formData.orientation
        });

        if (error || !data.success) {
            toast({ title: 'Erro ao criar partido', description: error?.message || data?.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: 'Partido criado com sucesso.' });
            onPartyCreated(); setIsOpen(false);
            setFormData({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '' });
            setLogoUrl(''); setLogoFile(null);
        }
        setLoading(false);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Criar Partido</Button></DialogTrigger>
            <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Fundar um Novo Partido Político</DialogTitle><DialogDescription>Preencha os dados para registrar seu partido na nação.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2"><Label htmlFor="name">Nome do Partido</Label><Input id="name" value={formData.name} onChange={(e) => setFormData(p=>({...p, name: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="acronym">Sigla</Label><Input id="acronym" value={formData.acronym} onChange={(e) => setFormData(p=>({...p, acronym: e.target.value}))} required maxLength="5" /></div>
                    <div className="grid gap-2"><Label htmlFor="orientation">Orientação Política</Label><Select onValueChange={(v) => setFormData(p => ({...p, orientation: v}))} value={formData.orientation} required><SelectTrigger><SelectValue placeholder="Selecione a orientação" /></SelectTrigger><SelectContent>{politicalOrientations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="description">Descrição Curta</Label><Input id="description" value={formData.description} onChange={(e) => setFormData(p=>({...p, description: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="ideology">Ideologia</Label><Textarea id="ideology" value={formData.ideology} onChange={(e) => setFormData(p=>({...p, ideology: e.target.value}))} placeholder="Descreva os princípios do seu partido..." required /></div>
                    <div className="grid gap-2"><Label htmlFor="statute">Estatuto do Partido</Label><Textarea id="statute" value={formData.statute} onChange={(e) => setFormData(p=>({...p, statute: e.target.value}))} rows={5} placeholder="Cole aqui as regras internas do partido." required /></div>
                    <ImageUploader onUrlChange={setLogoUrl} onFileChange={setLogoFile} initialUrl={logoUrl} label="Logo do Partido" required />
                    <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fundar Partido</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const PartyManagementDialog = ({ party, onAction }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [currentTab, setCurrentTab] = useState('members');
    const [affiliationMode, setAffiliationMode] = useState(party.affiliation_mode);

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
            <DialogTrigger asChild><Button variant="secondary" size="sm"><Settings className="mr-2 h-4 w-4" />Gerenciar</Button></DialogTrigger>
            <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Gerenciar {party.name}</DialogTitle></DialogHeader>
                <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="members">Pedidos de Filiação</TabsTrigger><TabsTrigger value="settings">Configurações</TabsTrigger></TabsList>
                    <TabsContent value="members">
                        <p>WIP</p>
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
            </DialogContent>
        </Dialog>
    );
}

const PartyDetailsDialog = ({ party }) => (
    <Dialog><DialogTrigger asChild><Button variant="outline" size="sm"><Info className="mr-2 h-4 w-4" />Detalhes</Button></DialogTrigger>
        <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <div className="flex items-center gap-4 mb-4">
                    <img src={party.logo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${party.acronym}`} alt={party.name} className="w-20 h-20 rounded-lg bg-secondary p-1 object-cover" />
                    <div>
                        <DialogTitle className="text-2xl">{party.name} ({party.acronym})</DialogTitle>
                        <DialogDescription>{party.description}</DialogDescription>
                        <p className="text-sm font-semibold text-primary mt-1">{party.orientation}</p>
                    </div>
                </div>
            </DialogHeader>
            <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="info">Informações</TabsTrigger><TabsTrigger value="members">Membros</TabsTrigger></TabsList>
                <TabsContent value="info" className="mt-4 space-y-4">
                    <div><h4 className="font-semibold">Fundador</h4><p className="text-muted-foreground">{party.founder?.full_name || 'Não definido'}</p></div>
                    <div><h4 className="font-semibold">Presidente</h4><p className="text-muted-foreground">{party.president?.full_name || 'Não definido'}</p></div>
                    <div><h4 className="font-semibold">Ideologia</h4><p className="text-muted-foreground whitespace-pre-wrap text-sm">{party.ideology || 'Não informada'}</p></div>
                    <div><h4 className="font-semibold">Estatuto do Partido</h4><p className="text-muted-foreground whitespace-pre-wrap text-sm max-h-40 overflow-y-auto">{party.statute || 'Não informado'}</p></div>
                </TabsContent>
                <TabsContent value="members" className="mt-4"><div className="space-y-2 max-h-60 overflow-y-auto">{(party.members || []).map(member => (<div key={member.user_id} className="flex items-center justify-between p-2 rounded bg-black/20"><span>{member.profiles.full_name}</span><span className="text-sm text-muted-foreground">{member.role}</span></div>))}</div></TabsContent>
            </Tabs>
        </DialogContent>
    </Dialog>
);

const PoliticalParties = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [parties, setParties] = useState([]);
    const [pendingRequest, setPendingRequest] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [userAffiliation, setUserAffiliation] = useState(null);
    const [showDisaffiliateConfirm, setShowDisaffiliateConfirm] = useState(false);
    const [newFounderId, setNewFounderId] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('political_parties').select(`
            *, 
            members:party_members(user_id, role, profiles(id, full_name)), 
            founder:profiles!political_parties_founder_id_fkey(full_name), 
            president:profiles!political_parties_president_id_fkey(full_name)
        `);
        if (error) { toast({ title: "Erro ao buscar partidos", description: error.message, variant: "destructive" }); }
        else { setParties(data || []); }

        if (user?.id) {
            const { data: memberData } = await supabase.from('party_members').select('*, party:political_parties(*, members:party_members(*, profiles(*)))').eq('user_id', user.id).maybeSingle();
            setUserAffiliation(memberData);

            if (!memberData) {
              const {data: requestData} = await supabase.from('party_affiliation_requests').select('*').eq('user_id', user.id).eq('status', 'pending').maybeSingle();
              setPendingRequest(requestData);
            } else {
              setPendingRequest(null);
            }
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleAffiliate = async (partyId) => {
        setActionLoading(partyId);
        const { data, error } = await supabase.rpc('request_party_affiliation', { p_party_id: partyId });
        if(error || !data.success) {
            toast({ title: 'Erro', description: error?.message || data.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            fetchData();
        }
        setActionLoading(null);
    }
    
    const handleDisaffiliate = async () => {
        if (!userAffiliation) return;
        
        if (userAffiliation.role === 'Fundador' && userAffiliation.party?.members?.length > 1 && !newFounderId) {
             toast({ title: 'Ação necessária', description: 'Como fundador, você deve indicar um sucessor antes de sair.', variant: 'destructive' });
             return;
        }

        setActionLoading('disaffiliate');
        const { data, error } = await supabase.rpc('disaffiliate_from_party', { 
            p_party_id: userAffiliation.party_id, 
            p_new_founder_id: newFounderId || null 
        });

        if(error || !data.success) {
            toast({ title: 'Erro', description: error?.message || data.message, variant: 'destructive' });
        } else { 
            toast({ title: 'Sucesso!', description: data.message }); 
            fetchData(); 
            setShowDisaffiliateConfirm(false); 
            setNewFounderId(''); 
        }
        setActionLoading(null);
    };

    const handleCancelRequest = async () => {
        if(!pendingRequest) return;
        setActionLoading(pendingRequest.party_id);
        const {data, error} = await supabase.rpc('cancel_affiliation_request', { p_request_id: pendingRequest.id });
        if(error || !data.success) {
            toast({ title: 'Erro', description: error?.message || data.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            fetchData();
        }
        setActionLoading(null);
    }

    if (loading) return <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div>;

    const renderAffiliationButton = (party) => {
      const isLoading = actionLoading === party.id;
      if (userAffiliation?.party_id === party.id) {
          return <Button variant="destructive" className="w-full" onClick={() => setShowDisaffiliateConfirm(true)} disabled={actionLoading}><LogOut className="mr-2 h-4 w-4" /> Desfiliar-se</Button>;
      }
      if (pendingRequest?.party_id === party.id) {
          return <Button variant="secondary" className="w-full" onClick={handleCancelRequest} disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <><Ban className="mr-2 h-4 w-4" /> Cancelar Pedido</>}</Button>;
      }

      const affiliateAction = () => handleAffiliate(party.id);

      if (userAffiliation && userAffiliation.party_id !== party.id) {
        return (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" disabled={isLoading}>{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogIn className="mr-2 h-4 w-4" />} Filiar-se</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>Trocar de partido?</AlertDialogTitle><AlertDialogDescription>Você já é membro de "{userAffiliation.party.name}". Ao se filiar a "{party.name}", você será automaticamente desfiliado do seu partido atual. Deseja continuar?</AlertDialogDescription></AlertDialogHeader>
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
                 <PageHeader icon={Building} title="Partidos" gradientText="Políticos" description="Organize-se, defenda suas ideias e concorra ao poder." iconColor="text-rose-400" />
                <div className="text-right mb-8"><CreatePartyDialog onPartyCreated={fetchData} /></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {parties.map(party => (
                        <motion.div key={party.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                            <Card className="glass-effect flex flex-col h-full">
                                <CardHeader>
                                    <div className="flex items-center gap-4">
                                        <img src={party.logo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${party.acronym}`} alt={party.name} className="w-16 h-16 rounded-lg bg-secondary p-1 object-cover" />
                                        <div>
                                            <CardTitle className="text-foreground">{party.name} ({party.acronym})</CardTitle>
                                            <CardDescription className="text-muted-foreground">{party.description}</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex-grow space-y-1">
                                    <p className="text-sm text-muted-foreground">Presidente: {party.president?.full_name || 'Não definido'}</p>
                                    <p className="text-sm text-muted-foreground">Membros: {party.members?.length || 0}</p>
                                    <p className="text-sm text-muted-foreground">Filiação: <span className="font-semibold">{party.affiliation_mode === 'automatic' ? 'Automática' : 'Manual'}</span></p>
                                </CardContent>
                                <CardFooter className="flex flex-col sm:flex-row gap-2">
                                    <div className="flex-grow flex gap-2">
                                        {renderAffiliationButton(party)}
                                        <PartyDetailsDialog party={party} />
                                    </div>
                                    {(user?.id === party.founder_id) && <PartyManagementDialog party={party} onAction={fetchData} />}
                                </CardFooter>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            </div>
            <Dialog open={showDisaffiliateConfirm} onOpenChange={setShowDisaffiliateConfirm}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Confirmar Desfiliação</DialogTitle><DialogDescription>Tem certeza que deseja sair do partido?</DialogDescription></DialogHeader>
                    {userAffiliation?.role === 'Fundador' && userAffiliation?.party?.members?.length > 1 && (
                        <div className="py-4 space-y-2">
                           <Label>Você é o fundador. Transfira a posse para outro membro antes de sair.</Label>
                           <Select onValueChange={setNewFounderId}><SelectTrigger><SelectValue placeholder="Selecione um novo fundador..." /></SelectTrigger><SelectContent>{userAffiliation.party.members.filter(m => m.user_id !== user.id).map(m => <SelectItem key={m.user_id} value={m.user_id}>{m.profiles.full_name}</SelectItem>)}</SelectContent></Select>
                        </div>
                    )}
                    <DialogFooter><Button variant="ghost" onClick={() => setShowDisaffiliateConfirm(false)}>Cancelar</Button><Button variant="destructive" onClick={handleDisaffiliate} disabled={!!actionLoading}>{actionLoading ? <Loader2 className="animate-spin"/> : "Confirmar Saída"}</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default PoliticalParties;