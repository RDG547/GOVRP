import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Loader2, Landmark, Users, Activity, Briefcase, FileSignature, Edit, Plus, Save, Trash2, Megaphone, TrendingUp, TrendingDown, CreditCard, School as University, PiggyBank, HeartHandshake as Handshake, BrainCircuit, HeartPulse, Shield, Anchor, BookOpen, Microscope, Recycle, TramFront as Tram, Globe, Palette, Cpu, Building, Coins, Percent, Wifi, Smartphone, Droplet, Flame, Zap, Package, Package2, PackageCheck, UserPlus, FilePlus, UserX, LogOut, AlertTriangle, Clock3, LayoutDashboard, Settings, Ban, CircleSlash, Power, PowerOff, Lock, ChevronLeft, FileText, Store, Gavel, DollarSign, Wrench, Banknote, Scale, HardHat, Leaf, Car, Contact, FileCheck, Receipt, Building2 } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import { BANK_POLICY_SETTINGS_KEY, DEFAULT_BANK_POLICY } from '@/components/bank/BankManagementPanel';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
    getGovernmentBudgetTotal,
    haveGovernmentBudgetAreasChanged,
    rebalanceGovernmentBudgetAreas,
} from '@/lib/governmentBudget';
import {
    annualPercentToMonthlyPercent,
    buildInvestmentAnnualRate,
    DEFAULT_ECONOMIC_POLICY,
    ECONOMIC_POLICY_SETTINGS_KEY,
    getEconomicPressureLabel,
    normalizeBankPolicyForEconomicPolicy,
    normalizeEconomicPolicy,
} from '@/lib/economicPolicy';
import { publishOfficialGazetteEntry } from '@/lib/officialGazette';
import GovernmentDynamicsPanel from '@/components/government/GovernmentDynamicsPanel';
import {
    EXECUTIVE_SPECIAL_OFFICES,
    appointExecutiveSpecialOffice,
    createExecutiveProvisionalMeasure,
    dismissExecutiveSpecialOffice,
    fetchExecutiveConstitutionalState,
    reviewPresidentialBill,
} from '@/lib/executiveGovernance';
import { fetchWithSessionAuth } from '@/lib/apiAuth';
import { applyPolicy } from '@/lib/economy/api';
import UserSelectOption from '@/components/UserSelectOption';
import { fetchActiveMinistersWithProfiles } from '@/lib/ministers';

const MINISTRY_INFO = {
    'Ministério da Justiça': { icon: Shield, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
    'Ministério da Defesa': { icon: Anchor, color: 'text-gray-400', bgColor: 'bg-gray-500/20' },
    'Ministério da Economia': { icon: Landmark, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
    'Ministério da Saúde': { icon: HeartPulse, color: 'text-red-400', bgColor: 'bg-red-500/20' },
    'Ministério da Educação': { icon: BookOpen, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
    'Ministério da Infraestrutura': { icon: Tram, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
    'Ministério do Meio Ambiente': { icon: Recycle, color: 'text-green-400', bgColor: 'bg-green-500/20' },
    'Ministério de Relações Exteriores': { icon: Globe, color: 'text-indigo-400', bgColor: 'bg-indigo-500/20' },
    'Ministério da Cultura': { icon: Palette, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
    'Ministério de Pesquisa': { icon: Microscope, color: 'text-pink-400', bgColor: 'bg-pink-500/20' },
    'Ministério da Tecnologia': { icon: Cpu, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
};

const MinisterManager = ({ ministers, ministries, onUpdate }) => {
    const { toast } = useToast();
    const [allUsers, setAllUsers] = useState([]);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState('');
    const [selectedMinistry, setSelectedMinistry] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [changingMinistry, setChangingMinistry] = useState(null);

    const allMinistries = ministries?.length
        ? ministries.filter((ministry) => ministry.is_active).map((ministry) => ministry.name)
        : Object.keys(MINISTRY_INFO);

    const availableMinistries = allMinistries.filter(
        (ministry) => !ministers.some((minister) => minister.ministry === ministry)
    );


    useEffect(() => {
        const fetchUsers = async () => {
            const { data, error } = await supabase.from('profiles').select('id, full_name, username, avatar_url, role').eq('role', 'Cidadão');
            if (error) {
                toast({ title: 'Erro ao buscar cidadãos', variant: 'destructive' });
            } else {
                setAllUsers(data);
            }
        };
        fetchUsers();
    }, [toast]);

    const openAppointDialog = (ministry) => {
        setSelectedMinistry(ministry || '');
        setSelectedUser('');
        setChangingMinistry(null);
        setIsDialogOpen(true);
    };

    const openChangeDialog = (minister) => {
        setChangingMinistry(minister);
        setSelectedMinistry(minister.ministry);
        setSelectedUser('');
        setIsDialogOpen(true);
    };

    const handleAppoint = async () => {
        setIsSaving(true);

        if (changingMinistry) {
            const { data: dismissData, error: dismissError } = await supabase.rpc('dismiss_minister', { p_user_id: changingMinistry.user_id });
            if (dismissError || !dismissData.success) {
                toast({ title: 'Erro ao exonerar ministro anterior', description: dismissData?.message || dismissError.message, variant: 'destructive' });
                setIsSaving(false);
                return;
            }
        }

        const { data, error } = await supabase.rpc('appoint_minister', { p_user_id: selectedUser, p_ministry: selectedMinistry });
        if (error || !data.success) {
            toast({ title: 'Erro ao nomear ministro', description: data?.message || error.message, variant: 'destructive' });
        } else {
            const selectedProfile = allUsers.find((profile) => profile.id === selectedUser);

            try {
                await publishOfficialGazetteEntry(supabase, {
                    title: `${changingMinistry ? 'Alteração' : 'Nomeação'} ministerial: ${selectedProfile?.full_name || 'Ministro'}`,
                    summary: `${selectedProfile?.full_name || 'O cidadão selecionado'} foi nomeado para ${selectedMinistry}.`,
                    content: `${selectedProfile?.full_name || 'O cidadão selecionado'} assumiu oficialmente o cargo de ${selectedMinistry}.`,
                    type: 'Nomeação e Exoneração',
                });
            } catch (gazetteError) {
                console.error('Erro ao publicar nomeação no Diário Oficial:', gazetteError);
            }

            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
            setIsDialogOpen(false);
            setChangingMinistry(null);
        }
        setIsSaving(false);
    };

    const handleDismiss = async (minister) => {
        const { data, error } = await supabase.rpc('dismiss_minister', { p_user_id: minister.user_id });
        if (error || !data.success) {
            toast({ title: 'Erro ao exonerar ministro', description: data?.message || error.message, variant: 'destructive' });
        } else {
            try {
                await publishOfficialGazetteEntry(supabase, {
                    title: `Exoneração ministerial: ${minister.profile.full_name}`,
                    summary: `${minister.profile.full_name} deixou o cargo de ${minister.ministry}.`,
                    content: `${minister.profile.full_name} foi exonerado do cargo de ${minister.ministry}.`,
                    type: 'Nomeação e Exoneração',
                });
            } catch (gazetteError) {
                console.error('Erro ao publicar exoneração no Diário Oficial:', gazetteError);
            }

            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-semibold flex items-center gap-2"><Briefcase className="w-5 h-5 text-primary" /> Gabinete de Ministros</h3>
                    <p className="text-sm text-muted-foreground mt-1">Nomeie e exonere os ministros do seu governo.</p>
                </div>
                <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) setChangingMinistry(null); }}>
                    <DialogTrigger asChild>
                        <Button onClick={() => openAppointDialog('')}><UserPlus className="w-4 h-4 mr-2" /> Nomear Ministro</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{changingMinistry ? 'Alterar Ministro' : 'Nomear Novo Ministro'}</DialogTitle>
                            {changingMinistry && <DialogDescription>Substituindo: {changingMinistry.profile.full_name} — {changingMinistry.ministry}</DialogDescription>}
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="user">Cidadão</Label>
                                <Select value={selectedUser} onValueChange={setSelectedUser}>
                                    <SelectTrigger><SelectValue placeholder="Selecione um cidadão" /></SelectTrigger>
                                    <SelectContent>
                                        <ScrollArea className="h-72">
                                          {allUsers.map((currentUser) => (
                                              <SelectItem key={currentUser.id} value={currentUser.id}>
                                                  <UserSelectOption user={currentUser} detail={currentUser.username ? `@${currentUser.username}` : ''} />
                                              </SelectItem>
                                          ))}
                                        </ScrollArea>
                                    </SelectContent>
                                </Select>
                            </div>
                            {!changingMinistry && (
                                <div className="grid gap-2">
                                    <Label htmlFor="ministry">Ministério</Label>
                                    <Select value={selectedMinistry} onValueChange={setSelectedMinistry}>
                                        <SelectTrigger><SelectValue placeholder="Selecione um ministério" /></SelectTrigger>
                                        <SelectContent>
                                            <ScrollArea className="h-72">
                                              {availableMinistries.map(min => <SelectItem key={min} value={min}>{min}</SelectItem>)}
                                            </ScrollArea>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button onClick={handleAppoint} disabled={isSaving || !selectedUser || !selectedMinistry}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {changingMinistry ? 'Alterar' : 'Nomear'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allMinistries.map(ministry => {
                    const info = MINISTRY_INFO[ministry] || { icon: Building2, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' };
                    const MinIcon = info.icon;
                    const minister = ministers.find(m => m.ministry === ministry);
                    return (
                        <Card key={ministry} className={`glass-effect transition-colors ${minister ? 'border-primary/30' : 'border-dashed border-muted-foreground/30'}`}>
                            <CardHeader className="pb-3">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-lg ${info.bgColor}`}>
                                        <MinIcon className={`w-5 h-5 ${info.color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <CardTitle className="text-sm font-semibold truncate">{ministry.replace('Ministério ', 'Min. ')}</CardTitle>
                                        {minister ? (
                                            <CardDescription className="truncate">{minister.profile.full_name} · reputação {Number(minister.reputation_score ?? 50).toFixed(0)}%</CardDescription>
                                        ) : (
                                            <CardDescription className="text-muted-foreground/50 italic">Vago</CardDescription>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardFooter className="pt-0 gap-2">
                                {minister ? (
                                    <>
                                        <Button variant="outline" size="sm" className="flex-1" onClick={() => openChangeDialog(minister)}>
                                            <Edit className="mr-1 h-3 w-3" /> Alterar
                                        </Button>
                                        <Button variant="destructive" size="sm" className="flex-1" onClick={() => handleDismiss(minister)}>
                                            <UserX className="mr-1 h-3 w-3" /> Exonerar
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" className="w-full" onClick={() => openAppointDialog(ministry)}>
                                        <UserPlus className="mr-1 h-3 w-3" /> Nomear
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

const DecreeManager = ({ decrees, onUpdate }) => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingDecree, setEditingDecree] = useState(null);
    const [formData, setFormData] = useState({ title: '', content: '' });
    const [isSaving, setIsSaving] = useState(false);

    const openNewDialog = () => {
        setEditingDecree(null);
        setFormData({ title: '', content: '' });
        setIsDialogOpen(true);
    };

    const openEditDialog = (decree) => {
        setEditingDecree(decree);
        setFormData({ title: decree.title, content: decree.content });
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        setIsSaving(true);
        let error;
        if (editingDecree) {
            ({ error } = await supabase.from('decrees').update({ ...formData }).eq('id', editingDecree.id));
        } else {
            ({ error } = await supabase.from('decrees').insert({ ...formData, author_id: user.id, is_published: false }));
        }

        if (error) {
            toast({ title: 'Erro ao salvar decreto', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Decreto salvo com sucesso!' });
            onUpdate();
            setIsDialogOpen(false);
        }
        setIsSaving(false);
    };

    const handleDelete = async (decreeId) => {
        const { error } = await supabase.from('decrees').delete().eq('id', decreeId);
        if (error) {
            toast({ title: 'Erro ao excluir decreto', variant: 'destructive' });
        } else {
            toast({ title: 'Decreto excluído com sucesso!' });
            onUpdate();
        }
    };

    const handlePublish = async (decreeId, isPublished) => {
        const { error } = await supabase
            .from('decrees')
            .update({ is_published: !isPublished })
            .eq('id', decreeId);
         if (error) {
            toast({ title: 'Erro ao publicar', variant: 'destructive' });
        } else {
            toast({ title: `Decreto ${!isPublished ? 'publicado' : 'despublicado'}!` });
            onUpdate();
        }
    };


    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><FileSignature className="w-6 h-6 text-primary" />Decretos</CardTitle>
                <CardDescription>Crie, edite e publique decretos presidenciais.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-4">
                 {decrees.length > 0 ? decrees.map(decree => (
                    <div key={decree.id} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                        <div>
                            <p className="font-semibold">{decree.title}</p>
                            <p className={`text-sm ${decree.is_published ? 'text-green-400' : 'text-yellow-400'}`}>{decree.is_published ? 'Publicado' : 'Rascunho'}</p>
                        </div>
                        <div className="flex gap-1">
                            <Button variant="outline" size="sm" onClick={() => openEditDialog(decree)}><Edit className="w-4 h-4 mr-2"/>Editar</Button>
                            <Button variant="outline" size="sm" onClick={() => handlePublish(decree.id, decree.is_published)}><Megaphone className="w-4 h-4 mr-2"/>Publicar</Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDelete(decree.id)}><Trash2 className="w-4 h-4 mr-2"/>Excluir</Button>
                        </div>
                    </div>
                )) : <p className="text-center text-muted-foreground py-4">Nenhum decreto criado.</p>}
            </CardContent>
            <CardFooter>
                <Button onClick={openNewDialog} className="w-full"><FilePlus className="mr-2 h-4 w-4" /> Novo Decreto</Button>
            </CardFooter>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingDecree ? 'Editar Decreto' : 'Novo Decreto'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Título</Label>
                            <Input id="title" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="content">Conteúdo</Label>
                            <Textarea id="content" value={formData.content} onChange={(e) => setFormData({...formData, content: e.target.value})} rows={10}/>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button onClick={handleSave} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const BudgetManager = ({ budget, treasuryBalance, onUpdate, setActiveTab }) => {
    const { toast } = useToast();
    const [areas, setAreas] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [editingArea, setEditingArea] = useState(null);
    const [tempValue, setTempValue] = useState(0);
    const [inputValue, setInputValue] = useState("R$ 0,00");
    const safeTreasuryBalance = Math.max(0, Math.floor(Number(treasuryBalance) || 0));

    const areaIcons = {
        'Saúde': { icon: HeartPulse, color: 'text-red-400' },
        'Segurança': { icon: Shield, color: 'text-blue-400' },
        'Defesa': { icon: Anchor, color: 'text-gray-400' },
        'Educação': { icon: BookOpen, color: 'text-yellow-400' },
        'Tecnologia': { icon: Cpu, color: 'text-cyan-400' },
        'Meio Ambiente': { icon: Recycle, color: 'text-green-400' },
        'Infraestrutura': { icon: Tram, color: 'text-orange-400' },
        'Cultura': { icon: Palette, color: 'text-purple-400' },
        'Relações Exteriores': { icon: Globe, color: 'text-indigo-400' },
        'Economia': { icon: Landmark, color: 'text-emerald-400' },
        'Pesquisa': { icon: Microscope, color: 'text-pink-400' },
        'default': { icon: Building, color: 'text-gray-500'}
    };

    useEffect(() => {
        if (budget && budget.areas) {
            const adjustedAreas = rebalanceGovernmentBudgetAreas(budget.areas, safeTreasuryBalance);
            setAreas(adjustedAreas);

            if (haveGovernmentBudgetAreasChanged(budget.areas, adjustedAreas)) {
                const saveAdjusted = async () => {
                    await supabase
                        .from('system_settings')
                        .update({ value: { ...budget, areas: adjustedAreas } })
                        .eq('key', 'government_budget');
                };

                saveAdjusted();
            }
        }
    }, [budget, safeTreasuryBalance]);

    useEffect(() => {
        setInputValue(formatCurrency(tempValue, true));
    }, [tempValue]);

    const totalAllocated = getGovernmentBudgetTotal(areas);
    const availableToAllocate = Math.max(
        0,
        safeTreasuryBalance - (totalAllocated - (editingArea?.allocated_value || 0))
    );

    const handleEditArea = (area) => {
        setEditingArea(area);
        const value = area.allocated_value || 0;
        setTempValue(value);
        setInputValue(formatCurrency(value, true));
    };

    const handleUpdateAreaValue = () => {
        const maxAllowed = Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0));
        let finalValue = Math.max(0, tempValue);

        if (tempValue > maxAllowed) {
            finalValue = maxAllowed;
            toast({ title: "Valor excede o saldo!", description: `O valor foi ajustado para o máximo disponível: ${formatCurrency(maxAllowed)}.`, variant: "destructive" });
        }

        const newAreas = areas.map(area =>
            area.name === editingArea.name ? { ...area, allocated_value: finalValue } : area
        );
        setAreas(newAreas);
        setEditingArea(null);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const currentTotalAllocated = getGovernmentBudgetTotal(areas);

        if (currentTotalAllocated > safeTreasuryBalance) {
            toast({ title: 'Orçamento Inválido', description: 'O valor alocado excede o saldo do cofre público.', variant: 'destructive' });
            setIsSaving(false);
            return;
        }

        const newBudgetData = { areas };
        const { error } = await supabase
            .from('system_settings')
            .update({ value: newBudgetData })
            .eq('key', 'government_budget');

        if (error) {
            toast({ title: 'Erro ao salvar orçamento', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Orçamento salvo com sucesso!' });
            onUpdate();
            if(setActiveTab) setActiveTab('finances');
        }
        setIsSaving(false);
    };

    const handleInputChange = (e) => {
        const rawValue = e.target.value;
        setInputValue(rawValue);
        const parsedValue = parseCurrency(rawValue);
        if (!isNaN(parsedValue)) {
            setTempValue(parsedValue);
        }
    };

    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><PiggyBank className="w-6 h-6 text-primary" />Orçamento Governamental</CardTitle>
                <CardDescription>Distribua os recursos do cofre público. Disponível: <span className="text-green-400 font-bold">{formatCurrency(Math.max(0, safeTreasuryBalance - totalAllocated))}</span></CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-4 overflow-y-auto max-h-[500px] pr-4 custom-scrollbar">
                {areas.map((area) => {
                    const AreaIcon = areaIcons[area.name]?.icon || areaIcons.default.icon;
                    const iconColor = areaIcons[area.name]?.color || areaIcons.default.color;
                    return (
                        <div key={area.name} className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <AreaIcon className={`w-5 h-5 ${iconColor}`} />
                                <div>
                                    <p className="font-semibold">{area.name}</p>
                                    <p className="text-sm text-muted-foreground">{formatCurrency(area.allocated_value)}</p>
                                </div>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => handleEditArea(area)}>Gerenciar</Button>
                        </div>
                    )
                })}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-4 pt-6">
                <div className="text-center text-sm font-bold">
                    <p>Total Alocado: {formatCurrency(totalAllocated)}</p>
                    <p className="text-xs text-muted-foreground">Disponível no Cofre: {formatCurrency(safeTreasuryBalance)}</p>
                    <Progress value={safeTreasuryBalance > 0 ? (totalAllocated / safeTreasuryBalance) * 100 : 0} className="mt-2 h-2"/>
                </div>
                <Button onClick={handleSave} disabled={isSaving}>
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Orçamento'}
                </Button>
            </CardFooter>

             <Dialog open={!!editingArea} onOpenChange={() => setEditingArea(null)}>
                <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>Gerenciar Orçamento: {editingArea?.name}</DialogTitle>
                        <DialogDescription>
                            Defina o valor para esta área. Disponível para alocação: {formatCurrency(availableToAllocate)}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4" >
                        <div>
                            <Label htmlFor="exact-value">Valor Exato</Label>
                            <Input
                                id="exact-value"
                                value={inputValue}
                                onChange={handleInputChange}
                            />
                        </div>
                        <div>
                             <Label>Alocação Visual ({(((Math.max(0, tempValue) || 0) / (Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0)) || 1)) * 100).toFixed(2)}%)</Label>
                             <div onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
                               <Slider
                                  value={[Math.max(0, tempValue)]}
                                  onValueChange={(val) => setTempValue(Math.max(0, val[0]))}
                                  max={Math.max(0, availableToAllocate + (editingArea?.allocated_value || 0))}
                                  step={1000}
                               />
                             </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingArea(null)}>Cancelar</Button>
                        <Button onClick={handleUpdateAreaValue}>Confirmar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const TaxManager = ({ taxes, onUpdate, setActiveTab }) => {
    const { toast } = useToast();
    const [taxRates, setTaxRates] = useState({});
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (taxes) {
            setTaxRates({
                product_tax: (taxes.product_tax || 0) * 100,
                service_tax: (taxes.service_tax || 0) * 100,
                transaction_tax_value: taxes.transaction_tax?.value ?
                    (taxes.transaction_tax.type === 'percentage' ? taxes.transaction_tax.value * 100 : taxes.transaction_tax.value)
                    : 0,
                transaction_tax_type: taxes.transaction_tax?.type || 'percentage',
            });
        }
    }, [taxes]);

    const handleSave = async () => {
        setIsSaving(true);
        const newTaxData = {
            product_tax: taxRates.product_tax / 100,
            service_tax: taxRates.service_tax / 100,
            transaction_tax: {
                type: taxRates.transaction_tax_type,
                value: taxRates.transaction_tax_type === 'percentage' ? taxRates.transaction_tax_value / 100 : taxRates.transaction_tax_value
            }
        };

        const { error } = await supabase.from('system_settings').update({ value: newTaxData }).eq('key', 'tax_rates');

        if (error) {
            toast({ title: 'Erro ao salvar impostos', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Impostos salvos com sucesso!' });
            onUpdate();
            setActiveTab('finances');
        }
        setIsSaving(false);
    };

    const handleTaxValueChange = (taxName, value) => {
        const numericValue = parseFloat(value);
        if (!isNaN(numericValue)) {
            setTaxRates(prev => ({ ...prev, [taxName]: numericValue }));
        } else if (value === '') {
            setTaxRates(prev => ({ ...prev, [taxName]: 0 }));
        }
    };

    return (
        <Card className="glass-effect h-full flex flex-col">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="w-6 h-6 text-primary" />Gestão de Impostos</CardTitle>
                <CardDescription>Ajuste as alíquotas de impostos do país.</CardDescription>
            </CardHeader>
            <CardContent className="flex-grow space-y-6">
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label>Imposto sobre Produtos (IVC)</Label>
                        <div className="flex items-center gap-1 w-24">
                           <Input type="number" value={taxRates.product_tax?.toFixed(2)} onChange={e => handleTaxValueChange('product_tax', e.target.value)} className="h-8 text-right"/>
                           <Percent className="h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                    <Slider value={[taxRates.product_tax || 0]} onValueChange={(val) => setTaxRates(p => ({...p, product_tax: val[0]}))} max={100} step={0.01} />
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label>Imposto sobre Serviços (ISS)</Label>
                         <div className="flex items-center gap-1 w-24">
                           <Input type="number" value={taxRates.service_tax?.toFixed(2)} onChange={e => handleTaxValueChange('service_tax', e.target.value)} className="h-8 text-right"/>
                           <Percent className="h-4 w-4 text-muted-foreground" />
                        </div>
                    </div>
                    <Slider value={[taxRates.service_tax || 0]} onValueChange={(val) => setTaxRates(p => ({...p, service_tax: val[0]}))} max={100} step={0.01} />
                </div>
                 <div className="space-y-4">
                    <Label>Imposto sobre Transações Financeiras (ITF)</Label>
                    <Select value={taxRates.transaction_tax_type} onValueChange={(val) => setTaxRates(p => ({...p, transaction_tax_type: val}))}>
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="percentage">Porcentagem (%)</SelectItem>
                            <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                        </SelectContent>
                    </Select>
                     {taxRates.transaction_tax_type === 'percentage' ? (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label>Alíquota Percentual</Label>
                                <div className="flex items-center gap-1 w-24">
                                   <Input type="number" value={taxRates.transaction_tax_value?.toFixed(2)} onChange={e => handleTaxValueChange('transaction_tax_value', e.target.value)} className="h-8 text-right"/>
                                   <Percent className="h-4 w-4 text-muted-foreground" />
                                </div>
                            </div>
                            <Slider value={[taxRates.transaction_tax_value || 0]} onValueChange={(val) => setTaxRates(p => ({...p, transaction_tax_value: val[0]}))} max={100} step={0.01} />
                        </div>
                    ) : (
                        <div>
                            <Label>Valor Fixo por Transação</Label>
                            <Input type="text" value={formatCurrency(taxRates.transaction_tax_value || 0, true)} onChange={(e) => setTaxRates(p => ({...p, transaction_tax_value: parseCurrency(e.target.value)}))} />
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter>
                 <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Impostos'}
                </Button>
            </CardFooter>
        </Card>
    );
};

const FinanceCard = ({ title, value, icon, isCurrency = true, colorClass = 'text-green-400' }) => {
    const Icon = icon;
    return (
        <div className="glass-effect p-4 rounded-lg flex items-center gap-4">
            <div className={`p-3 rounded-md bg-primary/10 ${colorClass}`}>
                <Icon className="w-6 h-6" />
            </div>
            <div>
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className={`text-lg font-bold ${colorClass}`}>{isCurrency ? formatCurrency(value) : value}</p>
            </div>
        </div>
    );
};

const LoanManager = ({ onUpdate, setActiveTab, govFinances }) => {
    const { toast } = useToast();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [amount, setAmount] = useState(1000000);
    const [installments, setInstallments] = useState(12);
    const [isSaving, setIsSaving] = useState(false);
    const [bankPolicy, setBankPolicy] = useState(DEFAULT_BANK_POLICY);

    const availableLoanAmount = govFinances ? govFinances.loan_limit - govFinances.loans_balance : 0;
    const governmentDebtRate = Number(bankPolicy.government_debt_interest_rate || 0);
    const estimatedTotalDebt = amount * (1 + governmentDebtRate / 100);

    useEffect(() => {
        const fetchBankPolicy = async () => {
            const { data } = await supabase
                .from('system_settings')
                .select('value')
                .eq('key', BANK_POLICY_SETTINGS_KEY)
                .maybeSingle();

            if (data?.value) {
                setBankPolicy({ ...DEFAULT_BANK_POLICY, ...data.value });
            }
        };

        fetchBankPolicy();
    }, []);

    const handleTakeLoan = async () => {
        setIsSaving(true);
        const { data, error } = await supabase.rpc('government_take_loan', {
            p_amount: amount,
            p_installments: installments,
        });
        if (error || !data.success) {
            toast({ title: 'Erro ao pegar empréstimo', description: data?.message || error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Sucesso!', description: data.message });
            onUpdate();
            setIsDialogOpen(false);
            setActiveTab('finances');
        }
        setIsSaving(false);
    };

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
                <Button className="w-full"><Coins className="mr-2 h-4 w-4"/>Pegar Empréstimo</Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pegar Empréstimo Governamental</DialogTitle>
                    <DialogDescription>
                        Solicite um empréstimo para o cofre público.
                        <br />
                        <span className="font-bold text-primary">Disponível para empréstimo: {formatCurrency(availableLoanAmount)}</span>
                        <br />
                        <span>Taxa vigente do Banco Nacional: {governmentDebtRate.toFixed(2)}% a.m.</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="amount">Valor do Empréstimo</Label>
                        <Input id="amount" type="text" value={formatCurrency(amount, true)} onChange={e => setAmount(parseCurrency(e.target.value))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="installments">Parcelas</Label>
                        <Input id="installments" type="number" value={installments} onChange={(e) => setInstallments(parseInt(e.target.value, 10))} />
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">
                        Custo estimado com juros: <span className="font-semibold text-foreground">{formatCurrency(estimatedTotalDebt)}</span>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleTakeLoan} disabled={isSaving}>
                        {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar Empréstimo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const SelicManager = ({ economicPolicy, bankPolicy, onUpdate }) => {
    const { toast } = useToast();
    const [selicRate, setSelicRate] = useState(Number(economicPolicy?.selic_rate ?? DEFAULT_ECONOMIC_POLICY.selic_rate));
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        setSelicRate(Number(economicPolicy?.selic_rate ?? DEFAULT_ECONOMIC_POLICY.selic_rate));
    }, [economicPolicy?.selic_rate]);

    const projectedEconomicPolicy = normalizeEconomicPolicy({
        ...economicPolicy,
        selic_rate: selicRate,
    });
    const projectedBankPolicy = normalizeBankPolicyForEconomicPolicy(
        bankPolicy,
        projectedEconomicPolicy,
        DEFAULT_BANK_POLICY
    );
    const projectedSelicMonthlyRate = annualPercentToMonthlyPercent(projectedEconomicPolicy.selic_rate);
    const lowRiskInvestmentRate = buildInvestmentAnnualRate(projectedEconomicPolicy.selic_rate, 'low');
    const highRiskInvestmentRate = buildInvestmentAnnualRate(projectedEconomicPolicy.selic_rate, 'high');

    const handleSave = async () => {
        setIsSaving(true);

        try {
            const nextEconomicPolicy = normalizeEconomicPolicy({
                ...economicPolicy,
                selic_rate: selicRate,
            });

            await applyPolicy({
                policyType: 'selic',
                newValue: nextEconomicPolicy.selic_rate,
                marketExpectation: economicPolicy?.selic_rate,
                justification: 'Decisão de política monetária registrada pela Presidência no painel oficial.',
            });

            await publishOfficialGazetteEntry(supabase, {
                title: `Fixação da taxa Selic em ${nextEconomicPolicy.selic_rate.toFixed(2)}% a.a.`,
                summary: 'A Presidência atualizou a taxa básica de juros da economia nacional.',
                content:
                    `A taxa Selic foi definida em ${nextEconomicPolicy.selic_rate.toFixed(2)}% ao ano, equivalente a ${annualPercentToMonthlyPercent(nextEconomicPolicy.selic_rate).toFixed(2)}% ao mês.` +
                    ` A decisão repercute sobre o custo do crédito, a dívida pública e a remuneração das aplicações financeiras disponíveis no GOV.RP.`,
                type: 'Decreto',
                sourceId: `selic-${Date.now()}`,
            });

            toast({ title: 'Taxa Selic atualizada com sucesso' });
            await onUpdate?.();
        } catch (error) {
            toast({ title: 'Erro ao atualizar a Selic', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Percent className="w-5 h-5 text-primary" /> Política Monetária</CardTitle>
                <CardDescription>
                    Defina a Selic e propague automaticamente o impacto sobre crédito, dívida pública e investimentos.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Taxa Selic (% a.a.)</p>
                            <p className="text-2xl font-bold text-foreground">{Number(selicRate || 0).toFixed(2)}%</p>
                            <p className="text-xs text-muted-foreground">Equivalente mensal: {projectedSelicMonthlyRate.toFixed(2)}% a.m.</p>
                        </div>
                        <div className="w-32">
                            <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={selicRate}
                                onChange={(event) => setSelicRate(Number(event.target.value || 0))}
                            />
                        </div>
                    </div>
                    <Slider value={[Number(selicRate || 0)]} onValueChange={(value) => setSelicRate(Number(value[0] || 0))} max={40} step={0.05} />
                    <p className="text-sm text-muted-foreground">{getEconomicPressureLabel(selicRate)}</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Empréstimos</p>
                        <p className="mt-2 text-xl font-bold text-emerald-400">{Number(projectedBankPolicy.loan_interest_rate || 0).toFixed(2)}% a.m.</p>
                        <p className="text-xs text-muted-foreground">Spread preservado: {Number(projectedBankPolicy.loan_interest_spread || 0).toFixed(2)} p.p.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Cartão rotativo</p>
                        <p className="mt-2 text-xl font-bold text-orange-400">{Number(projectedBankPolicy.credit_card_revolving_rate || 0).toFixed(2)}% a.m.</p>
                        <p className="text-xs text-muted-foreground">Spread preservado: {Number(projectedBankPolicy.credit_card_revolving_spread || 0).toFixed(2)} p.p.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Dívida pública</p>
                        <p className="mt-2 text-xl font-bold text-amber-300">{Number(projectedBankPolicy.government_debt_interest_rate || 0).toFixed(2)}% a.m.</p>
                        <p className="text-xs text-muted-foreground">Custo financeiro do Tesouro ajustado automaticamente.</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Investimentos</p>
                        <p className="mt-2 text-xl font-bold text-cyan-300">{(lowRiskInvestmentRate * 100).toFixed(2)}% a.a.</p>
                        <p className="text-xs text-muted-foreground">Baixo risco: {(highRiskInvestmentRate * 100).toFixed(2)}% a.a. em alto risco.</p>
                    </div>
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Taxa Selic
                </Button>
            </CardFooter>
        </Card>
    );
};

const TARIFF_GROUPS = {
    'Emissão de Documentos': {
        groupIcon: FileText,
        tariffs: [
            { key: 'doc_CNH', label: 'CNH', icon: Car },
            { key: 'doc_Passport', label: 'Passaporte', icon: Globe },
            { key: 'doc_CNPJ', label: 'CNPJ', icon: Building2 },
            { key: 'doc_CTD', label: 'Carteira de Trabalho Digital', icon: Contact },
            { key: 'doc_Titulo_Eleitor', label: 'Título de Eleitor', icon: FileCheck },
            { key: 'doc_Certificado_Reservista', label: 'Certificado de Reservista', icon: Shield },
            { key: 'doc_Certidao_Casamento', label: 'Certidão de Casamento', icon: FileSignature },
            { key: 'doc_Registro_Profissional', label: 'Registro Profissional', icon: Briefcase },
        ]
    },
    'Criação de Empresas': {
        groupIcon: Store,
        tariffs: [
            { key: 'biz_banco', label: 'Banco', icon: Landmark },
            { key: 'biz_construtora', label: 'Construtora', icon: HardHat },
            { key: 'biz_fabrica', label: 'Fábrica', icon: Building },
            { key: 'biz_loja', label: 'Loja / Comércio', icon: Store },
            { key: 'biz_transportadora', label: 'Transportadora', icon: Tram },
            { key: 'biz_consultoria', label: 'Consultoria', icon: BrainCircuit },
            { key: 'biz_seguranca', label: 'Empresa de Segurança', icon: Shield },
            { key: 'biz_distribuidora', label: 'Distribuidora', icon: Package },
        ]
    },
    'Multas': {
        groupIcon: Gavel,
        tariffs: [
            { key: 'fine_leve', label: 'Infração Leve', icon: AlertTriangle },
            { key: 'fine_media', label: 'Infração Média', icon: AlertTriangle },
            { key: 'fine_grave', label: 'Infração Grave', icon: Ban },
            { key: 'fine_gravissima', label: 'Infração Gravíssima', icon: Ban },
        ]
    },
};

const TARIFF_GROUP_KEYS = Object.keys(TARIFF_GROUPS);

const TariffManager = ({ baseTariffs, onUpdate }) => {
    const { toast } = useToast();
    const [tariffs, setTariffs] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [activeTariffTab, setActiveTariffTab] = useState(TARIFF_GROUP_KEYS[0]);

    useEffect(() => {
        if (baseTariffs) {
            setTariffs(baseTariffs);
        }
    }, [baseTariffs]);

    const handleTariffChange = (key, value) => {
        setTariffs(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        const { error } = await supabase.from('system_settings').upsert({ key: 'base_tariffs', value: tariffs });
        if (error) {
            toast({ title: 'Erro ao salvar tarifas', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Tarifas atualizadas com sucesso!' });
            onUpdate();
        }
        setIsSaving(false);
    };

    const groupData = TARIFF_GROUPS[activeTariffTab];
    const GroupIcon = groupData.groupIcon;

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Receipt className="w-5 h-5 text-primary" /> Valores de Tarifas Base</CardTitle>
                <CardDescription>Defina os valores cobrados para emissão de documentos, criação de empresas e multas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <Tabs value={activeTariffTab} onValueChange={setActiveTariffTab} className="w-full">
                    <TabsList className="w-full grid grid-cols-3">
                        {TARIFF_GROUP_KEYS.map(groupName => {
                            const GIcon = TARIFF_GROUPS[groupName].groupIcon;
                            return (
                                <TabsTrigger key={groupName} value={groupName} className="text-xs sm:text-sm">
                                    <GIcon className="w-4 h-4 mr-1.5" />
                                    {groupName.split(' ').slice(-1)[0]}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-2 mb-2">
                    <GroupIcon className="w-5 h-5 text-primary" />
                    <h4 className="font-semibold text-lg text-foreground">{activeTariffTab}</h4>
                </div>

                <div className="space-y-3">
                    {groupData.tariffs.map(({ key, label, icon: TariffIcon }) => (
                        <div key={key} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <TariffIcon className="w-4 h-4 text-muted-foreground" />
                                <Label htmlFor={key}>{label}</Label>
                            </div>
                            <Input
                                id={key}
                                value={formatCurrency(tariffs[key] || 0, true)}
                                onChange={(e) => handleTariffChange(key, e.target.value)}
                                className="w-32"
                            />
                        </div>
                    ))}
                </div>
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={isSaving} className="w-full">
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Salvar Tarifas'}
                </Button>
            </CardFooter>
        </Card>
    );
};

const ConstitutionalStatusCard = ({ executiveState }) => {
    const currentTerm = executiveState?.currentTerm;
    const viceAssumedPresidency = Boolean(executiveState?.viceAssumedPresidency);
    const currentPresident = executiveState?.currentPresidentProfile?.full_name || 'Sem presidente em exercício';
    const currentVice = viceAssumedPresidency
        ? 'Vaga após sucessão presidencial'
        : executiveState?.currentViceProfile?.full_name || 'Vice-Presidente não definido';
    const actingAuthority = executiveState?.actingAuthority?.profile?.full_name || executiveState?.actingAuthority?.label || 'Conselho dos Administradores (CDA)';
    const currentTermLabel = currentTerm
        ? `${new Date(currentTerm.term_start_at).toLocaleString('pt-BR')} até ${new Date(currentTerm.term_end_at).toLocaleString('pt-BR')}`
        : executiveState?.manualExecutiveOfficeActive
            ? 'Cargo executivo atribuído manualmente pelo admin, válido até nova eleição presidencial consolidada.'
            : 'Nenhum mandato ativo identificado no histórico eleitoral.';

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Landmark className="w-6 h-6 text-primary" />
                    Status Constitucional do Executivo
                </CardTitle>
                <CardDescription>
                    A Presidência e a Vice-Presidência são eleitas simultaneamente por voto direto, com mandato de 1 mês e apenas 1 reeleição consecutiva.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Presidente da República</p>
                        <p className="font-semibold text-foreground mt-1">{currentPresident}</p>
                        {viceAssumedPresidency && (
                            <p className="mt-1 text-xs font-medium text-emerald-300">Vice eleito que assumiu a Presidência</p>
                        )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Vice-Presidente</p>
                        <p className="font-semibold text-foreground mt-1">{currentVice}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-sm text-muted-foreground">Mandato mensal</p>
                        <p className="text-sm font-medium text-foreground mt-1">{currentTermLabel}</p>
                    </div>
                </div>

                <div className={`rounded-xl border p-4 ${executiveState?.isVacant ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/20 bg-emerald-500/10'}`}>
                    <div className="flex items-start gap-3">
                        {executiveState?.isVacant ? (
                            <AlertTriangle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
                        ) : (
                            <Shield className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                        )}
                        <div>
                            <p className="font-semibold text-foreground">
                                {executiveState?.isVacant
                                    ? 'Vacância presidencial em curso'
                                    : viceAssumedPresidency
                                        ? 'Sucessão presidencial automática'
                                        : 'Chefia do Executivo regular'}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {executiveState?.isVacant
                                    ? `Na vacância, a condução do Executivo passa sucessivamente para ${actingAuthority}.`
                                    : viceAssumedPresidency
                                        ? 'O vice-presidente assumiu a chefia do Executivo porque a Presidência ficou sem ocupante ativo.'
                                    : 'Compete privativamente ao Presidente nomear cargos-chave, sancionar ou vetar projetos, promulgar textos aprovados e editar medidas provisórias.'}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <Anchor className="w-5 h-5 text-sky-400" />
                        <h4 className="font-semibold text-foreground">Linha de sucessão</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                        {(executiveState?.successionLine || []).map((entry, index) => (
                            <div key={entry.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{index + 1}º na ordem</p>
                                <p className="font-semibold text-foreground mt-2">{entry.label}</p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {entry.profile?.full_name || (entry.is_cda ? 'Assunção colegiada excepcional' : 'Sem ocupante definido')}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const SpecialAppointmentsManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [availableProfiles, setAvailableProfiles] = useState({});
    const [selectedProfiles, setSelectedProfiles] = useState({});
    const [savingOfficeKey, setSavingOfficeKey] = useState(null);

    useEffect(() => {
        const fetchProfiles = async () => {
            try {
                const entries = await Promise.all(
                    EXECUTIVE_SPECIAL_OFFICES.map(async (office) => {
                        const { data, error } = await supabase
                            .from('profiles')
                            .select('id, full_name, username, avatar_url, role')
                            .in('role', office.eligibleRoles)
                            .order('full_name', { ascending: true });

                        if (error) {
                            throw error;
                        }

                        return [office.key, data || []];
                    })
                );

                setAvailableProfiles(Object.fromEntries(entries));
            } catch (error) {
                toast({ title: 'Erro ao carregar nomes para nomeação', description: error.message, variant: 'destructive' });
            }
        };

        fetchProfiles();
    }, [toast]);

    const handleAppoint = async (officeKey) => {
        const selectedUserId = selectedProfiles[officeKey];
        if (!selectedUserId) {
            toast({ title: 'Selecione um nome', description: 'Escolha um ocupante antes de concluir a nomeação.', variant: 'destructive' });
            return;
        }

        setSavingOfficeKey(officeKey);
        try {
            await appointExecutiveSpecialOffice(supabase, {
                officeKey,
                userId: selectedUserId,
                actorId,
            });
            toast({ title: 'Nomeação concluída', description: 'O ato foi registrado no Diário Oficial.' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao nomear', description: error.message, variant: 'destructive' });
        } finally {
            setSavingOfficeKey(null);
        }
    };

    const handleDismiss = async (officeKey) => {
        setSavingOfficeKey(officeKey);
        try {
            await dismissExecutiveSpecialOffice(supabase, { officeKey, actorId });
            toast({ title: 'Exoneração concluída', description: 'O ato foi registrado no Diário Oficial.' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao exonerar', description: error.message, variant: 'destructive' });
        } finally {
            setSavingOfficeKey(null);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Shield className="w-6 h-6 text-primary" />
                    Nomeações Estratégicas do Executivo
                </CardTitle>
                <CardDescription>Defina os ocupantes de cargos executivos estratégicos, incluindo segurança, defesa e Banco Nacional.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {EXECUTIVE_SPECIAL_OFFICES.map((office) => {
                    const appointment = executiveState?.settings?.specialAppointmentsDetailed?.[office.key];
                    const officeIcon = office.key === 'armed_forces_commander' ? Anchor : office.key === 'national_bank_president' ? Landmark : Shield;
                    const OfficeIcon = officeIcon;

                    return (
                        <div key={office.key} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                            <div className="flex items-start gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <OfficeIcon className="w-5 h-5 text-primary" />
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-foreground">{office.label}</p>
                                    <p className="text-sm text-muted-foreground">{office.description}</p>
                                    <p className="text-sm text-foreground mt-2">
                                        Ocupante atual: <span className="font-semibold">{appointment?.profile?.full_name || 'Não designado'}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_auto] gap-3">
                                <Select value={selectedProfiles[office.key] || ''} onValueChange={(value) => setSelectedProfiles((current) => ({ ...current, [office.key]: value }))}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione um ocupante" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-80 overflow-y-auto">
                                        {(availableProfiles[office.key] || []).map((profile) => (
                                            <SelectItem key={profile.id} value={profile.id}>
                                                <UserSelectOption user={profile} detail={profile.role} />
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Button onClick={() => handleAppoint(office.key)} disabled={savingOfficeKey === office.key}>
                                    {savingOfficeKey === office.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                                    Nomear
                                </Button>
                                <Button variant="destructive" onClick={() => handleDismiss(office.key)} disabled={savingOfficeKey === office.key || !appointment}>
                                    {savingOfficeKey === office.key ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserX className="mr-2 h-4 w-4" />}
                                    Exonerar
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
};

const BillReviewManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [reviewState, setReviewState] = useState(null);
    const [reason, setReason] = useState('');
    const [partialScope, setPartialScope] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const pendingBills = executiveState?.pendingBills || [];
    const recentActions = executiveState?.settings?.billActionsDetailed || [];

    const openReviewDialog = (bill, action) => {
        setReviewState({ bill, action });
        setReason('');
        setPartialScope('');
    };

    const handleConfirm = async () => {
        if (!reviewState?.bill) {
            return;
        }

        if (reviewState.action === 'veto_total' && !reason.trim()) {
            toast({ title: 'Fundamentação obrigatória', description: 'Informe a motivação do veto total.', variant: 'destructive' });
            return;
        }

        if (reviewState.action === 'veto_partial' && (!reason.trim() || !partialScope.trim())) {
            toast({ title: 'Dados incompletos', description: 'Informe a fundamentação e os trechos alcançados pelo veto parcial.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            await reviewPresidentialBill(supabase, {
                bill: reviewState.bill,
                action: reviewState.action,
                actorId,
                reason,
                partialScope,
            });
            toast({ title: 'Ato presidencial registrado', description: 'O projeto foi atualizado e publicado no Diário Oficial.' });
            setReviewState(null);
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao registrar ato presidencial', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileSignature className="w-6 h-6 text-primary" />
                    Sanção, Promulgação e Veto
                </CardTitle>
                <CardDescription>Projetos aprovados pelo Parlamento aguardam ato presidencial antes de entrarem na ordem jurídica.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {pendingBills.length ? pendingBills.map((bill) => {
                    const isPromulgationOnly = bill.status === 'Aguardando promulgação presidencial' || `${bill.type || ''}`.toUpperCase().includes('PEC');

                    return (
                        <div key={bill.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                            <div className="flex flex-col gap-1">
                                <p className="font-semibold text-foreground">{bill.title}</p>
                                <p className="text-sm text-muted-foreground">
                                    {bill.type || 'Projeto Legislativo'} • {bill.house?.name || 'Casa Legislativa'} • {bill.status}
                                </p>
                                <p className="text-sm text-muted-foreground">{bill.summary || 'Sem ementa cadastrada.'}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button onClick={() => openReviewDialog(bill, isPromulgationOnly ? 'promulgate' : 'sanction')}>
                                    <Megaphone className="mr-2 h-4 w-4" />
                                    {isPromulgationOnly ? 'Promulgar' : 'Sancionar'}
                                </Button>
                                {!isPromulgationOnly && (
                                    <>
                                        <Button variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={() => openReviewDialog(bill, 'veto_total')}>
                                            <Ban className="mr-2 h-4 w-4" />
                                            Veto total
                                        </Button>
                                        <Button variant="outline" className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300" onClick={() => openReviewDialog(bill, 'veto_partial')}>
                                            <CircleSlash className="mr-2 h-4 w-4" />
                                            Veto parcial
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                }) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-muted-foreground">
                        Nenhum projeto aguarda ato presidencial neste momento.
                    </div>
                )}

                {recentActions.length ? (
                    <div className="pt-2 space-y-3">
                        <h4 className="font-semibold text-foreground">Últimos atos presidenciais</h4>
                        {recentActions.slice(0, 5).map((action) => (
                            <div key={action.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                                <p className="font-semibold text-foreground">{action.bill_title}</p>
                                <p className="text-sm text-muted-foreground">
                                    Resultado: {action.resulting_status} • {new Date(action.created_at).toLocaleString('pt-BR')}
                                </p>
                                {action.reason ? <p className="text-sm text-muted-foreground mt-1">{action.reason}</p> : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </CardContent>

            <Dialog open={!!reviewState} onOpenChange={(open) => !open && setReviewState(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {reviewState?.action === 'promulgate' && 'Promulgar texto aprovado'}
                            {reviewState?.action === 'sanction' && 'Sancionar projeto'}
                            {reviewState?.action === 'veto_total' && 'Registrar veto total'}
                            {reviewState?.action === 'veto_partial' && 'Registrar veto parcial'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewState?.bill?.title}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {(reviewState?.action === 'veto_total' || reviewState?.action === 'veto_partial') && (
                            <div className="grid gap-2">
                                <Label htmlFor="bill-review-reason">Fundamentação</Label>
                                <Textarea
                                    id="bill-review-reason"
                                    rows={5}
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    placeholder="Descreva a motivação constitucional, política ou administrativa do veto."
                                />
                            </div>
                        )}
                        {reviewState?.action === 'veto_partial' && (
                            <div className="grid gap-2">
                                <Label htmlFor="bill-review-scope">Trechos atingidos</Label>
                                <Textarea
                                    id="bill-review-scope"
                                    rows={4}
                                    value={partialScope}
                                    onChange={(event) => setPartialScope(event.target.value)}
                                    placeholder="Liste os dispositivos ou trechos alcançados pelo veto parcial."
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancelar</Button>
                        </DialogClose>
                        <Button onClick={handleConfirm} disabled={isSaving}>
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Confirmar ato presidencial
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

const ProvisionalMeasureManager = ({ executiveState, onUpdate, actorId }) => {
    const { toast } = useToast();
    const [formData, setFormData] = useState({ title: '', summary: '', content: '' });
    const [isSaving, setIsSaving] = useState(false);
    const provisionalMeasures = executiveState?.settings?.provisionalMeasuresDetailed || [];

    const handleSubmit = async () => {
        if (!formData.title.trim() || !formData.summary.trim() || !formData.content.trim()) {
            toast({ title: 'Campos obrigatórios', description: 'Preencha título, resumo e conteúdo da medida provisória.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            await createExecutiveProvisionalMeasure(supabase, {
                title: formData.title,
                summary: formData.summary,
                content: formData.content,
                authorId: actorId,
            });
            toast({ title: 'Medida provisória publicada', description: 'A medida provisória passa a valer por até 1 semana, sem prorrogação.' });
            setFormData({ title: '', summary: '', content: '' });
            await onUpdate();
        } catch (error) {
            toast({ title: 'Erro ao criar medida provisória', description: error.message, variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Clock3 className="w-6 h-6 text-primary" />
                    Medidas Provisórias
                </CardTitle>
                <CardDescription>Medidas provisórias têm força de lei, validade máxima improrrogável de 1 semana e devem ser publicadas oficialmente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-2">
                        <Label htmlFor="mp-title">Título</Label>
                        <Input id="mp-title" value={formData.title} onChange={(event) => setFormData((current) => ({ ...current, title: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="mp-summary">Resumo</Label>
                        <Textarea id="mp-summary" rows={3} value={formData.summary} onChange={(event) => setFormData((current) => ({ ...current, summary: event.target.value }))} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="mp-content">Conteúdo</Label>
                        <Textarea id="mp-content" rows={8} value={formData.content} onChange={(event) => setFormData((current) => ({ ...current, content: event.target.value }))} />
                    </div>
                    <Button onClick={handleSubmit} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus className="mr-2 h-4 w-4" />}
                        Publicar Medida Provisória
                    </Button>
                </div>

                <div className="space-y-3">
                    <h4 className="font-semibold text-foreground">Histórico recente</h4>
                    {provisionalMeasures.length ? provisionalMeasures.map((measure) => (
                        <div key={measure.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                            <p className="font-semibold text-foreground">{measure.title}</p>
                            <p className="text-sm text-muted-foreground">{measure.summary}</p>
                            <p className="text-xs text-muted-foreground mt-2">
                                Publicada em {new Date(measure.issued_at).toLocaleString('pt-BR')} • Expira em {new Date(measure.expires_at).toLocaleString('pt-BR')} • {measure.status === 'expired' ? 'Expirada' : 'Ativa'}
                            </p>
                        </div>
                    )) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-muted-foreground">
                            Nenhuma medida provisória foi editada no mandato atual.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

const ResignationManager = ({ onResign }) => {
    const [isSaving, setIsSaving] = useState(false);

    const handleResign = async () => {
        setIsSaving(true);
        await onResign();
        setIsSaving(false);
    };

    return (
        <Card className="glass-effect">
            <CardHeader>
                <CardTitle>Ações Presidenciais</CardTitle>
                <CardDescription>Ações de alto nível que afetam seu mandato.</CardDescription>
            </CardHeader>
            <CardContent>
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="destructive" className="w-full">
                            <LogOut className="mr-2 h-4 w-4" /> Renunciar ao Cargo
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Confirmar Renúncia</DialogTitle>
                            <DialogDescription>
                                Tem certeza de que deseja renunciar ao cargo de Presidente? Esta ação é irreversível. Você e todos os seus ministros perderão seus cargos e voltarão a ser cidadãos.
                            </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                            <Button variant="destructive" onClick={handleResign} disabled={isSaving}>
                                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirmar Renúncia
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};

const ENTERPRISE_SECTORS = [
    { value: 'Banco Nacional', label: 'Banco Nacional', icon: Landmark, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
    { value: 'Internet', label: 'Internet', icon: Wifi, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
    { value: 'Energia Elétrica', label: 'Energia Elétrica', icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
    { value: 'Água', label: 'Água', icon: Droplet, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
    { value: 'Telefonia', label: 'Telefonia', icon: Smartphone, color: 'text-violet-400', bgColor: 'bg-violet-500/20' },
    { value: 'Gás', label: 'Gás', icon: Flame, color: 'text-orange-500', bgColor: 'bg-orange-500/20' },
    { value: 'Outros', label: 'Outros', icon: Building, color: 'text-gray-400', bgColor: 'bg-gray-500/20' },
];

const isNationalBankEnterprise = (enterprise) =>
    enterprise?.sector === 'Banco Nacional' || `${enterprise?.name || ''}`.toLowerCase() === 'banco nacional';

const SECTOR_SERVICE_KEYS = {
    'Internet': [
        { key: 'Internet_Básico', label: 'Plano Básico', icon: Package },
        { key: 'Internet_Ultra', label: 'Plano Ultra', icon: Package2 },
        { key: 'Internet_Mega', label: 'Plano Mega', icon: PackageCheck },
    ],
    'Telefonia': [
        { key: 'Telefonia_Básico', label: 'Plano Básico', icon: Package },
        { key: 'Telefonia_Intermediário', label: 'Plano Intermediário', icon: Package2 },
        { key: 'Telefonia_Premium', label: 'Plano Premium', icon: PackageCheck },
    ],
    'Energia Elétrica': [
        { key: 'Energia Elétrica', label: 'Energia Elétrica', icon: Zap },
    ],
    'Água': [
        { key: 'Água', label: 'Água', icon: Droplet },
    ],
    'Gás': [
        { key: 'Gás', label: 'Gás', icon: Flame },
    ],
};

const ENTERPRISE_COST_LABELS = {
    employees: 'Funcionários',
    infrastructure: 'Infraestrutura',
    maintenance: 'Manutenção',
    energy: 'Energia',
    licenses: 'Licenças',
};

const WEEKS_PER_MONTH = 4.345;
const DEFAULT_ENTERPRISE_FORM = {
    name: '',
    sector: '',
    description: '',
    market_value: 'R$ 1.000.000,00',
    health_score: 75,
};

const normalizeEnterpriseCosts = (value = {}) =>
    Object.keys(ENTERPRISE_COST_LABELS).reduce((accumulator, key) => {
        accumulator[key] = Number(value?.[key] || 0);
        return accumulator;
    }, {});

const sumEnterpriseCosts = (costs = {}) =>
    Object.values(costs || {}).reduce((sum, current) => sum + Number(current || 0), 0);

const getEnterpriseHealthScore = (enterprise) =>
    Math.min(100, Math.max(0, Number(enterprise?.health_score ?? 75)));

const getEnterpriseMarketValue = (enterprise) => Number(enterprise?.market_value || 0);

const EnterpriseDetailView = ({ enterprise, onBack, onUpdate }) => {
    const { toast } = useToast();
    const sectorInfo = ENTERPRISE_SECTORS.find(s => s.value === enterprise.sector) || ENTERPRISE_SECTORS.find(s => s.value === 'Outros');
    const SectorIcon = sectorInfo.icon;
    const sectorServices = SECTOR_SERVICE_KEYS[enterprise.sector] || [];
    const isNationalBank = isNationalBankEnterprise(enterprise);

    const [prices, setPrices] = useState({});
    const [costs, setCosts] = useState(() => normalizeEnterpriseCosts());
    const [savingPrices, setSavingPrices] = useState(false);
    const [savingCosts, setSavingCosts] = useState(false);
    const [loadingData, setLoadingData] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setLoadingData(true);
            const [pricesRes, costsRes] = await Promise.all([
                supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').single(),
                supabase.from('system_settings').select('value').eq('key', 'enterprise_costs').single(),
            ]);
            if (pricesRes.data?.value) setPrices(pricesRes.data.value);
            setCosts(normalizeEnterpriseCosts(costsRes.data?.value?.[enterprise.id]));
            setLoadingData(false);
        };
        loadData();
    }, [enterprise.id]);

    const handlePriceChange = (key, value) => {
        setPrices(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleCostChange = (key, value) => {
        setCosts(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleSavePrices = async () => {
        setSavingPrices(true);
        const { error } = await supabase.from('system_settings').update({ value: prices }).eq('key', 'basic_service_prices');
        if (error) {
            toast({ title: 'Erro ao salvar preços', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Preços atualizados!' });
            onUpdate?.();
        }
        setSavingPrices(false);
    };

    const handleSaveCosts = async () => {
        setSavingCosts(true);
        const { data: existing } = await supabase.from('system_settings').select('value').eq('key', 'enterprise_costs').single();
        const allCosts = existing?.value || {};
        allCosts[enterprise.id] = costs;
        const { error } = await supabase.from('system_settings').upsert({ key: 'enterprise_costs', value: allCosts });
        if (error) {
            toast({ title: 'Erro ao salvar custos', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Custos operacionais atualizados!' });
            onUpdate?.();
        }
        setSavingCosts(false);
    };

    const totalMonthlyCost = sumEnterpriseCosts(costs);
    const totalWeeklyCost = totalMonthlyCost / WEEKS_PER_MONTH;
    const marketValue = getEnterpriseMarketValue(enterprise);
    const healthScore = getEnterpriseHealthScore(enterprise);

    if (loadingData) return <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ChevronLeft className="w-4 h-4 mr-1" /> Voltar
                </Button>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${sectorInfo.bgColor}`}><SectorIcon className={`w-6 h-6 ${sectorInfo.color}`} /></div>
                    <div>
                        <h3 className="text-xl font-semibold">{enterprise.name}</h3>
                        <p className="text-sm text-muted-foreground">{sectorInfo.label} • {enterprise.is_active ? 'Ativa' : 'Inativa'}</p>
                    </div>
                </div>
            </div>

            {enterprise.description && (
                <Card className="glass-effect">
                    <CardContent className="pt-4">
                        <p className="text-sm text-muted-foreground">{enterprise.description}</p>
                    </CardContent>
                </Card>
            )}

            {isNationalBank ? (
                <Card className="glass-effect border-emerald-500/20">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2"><Lock className="w-5 h-5 text-emerald-400" /> Operações do Banco Nacional</CardTitle>
                        <CardDescription>
                            A Presidência pode gerir a estatal e conduzir sua privatização, mas a política operacional de juros, empréstimos e cartões é exclusiva do Presidente do Banco Nacional e não aparece neste painel.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : null}

            <Card className="glass-effect border-emerald-500/20">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-emerald-400" /> Valor e Saúde da Estatal</CardTitle>
                    <CardDescription>
                        O balanço semanal usa estes indicadores para calibrar lucro, prejuízo e impacto no cofre público.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor de mercado</p>
                        <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(marketValue)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center justify-between">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Saúde operacional</p>
                            <span className={healthScore >= 70 ? 'text-emerald-300' : healthScore >= 40 ? 'text-amber-300' : 'text-red-300'}>{healthScore}%</span>
                        </div>
                        <Progress value={healthScore} className="mt-3 h-3" />
                    </div>
                </CardContent>
            </Card>

            <Card className="glass-effect border-amber-500/20">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Coins className="w-5 h-5 text-amber-400" /> Resumo de Custos</CardTitle>
                    <CardDescription>
                        Custos configurados para esta estatal: <span className="font-semibold text-foreground">{formatCurrency(totalMonthlyCost)}</span>/mês e <span className="font-semibold text-foreground">{formatCurrency(totalWeeklyCost)}</span>/semana.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {Object.entries(ENTERPRISE_COST_LABELS).map(([key, label]) => (
                        <div key={key} className="rounded-xl border border-white/10 bg-white/5 p-3">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                            <p className="mt-2 text-lg font-semibold text-foreground">{formatCurrency(costs[key] || 0)}</p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {sectorServices.length > 0 && (
                <Card className="glass-effect">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2"><DollarSign className="w-5 h-5 text-primary" /> Preços dos Serviços</CardTitle>
                        <CardDescription>Defina o valor semanal para os serviços desta estatal.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {sectorServices.map(({ key, label, icon: ServiceIcon }) => (
                            <div key={key} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ServiceIcon className={`w-4 h-4 ${sectorInfo.color}`} />
                                    <Label htmlFor={`price-${key}`}>{label}</Label>
                                </div>
                                <Input
                                    id={`price-${key}`}
                                    value={formatCurrency(prices[key] || 0, true)}
                                    onChange={(e) => handlePriceChange(key, e.target.value)}
                                    className="w-32"
                                />
                            </div>
                        ))}
                    </CardContent>
                    <CardFooter>
                        <Button onClick={handleSavePrices} disabled={savingPrices} className="w-full">
                            {savingPrices ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar Preços
                        </Button>
                    </CardFooter>
                </Card>
            )}

            <Card className="glass-effect">
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2"><Coins className="w-5 h-5 text-amber-400" /> Custos Operacionais</CardTitle>
                    <CardDescription>Custos mensais de operação da estatal. Total: <span className="font-bold text-foreground">{formatCurrency(totalMonthlyCost)}</span>/mês</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {Object.entries(ENTERPRISE_COST_LABELS).map(([key, label]) => (
                        <div key={key} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Wrench className="w-4 h-4 text-muted-foreground" />
                                <Label htmlFor={`cost-${key}`}>{label}</Label>
                            </div>
                            <Input
                                id={`cost-${key}`}
                                value={formatCurrency(costs[key] || 0, true)}
                                onChange={(e) => handleCostChange(key, e.target.value)}
                                className="w-32"
                            />
                        </div>
                    ))}
                </CardContent>
                <CardFooter>
                    <Button onClick={handleSaveCosts} disabled={savingCosts} className="w-full">
                        {savingCosts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Salvar Custos
                    </Button>
                </CardFooter>
            </Card>
        </div>
    );
};

const StateEnterpriseManager = ({ onUpdate }) => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [enterprises, setEnterprises] = useState([]);
    const [enterpriseCostsMap, setEnterpriseCostsMap] = useState({});
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingEnterprise, setEditingEnterprise] = useState(null);
    const [selectedEnterprise, setSelectedEnterprise] = useState(null);
    const [form, setForm] = useState(() => ({ ...DEFAULT_ENTERPRISE_FORM }));
    const [saving, setSaving] = useState(false);
    const [servicePrices, setServicePrices] = useState({});
    const [savingPricesFor, setSavingPricesFor] = useState(null);
    const [enterpriseToPrivatize, setEnterpriseToPrivatize] = useState(null);
    const [privatizationPrice, setPrivatizationPrice] = useState('R$ 0,00');

    const fetchEnterprises = useCallback(async () => {
        setLoading(true);
        const [entRes, pricesRes, costsRes] = await Promise.all([
            supabase.from('state_enterprises').select('*').order('created_at', { ascending: true }),
            supabase.from('system_settings').select('value').eq('key', 'basic_service_prices').single(),
            supabase.from('system_settings').select('value').eq('key', 'enterprise_costs').single(),
        ]);
        if (entRes.error) {
            toast({ title: 'Erro ao carregar estatais', description: entRes.error.message, variant: 'destructive' });
        } else {
            setEnterprises(entRes.data || []);
            if (selectedEnterprise) {
                const updated = (entRes.data || []).find(e => e.id === selectedEnterprise.id);
                if (updated) setSelectedEnterprise(updated);
            }
        }
        if (pricesRes.data?.value) setServicePrices(pricesRes.data.value);
        setEnterpriseCostsMap(costsRes.data?.value || {});
        setLoading(false);
    }, [toast, selectedEnterprise]);

    useEffect(() => { fetchEnterprises(); }, []);

    const openCreate = () => {
        setEditingEnterprise(null);
        setForm({ ...DEFAULT_ENTERPRISE_FORM });
        setIsDialogOpen(true);
    };

    const openEdit = (enterprise) => {
        setEditingEnterprise(enterprise);
        setForm({
            name: enterprise.name,
            sector: enterprise.sector,
            description: enterprise.description || '',
            market_value: formatCurrency(getEnterpriseMarketValue(enterprise), true),
            health_score: getEnterpriseHealthScore(enterprise),
        });
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.name.trim() || !form.sector) {
            toast({ title: 'Preencha nome e setor', variant: 'destructive' });
            return;
        }
        setSaving(true);
        const enterprisePayload = {
            name: form.name.trim(),
            sector: form.sector,
            description: form.description.trim(),
            market_value: parseCurrency(form.market_value),
            health_score: Number(form.health_score || 0),
            updated_at: new Date().toISOString(),
        };
        if (editingEnterprise) {
            const { error } = await supabase
                .from('state_enterprises')
                .update(enterprisePayload)
                .eq('id', editingEnterprise.id);
            if (error) {
                toast({ title: 'Erro ao atualizar', description: error.message, variant: 'destructive' });
            } else {
                toast({ title: 'Estatal atualizada com sucesso' });
                await publishOfficialGazetteEntry(supabase, {
                    title: `Atualização de Estatal: ${form.name.trim()}`,
                    content: `A estatal "${form.name.trim()}" (setor: ${form.sector}) foi atualizada pelo Presidente da República.`,
                    category: 'decree',
                    author_id: user?.id,
                });
            }
        } else {
            const { error } = await supabase
                .from('state_enterprises')
                .insert({ ...enterprisePayload, created_by: user?.id });
            if (error) {
                toast({ title: 'Erro ao criar estatal', description: error.message, variant: 'destructive' });
            } else {
                toast({ title: 'Estatal criada com sucesso' });
                await publishOfficialGazetteEntry(supabase, {
                    title: `Criação de Estatal: ${form.name.trim()}`,
                    content: `O Presidente da República criou a estatal "${form.name.trim()}" no setor de ${form.sector}.`,
                    category: 'decree',
                    author_id: user?.id,
                });
            }
        }
        setSaving(false);
        setIsDialogOpen(false);
        fetchEnterprises();
        onUpdate?.();
    };

    const openPrivatizationDialog = (enterprise) => {
        setEnterpriseToPrivatize(enterprise);
        setPrivatizationPrice(formatCurrency(enterprise.privatization_price || 0, true));
    };

    const handlePrivatize = async () => {
        if (!enterpriseToPrivatize?.id) return;
        const targetEnterprise = enterpriseToPrivatize;
        const price = parseCurrency(privatizationPrice);
        if (!price || price <= 0) {
            toast({ title: 'Informe um preço de privatização válido', variant: 'destructive' });
            return;
        }
        const { error } = await supabase
            .from('state_enterprises')
            .update({
                privatization_status: 'for_sale',
                privatization_price: price,
                is_privatized: false,
                updated_at: new Date().toISOString(),
            })
            .eq('id', targetEnterprise.id);
        if (error) {
            toast({ title: 'Erro ao privatizar', description: error.message, variant: 'destructive' });
        } else {
            setEnterpriseToPrivatize(null);
            setPrivatizationPrice('R$ 0,00');
            toast({ title: `"${targetEnterprise.name}" está à venda para privatização` });
            await fetchEnterprises();
            onUpdate?.();
            publishOfficialGazetteEntry(supabase, {
                title: `Privatização aberta: ${targetEnterprise.name}`,
                content: `O Presidente da República abriu a privatização da estatal "${targetEnterprise.name}" pelo valor de ${formatCurrency(price)}. A empresa permanecerá estatal até que haja comprador.`,
                type: 'Decreto',
            }).catch((gazetteError) => {
                console.error('Erro ao publicar privatização no Diário Oficial:', gazetteError);
            });
        }
    };

    const handleCancelPrivatization = async (enterprise) => {
        const { error } = await supabase
            .from('state_enterprises')
            .update({
                privatization_status: 'none',
                privatization_price: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enterprise.id);

        if (error) {
            toast({ title: 'Erro ao cancelar privatização', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `Privatização de "${enterprise.name}" cancelada` });
            fetchEnterprises();
            onUpdate?.();
        }
    };

    const handleReactivate = async (enterprise) => {
        const { error } = await supabase
            .from('state_enterprises')
            .update({
                is_privatized: false,
                is_active: true,
                privatization_status: 'none',
                privatization_price: null,
                privatization_buyer_id: null,
                privatized_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', enterprise.id);
        if (error) {
            toast({ title: 'Erro ao reestatizar', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: `"${enterprise.name}" foi reestatizada` });
            fetchEnterprises();
            onUpdate?.();
        }
    };

    const handleToggleActive = async (enterprise) => {
        const { error } = await supabase
            .from('state_enterprises')
            .update({ is_active: !enterprise.is_active, updated_at: new Date().toISOString() })
            .eq('id', enterprise.id);
        if (error) {
            toast({ title: 'Erro', description: error.message, variant: 'destructive' });
        } else {
            fetchEnterprises();
        }
    };

    const handleInlinePriceChange = (key, value) => {
        setServicePrices(prev => ({ ...prev, [key]: parseCurrency(value) }));
    };

    const handleSaveInlinePrices = async (enterpriseId) => {
        setSavingPricesFor(enterpriseId);
        const { error } = await supabase.from('system_settings').update({ value: servicePrices }).eq('key', 'basic_service_prices');
        if (error) {
            toast({ title: 'Erro ao salvar preços', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Preços atualizados!' });
            onUpdate?.();
        }
        setSavingPricesFor(null);
    };

    if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

    if (selectedEnterprise) {
        return <EnterpriseDetailView enterprise={selectedEnterprise} onBack={() => setSelectedEnterprise(null)} onUpdate={() => { fetchEnterprises(); onUpdate?.(); }} />;
    }

    const activeEnterprises = enterprises.filter(e => !e.is_privatized);
    const privatizedEnterprises = enterprises.filter(e => e.is_privatized);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-semibold flex items-center gap-2"><Building className="w-5 h-5 text-primary" /> Estatais do Governo</h3>
                    <p className="text-sm text-muted-foreground mt-1">Crie, gerencie e privatize empresas estatais.</p>
                </div>
                <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Nova Estatal</Button>
            </div>

            {activeEnterprises.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {activeEnterprises.map(enterprise => {
                        const sectorInfo = ENTERPRISE_SECTORS.find(s => s.value === enterprise.sector) || ENTERPRISE_SECTORS.find(s => s.value === 'Outros');
                        const SectorIcon = sectorInfo.icon;
                        const sectorServices = SECTOR_SERVICE_KEYS[enterprise.sector] || [];
                        const isNationalBank = isNationalBankEnterprise(enterprise);
                        const enterpriseCosts = normalizeEnterpriseCosts(enterpriseCostsMap[enterprise.id]);
                        const monthlyCost = sumEnterpriseCosts(enterpriseCosts);
                        const marketValue = getEnterpriseMarketValue(enterprise);
                        const healthScore = getEnterpriseHealthScore(enterprise);
                        return (
                            <Card key={enterprise.id} className="glass-effect cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setSelectedEnterprise(enterprise)}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg ${sectorInfo.bgColor}`}><SectorIcon className={`w-5 h-5 ${sectorInfo.color}`} /></div>
                                            <div>
                                                <CardTitle className="text-base">{enterprise.name}</CardTitle>
                                                <CardDescription>{sectorInfo.label}</CardDescription>
                                            </div>
                                        </div>
                                        <span className={`text-xs px-2 py-1 rounded-full ${
                                            isNationalBank
                                                ? 'bg-emerald-500/20 text-emerald-300'
                                                : enterprise.privatization_status === 'for_sale'
                                                ? 'bg-amber-500/20 text-amber-300'
                                                : enterprise.is_active
                                                    ? 'bg-emerald-500/20 text-emerald-400'
                                                    : 'bg-red-500/20 text-red-400'
                                        }`}>
                                            {isNationalBank ? 'Estatal estratégica' : enterprise.privatization_status === 'for_sale' ? 'À venda' : enterprise.is_active ? 'Ativa' : 'Inativa'}
                                        </span>
                                    </div>
                                </CardHeader>
                                {enterprise.description && (
                                    <CardContent className="pt-0 pb-3">
                                        <p className="text-sm text-muted-foreground">{enterprise.description}</p>
                                    </CardContent>
                                )}
                                <CardContent className="pt-0 pb-3">
                                    <div className="grid gap-3 sm:grid-cols-2">
                                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Custos operacionais</p>
                                                <p className="mt-1 text-lg font-semibold text-foreground">{formatCurrency(monthlyCost)}/mês</p>
                                            </div>
                                            <Coins className="h-5 w-5 text-amber-400" />
                                        </div>
                                        <p className="mt-2 text-xs text-muted-foreground">
                                            Funcionários: {formatCurrency(enterpriseCosts.employees)} • Infraestrutura: {formatCurrency(enterpriseCosts.infrastructure)}
                                        </p>
                                      </div>
                                      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-xs uppercase tracking-wide text-muted-foreground">Valor de mercado</p>
                                                <p className="mt-1 text-lg font-semibold text-foreground">{formatCurrency(marketValue)}</p>
                                            </div>
                                            <Scale className="h-5 w-5 text-emerald-400" />
                                        </div>
                                        <div className="mt-2">
                                            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                                                <span>Saúde operacional</span>
                                                <span>{healthScore}%</span>
                                            </div>
                                            <Progress value={healthScore} className="h-2" />
                                        </div>
                                      </div>
                                    </div>
                                </CardContent>
                                {sectorServices.length > 0 && (
                                    <CardContent className="pt-0 pb-3" onClick={e => e.stopPropagation()}>
                                        <div className="space-y-2 border-t border-border/40 pt-3">
                                            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><DollarSign className="w-3 h-3" /> Preços dos Serviços</p>
                                            {sectorServices.map(({ key, label, icon: ServiceIcon }) => (
                                                <div key={key} className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-1.5">
                                                        <ServiceIcon className={`w-3 h-3 ${sectorInfo.color}`} />
                                                        <span className="text-xs">{label}</span>
                                                    </div>
                                                    <Input
                                                        value={formatCurrency(servicePrices[key] || 0, true)}
                                                        onChange={(e) => handleInlinePriceChange(key, e.target.value)}
                                                        className="w-24 h-7 text-xs"
                                                    />
                                                </div>
                                            ))}
                                            <Button size="sm" variant="outline" className="w-full mt-1 h-7 text-xs" onClick={() => handleSaveInlinePrices(enterprise.id)} disabled={savingPricesFor === enterprise.id}>
                                                {savingPricesFor === enterprise.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                                                Salvar Preços
                                            </Button>
                                        </div>
                                    </CardContent>
                                )}
                                <CardFooter className="gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                                    <Button size="sm" variant="outline" onClick={() => openEdit(enterprise)}><Edit className="w-3 h-3 mr-1" /> Editar</Button>
                                    {isNationalBank ? (
                                        <>
                                            <Button size="sm" onClick={() => setSelectedEnterprise(enterprise)}><Landmark className="w-3 h-3 mr-1" /> Ver Detalhes</Button>
                                            {enterprise.privatization_status === 'for_sale' ? (
                                                <Button size="sm" variant="outline" onClick={() => handleCancelPrivatization(enterprise)}>
                                                    <CircleSlash className="w-3 h-3 mr-1" /> Cancelar Privatização
                                                </Button>
                                            ) : (
                                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => openPrivatizationDialog(enterprise)}><Banknote className="w-3 h-3 mr-1" /> Privatizar</Button>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Button size="sm" variant={enterprise.is_active ? "destructive" : "outline"} onClick={() => handleToggleActive(enterprise)}>
                                                {enterprise.is_active ? <><PowerOff className="w-3 h-3 mr-1" /> Desativar</> : <><Power className="w-3 h-3 mr-1" /> Ativar</>}
                                            </Button>
                                            {enterprise.privatization_status === 'for_sale' ? (
                                                <Button size="sm" variant="outline" onClick={() => handleCancelPrivatization(enterprise)}>
                                                    <CircleSlash className="w-3 h-3 mr-1" /> Cancelar Privatização
                                                </Button>
                                            ) : (
                                                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => openPrivatizationDialog(enterprise)}><Banknote className="w-3 h-3 mr-1" /> Privatizar</Button>
                                            )}
                                        </>
                                    )}
                                </CardFooter>
                            </Card>
                        );
                    })}
                </div>
            ) : (
                <Card className="glass-effect p-8 text-center text-muted-foreground">
                    <Building className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p>Nenhuma estatal ativa encontrada.</p>
                </Card>
            )}

            {privatizedEnterprises.length > 0 && (
                <div>
                    <h4 className="text-lg font-semibold mb-3 text-muted-foreground">Empresas Privatizadas</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {privatizedEnterprises.map(enterprise => {
                            const sectorInfo = ENTERPRISE_SECTORS.find(s => s.value === enterprise.sector) || ENTERPRISE_SECTORS.find(s => s.value === 'Outros');
                            const SectorIcon = sectorInfo.icon;
                            return (
                                <Card key={enterprise.id} className="glass-effect opacity-60">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-gray-500/20"><SectorIcon className="w-5 h-5 text-gray-400" /></div>
                                            <div>
                                                <CardTitle className="text-base line-through">{enterprise.name}</CardTitle>
                                                <CardDescription>{sectorInfo.label} — Privatizada</CardDescription>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardFooter>
                                        <Button size="sm" variant="outline" onClick={() => handleReactivate(enterprise)}>Reestatizar</Button>
                                    </CardFooter>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            )}

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingEnterprise ? 'Editar Estatal' : 'Criar Nova Estatal'}</DialogTitle>
                        <DialogDescription>
                            {editingEnterprise ? 'Atualize as informações da empresa estatal.' : 'Defina os dados da nova empresa estatal do governo.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label>Nome da Estatal</Label>
                            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: GOV Telecom" />
                        </div>
                        <div>
                            <Label>Setor</Label>
                            <Select
                                value={form.sector}
                                onValueChange={(value) =>
                                    setForm((current) => ({
                                        ...current,
                                        sector: value,
                                        name: value === 'Banco Nacional' && !current.name.trim() ? 'Banco Nacional' : current.name,
                                    }))
                                }
                            >
                                <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                                <SelectContent>
                                    {ENTERPRISE_SECTORS.map(s => (
                                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <Label>Valor de mercado</Label>
                                <Input
                                    value={form.market_value}
                                    onChange={(event) => setForm((current) => ({ ...current, market_value: formatCurrency(event.target.value, true) }))}
                                    placeholder="R$ 0,00"
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <Label>Saúde operacional</Label>
                                    <span className="text-sm text-muted-foreground">{Number(form.health_score || 0)}%</span>
                                </div>
                                <Slider
                                    value={[Number(form.health_score || 0)]}
                                    min={0}
                                    max={100}
                                    step={1}
                                    onValueChange={([value]) => setForm((current) => ({ ...current, health_score: value }))}
                                />
                            </div>
                        </div>
                        <div>
                            <Label>Descrição</Label>
                            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Breve descrição da estatal..." rows={3} />
                        </div>
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                            {editingEnterprise ? 'Salvar' : 'Criar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog open={Boolean(enterpriseToPrivatize)} onOpenChange={(open) => !open && setEnterpriseToPrivatize(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Privatizar Estatal</DialogTitle>
                        <DialogDescription>
                            Defina o preço de venda. A estatal continuará pública até que alguém compre.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-4">
                        <Label>Preço de privatização</Label>
                        <Input
                            value={privatizationPrice}
                            onChange={(event) => setPrivatizationPrice(formatCurrency(event.target.value, true))}
                            placeholder="R$ 0,00"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEnterpriseToPrivatize(null)}>Cancelar</Button>
                        <Button onClick={handlePrivatize}>
                            <Banknote className="w-4 h-4 mr-2" />
                            Colocar à Venda
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};


const PresidentDashboard = () => {
    const { toast } = useToast();
    const navigate = useNavigate();
    const { user, refreshUser } = useAuth();
    const [loading, setLoading] = useState(true);
    const [ministers, setMinisters] = useState([]);
    const [ministries, setMinistries] = useState([]);
    const [decrees, setDecrees] = useState([]);
    const [budget, setBudget] = useState(null);
    const [taxes, setTaxes] = useState(null);
    const [servicePrices, setServicePrices] = useState(null);
    const [baseTariffs, setBaseTariffs] = useState(null);
    const [govFinances, setGovFinances] = useState(null);
    const [bankPolicy, setBankPolicy] = useState(DEFAULT_BANK_POLICY);
    const [economicPolicy, setEconomicPolicy] = useState(DEFAULT_ECONOMIC_POLICY);
    const [deficit, setDeficit] = useState(0);
    const [executiveState, setExecutiveState] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const fetchData = useCallback(async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const [ministersRes, ministriesRes, decreesRes, settingsRes, financesRes, economicStateRes, executiveStateRes] = await Promise.all([
                fetchActiveMinistersWithProfiles(supabase),
                supabase.from('government_ministries').select('*').order('name'),
                supabase.from('decrees').select('*').order('created_at', { ascending: false }),
                supabase.from('system_settings').select('key, value'),
                supabase.from('government_finances').select('*').single(),
                supabase.from('economic_state').select('current_selic').eq('id', true).single(),
                fetchExecutiveConstitutionalState(supabase)
                    .then((data) => ({ data, error: null }))
                    .catch((error) => ({ data: null, error })),
            ]);

            if (settingsRes.error) throw settingsRes.error;
            if (financesRes.error) throw financesRes.error;

            const optionalErrors = [
                ministersRes.error,
                ministersRes.warning,
                ministriesRes.error,
                decreesRes.error,
                economicStateRes.error,
                executiveStateRes.error,
            ].filter(Boolean);

            if (optionalErrors.length > 0) {
                console.warn('Alguns dados complementares do painel presidencial não foram carregados:', optionalErrors);
            }

            if (!ministersRes.error) setMinisters(ministersRes.data || []);
            if (!ministriesRes.error) setMinistries(ministriesRes.data || []);
            if (!decreesRes.error) setDecrees(decreesRes.data || []);
            setGovFinances(financesRes.data);
            if (!executiveStateRes.error) setExecutiveState(executiveStateRes.data);

            const settingsMap = settingsRes.data.reduce((acc, item) => {
                acc[item.key] = item.value;
                return acc;
            }, {});

            const budgetData = settingsMap.government_budget || { areas: [] };
            const adjustedBudgetAreas = rebalanceGovernmentBudgetAreas(
                budgetData.areas,
                financesRes.data.treasury_balance
            );
            const normalizedBudgetData = { ...budgetData, areas: adjustedBudgetAreas };

            if (haveGovernmentBudgetAreasChanged(budgetData.areas, adjustedBudgetAreas)) {
                const { error: budgetSaveError } = await supabase
                    .from('system_settings')
                    .update({ value: normalizedBudgetData })
                    .eq('key', 'government_budget');

                if (budgetSaveError) {
                    throw budgetSaveError;
                }
            }

            setBudget(normalizedBudgetData);
            setTaxes(settingsMap.tax_rates || { product_tax: 0, service_tax: 0, transaction_tax: { type: 'percentage', value: 0 } });
            setServicePrices(settingsMap.basic_service_prices || {});
            setBaseTariffs(settingsMap.base_tariffs || {});
            const normalizedEconomicPolicy = normalizeEconomicPolicy({
                ...settingsMap[ECONOMIC_POLICY_SETTINGS_KEY],
                selic_rate: economicStateRes.data?.current_selic
                    ?? settingsMap[ECONOMIC_POLICY_SETTINGS_KEY]?.selic_rate
                    ?? DEFAULT_ECONOMIC_POLICY.selic_rate,
            });
            setEconomicPolicy(normalizedEconomicPolicy);
            setBankPolicy(
                normalizeBankPolicyForEconomicPolicy(
                    settingsMap[BANK_POLICY_SETTINGS_KEY],
                    normalizedEconomicPolicy,
                    DEFAULT_BANK_POLICY
                )
            );

            const totalAllocated = getGovernmentBudgetTotal(adjustedBudgetAreas);
            setDeficit(financesRes.data.treasury_balance - totalAllocated);

        } catch (error) {
            toast({ title: 'Erro ao carregar dados', description: error.message, variant: 'destructive' });
        } finally {
            if (showLoading) setLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        let refreshTimer;
        const scheduleRefresh = () => {
            window.clearTimeout(refreshTimer);
            refreshTimer = window.setTimeout(() => fetchData(false), 250);
        };
        let channel = supabase.channel('presidential-dashboard-live');

        [
            'ministers',
            'decrees',
            'bills',
            'system_settings',
            'government_finances',
            'economic_state',
            'economic_policy_decisions',
            'investment_options',
            'profiles',
            'elections',
            'candidates',
            'party_members',
            'government_ministries',
            'government_popularity_state',
            'government_popularity_events',
            'national_indicator_points',
        ].forEach((table) => {
            channel = channel.on('postgres_changes', {
                event: '*', schema: 'public', table,
            }, scheduleRefresh);
        });

        channel.subscribe();
        return () => {
            window.clearTimeout(refreshTimer);
            supabase.removeChannel(channel);
        };
    }, [fetchData]);

    const handleResignation = async () => {
        try {
            const response = await fetchWithSessionAuth('/api/elections/resign-presidency', {
                method: 'POST',
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(payload?.error || 'Não foi possível registrar a renúncia presidencial.');
            }

            toast({ title: 'Renúncia Aceita', description: payload.message });
            await refreshUser();
            navigate('/');
        } catch (error) {
            toast({ title: 'Erro ao renunciar', description: error.message, variant: 'destructive' });
        }
    };


    if (loading) {
        return <div className="flex justify-center items-center h-screen"><Loader2 className="animate-spin w-16 h-16" /></div>;
    }

    const cardUsage = govFinances?.corporate_card_limit ? (govFinances.corporate_card_used / govFinances.corporate_card_limit) * 100 : 0;
    const loanUsage = govFinances?.loan_limit ? (govFinances.loans_balance / govFinances.loan_limit) * 100 : 0;

    const corporateCardValue = govFinances
        ? `${formatCurrency(govFinances.corporate_card_used)} / ${formatCurrency(govFinances.corporate_card_limit)}`
        : 'R$ 0,00';

    const availableTreasury = govFinances
        ? Math.max(0, govFinances.treasury_balance - getGovernmentBudgetTotal(budget?.areas || []))
        : 0;
    const budgetAreas = budget?.areas || [];
    const allocatedBudget = getGovernmentBudgetTotal(budgetAreas);
    const treasuryBalance = Number(govFinances?.treasury_balance || 0);
    const loanAvailable = govFinances ? Math.max(0, Number(govFinances.loan_limit || 0) - Number(govFinances.loans_balance || 0)) : 0;
    const topBudgetAreas = [...budgetAreas]
        .sort((left, right) => Number(right.allocated_value || 0) - Number(left.allocated_value || 0))
        .slice(0, 5);
    const viceAssumedPresidency = Boolean(executiveState?.viceAssumedPresidency);
    const currentPresidentName = executiveState?.currentPresidentProfile?.full_name || 'Cargo vago';
    const currentViceName = viceAssumedPresidency
        ? 'Vaga após sucessão presidencial'
        : executiveState?.currentViceProfile?.full_name || 'Sem vice em exercício';
    const executiveMandateLabel = executiveState?.currentTerm?.name
        || (executiveState?.manualExecutiveOfficeActive
            ? 'Cargo atribuído manualmente pelo admin'
            : 'Nenhum mandato ativo identificado');

    return (
        <>
            <Helmet>
                <title>Painel Presidencial - GOV.RP</title>
                <meta name="description" content="Gerencie o governo, ministros, atos presidenciais, estatais e a gestão financeira." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Landmark}
                    title="Painel"
                    gradientText="Presidencial"
                    description="O centro de comando da nação. Administre o futuro do país."
                    iconColor="text-amber-400"
                    centered={true}
                />

                <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2 flex justify-center">
                        <TabsList className="inline-flex min-w-max w-max gap-2">
                            <TabsTrigger value="overview" className="min-w-[9.5rem] shrink-0"><LayoutDashboard className="w-4 h-4 mr-2" />Visão Geral</TabsTrigger>
                            <TabsTrigger value="finances" className="min-w-[11rem] shrink-0"><Coins className="w-4 h-4 mr-2" />Gestão Financeira</TabsTrigger>
                            <TabsTrigger value="management" className="min-w-[13rem] shrink-0"><Settings className="w-4 h-4 mr-2" />Gestão Governamental</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="overview" className="mt-6 space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-6">
                            <Card className="glass-effect overflow-hidden">
                                <CardHeader className="border-b border-white/10 bg-white/[0.03]">
                                    <CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5 text-emerald-400" /> Situação do Executivo</CardTitle>
                                    <CardDescription>Comando institucional, sucessão e mandato presidencial vigente.</CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
                                    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                                        <p className="text-xs uppercase text-muted-foreground">Presidente em exercício</p>
                                        <p className="mt-2 text-lg font-semibold text-foreground">{currentPresidentName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {executiveState?.isVacant
                                                ? 'Vacância presidencial ativa'
                                                : viceAssumedPresidency
                                                    ? 'Vice eleito que assumiu a Presidência'
                                                    : 'Chefia do Executivo regular'}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
                                        <p className="text-xs uppercase text-muted-foreground">Vice-Presidência</p>
                                        <p className="mt-2 text-lg font-semibold text-foreground">{currentViceName}</p>
                                        <p className="text-sm text-muted-foreground">{executiveMandateLabel}</p>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-black/20 p-4 sm:col-span-2">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                            <div>
                                                <p className="text-xs uppercase text-muted-foreground">Cofre público disponível</p>
                                                <p className="mt-2 text-3xl font-bold text-emerald-400">{formatCurrency(availableTreasury)}</p>
                                            </div>
                                            <Button variant="outline" onClick={() => setActiveTab('finances')}>Abrir Gestão Financeira</Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="glass-effect">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><PiggyBank className="w-5 h-5 text-primary" /> Resumo Fiscal</CardTitle>
                                    <CardDescription>Visão rápida de orçamento e capacidade de crédito.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                                        <span className="text-sm text-muted-foreground">Saldo bruto do cofre</span>
                                        <span className="font-semibold">{formatCurrency(treasuryBalance)}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                                        <span className="text-sm text-muted-foreground">Orçamento alocado</span>
                                        <span className="font-semibold">{formatCurrency(allocatedBudget)}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                                        <span className="text-sm text-muted-foreground">{deficit >= 0 ? 'Superávit' : 'Déficit'}</span>
                                        <span className={`font-semibold ${deficit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(Math.abs(deficit))}</span>
                                    </div>
                                    <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
                                        <span className="text-sm text-muted-foreground">Crédito governamental livre</span>
                                        <span className="font-semibold text-amber-300">{formatCurrency(loanAvailable)}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                                    <FinanceCard title="Cofre Público (Disponível)" value={availableTreasury} icon={University} colorClass="text-emerald-400" />
                                </motion.div>
                            )}
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                                <FinanceCard title={deficit >= 0 ? "Superávit Orçamentário" : "Déficit Orçamentário"} value={Math.abs(deficit)} icon={deficit >= 0 ? TrendingUp : TrendingDown} colorClass={deficit >= 0 ? 'text-green-400' : 'text-red-400'} />
                            </motion.div>
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                                    <FinanceCard title="Empréstimos Ativos" value={govFinances.loans_balance} icon={Handshake} colorClass="text-amber-400" />
                                </motion.div>
                            )}
                            {govFinances && (
                                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
                                    <FinanceCard title="Uso do Cartão Governamental" value={corporateCardValue} icon={CreditCard} isCurrency={false} colorClass="text-orange-400" />
                                </motion.div>
                            )}
                            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
                                <FinanceCard title="Taxa Selic" value={`${Number(economicPolicy?.selic_rate || 0).toFixed(2)}% a.a.`} icon={Percent} isCurrency={false} colorClass="text-cyan-300" />
                            </motion.div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <Card className="glass-effect overflow-hidden">
                                <CardHeader className="border-b border-white/10 bg-white/[0.03]">
                                    <CardTitle className="flex items-center gap-2"><University className="w-5 h-5 text-emerald-400" /> Execução Orçamentária</CardTitle>
                                    <CardDescription>Distribuição dos recursos públicos por área prioritária.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 p-6">
                                    <div>
                                        <div className="mb-2 flex items-center justify-between text-sm">
                                            <span className="text-muted-foreground">Alocado sobre saldo bruto</span>
                                            <span className="font-semibold">{treasuryBalance > 0 ? ((allocatedBudget / treasuryBalance) * 100).toFixed(1) : '0.0'}%</span>
                                        </div>
                                        <Progress value={treasuryBalance > 0 ? Math.min(100, (allocatedBudget / treasuryBalance) * 100) : 0} className="h-3" />
                                    </div>
                                    {topBudgetAreas.length ? topBudgetAreas.map((area) => (
                                        <div key={area.name} className="flex items-center justify-between rounded-lg bg-black/20 p-3">
                                            <span className="text-sm text-muted-foreground">{area.name}</span>
                                            <span className="font-semibold">{formatCurrency(area.allocated_value || 0)}</span>
                                        </div>
                                    )) : (
                                        <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma área orçamentária configurada.</p>
                                    )}
                                </CardContent>
                            </Card>

                            {govFinances && (
                                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}>
                                    <Card className="glass-effect overflow-hidden">
                                        <CardHeader className="border-b border-white/10 bg-white/[0.03]">
                                            <CardTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-orange-400"/> Crédito e Endividamento</CardTitle>
                                            <CardDescription>Cartão governamental e empréstimos ativos.</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-6 p-6">
                                            <div>
                                                <div className="mb-2 flex justify-between">
                                                    <div>
                                                        <p className="text-sm text-muted-foreground">Cartão governamental</p>
                                                        <p className="text-xl font-bold text-orange-400">{formatCurrency(govFinances.corporate_card_used)}</p>
                                                    </div>
                                                    <p className="text-sm font-semibold">{cardUsage.toFixed(1)}%</p>
                                                </div>
                                                <Progress value={Math.min(100, cardUsage)} className="h-3 bg-muted" indicatorClassName={`${cardUsage > 80 ? 'bg-red-500' : cardUsage > 50 ? 'bg-orange-500' : 'bg-green-500'}`} />
                                                <p className="mt-2 text-xs text-muted-foreground">Limite total: {formatCurrency(govFinances.corporate_card_limit)}</p>
                                            </div>
                                            <div>
                                                <div className="mb-2 flex justify-between">
                                                    <div>
                                                        <p className="text-sm text-muted-foreground">Empréstimos ativos</p>
                                                        <p className="text-xl font-bold text-amber-400">{formatCurrency(govFinances.loans_balance)}</p>
                                                    </div>
                                                    <p className="text-sm font-semibold">{loanUsage.toFixed(1)}%</p>
                                                </div>
                                                <Progress value={Math.min(100, loanUsage)} className="h-3 bg-muted" indicatorClassName={`${loanUsage > 80 ? 'bg-red-500' : loanUsage > 50 ? 'bg-amber-500' : 'bg-green-500'}`} />
                                                <p className="mt-2 text-xs text-muted-foreground">Limite total: {formatCurrency(govFinances.loan_limit)}</p>
                                                {loanUsage >= 100 && (
                                                    <p className="text-xs text-red-500 mt-3">A nação atingiu o topo do limite de dívidas permitido no momento.</p>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="finances" className="mt-6">
                        <Tabs defaultValue="budget" className="w-full">
                            <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2 mb-6 flex justify-center">
                                <TabsList className="inline-flex min-w-max w-max gap-2 border-b border-border/40 bg-transparent p-0">
                                    <TabsTrigger value="budget" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Building2 className="mr-2 h-4 w-4" />Orçamento Governamental</TabsTrigger>
                                    <TabsTrigger value="taxes" className="min-w-[12rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Receipt className="mr-2 h-4 w-4" />Gestão de Impostos</TabsTrigger>
                                    <TabsTrigger value="prices" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><DollarSign className="mr-2 h-4 w-4" />Valores de Tarifas Base</TabsTrigger>
                                    <TabsTrigger value="monetary" className="min-w-[12rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Percent className="mr-2 h-4 w-4" />Política Monetária</TabsTrigger>
                                    <TabsTrigger value="actions" className="min-w-[11rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Banknote className="mr-2 h-4 w-4" />Empréstimos/Cofre</TabsTrigger>
                                </TabsList>
                            </div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                                <TabsContent value="budget" className="mt-0">
                                    <div className="max-w-4xl mx-auto">
                                        {budget && govFinances && <BudgetManager budget={budget} treasuryBalance={govFinances.treasury_balance} onUpdate={fetchData} setActiveTab={setActiveTab} />}
                                    </div>
                                </TabsContent>

                                <TabsContent value="taxes" className="mt-0">
                                    <div className="max-w-3xl mx-auto">
                                        {taxes && <TaxManager taxes={taxes} onUpdate={fetchData} setActiveTab={setActiveTab} />}
                                    </div>
                                </TabsContent>

                                <TabsContent value="prices" className="mt-0">
                                    <div className="max-w-3xl mx-auto">
                                        <TariffManager baseTariffs={baseTariffs} onUpdate={fetchData} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="monetary" className="mt-0">
                                    <div className="max-w-4xl mx-auto">
                                        <SelicManager economicPolicy={economicPolicy} bankPolicy={bankPolicy} onUpdate={fetchData} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="actions" className="mt-0">
                                    <div className="max-w-xl mx-auto pt-8">
                                        <Card className="glass-effect">
                                            <CardHeader className="text-center">
                                                <CardTitle className="text-2xl">Ações de Cofre</CardTitle>
                                                {govFinances && (
                                                    <CardDescription className="text-base">
                                                        Margem atual pré-aprovada para empréstimos: <br/><span className="text-green-400 font-bold text-lg">{formatCurrency(govFinances.loan_limit - govFinances.loans_balance)}</span>
                                                    </CardDescription>
                                                )}
                                            </CardHeader>
                                            <CardContent className="flex justify-center pb-8">
                                                <LoanManager onUpdate={fetchData} setActiveTab={setActiveTab} govFinances={govFinances} />
                                            </CardContent>
                                        </Card>
                                    </div>
                                </TabsContent>
                            </motion.div>
                        </Tabs>
                    </TabsContent>

                    <TabsContent value="management" className="mt-6">
                        <Tabs defaultValue="constitutional" className="w-full">
                            <div className="overflow-x-auto custom-scrollbar -mx-4 px-4 pb-2 mb-6 flex justify-center">
                                <TabsList className="inline-flex min-w-max w-max gap-2 border-b border-border/40 bg-transparent p-0">
                                    <TabsTrigger value="constitutional" className="min-w-[12rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Shield className="mr-2 h-4 w-4" />Estado Executivo</TabsTrigger>
                                    <TabsTrigger value="dynamics" className="min-w-[14rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Activity className="mr-2 h-4 w-4" />Indicadores e Governo</TabsTrigger>
                                    <TabsTrigger value="ministers" className="min-w-[13rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><UserPlus className="mr-2 h-4 w-4" />Ministros e Nomeações</TabsTrigger>
                                    <TabsTrigger value="decrees" className="min-w-[13rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><FileCheck className="mr-2 h-4 w-4" />Atos Presidenciais</TabsTrigger>
                                    <TabsTrigger value="enterprises" className="min-w-[8rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><Building2 className="mr-2 h-4 w-4" />Estatais</TabsTrigger>
                                    <TabsTrigger value="resignation" className="min-w-[8rem] shrink-0 data-[state=active]:bg-card data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-t-lg px-6"><LogOut className="mr-2 h-4 w-4" />Renúncia</TabsTrigger>
                                </TabsList>
                            </div>

                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                                <TabsContent value="constitutional" className="mt-0">
                                    <div className="space-y-6 max-w-5xl mx-auto">
                                        <ConstitutionalStatusCard executiveState={executiveState} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="dynamics" className="mt-0">
                                    <div className="space-y-6 max-w-6xl mx-auto"><GovernmentDynamicsPanel /></div>
                                </TabsContent>

                                <TabsContent value="ministers" className="mt-0">
                                    <div className="space-y-6 max-w-5xl mx-auto">
                                        <MinisterManager ministers={ministers} ministries={ministries} onUpdate={fetchData} />
                                        <SpecialAppointmentsManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="decrees" className="mt-0">
                                    <div className="space-y-6 max-w-5xl mx-auto">
                                        <DecreeManager decrees={decrees} onUpdate={fetchData} />
                                        <BillReviewManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                        <ProvisionalMeasureManager executiveState={executiveState} onUpdate={fetchData} actorId={user?.id} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="enterprises" className="mt-0">
                                    <div className="max-w-5xl mx-auto">
                                        <StateEnterpriseManager onUpdate={fetchData} />
                                    </div>
                                </TabsContent>

                                <TabsContent value="resignation" className="mt-0">
                                    <div className="max-w-xl mx-auto pt-8">
                                        <ResignationManager onResign={handleResignation} />
                                    </div>
                                </TabsContent>
                            </motion.div>
                        </Tabs>
                    </TabsContent>
                </Tabs>
            </div>
        </>
    );
};

export default PresidentDashboard;
